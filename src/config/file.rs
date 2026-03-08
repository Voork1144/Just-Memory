//! Config file loading (JSON/TOML) with hot-reload support.
//!
//! Port of config-file.ts.
//! - Loads optional configuration from ~/.config/just-memory/config.json
//! - Priority: env vars > config file > defaults
//! - Supports runtime reload via file watcher (notify crate)

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

// ============================================================================
// FileConfig — runtime-tunable fields from config file
// ============================================================================

/// Configuration fields that can be set via config file.
/// All fields optional — missing fields keep the compiled defaults.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FileConfig {
    /// Alert thresholds
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alert_error_rate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alert_p95_latency_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alert_queue_depth: Option<f64>,

    /// Memory pressure threshold in MB
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heap_warning_mb: Option<f64>,
    /// Memory hard limit in MB (triggers queue rejection)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_limit_mb: Option<f64>,

    /// Consolidation interval in minutes
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consolidation_interval_minutes: Option<f64>,
    /// Max concurrent tool calls
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_concurrent: Option<f64>,
    /// Embedding worker batch size
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_batch_size: Option<f64>,
    /// Metrics flush interval in seconds
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics_flush_interval_seconds: Option<f64>,
    /// Enable/disable memory sampling
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_sampling_enabled: Option<bool>,
}

// ============================================================================
// Known fields and max values
// ============================================================================

/// Numeric fields that are allowed in the config file.
const KNOWN_NUMERIC: &[&str] = &[
    "alert_error_rate",
    "alert_p95_latency_ms",
    "alert_queue_depth",
    "heap_warning_mb",
    "memory_limit_mb",
    "consolidation_interval_minutes",
    "max_concurrent",
    "embedding_batch_size",
    "metrics_flush_interval_seconds",
];

const KNOWN_BOOL: &[&str] = &["memory_sampling_enabled"];

fn max_value_for(key: &str) -> Option<f64> {
    match key {
        "alert_error_rate" => Some(1.0),
        "alert_p95_latency_ms" => Some(300_000.0),
        "alert_queue_depth" => Some(10_000.0),
        "heap_warning_mb" => Some(16_384.0),
        "memory_limit_mb" => Some(16_384.0),
        "consolidation_interval_minutes" => Some(1440.0),
        "max_concurrent" => Some(100.0),
        "embedding_batch_size" => Some(1000.0),
        "metrics_flush_interval_seconds" => Some(3600.0),
        _ => None,
    }
}

// ============================================================================
// Config file path
// ============================================================================

fn default_config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".config")
        .join("just-memory")
        .join("config.json")
}

// ============================================================================
// Load & Parse — validates types, ranges, rejects unknowns
// ============================================================================

/// Load and validate a config file. Returns `FileConfig` (empty if file missing).
/// Logs warnings for unknown fields, type mismatches, and range violations.
pub fn load_config_file(path: Option<&Path>) -> FileConfig {
    let path = path
        .map(|p| p.to_path_buf())
        .unwrap_or_else(default_config_path);

    if !path.exists() {
        return FileConfig::default();
    }

    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(err) => {
            warn!(
                component = "config-file",
                op = "load",
                path = %path.display(),
                error = %err,
                "Failed to read config file"
            );
            return FileConfig::default();
        }
    };

    let parsed: HashMap<String, serde_json::Value> = match serde_json::from_str(&raw) {
        Ok(m) => m,
        Err(err) => {
            warn!(
                component = "config-file",
                op = "load",
                path = %path.display(),
                error = %err,
                "Failed to parse config file as JSON"
            );
            return FileConfig::default();
        }
    };

    let mut validated = FileConfig::default();
    let mut rejected: Vec<String> = Vec::new();

    let known_all: Vec<&str> = KNOWN_NUMERIC.iter().chain(KNOWN_BOOL.iter()).copied().collect();

    for (key, value) in &parsed {
        let key_str = key.as_str();

        // Check for unknown fields
        if !known_all.contains(&key_str) {
            rejected.push(format!("{key}: unknown field (ignored)"));
            continue;
        }

        // Boolean field
        if KNOWN_BOOL.contains(&key_str) {
            if let Some(b) = value.as_bool() {
                validated.memory_sampling_enabled = Some(b);
            } else {
                rejected.push(format!("{key}: expected boolean, got {}", value_type_name(value)));
            }
            continue;
        }

        // Numeric fields
        let num = match value.as_f64() {
            Some(n) => n,
            None => {
                rejected.push(format!("{key}: expected number, got {}", value_type_name(value)));
                continue;
            }
        };

        if !num.is_finite() {
            rejected.push(format!("{key}: non-finite number ({num})"));
            continue;
        }

        if num < 0.0 {
            rejected.push(format!("{key}: negative value ({num}) not allowed"));
            continue;
        }

        // Range clamping
        let clamped = match max_value_for(key_str) {
            Some(max) if num > max => {
                warn!(
                    component = "config-file",
                    op = "load",
                    "Clamped {key} from {num} to {max} (max: {max})"
                );
                max
            }
            _ => num,
        };

        set_numeric_field(&mut validated, key_str, clamped);
    }

    if !rejected.is_empty() {
        warn!(
            component = "config-file",
            op = "load",
            "Rejected config fields: {}", rejected.join("; ")
        );
    }

    info!(
        component = "config-file",
        op = "load",
        path = %path.display(),
        "Loaded config file"
    );

    validated
}

