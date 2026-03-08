//! Transcript ingestion dispatch — scan, parse, and ingest Claude JSONL transcripts.
//!
//! Claude Code stores conversation transcripts as JSONL files under
//! `~/.claude/projects/<encoded-path>/`. This module scans that directory tree,
//! parses the JSONL records, filters for meaningful content, deduplicates
//! against existing memories, and ingests them into Just-Memory.

use std::collections::HashSet;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::params;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::consolidation::enrichment;
use crate::infra::server_context::ServerContext;

/// Handle `memory_ingest` tool call.
pub async fn handle_ingest(ctx: &ServerContext, args: &Value) -> Result<Value> {
    let action = args["action"].as_str().unwrap_or("scan");
    let project_id = args["project_id"]
        .as_str()
        .unwrap_or(&ctx.project_id);

    match action {
        "scan" => handle_scan(args).await,
        "ingest" => handle_ingest_transcripts(ctx, args, project_id).await,
        "status" => handle_ingest_status(ctx, project_id).await,
        _ => anyhow::bail!("Unknown ingest action: {action}"),
    }
}

/// Scan `~/.claude/projects/` for transcript files without ingesting.
async fn handle_scan(args: &Value) -> Result<Value> {
    let base_dir = resolve_transcript_dir(args)?;

    if !base_dir.exists() {
        return Ok(json!({
            "found": false,
            "path": base_dir.to_string_lossy(),
            "message": "Claude transcript directory not found"
        }));
    }

    let mut sessions: Vec<Value> = Vec::new();
    let mut total_files = 0u64;
    let mut total_bytes = 0u64;

    // Walk project directories
    for entry in std::fs::read_dir(&base_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() { continue; }

        let dir_name = entry.file_name().to_string_lossy().to_string();
        let project = derive_project_from_dir_name(&dir_name);

        // Count JSONL files in this project dir
        let mut file_count = 0u64;
        let mut dir_bytes = 0u64;

        if let Ok(files) = std::fs::read_dir(entry.path()) {
            for f in files.flatten() {
                let fname = f.file_name().to_string_lossy().to_string();
                if fname.ends_with(".jsonl") {
                    file_count += 1;
                    dir_bytes += f.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }
        }

        if file_count > 0 {
            sessions.push(json!({
                "directory": dir_name,
                "derived_project_id": project,
                "file_count": file_count,
                "size_bytes": dir_bytes
            }));
            total_files += file_count;
            total_bytes += dir_bytes;
        }
    }

    Ok(json!({
        "found": true,
        "base_path": base_dir.to_string_lossy(),
        "total_sessions": sessions.len(),
        "total_files": total_files,
        "total_size_mb": format!("{:.1}", total_bytes as f64 / (1024.0 * 1024.0)),
        "sessions": sessions
    }))
}

/// Ingest transcripts into Just-Memory.
async fn handle_ingest_transcripts(
    ctx: &ServerContext,
    args: &Value,
    target_project_id: &str,
) -> Result<Value> {
    let base_dir = resolve_transcript_dir(args)?;
    if !base_dir.exists() {
        anyhow::bail!("Claude transcript directory not found: {}", base_dir.display());
    }

    let filter_project = args["filter_project"].as_str();
    let max_files = args["max_files"].as_u64().unwrap_or(100) as usize;
    let dry_run = args["dry_run"].as_bool().unwrap_or(false);

    let conn = ctx.pool.get().context("ingest: pool")?;

    // Collect existing content hashes for dedup
    let mut existing_hashes: HashSet<String> = HashSet::new();
    {
        let mut stmt = conn.prepare(
            "SELECT content_hash FROM memories WHERE project_id = ?1 AND deleted_at IS NULL AND content_hash IS NOT NULL"
        )?;
        let rows = stmt.query_map(params![target_project_id], |row| {
            row.get::<_, String>(0)
        })?;
        for row in rows.flatten() {
            existing_hashes.insert(row);
        }
    }

    let mut ingested = 0u64;
    let mut skipped_dup = 0u64;
    let mut skipped_noise = 0u64;
    let mut errors = 0u64;
    let mut files_processed = 0usize;

    // Walk project directories
    for entry in std::fs::read_dir(&base_dir)?.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }

        let dir_name = entry.file_name().to_string_lossy().to_string();
        let derived_project = derive_project_from_dir_name(&dir_name);

        // Apply project filter if specified
        if let Some(fp) = filter_project {
            if derived_project != fp { continue; }
        }

        // Process JSONL files in this directory
        if let Ok(files) = std::fs::read_dir(entry.path()) {
            for f in files.flatten() {
                if files_processed >= max_files { break; }

                let fname = f.file_name().to_string_lossy().to_string();
                if !fname.ends_with(".jsonl") { continue; }

                let file_path = f.path();
                match process_transcript_file(
                    &conn,
                    &file_path,
                    target_project_id,
                    &derived_project,
                    &existing_hashes,
                    dry_run,
                ) {
                    Ok(stats) => {
                        ingested += stats.ingested;
                        skipped_dup += stats.skipped_dup;
                        skipped_noise += stats.skipped_noise;
                        errors += stats.errors;
                        // Add newly ingested hashes to prevent self-duplication
                        existing_hashes.extend(stats.new_hashes);
                    }
                    Err(e) => {
                        warn!("Failed to process {}: {e}", file_path.display());
                        errors += 1;
                    }
                }
                files_processed += 1;
            }
        }
    }

    info!("Transcript ingestion: {ingested} stored, {skipped_dup} dedup, {skipped_noise} noise, {errors} errors");

    Ok(json!({
        "action": "ingest",
        "dry_run": dry_run,
        "files_processed": files_processed,
        "ingested": ingested,
        "skipped_duplicate": skipped_dup,
        "skipped_noise": skipped_noise,
        "errors": errors,
        "project_id": target_project_id
    }))
}

