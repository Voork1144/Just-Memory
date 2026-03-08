//! Query processing — intent detection, expansion, temporal operator parsing.
//!
//! Ports TypeScript `query-intent.ts`, `query-expand.ts`, `chronometer.ts`
//! (parseTemporalOperators) to Rust.

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;

// ============================================================================
// Query Intent Detection
// ============================================================================

/// Detected query intent used to select RRF weight profiles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum QueryIntent {
    Factual,
    Temporal,
    Navigational,
    Exploratory,
    ErrorDebug,
    SocialReasoning,
}

impl QueryIntent {
    /// String key for config lookups.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Factual => "factual",
            Self::Temporal => "temporal",
            Self::Navigational => "navigational",
            Self::Exploratory => "exploratory",
            Self::ErrorDebug => "error_debug",
            Self::SocialReasoning => "social_reasoning",
        }
    }

    /// Tie-breaking priority (higher wins).
    fn priority(self) -> u8 {
        match self {
            Self::Factual => 6,
            Self::SocialReasoning => 5,
            Self::ErrorDebug => 4,
            Self::Temporal => 3,
            Self::Navigational => 2,
            Self::Exploratory => 1,
        }
    }
}

/// Result of intent classification.
#[derive(Debug, Clone)]
pub struct IntentResult {
    pub intent: QueryIntent,
    pub confidence: f64,
    pub signals: Vec<String>,
}

/// Pattern entry: regex + weight + label.
struct IntentPattern {
    regex: Regex,
    weight: f64,
    label: &'static str,
}