/// Set a numeric field by name on FileConfig.
fn set_numeric_field(config: &mut FileConfig, key: &str, value: f64) {
    match key {
        "alert_error_rate" => config.alert_error_rate = Some(value),
        "alert_p95_latency_ms" => config.alert_p95_latency_ms = Some(value),
        "alert_queue_depth" => config.alert_queue_depth = Some(value),
        "heap_warning_mb" => config.heap_warning_mb = Some(value),
        "memory_limit_mb" => config.memory_limit_mb = Some(value),
        "consolidation_interval_minutes" => config.consolidation_interval_minutes = Some(value),
        "max_concurrent" => config.max_concurrent = Some(value),
        "embedding_batch_size" => config.embedding_batch_size = Some(value),
        "metrics_flush_interval_seconds" => config.metrics_flush_interval_seconds = Some(value),
        _ => {}
    }
}

/// Return a human-readable type name for a JSON value.
fn value_type_name(v: &serde_json::Value) -> &'static str {
    match v {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "boolean",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
    }
}

// ============================================================================
// Cached config (thread-safe)
// ============================================================================

/// Global cached config. Wrapped in Arc<Mutex<>> for thread-safe reload.
static CACHED_CONFIG: std::sync::LazyLock<Mutex<FileConfig>> =
    std::sync::LazyLock::new(|| Mutex::new(FileConfig::default()));

/// Initialize cached config from file.
pub fn init_file_config(path: Option<&Path>) {
    let config = load_config_file(path);
    *CACHED_CONFIG.lock().unwrap_or_else(|e| e.into_inner()) = config;
}

/// Get a clone of the current cached config.
pub fn get_file_config() -> FileConfig {
    CACHED_CONFIG
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

// ============================================================================
// File Watcher (runtime reload via notify crate)
// ============================================================================

/// Handle to a running config file watcher. Drop to stop watching.
pub struct ConfigWatcher {
    _watcher: RecommendedWatcher,
}

/// Start watching the config file for changes. Reloads on modify.
/// Returns `None` if the file doesn't exist or the watcher fails to start.
///
/// `on_reload` is called (on a background thread) when the config changes.
pub fn watch_config_file<F>(
    on_reload: F,
    path: Option<&Path>,
) -> Option<ConfigWatcher>
where
    F: Fn(FileConfig) + Send + 'static,
{
    let path = path
        .map(|p| p.to_path_buf())
        .unwrap_or_else(default_config_path);

    if !path.exists() {
        return None;
    }

    let watch_path = path.clone();
    let reload_path = path.clone();

    // Debounce: ignore events within 500ms of each other
    let last_reload = Arc::new(Mutex::new(std::time::Instant::now()));

    let debounce_last = last_reload.clone();

    let mut watcher = match notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        let event = match res {
            Ok(e) => e,
            Err(err) => {
                warn!(
                    component = "config-file",
                    op = "watch",
                    error = %err,
                    "File watcher error"
                );
                return;
            }
        };

        // Only react to modify/create events
        match event.kind {
            EventKind::Modify(_) | EventKind::Create(_) => {}
            _ => return,
        }

        // Debounce: skip if < 500ms since last reload
        {
            let mut last = debounce_last.lock().unwrap_or_else(|e| e.into_inner());
            let now = std::time::Instant::now();
            if now.duration_since(*last) < Duration::from_millis(500) {
                return;
            }
            *last = now;
        }

        let old_config = get_file_config();
        let new_config = load_config_file(Some(&reload_path));

        // Update cache
        *CACHED_CONFIG.lock().unwrap_or_else(|e| e.into_inner()) = new_config.clone();

        // Log what changed
        let changes = diff_configs(&old_config, &new_config);
        if !changes.is_empty() {
            info!(
                component = "config-file",
                op = "watch",
                "Config reloaded: {}", changes.join(", ")
            );
            on_reload(new_config);
        }
    }) {
        Ok(w) => w,
        Err(err) => {
            warn!(
                component = "config-file",
                op = "watch",
                error = %err,
                "Failed to create file watcher"
            );
            return None;
        }
    };

    // Watch the parent directory (some editors replace the file entirely)
    let watch_dir = watch_path.parent().unwrap_or(&watch_path);
    if let Err(err) = watcher.watch(watch_dir, RecursiveMode::NonRecursive) {
        warn!(
            component = "config-file",
            op = "watch",
            error = %err,
            path = %watch_dir.display(),
            "Failed to watch config directory"
        );
        return None;
    }

    info!(
        component = "config-file",
        op = "watch",
        path = %watch_path.display(),
        "Watching config file for changes"
    );

    Some(ConfigWatcher { _watcher: watcher })
}

/// Compare two FileConfig instances and return human-readable diffs.
fn diff_configs(old: &FileConfig, new: &FileConfig) -> Vec<String> {
    let mut changes = Vec::new();

    macro_rules! cmp_field {
        ($field:ident) => {
            if old.$field != new.$field {
                changes.push(format!(
                    "{}: {:?} -> {:?}",
                    stringify!($field),
                    old.$field,
                    new.$field
                ));
            }
        };
    }

    cmp_field!(alert_error_rate);
    cmp_field!(alert_p95_latency_ms);
    cmp_field!(alert_queue_depth);
    cmp_field!(heap_warning_mb);
    cmp_field!(memory_limit_mb);
    cmp_field!(consolidation_interval_minutes);
    cmp_field!(max_concurrent);
    cmp_field!(embedding_batch_size);
    cmp_field!(metrics_flush_interval_seconds);
    cmp_field!(memory_sampling_enabled);

    changes
}