/// Show ingestion status — how many transcript-sourced memories exist.
async fn handle_ingest_status(ctx: &ServerContext, project_id: &str) -> Result<Value> {
    let conn = ctx.pool.get().context("ingest status: pool")?;

    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM memories WHERE project_id = ?1 AND agent_id = 'transcript_ingest' AND deleted_at IS NULL",
        params![project_id],
        |row| row.get(0),
    )?;

    let recent: i64 = conn.query_row(
        "SELECT COUNT(*) FROM memories WHERE project_id = ?1 AND agent_id = 'transcript_ingest' AND deleted_at IS NULL AND created_at > datetime('now', '-24 hours')",
        params![project_id],
        |row| row.get(0),
    )?;

    Ok(json!({
        "project_id": project_id,
        "transcript_memories": total,
        "recent_24h": recent,
        "agent_id": "transcript_ingest"
    }))
}

// ============================================================================
// Internal helpers
// ============================================================================

struct IngestFileStats {
    ingested: u64,
    skipped_dup: u64,
    skipped_noise: u64,
    errors: u64,
    new_hashes: Vec<String>,
}

fn resolve_transcript_dir(args: &Value) -> Result<PathBuf> {
    if let Some(path) = args["transcript_dir"].as_str() {
        return Ok(PathBuf::from(path));
    }
    let home = dirs::home_dir().context("Cannot determine home directory")?;
    Ok(home.join(".claude").join("projects"))
}

/// Derive a project_id slug from the Claude projects directory name.
///
/// Directory names encode the working directory path, e.g.:
/// `-var-home-Voork-Desktop-Project-Just-Memory-Experiment-Lab` -> `just-memory`
/// `-var-home-Voork-Desktop-Project-LagWarden` -> `lagwarden`
fn derive_project_from_dir_name(dir_name: &str) -> String {
    let parts: Vec<&str> = dir_name.split('-').collect();

    // Look for known project names in the path segments
    let lower_parts: Vec<String> = parts.iter().map(|p| p.to_lowercase()).collect();
    let joined = lower_parts.join(" ");

    if joined.contains("just memory") || joined.contains("justmemory") {
        return "just-memory".to_string();
    }
    if joined.contains("lagwarden") {
        return "lagwarden".to_string();
    }

    // Default: use the last meaningful path segment
    for part in parts.iter().rev() {
        let p = part.trim();
        if !p.is_empty() && p.len() > 2
            && !["var", "home", "Desktop", "Project", "src"].contains(&p)
        {
            return p.to_lowercase();
        }
    }

    "workspace".to_string()
}