/// Build intent patterns. Called once via LazyLock.
fn build_intent_patterns() -> HashMap<QueryIntent, Vec<IntentPattern>> {
    let mut map: HashMap<QueryIntent, Vec<IntentPattern>> = HashMap::new();

    macro_rules! pat {
        ($intent:expr, $re:expr, $w:expr, $label:expr) => {
            map.entry($intent).or_default().push(IntentPattern {
                regex: Regex::new($re).expect("hardcoded regex pattern"),
                weight: $w,
                label: $label,
            });
        };
    }

    // Factual
    pat!(QueryIntent::Factual, r"(?i)\bwhat\s+is\b", 0.8, "what-is");
    pat!(QueryIntent::Factual, r"(?i)\bwho\s+is\b", 0.8, "who-is");
    pat!(QueryIntent::Factual, r"(?i)\bdefine\b", 0.7, "define");
    pat!(QueryIntent::Factual, r"(?i)\bversion\b", 0.5, "version");
    pat!(QueryIntent::Factual, r"(?i)\bv\d+\.\d+", 0.6, "version-ref");
    pat!(QueryIntent::Factual, r"(?i)\bname\s+of\b", 0.4, "name-of");
    pat!(QueryIntent::Factual, r"(?i)\bhow\s+many\b", 0.5, "how-many");
    pat!(QueryIntent::Factual, r"(?i)\bwhich\b", 0.3, "which");
    pat!(QueryIntent::Factual, r"(?i)\bis\s+it\s+true\b", 0.5, "truth-check");

    // Temporal
    pat!(QueryIntent::Temporal, r"(?i)\bwhen\b", 0.8, "when");
    pat!(QueryIntent::Temporal, r"(?i)\blast:\d+[dwm]\b", 0.9, "last-n");
    pat!(QueryIntent::Temporal, r"(?i)\bbefore:", 0.9, "before-op");
    pat!(QueryIntent::Temporal, r"(?i)\bafter:", 0.9, "after-op");
    pat!(QueryIntent::Temporal, r"(?i)\bduring:", 0.8, "during-op");
    pat!(QueryIntent::Temporal, r"(?i)\brecent(ly)?\b", 0.6, "recent");
    pat!(QueryIntent::Temporal, r"(?i)\byesterday\b", 0.7, "yesterday");
    pat!(QueryIntent::Temporal, r"(?i)\blast\s+(week|month|year)\b", 0.7, "last-period");
    pat!(QueryIntent::Temporal, r"(?i)\btoday\b", 0.6, "today");
    pat!(QueryIntent::Temporal, r"(?i)\bbetween:\S+\.\.\S+", 0.9, "between-op");

    // Navigational
    pat!(QueryIntent::Navigational, r"(?i)\bwhere\s+is\b", 0.8, "where-is");
    pat!(QueryIntent::Navigational, r"(?i)\bfind\b", 0.5, "find");
    pat!(QueryIntent::Navigational, r"[/\\]\w+\.\w+", 0.7, "file-path");
    pat!(QueryIntent::Navigational, r"https?://", 0.8, "url");
    pat!(QueryIntent::Navigational, r"(?i)\blocate\b", 0.5, "locate");
    pat!(QueryIntent::Navigational, r"(?i)\bpath\s+to\b", 0.6, "path-to");

    // Exploratory
    pat!(QueryIntent::Exploratory, r"(?i)\bhow\s+to\b", 0.8, "how-to");
    pat!(QueryIntent::Exploratory, r"(?i)\bwhy\b", 0.7, "why");
    pat!(QueryIntent::Exploratory, r"(?i)\bexplain\b", 0.7, "explain");
    pat!(QueryIntent::Exploratory, r"(?i)\bcompare\b", 0.6, "compare");
    pat!(QueryIntent::Exploratory, r"(?i)\bdifference\s+between\b", 0.6, "diff-between");
    pat!(QueryIntent::Exploratory, r"(?i)\brelat(ed|ion)\b", 0.4, "related");

    // Error/debug
    pat!(QueryIntent::ErrorDebug, r"(?i)\berror\b", 0.8, "error");
    pat!(QueryIntent::ErrorDebug, r"(?i)\bbug\b", 0.7, "bug");
    pat!(QueryIntent::ErrorDebug, r"(?i)\bcrash\b", 0.7, "crash");
    pat!(QueryIntent::ErrorDebug, r"(?i)\bstack\s*trace\b", 0.8, "stacktrace");
    pat!(QueryIntent::ErrorDebug, r"(?i)\bfail(ed|ure|ing)?\b", 0.6, "fail");
    pat!(QueryIntent::ErrorDebug, r"(?i)\bpanic\b", 0.6, "panic");
    pat!(QueryIntent::ErrorDebug, r"(?i)\bE\d{4}\b", 0.7, "error-code");
    pat!(QueryIntent::ErrorDebug, r"(?i)\bdebug\b", 0.5, "debug");

    // Social reasoning
    pat!(QueryIntent::SocialReasoning, r"(?i)\bbelieves?\b", 0.7, "believes");
    pat!(QueryIntent::SocialReasoning, r"(?i)\bthinks?\b", 0.6, "thinks");
    pat!(QueryIntent::SocialReasoning, r"(?i)\bprefers?\b", 0.7, "prefers");
    pat!(QueryIntent::SocialReasoning, r"(?i)\bopinion\b", 0.6, "opinion");
    pat!(QueryIntent::SocialReasoning, r"(?i)\btheory\s+of\s+mind\b", 0.8, "tom");

    map
}

static INTENT_PATTERNS: LazyLock<HashMap<QueryIntent, Vec<IntentPattern>>> =
    LazyLock::new(build_intent_patterns);

/// Detect query intent using pattern-weighted scoring.
pub fn detect_query_intent(query: &str) -> IntentResult {
    let patterns = &*INTENT_PATTERNS;
    let mut scores: HashMap<QueryIntent, f64> = HashMap::new();
    let mut signals: HashMap<QueryIntent, Vec<String>> = HashMap::new();

    for (&intent, pats) in patterns.iter() {
        for pat in pats {
            if pat.regex.is_match(query) {
                *scores.entry(intent).or_default() += pat.weight;
                signals.entry(intent).or_default().push(pat.label.to_string());
            }
        }
    }

    // Compound: exploratory + error_debug → exploratory boost
    let exp_score = scores.get(&QueryIntent::Exploratory).copied().unwrap_or(0.0);
    let err_score = scores.get(&QueryIntent::ErrorDebug).copied().unwrap_or(0.0);
    if exp_score >= 0.6 && err_score >= 0.6 {
        *scores.entry(QueryIntent::Exploratory).or_default() += 0.5;
        signals
            .entry(QueryIntent::Exploratory)
            .or_default()
            .push("compound:how-to-fix".to_string());
    }

    // Best intent with priority tie-breaking
    let mut best_intent = QueryIntent::Factual;
    let mut best_score = 0.0;

    for (&intent, &score) in &scores {
        if score > best_score
            || (score == best_score && score > 0.0 && intent.priority() > best_intent.priority())
        {
            best_intent = intent;
            best_score = score;
        }
    }

    let confidence = (best_score / 2.0).min(1.0);
    let sigs = signals.remove(&best_intent).unwrap_or_default();

    IntentResult {
        intent: best_intent,
        confidence,
        signals: sigs,
    }
}

