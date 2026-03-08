//! Connection pool setup with WAL mode, FTS5, and pragmas.
//!
//! Uses r2d2 + r2d2_sqlite for connection pooling with rusqlite.
//! The TypeScript version uses a single synchronous connection; we improve
//! concurrency here with a pool while preserving the same pragma settings.

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use anyhow::{Context, Result};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;
use tracing::info;

use crate::db::migrations;

// ============================================================================
// Type Aliases
// ============================================================================

/// Alias for the r2d2 connection pool over SQLite.
pub type DbPool = Pool<SqliteConnectionManager>;

/// Alias for a pooled connection handle.
pub type DbConn = r2d2::PooledConnection<SqliteConnectionManager>;

// ============================================================================
// Default Data Path
// ============================================================================

/// Default data directory: `~/.just-memory/`
static DEFAULT_DATA_DIR: LazyLock<PathBuf> = LazyLock::new(|| {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".just-memory")
});

/// Resolve the DB path from environment or default.
pub fn resolve_db_path() -> PathBuf {
    if let Ok(custom) = std::env::var("JUST_MEMORY_DB") {
        PathBuf::from(custom)
    } else {
        DEFAULT_DATA_DIR.join("memory.db")
    }
}

// ============================================================================
// Pragmas
// ============================================================================

/// Apply production SQLite pragmas matching the TypeScript version.
///
/// Pragmas from TS `database.ts`:
/// - `journal_mode = WAL`
/// - `busy_timeout = 5000`
/// - `synchronous = FULL`
/// - `foreign_keys = ON`
/// - `cache_size = -64000` (64 MB)
/// - `mmap_size = 268435456` (256 MB)
/// - `temp_store = MEMORY`
fn apply_pragmas(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        PRAGMA synchronous = FULL;
        PRAGMA foreign_keys = ON;
        PRAGMA cache_size = -64000;
        PRAGMA mmap_size = 268435456;
        PRAGMA temp_store = MEMORY;
        ",
    )
    .context("Failed to apply SQLite pragmas")?;
    Ok(())
}

// ============================================================================
// Pool Creation
// ============================================================================

/// Initializer that runs on every new connection from the pool.
#[derive(Debug)]
struct PragmaInitializer;

impl r2d2::CustomizeConnection<Connection, rusqlite::Error> for PragmaInitializer {
    fn on_acquire(&self, conn: &mut Connection) -> std::result::Result<(), rusqlite::Error> {
        apply_pragmas(conn).map_err(|e| {
            rusqlite::Error::ModuleError(format!("pragma init failed: {e}"))
        })
    }
}

/// Create a connection pool to the given SQLite path.
///
/// - Ensures parent directory exists
/// - Applies pragmas on each connection via `CustomizeConnection`
/// - Runs migrations on a dedicated connection
/// - Returns pool ready for use
pub fn create_pool(db_path: &Path) -> Result<DbPool> {
    // Ensure parent directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create DB directory: {}", parent.display()))?;
    }

    let manager = SqliteConnectionManager::file(db_path);

    let pool = Pool::builder()
        .max_size(4) // WAL allows concurrent reads; 4 is conservative for an MCP server
        .connection_customizer(Box::new(PragmaInitializer))
        .build(manager)
        .with_context(|| format!("Failed to create pool for {}", db_path.display()))?;

    info!("SQLite pool created: {}", db_path.display());

    // Run schema + migrations on a dedicated connection
    {
        let conn = pool.get().context("Failed to get init connection from pool")?;
        migrations::initialize_schema(&conn)?;
    }

    Ok(pool)
}

/// Create an in-memory pool (for tests).
///
/// Uses `SqliteConnectionManager::memory()` with shared cache so all pooled
/// connections see the same database.
pub fn create_memory_pool() -> Result<DbPool> {
    // Shared-cache in-memory DB so all pool connections see the same data.
    // Use a unique name per invocation to avoid cross-test contamination.
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let id = COUNTER.fetch_add(1, Ordering::Relaxed);
    let uri = format!("file:memdb_{id}?mode=memory&cache=shared");
    let manager = SqliteConnectionManager::file(uri)
        .with_flags(
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
                | rusqlite::OpenFlags::SQLITE_OPEN_CREATE
                | rusqlite::OpenFlags::SQLITE_OPEN_URI
                | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        );

    let pool = Pool::builder()
        .max_size(2)
        .connection_customizer(Box::new(PragmaInitializer))
        .build(manager)
        .context("Failed to create in-memory pool")?;

    {
        let conn = pool.get().context("Failed to get init connection from memory pool")?;
        migrations::initialize_schema(&conn)?;
    }

    Ok(pool)
}

/// Verify that FTS5 is available on the given connection.
pub fn check_fts5(conn: &Connection) -> bool {
    conn.execute_batch("CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_check USING fts5(x); DROP TABLE IF EXISTS _fts5_check;")
        .is_ok()
}

/// Get the WAL journal mode (should be "wal" after pragmas).
pub fn get_journal_mode(conn: &Connection) -> Result<String> {
    let mode: String = conn.query_row("PRAGMA journal_mode", [], |row| row.get(0))?;
    Ok(mode)
}
