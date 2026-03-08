//! Schema migrations — 29 migrations matching the TypeScript version exactly.
//!
//! Entry point: [`initialize_schema`] is called once per pool creation.
//! It runs CREATE TABLE IF NOT EXISTS for all core tables, then the numbered
//! migration pipeline, entity type seeding, FTS5 setup, and legacy cleanup.
//!
//! Design notes:
//! - All SQL uses `IF NOT EXISTS` / `OR IGNORE` so it is idempotent.
//! - Migrations use a `schema_migrations` tracking table (not PRAGMA user_version)
//!   to stay consistent with the TypeScript version.
//! - `try_add_column()` from queries.rs swallows "duplicate column" errors,
//!   matching the TS `try { ALTER TABLE } catch { /* exists */ }` pattern.

use anyhow::{Context, Result};
use rusqlite::Connection;
use tracing::{debug, info, warn};

use crate::db::queries;

// ============================================================================
// Public Entry Point
// ============================================================================

/// Initialize the full schema on a connection.
///
/// Called from `pool::create_pool()` and `pool::create_memory_pool()`.
/// Order matches TypeScript `initializeDatabase()`:
/// 1. Core tables (CREATE TABLE IF NOT EXISTS)
/// 2. Numbered migrations (29 total)
/// 3. Migration-only tables (for completeness on fresh DBs)
/// 4. Seed entity types
/// 5. FTS5 setup
/// 6. Legacy cleanup
pub fn initialize_schema(conn: &Connection) -> Result<()> {
    create_core_tables(conn)?;
    run_migrations(conn)?;
    create_migration_only_tables(conn)?;
    seed_entity_types(conn)?;
    let fts5_ok = init_fts5(conn);
    if !fts5_ok {
        warn!("FTS5 not available — full-text search will use LIKE fallback");
    }
    run_legacy_cleanup(conn)?;
    info!("Schema initialization complete");
    Ok(())
}

// ============================================================================
// Core Tables — matches schema.ts createCoreTables()
// ============================================================================