// ============================================================================
// Query Expansion
// ============================================================================

/// Result of query expansion.
#[derive(Debug, Clone)]
pub struct ExpandedQuery {
    pub original: String,
    pub expanded: String,
    pub terms: Vec<String>,
}

static ACRONYMS: LazyLock<HashMap<&'static str, &'static [&'static str]>> = LazyLock::new(|| {
    let mut m = HashMap::new();
    m.insert("db", &["database"][..]);
    m.insert("api", &["endpoint"][..]);
    m.insert("mcp", &["model", "context", "protocol"][..]);
    m.insert("jwt", &["token"][..]);
    m.insert("sql", &["query", "database"][..]);
    m.insert("css", &["style"][..]);
    m.insert("html", &["markup"][..]);
    m.insert("js", &["javascript"][..]);
    m.insert("ts", &["typescript"][..]);
    m.insert("ui", &["interface"][..]);
    m.insert("ux", &["experience"][..]);
    m.insert("ci", &["integration"][..]);
    m.insert("cd", &["deployment"][..]);
    m.insert("pr", &["pull", "request"][..]);
    m.insert("os", &["operating", "system"][..]);
    m.insert("cli", &["command"][..]);
    m.insert("sdk", &["kit"][..]);
    m.insert("env", &["environment"][..]);
    m.insert("config", &["configuration"][..]);
    m.insert("repo", &["repository"][..]);
    m.insert("dep", &["dependency"][..]);
    m.insert("deps", &["dependencies"][..]);
    m.insert("impl", &["implementation"][..]);
    m.insert("fn", &["function"][..]);
    m.insert("param", &["parameter"][..]);
    m.insert("args", &["arguments"][..]);
    m.insert("auth", &["authentication"][..]);
    m.insert("regex", &["pattern"][..]);
    m.insert("onnx", &["model", "inference"][..]);
    m.insert("fts", &["fulltext", "search"][..]);
    m
});

static SYNONYM_GROUPS: &[&[&str]] = &[
    &["fix", "bug", "patch", "repair"],
    &["error", "exception", "failure", "fault"],
    &["create", "add", "new", "make", "generate"],
    &["search", "find", "query", "lookup"],
    &["delete", "remove", "drop", "purge"],
    &["update", "modify", "change", "edit"],
    &["config", "configuration", "settings", "options"],
    &["fast", "quick", "speed", "performance"],
    &["slow", "latency", "delay", "lag"],
    &["test", "check", "verify", "validate"],
    &["build", "compile", "assemble", "package"],
    &["deploy", "release", "publish", "ship"],
    &["log", "trace", "debug", "monitor"],
    &["store", "save", "persist", "write"],
    &["load", "read", "fetch", "retrieve"],
    &["start", "begin", "init", "launch"],
    &["stop", "end", "halt", "terminate"],
];

static SYNONYM_LOOKUP: LazyLock<HashMap<&'static str, Vec<&'static str>>> = LazyLock::new(|| {
    let mut map: HashMap<&str, Vec<&str>> = HashMap::new();
    for group in SYNONYM_GROUPS {
        for &term in *group {
            let syns: Vec<&str> = group
                .iter()
                .filter(|&&s| s != term && !s.contains(' '))
                .copied()
                .take(2)
                .collect();
            map.insert(term, syns);
        }
    }
    map
});

