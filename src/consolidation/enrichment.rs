//! Auto-enrichment — type classification, TF-IDF tags, importance scoring, entity extraction.
//!
//! Ports TypeScript auto-enrichment logic applied during memory store.
//! These functions run synchronously at store-time (not in background consolidation).

use std::collections::HashMap;

use anyhow::Result;

use crate::db::pool::DbPool;

// ============================================================================
// Memory Type Classification
// ============================================================================

/// Classify memory type from content using keyword heuristics.
///
/// Returns one of: fact, decision, procedure, preference, note, event, observation.
pub fn classify_memory_type(content: &str) -> &'static str {
    let lower = content.to_lowercase();

    // Decision markers
    if lower.contains("decided") || lower.contains("decision")
        || lower.contains("chose") || lower.contains("will use")
        || lower.contains("going with") || lower.contains("selected")
    {
        return "decision";
    }

    // Procedure markers
    if lower.contains("step 1") || lower.contains("steps:")
        || lower.contains("how to") || lower.contains("procedure")
        || lower.contains("process:") || lower.contains("run ")
        || lower.contains("install ") || lower.contains("configure ")
    {
        return "procedure";
    }

    // Preference markers
    if lower.contains("prefer") || lower.contains("always use")
        || lower.contains("never use") || lower.contains("like ")
        || lower.contains("don't like") || lower.contains("better than")
    {
        return "preference";
    }

    // Event markers
    if lower.contains("happened") || lower.contains("occurred")
        || lower.contains("deployed") || lower.contains("released")
        || lower.contains("started") || lower.contains("finished")
        || lower.contains("migrated")
    {
        return "event";
    }

    // Observation markers
    if lower.contains("noticed") || lower.contains("observed")
        || lower.contains("seems like") || lower.contains("appears to")
        || lower.contains("found that") || lower.contains("discovered")
    {
        return "observation";
    }

    // Fact markers (most common)
    if lower.contains("is ") || lower.contains("are ")
        || lower.contains("uses ") || lower.contains("has ")
        || lower.contains("the ") || lower.contains("version")
    {
        return "fact";
    }

    "note"
}

// ============================================================================
// Auto-Tagging (TF-IDF inspired keyword extraction)
// ============================================================================

/// Common English stop words to filter from tag candidates.
const STOP_WORDS: &[&str] = &[
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "must", "need", "to", "of",
    "in", "for", "on", "with", "at", "by", "from", "as", "into", "through",
    "during", "before", "after", "above", "below", "between", "out", "off",
    "over", "under", "again", "further", "then", "once", "here", "there",
    "when", "where", "why", "how", "all", "each", "every", "both", "few",
    "more", "most", "other", "some", "such", "no", "nor", "not", "only",
    "own", "same", "so", "than", "too", "very", "just", "because", "but",
    "and", "or", "if", "while", "about", "up", "its", "it", "this", "that",
    "these", "those", "i", "me", "my", "we", "our", "you", "your", "he",
    "him", "his", "she", "her", "they", "them", "their", "what", "which",
    "who", "whom", "use", "used", "using",
];

/// Extract keyword tags from content using term frequency.
///
/// Returns up to `max_tags` high-frequency non-stopword tokens.
pub fn extract_tags(content: &str, max_tags: usize) -> Vec<String> {
    let stop_set: std::collections::HashSet<&str> = STOP_WORDS.iter().copied().collect();

    let mut freq: HashMap<String, usize> = HashMap::new();
    for word in content.split_whitespace() {
        let clean: String = word
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        let lower = clean.to_lowercase();
        if lower.len() >= 3 && !stop_set.contains(lower.as_str()) {
            *freq.entry(lower).or_default() += 1;
        }
    }

    let mut sorted: Vec<(String, usize)> = freq.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    sorted.into_iter().take(max_tags).map(|(w, _)| w).collect()
}

// ============================================================================
// Importance Scoring
// ============================================================================