fn create_core_tables(conn: &Connection) -> Result<()> {
    // ── memories ──────────────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            project_id TEXT DEFAULT 'global',
            content TEXT NOT NULL,
            type TEXT DEFAULT 'note',
            tags TEXT DEFAULT '[]',
            importance REAL DEFAULT 0.5,
            strength REAL DEFAULT 1.0,
            access_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            last_accessed TEXT DEFAULT (datetime('now')),
            deleted_at TEXT,
            confidence REAL DEFAULT 0.5,
            source_count INTEGER DEFAULT 1,
            contradiction_count INTEGER DEFAULT 0,
            embedding BLOB,
            updated_at TEXT DEFAULT (datetime('now')),
            sentiment TEXT DEFAULT 'neutral',
            emotion_intensity REAL DEFAULT 0.0,
            emotion_labels TEXT DEFAULT '[]',
            user_mood TEXT,
            embedding_model TEXT,
            valid_from TEXT DEFAULT (datetime('now')),
            valid_to TEXT,
            superseded_by TEXT,
            tier TEXT DEFAULT 'ephemeral',
            reconsolidation_count INTEGER DEFAULT 0,
            last_reconsolidated TEXT,
            emotional_salience REAL DEFAULT 0.0,
            processing_depth REAL DEFAULT 0.0,
            maturity_score REAL DEFAULT 0.0,
            maturity_updated_at TEXT,
            tier_changed_at TEXT,
            demotion_count INTEGER DEFAULT 0,
            content_original TEXT,
            compressed_at TEXT,
            search_hit_count INTEGER DEFAULT 0,
            sparse_tokens TEXT DEFAULT '',
            agent_id TEXT DEFAULT 'system',
            content_hash TEXT,
            confirmation_count INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
        CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
        CREATE INDEX IF NOT EXISTS idx_memories_deleted ON memories(deleted_at);
        CREATE INDEX IF NOT EXISTS idx_memories_confidence ON memories(confidence);
        CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id) WHERE deleted_at IS NULL;",
    )
    .context("Failed to create memories table")?;

    // ── edges ─────────────────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS edges (
            id TEXT PRIMARY KEY,
            project_id TEXT DEFAULT 'global',
            from_id TEXT NOT NULL,
            to_id TEXT NOT NULL,
            relation_type TEXT NOT NULL,
            valid_from TEXT DEFAULT (datetime('now')),
            valid_to TEXT,
            confidence REAL DEFAULT 1.0,
            metadata TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (from_id) REFERENCES memories(id),
            FOREIGN KEY (to_id) REFERENCES memories(id)
        );
        CREATE INDEX IF NOT EXISTS idx_edges_project ON edges(project_id);
        CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
        CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);
        CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation_type);",
    )
    .context("Failed to create edges table")?;

    // ── scratchpad ────────────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS scratchpad (
            key TEXT NOT NULL,
            project_id TEXT DEFAULT 'global',
            value TEXT NOT NULL,
            expires_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (key, project_id)
        );
        CREATE INDEX IF NOT EXISTS idx_scratchpad_project ON scratchpad(project_id);",
    )
    .context("Failed to create scratchpad table")?;

    // ── entities ──────────────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS entities (
            id TEXT PRIMARY KEY,
            project_id TEXT DEFAULT 'global',
            name TEXT NOT NULL,
            entity_type TEXT DEFAULT 'concept',
            observations TEXT DEFAULT '[]',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(project_id, name)
        );
        CREATE INDEX IF NOT EXISTS idx_entities_project ON entities(project_id);
        CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);",
    )
    .context("Failed to create entities table")?;

    // ── entity_relations ──────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS entity_relations (
            id TEXT PRIMARY KEY,
            project_id TEXT DEFAULT 'global',
            from_entity TEXT NOT NULL,
            to_entity TEXT NOT NULL,
            relation_type TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(project_id, from_entity, to_entity, relation_type)
        );
        CREATE INDEX IF NOT EXISTS idx_entity_relations_project ON entity_relations(project_id);
        CREATE INDEX IF NOT EXISTS idx_entity_relations_from ON entity_relations(from_entity);
        CREATE INDEX IF NOT EXISTS idx_entity_relations_to ON entity_relations(to_entity);",
    )
    .context("Failed to create entity_relations table")?;

    // ── entity_types ──────────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS entity_types (
            name TEXT PRIMARY KEY,
            parent_type TEXT,
            description TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (parent_type) REFERENCES entity_types(name)
        );
        CREATE INDEX IF NOT EXISTS idx_entity_types_parent ON entity_types(parent_type);",
    )
    .context("Failed to create entity_types table")?;

    // ── contradiction_resolutions ─────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS contradiction_resolutions (
            id TEXT PRIMARY KEY,
            project_id TEXT DEFAULT 'global',
            memory_id_1 TEXT NOT NULL,
            memory_id_2 TEXT NOT NULL,
            resolution_type TEXT DEFAULT 'pending',
            chosen_memory TEXT,
            resolution_note TEXT,
            resolved_by TEXT,
            resolved_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (memory_id_1) REFERENCES memories(id),
            FOREIGN KEY (memory_id_2) REFERENCES memories(id)
        );
        CREATE INDEX IF NOT EXISTS idx_resolution_project ON contradiction_resolutions(project_id);
        CREATE INDEX IF NOT EXISTS idx_resolution_type ON contradiction_resolutions(resolution_type);",
    )
    .context("Failed to create contradiction_resolutions table")?;

    // ── scheduled_tasks ───────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS scheduled_tasks (
            id TEXT PRIMARY KEY,
            project_id TEXT DEFAULT 'global',
            title TEXT NOT NULL,
            description TEXT,
            cron_expression TEXT,
            next_run TEXT,
            last_run TEXT,
            status TEXT DEFAULT 'pending',
            recurring INTEGER DEFAULT 0,
            memory_id TEXT,
            action_type TEXT DEFAULT 'reminder',
            action_data TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (memory_id) REFERENCES memories(id)
        );
        CREATE INDEX IF NOT EXISTS idx_scheduled_project ON scheduled_tasks(project_id);
        CREATE INDEX IF NOT EXISTS idx_scheduled_status ON scheduled_tasks(status);
        CREATE INDEX IF NOT EXISTS idx_scheduled_next_run ON scheduled_tasks(next_run);",
    )
    .context("Failed to create scheduled_tasks table")?;

    // ── tool_calls ────────────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tool_calls (
            id TEXT PRIMARY KEY,
            tool_name TEXT NOT NULL,
            arguments TEXT,
            output TEXT,
            success INTEGER DEFAULT 1,
            error TEXT,
            duration_ms INTEGER,
            project_id TEXT DEFAULT 'global',
            timestamp TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_tool_calls_timestamp ON tool_calls(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool_name);
        CREATE INDEX IF NOT EXISTS idx_tool_calls_success ON tool_calls(success);
        CREATE INDEX IF NOT EXISTS idx_tool_calls_project ON tool_calls(project_id);",
    )
    .context("Failed to create tool_calls table")?;

    // ── sessions ──────────────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            project_id TEXT DEFAULT 'global',
            client_id TEXT,
            started_at TEXT DEFAULT (datetime('now')),
            ended_at TEXT,
            tool_call_count INTEGER DEFAULT 0,
            memory_store_count INTEGER DEFAULT 0,
            memory_search_count INTEGER DEFAULT 0,
            last_activity_at TEXT DEFAULT (datetime('now')),
            crash_detected INTEGER DEFAULT 0,
            summary TEXT,
            metadata TEXT DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(ended_at) WHERE ended_at IS NULL;",
    )
    .context("Failed to create sessions table")?;

    // ── temporal_events ───────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS temporal_events (
            id TEXT PRIMARY KEY,
            memory_id TEXT NOT NULL,
            project_id TEXT DEFAULT 'global',
            event_type TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            session_id TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (memory_id) REFERENCES memories(id),
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        );
        CREATE INDEX IF NOT EXISTS idx_temporal_events_memory ON temporal_events(memory_id);
        CREATE INDEX IF NOT EXISTS idx_temporal_events_type ON temporal_events(event_type);
        CREATE INDEX IF NOT EXISTS idx_temporal_events_created ON temporal_events(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_temporal_events_session ON temporal_events(session_id);",
    )
    .context("Failed to create temporal_events table")?;

    // ── Composite indexes for hot paths ───────────────────────────────────
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_memories_project_active ON memories(project_id, deleted_at)
            WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_memories_embedding_null ON memories(project_id)
            WHERE deleted_at IS NULL AND embedding IS NULL;
        CREATE INDEX IF NOT EXISTS idx_tool_calls_prune ON tool_calls(timestamp);",
    )
    .context("Failed to create composite indexes")?;

    // ── Additional query-pattern indexes ──────────────────────────────────
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_memories_global ON memories(project_id)
            WHERE project_id = 'global' AND deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_memories_type_project ON memories(type, project_id)
            WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC)
            WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_memories_strength ON memories(strength)
            WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_memories_search_order ON memories(project_id, confidence DESC, importance DESC)
            WHERE deleted_at IS NULL;",
    )
    .context("Failed to create additional indexes")?;

    // ── Temporal indexes ──────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_memories_valid_from ON memories(valid_from);
        CREATE INDEX IF NOT EXISTS idx_memories_valid_to ON memories(valid_to);
        CREATE INDEX IF NOT EXISTS idx_memories_temporal ON memories(valid_from, valid_to) WHERE deleted_at IS NULL;",
    )
    .context("Failed to create temporal indexes")?;

    // ── tasks ─────────────────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            project_id TEXT DEFAULT 'global',
            description TEXT NOT NULL,
            total_steps INTEGER,
            current_step INTEGER,
            step_description TEXT,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);",
    )
    .context("Failed to create tasks table")?;

    // ── entity_observations ───────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS entity_observations (
            id TEXT PRIMARY KEY,
            entity_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (entity_id) REFERENCES entities(id)
        );
        CREATE INDEX IF NOT EXISTS idx_entity_observations_entity ON entity_observations(entity_id);",
    )
    .context("Failed to create entity_observations table")?;

    // ── Idempotent ALTER TABLE ADD COLUMN (existing databases) ────────────
    // These match the TS try/catch ALTER TABLE pattern. On a fresh DB the
    // columns already exist in the CREATE TABLE, so try_add_column returns
    // Ok(false). On an upgraded DB they add missing columns.
    let _ = queries::try_add_column(conn, "memories", "valid_from TEXT")?;
    let _ = queries::try_add_column(conn, "memories", "valid_to TEXT")?;
    let _ = queries::try_add_column(conn, "memories", "superseded_by TEXT")?;
    let _ = queries::try_add_column(conn, "memories", "tier TEXT DEFAULT 'ephemeral'")?;
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_memories_tier ON memories(tier) WHERE deleted_at IS NULL;",
    )?;

    let _ = queries::try_add_column(conn, "memories", "project_id TEXT DEFAULT 'global'")?;
    let _ = queries::try_add_column(conn, "edges", "project_id TEXT DEFAULT 'global'")?;
    let _ = queries::try_add_column(conn, "scratchpad", "project_id TEXT DEFAULT 'global'")?;
    let _ = queries::try_add_column(conn, "entities", "project_id TEXT DEFAULT 'global'")?;
    let _ = queries::try_add_column(conn, "entity_relations", "project_id TEXT DEFAULT 'global'")?;

    let _ = queries::try_add_column(conn, "memories", "sentiment TEXT DEFAULT 'neutral'")?;
    let _ = queries::try_add_column(conn, "memories", "emotion_intensity REAL DEFAULT 0.0")?;
    let _ = queries::try_add_column(conn, "memories", "emotion_labels TEXT DEFAULT '[]'")?;
    let _ = queries::try_add_column(conn, "memories", "user_mood TEXT")?;
    let _ = queries::try_add_column(conn, "memories", "updated_at TEXT DEFAULT (datetime('now'))")?;

    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_memories_sentiment ON memories(sentiment);
        CREATE INDEX IF NOT EXISTS idx_memories_emotion_intensity ON memories(emotion_intensity);",
    )?;

    let _ = queries::try_add_column(conn, "memories", "reconsolidation_count INTEGER DEFAULT 0")?;
    let _ = queries::try_add_column(conn, "memories", "last_reconsolidated TEXT")?;
    let _ = queries::try_add_column(conn, "memories", "emotional_salience REAL DEFAULT 0.0")?;
    let _ = queries::try_add_column(conn, "memories", "processing_depth REAL DEFAULT 0.0")?;
    let _ = queries::try_add_column(conn, "memories", "maturity_score REAL DEFAULT 0.0")?;
    let _ = queries::try_add_column(conn, "memories", "maturity_updated_at TEXT")?;
    let _ = queries::try_add_column(conn, "memories", "tier_changed_at TEXT")?;
    let _ = queries::try_add_column(conn, "memories", "demotion_count INTEGER DEFAULT 0")?;

    // ── processing_events ─────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS processing_events (
            id TEXT PRIMARY KEY,
            memory_id TEXT NOT NULL,
            project_id TEXT DEFAULT 'global',
            event_type TEXT NOT NULL,
            depth_before REAL NOT NULL,
            depth_after REAL NOT NULL,
            context TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (memory_id) REFERENCES memories(id)
        );
        CREATE INDEX IF NOT EXISTS idx_processing_events_memory ON processing_events(memory_id);
        CREATE INDEX IF NOT EXISTS idx_processing_events_project ON processing_events(project_id);
        CREATE INDEX IF NOT EXISTS idx_processing_events_type ON processing_events(event_type);",
    )
    .context("Failed to create processing_events table")?;

    let _ = queries::try_add_column(conn, "memories", "sparse_tokens TEXT DEFAULT ''")?;
    let _ = queries::try_add_column(conn, "memories", "agent_id TEXT DEFAULT 'system'")?;
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id) WHERE deleted_at IS NULL;",
    )?;

    let _ = queries::try_add_column(conn, "memories", "embedding_model TEXT")?;
    let _ = queries::try_add_column(conn, "memories", "content_hash TEXT")?;
    let _ = queries::try_add_column(conn, "memories", "confirmation_count INTEGER DEFAULT 0")?;

    // ── co_retrieval_edges ────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS co_retrieval_edges (
            id TEXT PRIMARY KEY,
            project_id TEXT DEFAULT 'global',
            memory_a TEXT NOT NULL,
            memory_b TEXT NOT NULL,
            co_retrieval_count INTEGER DEFAULT 1,
            weight REAL DEFAULT 0.1,
            last_co_retrieved TEXT DEFAULT (datetime('now')),
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (memory_a) REFERENCES memories(id),
            FOREIGN KEY (memory_b) REFERENCES memories(id),
            UNIQUE(project_id, memory_a, memory_b)
        );
        CREATE INDEX IF NOT EXISTS idx_co_retrieval_a ON co_retrieval_edges(memory_a);
        CREATE INDEX IF NOT EXISTS idx_co_retrieval_b ON co_retrieval_edges(memory_b);
        CREATE INDEX IF NOT EXISTS idx_co_retrieval_weight ON co_retrieval_edges(weight DESC);
        CREATE INDEX IF NOT EXISTS idx_co_retrieval_project ON co_retrieval_edges(project_id);
        CREATE INDEX IF NOT EXISTS idx_co_retrieval_project_a ON co_retrieval_edges(project_id, memory_a);
        CREATE INDEX IF NOT EXISTS idx_co_retrieval_project_b ON co_retrieval_edges(project_id, memory_b);",
    )
    .context("Failed to create co_retrieval_edges table")?;

    // ── concept_nodes + concept_memberships ───────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS concept_nodes (
            id TEXT PRIMARY KEY,
            project_id TEXT DEFAULT 'global',
            name TEXT,
            description TEXT,
            centroid BLOB,
            member_ids TEXT DEFAULT '[]',
            cluster_size INTEGER DEFAULT 0,
            cohesion REAL DEFAULT 0,
            hebbian_strength REAL DEFAULT 0,
            stability INTEGER DEFAULT 0,
            tension REAL DEFAULT 0,
            tension_last_restructured INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            last_consolidated TEXT DEFAULT (datetime('now')),
            UNIQUE(project_id, name)
        );
        CREATE INDEX IF NOT EXISTS idx_concept_project ON concept_nodes(project_id);
        CREATE INDEX IF NOT EXISTS idx_concept_size ON concept_nodes(cluster_size DESC);
        CREATE INDEX IF NOT EXISTS idx_concept_stability ON concept_nodes(stability DESC);

        CREATE TABLE IF NOT EXISTS concept_memberships (
            concept_id TEXT NOT NULL,
            memory_id TEXT NOT NULL,
            probability REAL DEFAULT 1.0,
            joined_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (concept_id, memory_id),
            FOREIGN KEY (concept_id) REFERENCES concept_nodes(id),
            FOREIGN KEY (memory_id) REFERENCES memories(id)
        );
        CREATE INDEX IF NOT EXISTS idx_cm_concept ON concept_memberships(concept_id);
        CREATE INDEX IF NOT EXISTS idx_cm_memory ON concept_memberships(memory_id);",
    )
    .context("Failed to create concept_nodes/memberships tables")?;

    // ── concept_snapshots + concept_drift_alerts + cortex_state ───────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS concept_snapshots (
            id TEXT PRIMARY KEY,
            concept_id TEXT NOT NULL,
            project_id TEXT DEFAULT 'global',
            cycle_number INTEGER NOT NULL,
            centroid BLOB,
            member_ids TEXT DEFAULT '[]',
            cluster_size INTEGER DEFAULT 0,
            cohesion REAL DEFAULT 0,
            hebbian_strength REAL DEFAULT 0,
            stability INTEGER DEFAULT 0,
            name TEXT,
            centroid_drift REAL DEFAULT 0,
            member_churn REAL DEFAULT 0,
            cohesion_delta REAL DEFAULT 0,
            event_type TEXT DEFAULT 'updated',
            event_metadata TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (concept_id) REFERENCES concept_nodes(id)
        );
        CREATE INDEX IF NOT EXISTS idx_cs_concept ON concept_snapshots(concept_id);
        CREATE INDEX IF NOT EXISTS idx_cs_project ON concept_snapshots(project_id);
        CREATE INDEX IF NOT EXISTS idx_cs_cycle ON concept_snapshots(cycle_number DESC);
        CREATE INDEX IF NOT EXISTS idx_cs_drift ON concept_snapshots(centroid_drift DESC);
        CREATE INDEX IF NOT EXISTS idx_cs_event ON concept_snapshots(event_type);

        CREATE TABLE IF NOT EXISTS concept_drift_alerts (
            id TEXT PRIMARY KEY,
            concept_id TEXT NOT NULL,
            project_id TEXT DEFAULT 'global',
            alert_type TEXT NOT NULL,
            severity REAL DEFAULT 0.5,
            cycle_number INTEGER NOT NULL,
            metric_value REAL NOT NULL,
            threshold REAL NOT NULL,
            description TEXT,
            acknowledged INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (concept_id) REFERENCES concept_nodes(id)
        );
        CREATE INDEX IF NOT EXISTS idx_cda_concept ON concept_drift_alerts(concept_id);
        CREATE INDEX IF NOT EXISTS idx_cda_type ON concept_drift_alerts(alert_type);
        CREATE INDEX IF NOT EXISTS idx_cda_unack ON concept_drift_alerts(acknowledged) WHERE acknowledged = 0;

        CREATE TABLE IF NOT EXISTS cortex_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO cortex_state (key, value) VALUES ('cycle_number', '0');",
    )
    .context("Failed to create cortex tables")?;

    // ── restructuring_events ──────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS restructuring_events (
            id TEXT PRIMARY KEY,
            concept_id TEXT NOT NULL,
            project_id TEXT DEFAULT 'global',
            cycle_number INTEGER NOT NULL,
            tension_score REAL NOT NULL,
            action_type TEXT NOT NULL,
            details TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (concept_id) REFERENCES concept_nodes(id)
        );
        CREATE INDEX IF NOT EXISTS idx_re_concept ON restructuring_events(concept_id);
        CREATE INDEX IF NOT EXISTS idx_re_project ON restructuring_events(project_id);
        CREATE INDEX IF NOT EXISTS idx_re_cycle ON restructuring_events(cycle_number DESC);
        CREATE INDEX IF NOT EXISTS idx_re_action ON restructuring_events(action_type);",
    )
    .context("Failed to create restructuring_events table")?;

    // Ensure tension columns exist for databases upgraded via migration 5
    let _ = queries::try_add_column(conn, "concept_nodes", "tension REAL DEFAULT 0")?;
    let _ = queries::try_add_column(
        conn,
        "concept_nodes",
        "tension_last_restructured INTEGER DEFAULT 0",
    )?;

    // ── ingestion_queue ───────────────────────────────────────────────────
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS ingestion_queue (
            id TEXT PRIMARY KEY,
            project_id TEXT DEFAULT 'global',
            source TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata TEXT DEFAULT '{}',
            priority INTEGER DEFAULT 5,
            status TEXT DEFAULT 'pending',
            attempts INTEGER DEFAULT 0,
            max_attempts INTEGER DEFAULT 3,
            created_at TEXT DEFAULT (datetime('now')),
            processed_at TEXT,
            error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ingestion_status ON ingestion_queue(status, priority, created_at);
        CREATE INDEX IF NOT EXISTS idx_ingestion_project ON ingestion_queue(project_id);",
    )
    .context("Failed to create ingestion_queue table")?;

    Ok(())
}