/// Process a single JSONL transcript file.
fn process_transcript_file(
    conn: &rusqlite::Connection,
    path: &Path,
    target_project_id: &str,
    _source_project: &str,
    existing_hashes: &HashSet<String>,
    dry_run: bool,
) -> Result<IngestFileStats> {
    let file = std::fs::File::open(path)
        .with_context(|| format!("Cannot open {}", path.display()))?;
    let reader = BufReader::new(file);

    let mut stats = IngestFileStats {
        ingested: 0,
        skipped_dup: 0,
        skipped_noise: 0,
        errors: 0,
        new_hashes: Vec::new(),
    };

    let session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown");

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => { stats.errors += 1; continue; }
        };

        if line.trim().is_empty() { continue; }

        let record: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => { stats.errors += 1; continue; }
        };

        // Extract meaningful content from the JSONL record
        let extracts = extract_from_record(&record);
        for extract in extracts {
            if is_noise(&extract.content) {
                stats.skipped_noise += 1;
                continue;
            }

            let content_hash = compute_hash(&extract.content);
            if existing_hashes.contains(&content_hash) {
                stats.skipped_dup += 1;
                continue;
            }

            if !dry_run {
                let memory_type = enrichment::classify_memory_type(&extract.content);
                let tags = enrichment::extract_tags(&extract.content, 5);
                let importance = enrichment::compute_importance(&extract.content, memory_type);
                let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string());
                let id = Uuid::new_v4().to_string();

                match conn.execute(
                    "INSERT INTO memories (id, project_id, content, type, tags, importance, confidence, strength, agent_id, content_hash, valid_from)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0.7, 1.0, 'transcript_ingest', ?7, ?8)",
                    params![
                        id,
                        target_project_id,
                        extract.content,
                        memory_type,
                        tags_json,
                        importance,
                        content_hash,
                        extract.timestamp.as_deref()
                    ],
                ) {
                    Ok(_) => {
                        stats.ingested += 1;
                        stats.new_hashes.push(content_hash);
                    }
                    Err(e) => {
                        debug!("Insert failed for session {session_id}: {e}");
                        stats.errors += 1;
                    }
                }
            } else {
                stats.ingested += 1;
                stats.new_hashes.push(content_hash);
            }
        }
    }

    Ok(stats)
}

/// Content extracted from a transcript record.
struct TranscriptExtract {
    content: String,
    timestamp: Option<String>,
}

/// Extract meaningful content from a JSONL record.
///
/// Claude Code transcript format has records with:
/// - `type: "human"` — user messages
/// - `type: "assistant"` — Claude responses
/// - `type: "tool_use"` — tool calls
/// - `type: "tool_result"` — tool outputs
///
/// We primarily want decisions, errors, fixes, procedures, and key facts.
fn extract_from_record(record: &Value) -> Vec<TranscriptExtract> {
    let mut extracts = Vec::new();
    let timestamp = record["timestamp"].as_str().map(String::from)
        .or_else(|| Some(Utc::now().to_rfc3339()));

    // Handle message content
    if let Some(message) = record.get("message") {
        if let Some(content) = message.get("content") {
            // content can be a string or array of blocks
            if let Some(text) = content.as_str() {
                if text.len() >= 50 {
                    extracts.push(TranscriptExtract {
                        content: truncate_content(text, 2000),
                        timestamp: timestamp.clone(),
                    });
                }
            } else if let Some(blocks) = content.as_array() {
                for block in blocks {
                    if let Some(text) = block["text"].as_str() {
                        if text.len() >= 50 {
                            extracts.push(TranscriptExtract {
                                content: truncate_content(text, 2000),
                                timestamp: timestamp.clone(),
                            });
                        }
                    }
                }
            }
        }
    }

    // Handle top-level content (simpler format)
    if extracts.is_empty() {
        if let Some(text) = record["content"].as_str() {
            if text.len() >= 50 {
                extracts.push(TranscriptExtract {
                    content: truncate_content(text, 2000),
                    timestamp: timestamp.clone(),
                });
            }
        }
    }

    extracts
}