/// Compute initial importance score for a memory.
///
/// Heuristic-based: boosts for code, errors, decisions, procedures.
pub fn compute_importance(content: &str, memory_type: &str) -> f64 {
    let mut score = 0.5_f64;
    let lower = content.to_lowercase();

    // Type-based boost
    match memory_type {
        "decision" => score += 0.2,
        "procedure" => score += 0.15,
        "preference" => score += 0.1,
        "fact" => score += 0.05,
        _ => {}
    }

    // Content markers
    if lower.contains("critical") || lower.contains("important") || lower.contains("breaking") {
        score += 0.15;
    }
    if lower.contains("error") || lower.contains("bug") || lower.contains("fix") {
        score += 0.1;
    }
    if lower.contains("security") || lower.contains("vulnerability") {
        score += 0.15;
    }

    // Length-based: very short content is less important
    if content.len() < 20 {
        score -= 0.1;
    } else if content.len() > 200 {
        score += 0.05;
    }

    score.clamp(0.1, 1.0)
}

// ============================================================================
// Duplicate Detection
// ============================================================================

/// Check if content is a near-duplicate of existing memories.
///
/// Uses content hash for exact match and Jaccard similarity for fuzzy match.
pub fn check_duplicate(
    pool: &DbPool,
    project_id: &str,
    content: &str,
    content_hash: &str,
) -> Result<Option<String>> {
    let conn = pool.get()?;

    // Exact hash match
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM memories WHERE content_hash = ?1 \
             AND project_id = ?2 AND deleted_at IS NULL LIMIT 1",
            rusqlite::params![content_hash, project_id],
            |row| row.get(0),
        )
        .ok();

    if existing.is_some() {
        return Ok(existing);
    }

    // Fuzzy: check recent memories with Jaccard similarity
    let mut stmt = conn.prepare(
        "SELECT id, content FROM memories WHERE project_id = ?1 \
         AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20",
    )?;

    let recent: Vec<(String, String)> = stmt
        .query_map([project_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let content_words: std::collections::HashSet<&str> = content.split_whitespace().collect();

    for (id, existing_content) in recent {
        let existing_words: std::collections::HashSet<&str> =
            existing_content.split_whitespace().collect();
        let intersection = content_words.intersection(&existing_words).count();
        let union = content_words.union(&existing_words).count();
        if union > 0 {
            let jaccard = intersection as f64 / union as f64;
            if jaccard > 0.85 {
                return Ok(Some(id));
            }
        }
    }

    Ok(None)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_decision() {
        assert_eq!(classify_memory_type("We decided to use Rust"), "decision");
        assert_eq!(classify_memory_type("Going with PostgreSQL"), "decision");
    }

    #[test]
    fn test_classify_procedure() {
        assert_eq!(classify_memory_type("Step 1: install dependencies"), "procedure");
        assert_eq!(classify_memory_type("How to deploy to production"), "procedure");
    }

    #[test]
    fn test_classify_preference() {
        assert_eq!(classify_memory_type("I prefer dark mode"), "preference");
        assert_eq!(classify_memory_type("Always use snake_case"), "preference");
    }

    #[test]
    fn test_classify_event() {
        assert_eq!(classify_memory_type("The migration happened yesterday"), "event");
        assert_eq!(classify_memory_type("Deployed v2.0 to prod"), "event");
    }

    #[test]
    fn test_classify_observation() {
        assert_eq!(classify_memory_type("I noticed the tests are slow"), "observation");
    }

    #[test]
    fn test_classify_fact() {
        assert_eq!(classify_memory_type("Rust is a systems language"), "fact");
    }

    #[test]
    fn test_classify_default() {
        assert_eq!(classify_memory_type("hello"), "note");
    }

    #[test]
    fn test_extract_tags() {
        let tags = extract_tags("Rust programming language memory server implementation", 3);
        assert!(!tags.is_empty());
        assert!(tags.len() <= 3);
        // Stop words like "the" should not appear
        for tag in &tags {
            assert!(tag.len() >= 3);
        }
    }

    #[test]
    fn test_extract_tags_empty() {
        let tags = extract_tags("", 5);
        assert!(tags.is_empty());
    }

    #[test]
    fn test_compute_importance_decision() {
        let score = compute_importance("We decided to use Rust", "decision");
        assert!(score > 0.5, "Decisions should have higher importance");
    }

    #[test]
    fn test_compute_importance_clamped() {
        let score = compute_importance(
            "critical security vulnerability breaking important error fix",
            "decision",
        );
        assert!(score <= 1.0);
        assert!(score >= 0.1);
    }

    #[test]
    fn test_compute_importance_short() {
        let score = compute_importance("hi", "note");
        assert!(score < 0.5, "Very short content should have low importance");
    }
}