// ============================================================================
// Migration-Only Tables — matches schema.ts createMigrationOnlyTables()
// ============================================================================

fn create_migration_only_tables(conn: &Connection) -> Result<()> {
    // Migration 13: Schema Extraction
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS memory_schemas (
            id TEXT PRIMARY KEY,
            project_id TEXT DEFAULT 'global',
            schema_pattern TEXT NOT NULL,
            examples TEXT DEFAULT '[]',
            frequency INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_memory_schemas_project ON memory_schemas(project_id);",
    )?;

    // Migration 14: Source Credibility
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS source_credibility (
            source_id TEXT NOT NULL,
            project_id TEXT DEFAULT 'global',
            correct_count INTEGER DEFAULT 0,
            incorrect_count INTEGER DEFAULT 0,
            credibility_score REAL DEFAULT 0.5,
            last_updated TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (source_id, project_id)
        );
        CREATE INDEX IF NOT EXISTS idx_source_credibility_project ON source_credibility(project_id);
        CREATE INDEX IF NOT EXISTS idx_source_credibility_score ON source_credibility(credibility_score);",
    )?;

    // Migration 15: Resolution Audit Trail
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS resolution_audit_log (
            id TEXT PRIMARY KEY,
            resolution_id TEXT NOT NULL,
            project_id TEXT DEFAULT 'global',
            action TEXT NOT NULL,
            actor TEXT DEFAULT 'system',
            rationale TEXT,
            previous_state TEXT,
            new_state TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (resolution_id) REFERENCES contradiction_resolutions(id)
        );
        CREATE INDEX IF NOT EXISTS idx_audit_resolution ON resolution_audit_log(resolution_id);
        CREATE INDEX IF NOT EXISTS idx_audit_project ON resolution_audit_log(project_id);
        CREATE INDEX IF NOT EXISTS idx_audit_action ON resolution_audit_log(action);
        CREATE INDEX IF NOT EXISTS idx_audit_created ON resolution_audit_log(created_at DESC);",
    )?;

    // Migration 16: Consolidation Profiler
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS consolidation_profile_runs (
            id TEXT PRIMARY KEY,
            project_id TEXT DEFAULT 'global',
            level TEXT NOT NULL,
            phase_timings TEXT DEFAULT '{}',
            total_duration_ms INTEGER DEFAULT 0,
            memory_count INTEGER DEFAULT 0,
            edge_count INTEGER DEFAULT 0,
            concept_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_profile_runs_project ON consolidation_profile_runs(project_id);
        CREATE INDEX IF NOT EXISTS idx_profile_runs_level ON consolidation_profile_runs(level);
        CREATE INDEX IF NOT EXISTS idx_profile_runs_created ON consolidation_profile_runs(created_at DESC);",
    )?;

    // Migration 17: Health Snapshots
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS health_snapshots (
            id TEXT PRIMARY KEY,
            project_id TEXT DEFAULT 'global',
            overall_score INTEGER DEFAULT 0,
            dimension_scores TEXT DEFAULT '{}',
            memory_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_health_snapshots_project ON health_snapshots(project_id);
        CREATE INDEX IF NOT EXISTS idx_health_snapshots_created ON health_snapshots(created_at DESC);",
    )?;

    // Migration 22: Code Intelligence
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS code_entities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            name TEXT NOT NULL,
            qualified_name TEXT NOT NULL,
            signature TEXT,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            docstring TEXT,
            complexity INTEGER DEFAULT 0,
            language TEXT NOT NULL,
            hash TEXT NOT NULL,
            embedding_id TEXT,
            bridge_entity_id TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(project_id, file_path, qualified_name)
        );
        CREATE INDEX IF NOT EXISTS idx_code_entities_project ON code_entities(project_id);
        CREATE INDEX IF NOT EXISTS idx_code_entities_file ON code_entities(project_id, file_path);
        CREATE INDEX IF NOT EXISTS idx_code_entities_name ON code_entities(project_id, name);
        CREATE INDEX IF NOT EXISTS idx_code_entities_type ON code_entities(project_id, entity_type);
        CREATE INDEX IF NOT EXISTS idx_code_entities_qualified ON code_entities(project_id, qualified_name);
        CREATE INDEX IF NOT EXISTS idx_code_entities_hash ON code_entities(hash);

        CREATE TABLE IF NOT EXISTS code_relations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT NOT NULL,
            from_entity_id INTEGER NOT NULL,
            to_entity_id INTEGER NOT NULL,
            relation_type TEXT NOT NULL,
            confidence REAL DEFAULT 1.0,
            metadata TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (from_entity_id) REFERENCES code_entities(id) ON DELETE CASCADE,
            FOREIGN KEY (to_entity_id) REFERENCES code_entities(id) ON DELETE CASCADE,
            UNIQUE(project_id, from_entity_id, to_entity_id, relation_type)
        );
        CREATE INDEX IF NOT EXISTS idx_code_relations_project ON code_relations(project_id);
        CREATE INDEX IF NOT EXISTS idx_code_relations_from ON code_relations(from_entity_id);
        CREATE INDEX IF NOT EXISTS idx_code_relations_to ON code_relations(to_entity_id);
        CREATE INDEX IF NOT EXISTS idx_code_relations_type ON code_relations(project_id, relation_type);

        CREATE TABLE IF NOT EXISTS code_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_hash TEXT NOT NULL,
            entity_count INTEGER DEFAULT 0,
            relation_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(project_id, file_path, file_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_code_snapshots_project ON code_snapshots(project_id);
        CREATE INDEX IF NOT EXISTS idx_code_snapshots_file ON code_snapshots(project_id, file_path);",
    )?;

    // Migration 23: Architecture Insights
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS code_architecture_insights (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT NOT NULL,
            pattern TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'info',
            entities TEXT NOT NULL DEFAULT '[]',
            description TEXT NOT NULL,
            suggestion TEXT,
            file_path TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_code_arch_project ON code_architecture_insights(project_id);
        CREATE INDEX IF NOT EXISTS idx_code_arch_pattern ON code_architecture_insights(project_id, pattern);
        CREATE INDEX IF NOT EXISTS idx_code_arch_severity ON code_architecture_insights(project_id, severity);",
    )?;

    // Migration 28: Behavior Queue
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS behavior_queue (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_behavior_queue_status_created ON behavior_queue(status, created_at);",
    )?;

    Ok(())
}