/// Expand a query with acronym expansions and synonym terms.
pub fn expand_query(query: &str) -> ExpandedQuery {
    let original = query.to_string();
    let lower = query.to_lowercase();
    let original_terms: Vec<&str> = lower.split_whitespace().collect();

    let mut expansions: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for term in &original_terms {
        if seen.insert(term.to_string()) {
            expansions.push(term.to_string());
        }

        // Acronym expansion
        if let Some(exps) = ACRONYMS.get(term) {
            for &exp in *exps {
                let first = exp.split_whitespace().next().unwrap_or(exp);
                if seen.insert(first.to_string()) {
                    expansions.push(first.to_string());
                }
            }
        }

        // Synonym expansion (max 2)
        if let Some(syns) = SYNONYM_LOOKUP.get(term) {
            for &syn in syns.iter().take(2) {
                if seen.insert(syn.to_string()) {
                    expansions.push(syn.to_string());
                }
            }
        }
    }

    expansions.sort();
    let expanded = expansions.join(" ");

    ExpandedQuery {
        original,
        expanded,
        terms: expansions,
    }
}

// ============================================================================
// Temporal Operator Parsing
// ============================================================================

/// Parsed temporal operators extracted from query.
#[derive(Debug, Clone, Default)]
pub struct TemporalOperators {
    pub clean_query: String,
    pub before: Option<String>,
    pub after: Option<String>,
    pub as_of: Option<String>,
}

/// Parse temporal operators from query string.
///
/// Supported: `before:YYYY-MM-DD`, `after:YYYY-MM-DD`, `last:Nd/Nw/Nm`,
/// `during:YYYY-MM`, `as_of:YYYY-MM-DD`, `between:DATE..DATE`.
pub fn parse_temporal_operators(query: &str) -> TemporalOperators {
    static RE_BEFORE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)\bbefore:(\d{4}-\d{2}-\d{2})\b").expect("const regex"));
    static RE_AFTER: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)\bafter:(\d{4}-\d{2}-\d{2})\b").expect("const regex"));
    static RE_AS_OF: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)\bas_of:(\d{4}-\d{2}-\d{2})\b").expect("const regex"));
    static RE_LAST: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)\blast:(\d+)([dwmDWM])\b").expect("const regex"));
    static RE_DURING: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)\bduring:(\d{4}-\d{2})\b").expect("const regex"));
    static RE_BETWEEN: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)\bbetween:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})\b").expect("const regex")
    });

    let mut result = TemporalOperators {
        clean_query: query.to_string(),
        ..Default::default()
    };

    if let Some(cap) = RE_BEFORE.captures(query) {
        result.before = Some(cap[1].to_string());
        result.clean_query = RE_BEFORE.replace_all(&result.clean_query, "").to_string();
    }

    if let Some(cap) = RE_AFTER.captures(query) {
        result.after = Some(cap[1].to_string());
        result.clean_query = RE_AFTER.replace_all(&result.clean_query, "").to_string();
    }

    if let Some(cap) = RE_AS_OF.captures(query) {
        result.as_of = Some(cap[1].to_string());
        result.clean_query = RE_AS_OF.replace_all(&result.clean_query, "").to_string();
    }

    if let Some(cap) = RE_LAST.captures(query) {
        let num: i64 = cap[1].parse().unwrap_or(0);
        let unit = &cap[2];
        let days = match unit.to_ascii_lowercase().as_str() {
            "d" => num,
            "w" => num * 7,
            "m" => num * 30,
            _ => num,
        };
        if days > 0 {
            let now = chrono::Utc::now();
            let after_date = now - chrono::Duration::days(days);
            result.after = Some(after_date.format("%Y-%m-%d").to_string());
        }
        result.clean_query = RE_LAST.replace_all(&result.clean_query, "").to_string();
    }

    if let Some(cap) = RE_DURING.captures(query) {
        let ym = &cap[1];
        result.after = Some(format!("{ym}-01"));
        let parts: Vec<&str> = ym.split('-').collect();
        if parts.len() == 2 {
            if let (Ok(y), Ok(m)) = (parts[0].parse::<i32>(), parts[1].parse::<u32>()) {
                let (end_y, end_m) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
                result.before = Some(format!("{end_y:04}-{end_m:02}-01"));
            }
        }
        result.clean_query = RE_DURING.replace_all(&result.clean_query, "").to_string();
    }

    if let Some(cap) = RE_BETWEEN.captures(query) {
        result.after = Some(cap[1].to_string());
        result.before = Some(cap[2].to_string());
        result.clean_query = RE_BETWEEN.replace_all(&result.clean_query, "").to_string();
    }

    result.clean_query = result
        .clean_query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    result
}

// ============================================================================
// Prepared Search Query
// ============================================================================

