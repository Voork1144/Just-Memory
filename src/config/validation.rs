//! Config validation — range checks, clamping, negative rejection.
//!
//! This module provides the unified validation entry point that combines
//! static config validation (from definitions.rs) with runtime file config
//! validation. Call `validate_all()` at startup.

use super::definitions::{validate_config, ConfigWarning};
use super::file::{get_file_config, FileConfig};

// ============================================================================
// File config validation
// ============================================================================

/// Validate the currently loaded FileConfig values.
/// Returns warnings for out-of-range or suspicious values.
pub fn validate_file_config(config: &FileConfig) -> Vec<ConfigWarning> {
    let mut warnings = Vec::new();

    // alert_error_rate must be 0.0..=1.0
    if let Some(v) = config.alert_error_rate {
        if v < 0.0 || v > 1.0 {
            warnings.push(ConfigWarning {
                namespace: "FileConfig".into(),
                field: "alert_error_rate".into(),
                message: format!("alert_error_rate={v} is out of range (0.0-1.0)."),
            });
        }
    }

    // alert_p95_latency_ms must be positive
    if let Some(v) = config.alert_p95_latency_ms {
        if v <= 0.0 {
            warnings.push(ConfigWarning {
                namespace: "FileConfig".into(),
                field: "alert_p95_latency_ms".into(),
                message: format!("alert_p95_latency_ms={v} must be positive."),
            });
        }
    }

    // heap_warning_mb should be less than memory_limit_mb
    if let (Some(warn_mb), Some(limit_mb)) = (config.heap_warning_mb, config.memory_limit_mb) {
        if warn_mb >= limit_mb {
            warnings.push(ConfigWarning {
                namespace: "FileConfig".into(),
                field: "heap_warning_mb".into(),
                message: format!(
                    "heap_warning_mb ({warn_mb}) >= memory_limit_mb ({limit_mb}). \
                     Warning threshold should be lower than hard limit."
                ),
            });
        }
    }

    // max_concurrent should be a whole number
    if let Some(v) = config.max_concurrent {
        if v != v.floor() || v < 1.0 {
            warnings.push(ConfigWarning {
                namespace: "FileConfig".into(),
                field: "max_concurrent".into(),
                message: format!("max_concurrent={v} should be a positive integer."),
            });
        }
    }

    // embedding_batch_size should be a whole number
    if let Some(v) = config.embedding_batch_size {
        if v != v.floor() || v < 1.0 {
            warnings.push(ConfigWarning {
                namespace: "FileConfig".into(),
                field: "embedding_batch_size".into(),
                message: format!("embedding_batch_size={v} should be a positive integer."),
            });
        }
    }

    // consolidation_interval_minutes must be > 0
    if let Some(v) = config.consolidation_interval_minutes {
        if v <= 0.0 {
            warnings.push(ConfigWarning {
                namespace: "FileConfig".into(),
                field: "consolidation_interval_minutes".into(),
                message: format!("consolidation_interval_minutes={v} must be positive."),
            });
        }
    }

    warnings
}

// ============================================================================
// Unified validation
// ============================================================================

/// Run all config validations: static constants + file config.
/// Call at startup after loading the config file.
pub fn validate_all() -> Vec<ConfigWarning> {
    let mut all = validate_config();
    let file_config = get_file_config();
    all.extend(validate_file_config(&file_config));
    all
}