// ============================================================================
// Entity Type Seeding — matches schema.ts seedEntityTypes()
// ============================================================================

fn seed_entity_types(conn: &Connection) -> Result<()> {
    let count: i64 = conn
        .prepare_cached("SELECT COUNT(*) FROM entity_types")?
        .query_row([], |row| row.get(0))?;

    // Use < 9 instead of == 0 because migration 27 may have already
    // inserted 'agent' before this function runs. INSERT OR IGNORE
    // ensures no duplicates.
    if count < 9 {
        let mut stmt = conn.prepare_cached(
            "INSERT OR IGNORE INTO entity_types (name, parent_type, description) VALUES (?1, ?2, ?3)",
        )?;

        let defaults: &[(&str, Option<&str>, &str)] = &[
            ("concept", None, "Abstract idea or notion"),
            ("person", None, "Human individual"),
            ("organization", None, "Company, team, or group"),
            ("project", None, "Work initiative or codebase"),
            ("technology", None, "Tool, framework, or language"),
            ("location", None, "Physical or virtual place"),
            ("event", None, "Occurrence in time"),
            ("document", None, "File, specification, or record"),
            ("agent", None, "Autonomous entity or AI"),
        ];

        for (name, parent, desc) in defaults {
            stmt.execute(rusqlite::params![name, parent, desc])?;
        }

        info!("Seeded {} default entity types", defaults.len());
    }

    Ok(())
}

// ============================================================================
// FTS5 — matches schema.ts initFTS5()
// ============================================================================

fn init_fts5(conn: &Connection) -> bool {
    let result = (|| -> Result<bool> {
        conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                id UNINDEXED,
                content,
                sparse_tokens,
                project_id UNINDEXED,
                content='memories',
                content_rowid='rowid'
            );",
        )
        .context("Failed to create FTS5 virtual table")?;

        // Triggers to keep FTS5 in sync with memories table
        conn.execute_batch(
            "CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
                INSERT INTO memories_fts(rowid, id, content, sparse_tokens, project_id)
                    VALUES (new.rowid, new.id, new.content, new.sparse_tokens, new.project_id);
            END;

            CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, id, content, sparse_tokens, project_id)
                    VALUES ('delete', old.rowid, old.id, old.content, old.sparse_tokens, old.project_id);
            END;

            CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE OF content, sparse_tokens ON memories BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, id, content, sparse_tokens, project_id)
                    VALUES ('delete', old.rowid, old.id, old.content, old.sparse_tokens, old.project_id);
                INSERT INTO memories_fts(rowid, id, content, sparse_tokens, project_id)
                    VALUES (new.rowid, new.id, new.content, new.sparse_tokens, new.project_id);
            END;

            CREATE TRIGGER IF NOT EXISTS memories_fts_softdelete AFTER UPDATE OF deleted_at ON memories
                WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL
            BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, id, content, sparse_tokens, project_id)
                    VALUES ('delete', old.rowid, old.id, old.content, old.sparse_tokens, old.project_id);
            END;

            CREATE TRIGGER IF NOT EXISTS memories_fts_project_update AFTER UPDATE OF project_id ON memories
                WHEN new.deleted_at IS NULL
            BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, id, content, sparse_tokens, project_id)
                    VALUES ('delete', old.rowid, old.id, old.content, old.sparse_tokens, old.project_id);
                INSERT INTO memories_fts(rowid, id, content, sparse_tokens, project_id)
                    VALUES (new.rowid, new.id, new.content, new.sparse_tokens, new.project_id);
            END;",
        )
        .context("Failed to create FTS5 triggers")?;

        // Backfill: populate FTS5 with existing memories if empty
        let fts_count: i64 = conn
            .prepare_cached("SELECT COUNT(*) FROM memories_fts")?
            .query_row([], |row| row.get(0))?;
        let mem_count: i64 = conn
            .prepare_cached("SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL")?
            .query_row([], |row| row.get(0))?;

        if fts_count == 0 && mem_count > 0 {
            info!("Backfilling FTS5 index with {} memories", mem_count);
            conn.execute_batch(
                "INSERT INTO memories_fts(rowid, id, content, sparse_tokens, project_id)
                    SELECT rowid, id, content, sparse_tokens, project_id
                    FROM memories WHERE deleted_at IS NULL",
            )?;
            info!("FTS5 backfill complete");
        }

        Ok(true)
    })();

    match result {
        Ok(ok) => ok,
        Err(e) => {
            warn!("FTS5 initialization failed: {e:#}");
            false
        }
    }
}

// ============================================================================
// Legacy Cleanup — matches schema.ts runLegacyCleanup()
// ============================================================================

fn run_legacy_cleanup(conn: &Connection) -> Result<()> {
    let count: i64 = conn
        .prepare_cached(
            "SELECT COUNT(*) FROM memories WHERE type = 'system' AND content LIKE '%consolidation_run%'",
        )?
        .query_row([], |row| row.get(0))?;

    if count > 20 {
        info!(
            "Cleaning up {} legacy consolidation_run system memories",
            count
        );
        conn.execute(
            "DELETE FROM memories
            WHERE type = 'system'
                AND content LIKE '%consolidation_run%'
                AND id NOT IN (
                    SELECT id FROM memories
                    WHERE type = 'system' AND content LIKE '%consolidation_run%'
                    ORDER BY created_at DESC
                    LIMIT 10
                )",
            [],
        )?;
        info!("Legacy system memory cleanup complete");
    }

    Ok(())
}

// ============================================================================
// Numbered Migrations — matches schema-migrations.ts runMigrations()
// ============================================================================