/// Fully prepared query for the search pipeline.
#[derive(Debug, Clone)]
pub struct PreparedQuery {
    pub intent: IntentResult,
    pub keyword_query: String,
    pub semantic_query: String,
    pub effective_query: String,
    pub effective_as_of: Option<String>,
    pub temporal_before: Option<String>,
    pub temporal_after: Option<String>,
}

/// Phase 1 of TEMPR: prepare a raw query for the search pipeline.
pub fn prepare_search_query(query: &str, as_of: Option<&str>) -> PreparedQuery {
    let intent = detect_query_intent(query);
    let expanded = expand_query(query);
    let keyword_query = expanded.expanded.clone();

    let temporal = parse_temporal_operators(query);
    let effective_as_of = as_of.map(|s| s.to_string()).or(temporal.as_of);
    let effective_query = if temporal.clean_query.is_empty() {
        query.to_string()
    } else {
        temporal.clean_query
    };

    let semantic_expanded = expand_query(&effective_query);
    let semantic_query = if semantic_expanded.terms.len() > expanded.terms.len() {
        semantic_expanded.expanded
    } else {
        effective_query.clone()
    };

    PreparedQuery {
        intent,
        keyword_query,
        semantic_query,
        effective_query,
        effective_as_of,
        temporal_before: temporal.before,
        temporal_after: temporal.after,
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_intent_factual() {
        let r = detect_query_intent("what is the Rust version?");
        assert_eq!(r.intent, QueryIntent::Factual);
        assert!(r.confidence > 0.0);
    }

    #[test]
    fn test_intent_temporal() {
        let r = detect_query_intent("when did the last deployment happen?");
        assert_eq!(r.intent, QueryIntent::Temporal);
    }

    #[test]
    fn test_intent_error_debug() {
        let r = detect_query_intent("error E0308 in build");
        assert_eq!(r.intent, QueryIntent::ErrorDebug);
    }

    #[test]
    fn test_intent_exploratory() {
        let r = detect_query_intent("how to implement caching");
        assert_eq!(r.intent, QueryIntent::Exploratory);
    }

    #[test]
    fn test_intent_default_factual() {
        let r = detect_query_intent("random string with no patterns");
        assert_eq!(r.intent, QueryIntent::Factual);
        assert_eq!(r.confidence, 0.0);
    }

    #[test]
    fn test_expand_basic() {
        let r = expand_query("fix the db error");
        assert!(r.terms.contains(&"database".to_string()));
    }

    #[test]
    fn test_expand_no_duplicates() {
        let r = expand_query("search find query");
        let mut sorted = r.terms.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), r.terms.len());
    }

    #[test]
    fn test_parse_temporal_before() {
        let r = parse_temporal_operators("bugs before:2025-01-15 in login");
        assert_eq!(r.before, Some("2025-01-15".to_string()));
        assert!(!r.clean_query.contains("before:"));
    }

    #[test]
    fn test_parse_temporal_last() {
        let r = parse_temporal_operators("changes last:7d");
        assert!(r.after.is_some());
        assert!(r.clean_query.contains("changes"));
    }

    #[test]
    fn test_parse_temporal_between() {
        let r = parse_temporal_operators("events between:2024-01-01..2024-12-31");
        assert_eq!(r.after, Some("2024-01-01".to_string()));
        assert_eq!(r.before, Some("2024-12-31".to_string()));
    }

    #[test]
    fn test_parse_temporal_during() {
        let r = parse_temporal_operators("work during:2024-12");
        assert_eq!(r.after, Some("2024-12-01".to_string()));
        assert_eq!(r.before, Some("2025-01-01".to_string()));
    }

    #[test]
    fn test_prepare_search_query() {
        let pq = prepare_search_query("what is the db schema before:2025-01-01", None);
        // "before:" (weight 0.9) outscores "what is" (weight 0.8), so Temporal wins
        assert_eq!(pq.intent.intent, QueryIntent::Temporal);
        assert_eq!(pq.temporal_before, Some("2025-01-01".to_string()));
        assert!(!pq.effective_query.contains("before:"));
    }

    #[test]
    fn test_prepare_as_of_override() {
        let pq = prepare_search_query("test as_of:2024-06-01", Some("2025-01-01"));
        assert_eq!(pq.effective_as_of, Some("2025-01-01".to_string()));
    }
}