/// Check if content is noise (too short, repetitive, or low-value).
fn is_noise(content: &str) -> bool {
    let trimmed = content.trim();

    // Too short
    if trimmed.len() < 50 {
        return true;
    }

    // Common noise patterns
    let noise_patterns = [
        "I'll help you with that",
        "Let me ",
        "Sure, ",
        "OK, ",
        "Certainly",
        "Here's what I found",
        "I understand",
        "Let me think about",
        "I apologize",
        "I'm sorry",
    ];

    // If content starts with a noise pattern and is short, skip it
    if trimmed.len() < 200 {
        for pattern in &noise_patterns {
            if trimmed.starts_with(pattern) {
                return true;
            }
        }
    }

    // Pure JSON/code blocks that are just tool outputs
    if trimmed.starts_with('{') && trimmed.ends_with('}') && trimmed.len() < 500 {
        return true;
    }

    false
}

fn compute_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn truncate_content(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_project_just_memory() {
        let name = "-var-home-Voork-Desktop-Project-Just-Memory-Experiment-Lab";
        assert_eq!(derive_project_from_dir_name(name), "just-memory");
    }

    #[test]
    fn test_derive_project_lagwarden() {
        let name = "-var-home-Voork-Desktop-Project-LagWarden";
        assert_eq!(derive_project_from_dir_name(name), "lagwarden");
    }

    #[test]
    fn test_derive_project_unknown() {
        let name = "-var-home-user-myproject";
        assert_eq!(derive_project_from_dir_name(name), "myproject");
    }

    #[test]
    fn test_is_noise_short() {
        assert!(is_noise("hello"));
        assert!(is_noise("yes"));
        assert!(is_noise("OK"));
    }

    #[test]
    fn test_is_noise_boilerplate() {
        assert!(is_noise("I'll help you with that and look into the issue."));
        assert!(is_noise("Sure, let me check the code for you."));
    }

    #[test]
    fn test_is_noise_meaningful() {
        let content = "The bug was caused by a race condition in the event loop where the timer \
            expired before the connection was established, leading to a null pointer dereference.";
        assert!(!is_noise(content));
    }

    #[test]
    fn test_is_noise_json_blob() {
        assert!(is_noise(r#"{"status": "ok", "count": 5, "items": ["a", "b"]}"#));
    }

    #[test]
    fn test_compute_hash_deterministic() {
        let h1 = compute_hash("test content");
        let h2 = compute_hash("test content");
        assert_eq!(h1, h2);
        assert_ne!(h1, compute_hash("different content"));
    }

    #[test]
    fn test_truncate_content_short() {
        assert_eq!(truncate_content("hello", 10), "hello");
    }

    #[test]
    fn test_truncate_content_long() {
        let long = "a".repeat(100);
        let result = truncate_content(&long, 50);
        assert_eq!(result.len(), 53); // 50 + "..."
        assert!(result.ends_with("..."));
    }

    #[test]
    fn test_extract_from_record_empty() {
        let record = json!({});
        assert!(extract_from_record(&record).is_empty());
    }

    #[test]
    fn test_extract_from_record_message() {
        let record = json!({
            "message": {
                "role": "assistant",
                "content": "The critical finding is that the dispatch layer bypasses the search engine entirely, doing raw SQL queries instead of using the hybrid search pipeline."
            },
            "timestamp": "2025-01-15T10:30:00Z"
        });
        let extracts = extract_from_record(&record);
        assert_eq!(extracts.len(), 1);
        assert!(extracts[0].content.contains("dispatch layer"));
    }

    #[test]
    fn test_extract_from_record_blocks() {
        let record = json!({
            "message": {
                "role": "assistant",
                "content": [
                    { "type": "text", "text": "This is a short line" },
                    { "type": "text", "text": "The race condition was traced to the async event handler that fires before the database connection pool is initialized, causing all queries to fail with 'pool exhausted'." }
                ]
            }
        });
        let extracts = extract_from_record(&record);
        assert_eq!(extracts.len(), 1); // Short line filtered out
        assert!(extracts[0].content.contains("race condition"));
    }
}