fn run_migrations(conn: &Connection) -> Result<()> {
    // Ensure schema_migrations tracking table exists
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            description TEXT NOT NULL,
            applied_at TEXT DEFAULT (datetime('now'))
        );",
    )?;

    // ── v6 → v7 Migration Bridge ─────────────────────────────────────────
    // Detect old v6.0.0 migration 2 (scratchpad instance_id) and remove it
    // so the new migration 2+ chain can execute.
    let old_mig2: Option<i64> = conn
        .prepare_cached(
            "SELECT version FROM schema_migrations WHERE version = 2 AND description LIKE '%instance_id%scratchpad%'",
        )?
        .query_row([], |row| row.get(0))
        .optional_ext()?;
    if old_mig2.is_some() {
        conn.execute("DELETE FROM schema_migrations WHERE version = 2", [])?;
        info!("Removed v6.0.0 migration 2 (scratchpad instance_id) to allow v7.0.0 migrations");
    }

    // ── Migration 1: Drop unused tables ──────────────────────────────────
    if !queries::migration_has_run(conn, 1)? {
        // SAFE: table names are hardcoded constants, not user input
        let unused_tables = [
            "causal_relationships",
            "alternative_outcomes",
            "user_intents",
            "intent_signals",
            "memory_access_sequences",
            "memory_coaccess",
        ];
        for table in &unused_tables {
            if let Err(e) = conn.execute_batch(&format!("DROP TABLE IF EXISTS {table}")) {
                debug!("migration1: failed to drop table {table}: {e}");
            }
        }
        queries::mark_migration(conn, 1, "Drop unused tables: causal_relationships, alternative_outcomes, user_intents, intent_signals, memory_access_sequences, memory_coaccess")?;
        info!("Migration 1: Dropped 6 unused tables");
    }

    // ── Migration 2: Hebbian co-retrieval edges ──────────────────────────
    if !queries::migration_has_run(conn, 2)? {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS co_retrieval_edges (
                id TEXT PRIMARY KEY,
                project_id TEXT DEFAULT 'global',
                memory_a TEXT NOT NULL,
                memory_b TEXT NOT NULL,
                co_retrieval_count INTEGER DEFAULT 1,
                weight REAL DEFAULT 0.1,
                last_co_retrieved TEXT DEFAULT (datetime('now')),
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (memory_a) REFERENCES memories(id),
                FOREIGN KEY (memory_b) REFERENCES memories(id),
                UNIQUE(project_id, memory_a, memory_b)
            );
            CREATE INDEX IF NOT EXISTS idx_co_retrieval_a ON co_retrieval_edges(memory_a);
            CREATE INDEX IF NOT EXISTS idx_co_retrieval_b ON co_retrieval_edges(memory_b);
            CREATE INDEX IF NOT EXISTS idx_co_retrieval_weight ON co_retrieval_edges(weight DESC);
            CREATE INDEX IF NOT EXISTS idx_co_retrieval_project ON co_retrieval_edges(project_id);",
        )?;
        queries::mark_migration(
            conn,
            2,
            "Memory Cortex Layer 1: co_retrieval_edges table for Hebbian learning",
        )?;
        info!("Migration 2: Created co_retrieval_edges table");
    }

    // ── Migration 3: Growing Concept Nodes ───────────────────────────────
    if !queries::migration_has_run(conn, 3)? {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS concept_nodes (
                id TEXT PRIMARY KEY,
                project_id TEXT DEFAULT 'global',
                name TEXT,
                description TEXT,
                centroid BLOB,
                member_ids TEXT DEFAULT '[]',
                cluster_size INTEGER DEFAULT 0,
                cohesion REAL DEFAULT 0,
                hebbian_strength REAL DEFAULT 0,
                stability INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                last_consolidated TEXT DEFAULT (datetime('now')),
                UNIQUE(project_id, name)
            );
            CREATE INDEX IF NOT EXISTS idx_concept_project ON concept_nodes(project_id);
            CREATE INDEX IF NOT EXISTS idx_concept_size ON concept_nodes(cluster_size DESC);
            CREATE INDEX IF NOT EXISTS idx_concept_stability ON concept_nodes(stability DESC);

            CREATE TABLE IF NOT EXISTS concept_memberships (
                concept_id TEXT NOT NULL,
                memory_id TEXT NOT NULL,
                probability REAL DEFAULT 1.0,
                joined_at TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (concept_id, memory_id),
                FOREIGN KEY (concept_id) REFERENCES concept_nodes(id),
                FOREIGN KEY (memory_id) REFERENCES memories(id)
            );
            CREATE INDEX IF NOT EXISTS idx_cm_concept ON concept_memberships(concept_id);
            CREATE INDEX IF NOT EXISTS idx_cm_memory ON concept_memberships(memory_id);",
        )?;
        queries::mark_migration(
            conn,
            3,
            "Memory Cortex Layer 2: concept_nodes + concept_memberships tables",
        )?;
        info!("Migration 3: Created concept_nodes + concept_memberships");
    }

    // ── Migration 4: Concept Drift & Evolution ───────────────────────────
    if !queries::migration_has_run(conn, 4)? {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS concept_snapshots (
                id TEXT PRIMARY KEY,
                concept_id TEXT NOT NULL,
                project_id TEXT DEFAULT 'global',
                cycle_number INTEGER NOT NULL,
                centroid BLOB,
                member_ids TEXT DEFAULT '[]',
                cluster_size INTEGER DEFAULT 0,
                cohesion REAL DEFAULT 0,
                hebbian_strength REAL DEFAULT 0,
                stability INTEGER DEFAULT 0,
                name TEXT,
                centroid_drift REAL DEFAULT 0,
                member_churn REAL DEFAULT 0,
                cohesion_delta REAL DEFAULT 0,
                event_type TEXT DEFAULT 'updated',
                event_metadata TEXT DEFAULT '{}',
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (concept_id) REFERENCES concept_nodes(id)
            );
            CREATE INDEX IF NOT EXISTS idx_cs_concept ON concept_snapshots(concept_id);
            CREATE INDEX IF NOT EXISTS idx_cs_project ON concept_snapshots(project_id);
            CREATE INDEX IF NOT EXISTS idx_cs_cycle ON concept_snapshots(cycle_number DESC);
            CREATE INDEX IF NOT EXISTS idx_cs_drift ON concept_snapshots(centroid_drift DESC);
            CREATE INDEX IF NOT EXISTS idx_cs_event ON concept_snapshots(event_type);

            CREATE TABLE IF NOT EXISTS concept_drift_alerts (
                id TEXT PRIMARY KEY,
                concept_id TEXT NOT NULL,
                project_id TEXT DEFAULT 'global',
                alert_type TEXT NOT NULL,
                severity REAL DEFAULT 0.5,
                cycle_number INTEGER NOT NULL,
                metric_value REAL NOT NULL,
                threshold REAL NOT NULL,
                description TEXT,
                acknowledged INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (concept_id) REFERENCES concept_nodes(id)
            );
            CREATE INDEX IF NOT EXISTS idx_cda_concept ON concept_drift_alerts(concept_id);
            CREATE INDEX IF NOT EXISTS idx_cda_type ON concept_drift_alerts(alert_type);
            CREATE INDEX IF NOT EXISTS idx_cda_unack ON concept_drift_alerts(acknowledged) WHERE acknowledged = 0;

            CREATE TABLE IF NOT EXISTS cortex_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now'))
            );
            INSERT OR IGNORE INTO cortex_state (key, value) VALUES ('cycle_number', '0');",
        )?;
        queries::mark_migration(
            conn,
            4,
            "Memory Cortex Layer 3: concept_snapshots, concept_drift_alerts, cortex_state",
        )?;
        info!("Migration 4: Created cortex layer 3 tables");
    }

    // ── Migration 5: Tension-Driven Restructuring ────────────────────────
    if !queries::migration_has_run(conn, 5)? {
        let _ = queries::try_add_column(conn, "concept_nodes", "tension REAL DEFAULT 0")?;
        let _ = queries::try_add_column(
            conn,
            "concept_nodes",
            "tension_last_restructured INTEGER DEFAULT 0",
        )?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS restructuring_events (
                id TEXT PRIMARY KEY,
                concept_id TEXT NOT NULL,
                project_id TEXT DEFAULT 'global',
                cycle_number INTEGER NOT NULL,
                tension_score REAL NOT NULL,
                action_type TEXT NOT NULL,
                details TEXT DEFAULT '{}',
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (concept_id) REFERENCES concept_nodes(id)
            );
            CREATE INDEX IF NOT EXISTS idx_re_concept ON restructuring_events(concept_id);
            CREATE INDEX IF NOT EXISTS idx_re_project ON restructuring_events(project_id);
            CREATE INDEX IF NOT EXISTS idx_re_cycle ON restructuring_events(cycle_number DESC);
            CREATE INDEX IF NOT EXISTS idx_re_action ON restructuring_events(action_type);",
        )?;
        queries::mark_migration(
            conn,
            5,
            "Memory Cortex Layer 4: tension columns + restructuring_events",
        )?;
        info!("Migration 5: Added tension columns + restructuring_events");
    }

    // ── Migration 6: Temporal Reasoning ──────────────────────────────────
    if !queries::migration_has_run(conn, 6)? {
        if queries::table_exists(conn, "memories")? {
            let _ = queries::try_add_column(conn, "memories", "valid_from TEXT")?;
            let _ = queries::try_add_column(conn, "memories", "valid_to TEXT")?;
            let _ = queries::try_add_column(conn, "memories", "superseded_by TEXT")?;

            // Backfill: set valid_from = created_at for existing memories
            conn.execute(
                "UPDATE memories SET valid_from = created_at WHERE valid_from IS NULL",
                [],
            )?;

            conn.execute_batch(
                "CREATE INDEX IF NOT EXISTS idx_memories_valid_from ON memories(valid_from);
                CREATE INDEX IF NOT EXISTS idx_memories_valid_to ON memories(valid_to);
                CREATE INDEX IF NOT EXISTS idx_memories_temporal ON memories(valid_from, valid_to) WHERE deleted_at IS NULL;",
            )?;
        }
        queries::mark_migration(
            conn,
            6,
            "Temporal reasoning: valid_from, valid_to, superseded_by + backfill",
        )?;
        info!("Migration 6: Added temporal columns");
    }

    // ── Migration 7: Self-Editing Memory Tiers ───────────────────────────
    if !queries::migration_has_run(conn, 7)? {
        if queries::table_exists(conn, "memories")? {
            let _ = queries::try_add_column(
                conn,
                "memories",
                "tier TEXT DEFAULT 'ephemeral'",
            )?;

            // Backfill tiers based on access_count
            conn.execute(
                "UPDATE memories SET tier = 'core' WHERE access_count >= 10 AND deleted_at IS NULL",
                [],
            )?;
            conn.execute(
                "UPDATE memories SET tier = 'established' WHERE access_count >= 5 AND access_count < 10 AND tier = 'ephemeral' AND deleted_at IS NULL",
                [],
            )?;
            conn.execute(
                "UPDATE memories SET tier = 'relevant' WHERE access_count >= 2 AND access_count < 5 AND tier = 'ephemeral' AND deleted_at IS NULL",
                [],
            )?;

            conn.execute_batch(
                "CREATE INDEX IF NOT EXISTS idx_memories_tier ON memories(tier) WHERE deleted_at IS NULL;",
            )?;
        }
        queries::mark_migration(
            conn,
            7,
            "Self-editing memory tiers: tier column + backfill from access_count",
        )?;
        info!("Migration 7: Added tier column with backfill");
    }

    // ── Migration 8: M1 Foundation — sessions, temporal_events, embedding_model
    if !queries::migration_has_run(conn, 8)? {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                project_id TEXT DEFAULT 'global',
                client_id TEXT,
                started_at TEXT DEFAULT (datetime('now')),
                ended_at TEXT,
                tool_call_count INTEGER DEFAULT 0,
                memory_store_count INTEGER DEFAULT 0,
                memory_search_count INTEGER DEFAULT 0,
                last_activity_at TEXT DEFAULT (datetime('now')),
                crash_detected INTEGER DEFAULT 0,
                summary TEXT,
                metadata TEXT DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
            CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(ended_at) WHERE ended_at IS NULL;

            CREATE TABLE IF NOT EXISTS temporal_events (
                id TEXT PRIMARY KEY,
                memory_id TEXT NOT NULL,
                project_id TEXT DEFAULT 'global',
                event_type TEXT NOT NULL,
                old_value TEXT,
                new_value TEXT,
                session_id TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (memory_id) REFERENCES memories(id),
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            );
            CREATE INDEX IF NOT EXISTS idx_temporal_events_memory ON temporal_events(memory_id);
            CREATE INDEX IF NOT EXISTS idx_temporal_events_type ON temporal_events(event_type);
            CREATE INDEX IF NOT EXISTS idx_temporal_events_created ON temporal_events(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_temporal_events_session ON temporal_events(session_id);",
        )?;

        if queries::table_exists(conn, "memories")? {
            let _ = queries::try_add_column(conn, "memories", "embedding_model TEXT")?;
        }

        queries::mark_migration(
            conn,
            8,
            "M1 Foundation: sessions, temporal_events, embedding_model",
        )?;
        info!("Migration 8: Created sessions + temporal_events, added embedding_model");
    }

    // ── Migration 9: Ingestion Queue ─────────────────────────────────────
    if !queries::migration_has_run(conn, 9)? {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS ingestion_queue (
                id TEXT PRIMARY KEY,
                project_id TEXT DEFAULT 'global',
                source TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata TEXT DEFAULT '{}',
                priority INTEGER DEFAULT 5,
                status TEXT DEFAULT 'pending',
                attempts INTEGER DEFAULT 0,
                max_attempts INTEGER DEFAULT 3,
                created_at TEXT DEFAULT (datetime('now')),
                processed_at TEXT,
                error TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_ingestion_status ON ingestion_queue(status, priority, created_at);
            CREATE INDEX IF NOT EXISTS idx_ingestion_project ON ingestion_queue(project_id);",
        )?;
        queries::mark_migration(conn, 9, "M3 Automation Pipeline: ingestion_queue")?;
        info!("Migration 9: Created ingestion_queue");
    }

    // ── Migration 10: Reconsolidation on Recall ──────────────────────────
    if !queries::migration_has_run(conn, 10)? {
        if queries::table_exists(conn, "memories")? {
            let _ = queries::try_add_column(
                conn,
                "memories",
                "reconsolidation_count INTEGER DEFAULT 0",
            )?;
            let _ = queries::try_add_column(conn, "memories", "last_reconsolidated TEXT")?;
        }
        queries::mark_migration(
            conn,
            10,
            "M5 Reconsolidation: reconsolidation_count, last_reconsolidated",
        )?;
        info!("Migration 10: Added reconsolidation columns");
    }

    // ── Migration 11: Emotional Salience ─────────────────────────────────
    if !queries::migration_has_run(conn, 11)? {
        if queries::table_exists(conn, "memories")? {
            let _ = queries::try_add_column(
                conn,
                "memories",
                "emotional_salience REAL DEFAULT 0.0",
            )?;
        }
        queries::mark_migration(conn, 11, "M5 Emotional Salience: emotional_salience column")?;
        info!("Migration 11: Added emotional_salience");
    }

    // ── Migration 12: Processing Depth ───────────────────────────────────
    if !queries::migration_has_run(conn, 12)? {
        if queries::table_exists(conn, "memories")? {
            let _ = queries::try_add_column(
                conn,
                "memories",
                "processing_depth REAL DEFAULT 0.0",
            )?;
        }
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS processing_events (
                id TEXT PRIMARY KEY,
                memory_id TEXT NOT NULL,
                project_id TEXT DEFAULT 'global',
                event_type TEXT NOT NULL,
                depth_before REAL NOT NULL,
                depth_after REAL NOT NULL,
                context TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (memory_id) REFERENCES memories(id)
            );
            CREATE INDEX IF NOT EXISTS idx_processing_events_memory ON processing_events(memory_id);
            CREATE INDEX IF NOT EXISTS idx_processing_events_project ON processing_events(project_id);
            CREATE INDEX IF NOT EXISTS idx_processing_events_type ON processing_events(event_type);",
        )?;
        queries::mark_migration(
            conn,
            12,
            "M5 Processing Depth: processing_depth + processing_events",
        )?;
        info!("Migration 12: Added processing_depth + processing_events");
    }

    // ── Migration 13: Schema Extraction ──────────────────────────────────
    if !queries::migration_has_run(conn, 13)? {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS memory_schemas (
                id TEXT PRIMARY KEY,
                project_id TEXT DEFAULT 'global',
                schema_pattern TEXT NOT NULL,
                examples TEXT DEFAULT '[]',
                frequency INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_memory_schemas_project ON memory_schemas(project_id);",
        )?;
        queries::mark_migration(conn, 13, "M5 Schema Extraction: memory_schemas")?;
        info!("Migration 13: Created memory_schemas");
    }

    // ── Migration 14: Source Credibility ──────────────────────────────────
    if !queries::migration_has_run(conn, 14)? {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS source_credibility (
                source_id TEXT NOT NULL,
                project_id TEXT DEFAULT 'global',
                correct_count INTEGER DEFAULT 0,
                incorrect_count INTEGER DEFAULT 0,
                credibility_score REAL DEFAULT 0.5,
                last_updated TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (source_id, project_id)
            );
            CREATE INDEX IF NOT EXISTS idx_source_credibility_project ON source_credibility(project_id);
            CREATE INDEX IF NOT EXISTS idx_source_credibility_score ON source_credibility(credibility_score);",
        )?;
        queries::mark_migration(conn, 14, "M5 Source Credibility: source_credibility")?;
        info!("Migration 14: Created source_credibility");
    }

    // ── Migration 15: Resolution Audit Trail ─────────────────────────────
    if !queries::migration_has_run(conn, 15)? {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS resolution_audit_log (
                id TEXT PRIMARY KEY,
                resolution_id TEXT NOT NULL,
                project_id TEXT DEFAULT 'global',
                action TEXT NOT NULL,
                actor TEXT DEFAULT 'system',
                rationale TEXT,
                previous_state TEXT,
                new_state TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (resolution_id) REFERENCES contradiction_resolutions(id)
            );
            CREATE INDEX IF NOT EXISTS idx_audit_resolution ON resolution_audit_log(resolution_id);
            CREATE INDEX IF NOT EXISTS idx_audit_project ON resolution_audit_log(project_id);
            CREATE INDEX IF NOT EXISTS idx_audit_action ON resolution_audit_log(action);
            CREATE INDEX IF NOT EXISTS idx_audit_created ON resolution_audit_log(created_at DESC);",
        )?;
        queries::mark_migration(conn, 15, "M5 Resolution Audit Trail: resolution_audit_log")?;
        info!("Migration 15: Created resolution_audit_log");
    }

    // ── Migration 16: Consolidation Profiler ─────────────────────────────
    if !queries::migration_has_run(conn, 16)? {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS consolidation_profile_runs (
                id TEXT PRIMARY KEY,
                project_id TEXT DEFAULT 'global',
                level TEXT NOT NULL,
                phase_timings TEXT DEFAULT '{}',
                total_duration_ms INTEGER DEFAULT 0,
                memory_count INTEGER DEFAULT 0,
                edge_count INTEGER DEFAULT 0,
                concept_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_profile_runs_project ON consolidation_profile_runs(project_id);
            CREATE INDEX IF NOT EXISTS idx_profile_runs_level ON consolidation_profile_runs(level);
            CREATE INDEX IF NOT EXISTS idx_profile_runs_created ON consolidation_profile_runs(created_at DESC);",
        )?;
        queries::mark_migration(conn, 16, "M5 Consolidation Profiler: consolidation_profile_runs")?;
        info!("Migration 16: Created consolidation_profile_runs");
    }

    // ── Migration 17: Health Snapshots ────────────────────────────────────
    if !queries::migration_has_run(conn, 17)? {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS health_snapshots (
                id TEXT PRIMARY KEY,
                project_id TEXT DEFAULT 'global',
                overall_score INTEGER DEFAULT 0,
                dimension_scores TEXT DEFAULT '{}',
                memory_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_health_snapshots_project ON health_snapshots(project_id);
            CREATE INDEX IF NOT EXISTS idx_health_snapshots_created ON health_snapshots(created_at DESC);",
        )?;
        queries::mark_migration(conn, 17, "M5 Memory Health Score: health_snapshots")?;
        info!("Migration 17: Created health_snapshots");
    }

    // ── Migration 18: Memory Maturity Score ──────────────────────────────
    if !queries::migration_has_run(conn, 18)? {
        if queries::table_exists(conn, "memories")? {
            let _ = queries::try_add_column(
                conn,
                "memories",
                "maturity_score REAL DEFAULT 0.0",
            )?;
            let _ = queries::try_add_column(conn, "memories", "maturity_updated_at TEXT")?;
        }
        queries::mark_migration(
            conn,
            18,
            "M6 Memory Maturity Score: maturity_score, maturity_updated_at",
        )?;
        info!("Migration 18: Added maturity_score columns");
    }

    // ── Migration 19: Tier Lifecycle ─────────────────────────────────────
    if !queries::migration_has_run(conn, 19)? {
        if queries::table_exists(conn, "memories")? {
            let _ = queries::try_add_column(conn, "memories", "tier_changed_at TEXT")?;
            let _ = queries::try_add_column(
                conn,
                "memories",
                "demotion_count INTEGER DEFAULT 0",
            )?;
        }
        queries::mark_migration(
            conn,
            19,
            "M6 Tier Lifecycle: tier_changed_at, demotion_count",
        )?;
        info!("Migration 19: Added tier lifecycle columns");
    }

    // ── Migration 20: Memory Compression ─────────────────────────────────
    if !queries::migration_has_run(conn, 20)? {
        if queries::table_exists(conn, "memories")? {
            let _ = queries::try_add_column(conn, "memories", "content_original TEXT")?;
            let _ = queries::try_add_column(conn, "memories", "compressed_at TEXT")?;
        }
        queries::mark_migration(
            conn,
            20,
            "M6 Memory Compression: content_original, compressed_at",
        )?;
        info!("Migration 20: Added compression columns");
    }

    // ── Migration 21: Search Hit Count ───────────────────────────────────
    if !queries::migration_has_run(conn, 21)? {
        if queries::table_exists(conn, "memories")? {
            let _ = queries::try_add_column(
                conn,
                "memories",
                "search_hit_count INTEGER DEFAULT 0",
            )?;
            conn.execute_batch(
                "CREATE INDEX IF NOT EXISTS idx_memories_search_hit_count ON memories(search_hit_count) WHERE deleted_at IS NULL;",
            )?;
        }
        queries::mark_migration(conn, 21, "M10 Self-Editing Memory: search_hit_count")?;
        info!("Migration 21: Added search_hit_count");
    }

    // ── Migration 22: Code Intelligence ──────────────────────────────────
    if !queries::migration_has_run(conn, 22)? {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS code_entities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                file_path TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                name TEXT NOT NULL,
                qualified_name TEXT NOT NULL,
                signature TEXT,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL,
                docstring TEXT,
                complexity INTEGER DEFAULT 0,
                language TEXT NOT NULL,
                hash TEXT NOT NULL,
                embedding_id TEXT,
                bridge_entity_id TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now')),
                UNIQUE(project_id, file_path, qualified_name)
            );
            CREATE INDEX IF NOT EXISTS idx_code_entities_project ON code_entities(project_id);
            CREATE INDEX IF NOT EXISTS idx_code_entities_file ON code_entities(project_id, file_path);
            CREATE INDEX IF NOT EXISTS idx_code_entities_name ON code_entities(project_id, name);
            CREATE INDEX IF NOT EXISTS idx_code_entities_type ON code_entities(project_id, entity_type);
            CREATE INDEX IF NOT EXISTS idx_code_entities_qualified ON code_entities(project_id, qualified_name);
            CREATE INDEX IF NOT EXISTS idx_code_entities_hash ON code_entities(hash);

            CREATE TABLE IF NOT EXISTS code_relations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                from_entity_id INTEGER NOT NULL,
                to_entity_id INTEGER NOT NULL,
                relation_type TEXT NOT NULL,
                confidence REAL DEFAULT 1.0,
                metadata TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (from_entity_id) REFERENCES code_entities(id) ON DELETE CASCADE,
                FOREIGN KEY (to_entity_id) REFERENCES code_entities(id) ON DELETE CASCADE,
                UNIQUE(project_id, from_entity_id, to_entity_id, relation_type)
            );
            CREATE INDEX IF NOT EXISTS idx_code_relations_project ON code_relations(project_id);
            CREATE INDEX IF NOT EXISTS idx_code_relations_from ON code_relations(from_entity_id);
            CREATE INDEX IF NOT EXISTS idx_code_relations_to ON code_relations(to_entity_id);
            CREATE INDEX IF NOT EXISTS idx_code_relations_type ON code_relations(project_id, relation_type);

            CREATE TABLE IF NOT EXISTS code_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_hash TEXT NOT NULL,
                entity_count INTEGER DEFAULT 0,
                relation_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(project_id, file_path, file_hash)
            );
            CREATE INDEX IF NOT EXISTS idx_code_snapshots_project ON code_snapshots(project_id);
            CREATE INDEX IF NOT EXISTS idx_code_snapshots_file ON code_snapshots(project_id, file_path);",
        )?;
        queries::mark_migration(
            conn,
            22,
            "M12 Code Intelligence: code_entities, code_relations, code_snapshots",
        )?;
        info!("Migration 22: Created code intelligence tables");
    }

    // ── Migration 23: Architecture Insights ──────────────────────────────
    if !queries::migration_has_run(conn, 23)? {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS code_architecture_insights (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                pattern TEXT NOT NULL,
                severity TEXT NOT NULL DEFAULT 'info',
                entities TEXT NOT NULL DEFAULT '[]',
                description TEXT NOT NULL,
                suggestion TEXT,
                file_path TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_code_arch_project ON code_architecture_insights(project_id);
            CREATE INDEX IF NOT EXISTS idx_code_arch_pattern ON code_architecture_insights(project_id, pattern);
            CREATE INDEX IF NOT EXISTS idx_code_arch_severity ON code_architecture_insights(project_id, severity);",
        )?;
        queries::mark_migration(
            conn,
            23,
            "M12 Code Intelligence: code_architecture_insights",
        )?;
        info!("Migration 23: Created code_architecture_insights");
    }

    // ── Migration 24: Composite co-retrieval indexes ─────────────────────
    if !queries::migration_has_run(conn, 24)? {
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_co_retrieval_project_a ON co_retrieval_edges(project_id, memory_a);
            CREATE INDEX IF NOT EXISTS idx_co_retrieval_project_b ON co_retrieval_edges(project_id, memory_b);",
        )?;
        queries::mark_migration(
            conn,
            24,
            "Composite indexes on co_retrieval_edges for (project_id, memory_a/b)",
        )?;
        info!("Migration 24: Added composite co-retrieval indexes");
    }

    // ── Migration 25: Sparse Vectors + FTS5 expansion ────────────────────
    if !queries::migration_has_run(conn, 25)? {
        if queries::table_exists(conn, "memories")? {
            let _ = queries::try_add_column(conn, "memories", "sparse_tokens TEXT DEFAULT ''")?;

            // Drop old FTS5 index so init_fts5() rebuilds with sparse_tokens
            conn.execute_batch(
                "DROP TRIGGER IF EXISTS memories_fts_insert;
                DROP TRIGGER IF EXISTS memories_fts_delete;
                DROP TRIGGER IF EXISTS memories_fts_update;
                DROP TRIGGER IF EXISTS memories_fts_softdelete;
                DROP TRIGGER IF EXISTS memories_fts_project_update;
                DROP TABLE IF EXISTS memories_fts;",
            )?;
        }
        queries::mark_migration(
            conn,
            25,
            "M14 Sparse Vectors: sparse_tokens + FTS5 rebuild",
        )?;
        info!("Migration 25: Added sparse_tokens, dropped old FTS5 for rebuild");
    }

    // ── Migration 26: Agent ID column ────────────────────────────────────
    if !queries::migration_has_run(conn, 26)? {
        if queries::table_exists(conn, "memories")? {
            let _ = queries::try_add_column(
                conn,
                "memories",
                "agent_id TEXT DEFAULT 'system'",
            )?;
            conn.execute_batch(
                "CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id) WHERE deleted_at IS NULL;",
            )?;
        }
        queries::mark_migration(
            conn,
            26,
            "M15 Cognitive Architectures: agent_id column",
        )?;
        info!("Migration 26: Added agent_id column");
    }

    // ── Migration 27: Seed 'agent' entity type ───────────────────────────
    if !queries::migration_has_run(conn, 27)? {
        if let Err(e) = conn.execute_batch(
            "INSERT OR IGNORE INTO entity_types (name, parent_type, description) VALUES ('agent', NULL, 'Autonomous entity or AI')",
        ) {
            debug!("migration27: entity_types may not exist: {e}");
        }
        queries::mark_migration(conn, 27, "M15 Cognitive Architectures: Seed agent entity type")?;
        info!("Migration 27: Seeded agent entity type");
    }

    // ── Migration 28: Behavior Queue ─────────────────────────────────────
    if !queries::migration_has_run(conn, 28)? {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS behavior_queue (
                id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_behavior_queue_status_created ON behavior_queue(status, created_at);",
        )?;
        queries::mark_migration(conn, 28, "M16 LLM Cascade: behavior_queue")?;
        info!("Migration 28: Created behavior_queue");
    }

    // ── Migration 29: Scratchpad schema normalization ────────────────────
    if !queries::migration_has_run(conn, 29)? {
        let has_instance_id = queries::column_exists(conn, "scratchpad", "instance_id")?;

        if has_instance_id {
            let result: Result<()> = (|| {
                // Backup preserving most recent value per (key, project_id)
                conn.execute_batch(
                    "CREATE TABLE IF NOT EXISTS _scratchpad_v7_backup AS
                        SELECT key, project_id, value, expires_at, created_at
                        FROM scratchpad AS s
                        WHERE rowid = (
                            SELECT rowid FROM scratchpad
                            WHERE key = s.key AND project_id = s.project_id
                            ORDER BY created_at DESC LIMIT 1
                        )",
                )?;
                conn.execute_batch("DROP TABLE IF EXISTS scratchpad")?;
                conn.execute_batch(
                    "CREATE TABLE scratchpad (
                        key TEXT NOT NULL,
                        project_id TEXT DEFAULT 'global',
                        value TEXT NOT NULL,
                        expires_at TEXT,
                        created_at TEXT DEFAULT (datetime('now')),
                        PRIMARY KEY (key, project_id)
                    );
                    CREATE INDEX IF NOT EXISTS idx_scratchpad_project ON scratchpad(project_id);",
                )?;
                conn.execute_batch(
                    "INSERT OR IGNORE INTO scratchpad (key, project_id, value, expires_at, created_at)
                        SELECT key, project_id, value, expires_at, created_at FROM _scratchpad_v7_backup",
                )?;
                conn.execute_batch("DROP TABLE IF EXISTS _scratchpad_v7_backup")?;

                let restored: i64 = conn
                    .prepare_cached("SELECT COUNT(*) FROM scratchpad")?
                    .query_row([], |row| row.get(0))?;
                info!(
                    "Scratchpad normalized to 2-column PK ({} rows preserved)",
                    restored
                );
                Ok(())
            })();

            if let Err(e) = result {
                warn!("Scratchpad normalization failed: {e:#}");
                let _ = conn.execute_batch("DROP TABLE IF EXISTS _scratchpad_v7_backup");
            }
        }

        queries::mark_migration(
            conn,
            29,
            "v7.0.0: Scratchpad schema normalization (remove instance_id, 2-column PK)",
        )?;
    }

    Ok(())
}

// ============================================================================
// Utility: OptionalExtension for query_row
// ============================================================================

/// Extension trait to convert QueryReturnedNoRows to None.
trait OptionalExt<T> {
    fn optional_ext(self) -> Result<Option<T>>;
}

impl<T> OptionalExt<T> for std::result::Result<T, rusqlite::Error> {
    fn optional_ext(self) -> Result<Option<T>> {
        match self {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_initialize_schema_fresh_db() {
        let conn = setup_test_conn();
        initialize_schema(&conn).unwrap();

        // Verify core tables exist
        assert!(queries::table_exists(&conn, "memories").unwrap());
        assert!(queries::table_exists(&conn, "edges").unwrap());
        assert!(queries::table_exists(&conn, "scratchpad").unwrap());
        assert!(queries::table_exists(&conn, "entities").unwrap());
        assert!(queries::table_exists(&conn, "entity_relations").unwrap());
        assert!(queries::table_exists(&conn, "entity_types").unwrap());
        assert!(queries::table_exists(&conn, "sessions").unwrap());
        assert!(queries::table_exists(&conn, "temporal_events").unwrap());
        assert!(queries::table_exists(&conn, "co_retrieval_edges").unwrap());
        assert!(queries::table_exists(&conn, "concept_nodes").unwrap());
        assert!(queries::table_exists(&conn, "concept_memberships").unwrap());
        assert!(queries::table_exists(&conn, "cortex_state").unwrap());
        assert!(queries::table_exists(&conn, "schema_migrations").unwrap());

        // Verify migration-only tables
        assert!(queries::table_exists(&conn, "memory_schemas").unwrap());
        assert!(queries::table_exists(&conn, "source_credibility").unwrap());
        assert!(queries::table_exists(&conn, "code_entities").unwrap());
        assert!(queries::table_exists(&conn, "behavior_queue").unwrap());

        // Verify tables added for tool dispatch
        assert!(queries::table_exists(&conn, "tasks").unwrap());
        assert!(queries::table_exists(&conn, "entity_observations").unwrap());

        // Verify entity types seeded
        let count: i64 = conn
            .prepare("SELECT COUNT(*) FROM entity_types")
            .unwrap()
            .query_row([], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 9);

        // Verify all 29 migrations marked
        let mig_count: i64 = conn
            .prepare("SELECT COUNT(*) FROM schema_migrations")
            .unwrap()
            .query_row([], |row| row.get(0))
            .unwrap();
        assert_eq!(mig_count, 29);
    }

    #[test]
    fn test_initialize_schema_idempotent() {
        let conn = setup_test_conn();
        initialize_schema(&conn).unwrap();
        // Running again should not fail
        initialize_schema(&conn).unwrap();

        let mig_count: i64 = conn
            .prepare("SELECT COUNT(*) FROM schema_migrations")
            .unwrap()
            .query_row([], |row| row.get(0))
            .unwrap();
        assert_eq!(mig_count, 29);
    }

    #[test]
    fn test_cortex_state_seeded() {
        let conn = setup_test_conn();
        initialize_schema(&conn).unwrap();

        let val = queries::cortex_state_get(&conn, "cycle_number").unwrap();
        assert_eq!(val, Some("0".to_string()));
    }
}
