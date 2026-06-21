use gateway_config::{
    GatewayConfig, LogFormat, ProviderKind, RoutingStrategy,
};
use gateway_config::hot_reload::load_config;

// ─── ProviderKind ────────────────────────────────────────────────────────────

#[test]
fn provider_kind_lowercase_round_trip() {
    let kinds = [
        ("openai",     ProviderKind::OpenAI),
        ("anthropic",  ProviderKind::Anthropic),
        ("gemini",     ProviderKind::Gemini),
        ("mistral",    ProviderKind::Mistral),
        ("cohere",     ProviderKind::Cohere),
        ("groq",       ProviderKind::Groq),
        ("bedrock",    ProviderKind::Bedrock),
        ("vertexai",   ProviderKind::VertexAI),
        ("azure",      ProviderKind::Azure),
        ("together",   ProviderKind::Together),
        ("perplexity", ProviderKind::Perplexity),
        ("deepseek",   ProviderKind::DeepSeek),
        ("fireworks",  ProviderKind::Fireworks),
        ("custom",     ProviderKind::Custom),
    ];
    for (s, expected) in kinds {
        let parsed: ProviderKind =
            serde_json::from_str(&format!("\"{s}\"")).expect("parse");
        assert_eq!(parsed, expected, "string={s}");
    }
}

#[test]
fn provider_kind_uppercase_rejected() {
    // The enum is lowercase — uppercase variants must NOT parse silently.
    let res: Result<ProviderKind, _> = serde_json::from_str("\"OpenAI\"");
    assert!(res.is_err(), "uppercase variant must not be accepted");
}

#[test]
fn provider_kind_unknown_rejected() {
    let res: Result<ProviderKind, _> = serde_json::from_str("\"madeup\"");
    assert!(res.is_err());
}

// ─── RoutingStrategy ────────────────────────────────────────────────────────

#[test]
fn routing_strategy_snake_case() {
    let cases = [
        ("sequential",   RoutingStrategy::Sequential),
        ("round_robin",  RoutingStrategy::RoundRobin),
        ("weighted",     RoutingStrategy::Weighted),
        ("latency",      RoutingStrategy::Latency),
        ("cost",         RoutingStrategy::Cost),
    ];
    for (s, expected) in cases {
        let parsed: RoutingStrategy =
            serde_json::from_str(&format!("\"{s}\"")).unwrap();
        assert_eq!(parsed, expected);
    }
}

// ─── Defaults ────────────────────────────────────────────────────────────────

#[test]
fn defaults_match_expectations() {
    let cfg = GatewayConfig::default();
    assert_eq!(cfg.server.port, 8080);
    assert_eq!(cfg.server.host, "0.0.0.0");
    assert_eq!(cfg.cache.exact_match.ttl_seconds, 3600);
    assert_eq!(cfg.cache.exact_match.max_entries, 10_000);
    assert!(!cfg.cache.semantic.enabled, "semantic cache off by default");
    assert!(!cfg.auth.enabled);
    assert_eq!(cfg.dashboard_auth.username, "admin");
    assert_eq!(cfg.dashboard_auth.password, "admin");
    assert_eq!(cfg.storage.retention_days, 30);
    assert!(matches!(cfg.telemetry.log_format, LogFormat::Text));
}

// ─── TOML round trip ─────────────────────────────────────────────────────────

#[test]
fn minimal_toml_loads() {
    let toml = r#"
        [server]
        host = "127.0.0.1"
        port = 4891
        request_timeout_ms = 5000
        max_connections = 64

        [cache]
        enabled = true
        redis_url = ""

        [cache.exact_match]
        enabled = true
        ttl_seconds = 60
        max_entries = 100

        [cache.semantic]
        enabled = false
        similarity_threshold = 0.9
        ttl_seconds = 600

        [telemetry]
        metrics_enabled = true
        metrics_path = "/metrics"
        tracing_enabled = false
        log_level = "info"
        log_format = "text"

        [auth]
        enabled = false

        [storage]
        database_url = "sqlite::memory:"
        log_bodies = true
        retention_days = 7

        [[providers]]
        name = "openai-primary"
        kind = "openai"
        api_key = "sk-fake"
        weight = 100
        models = ["gpt-4o"]
    "#;
    let cfg: GatewayConfig = toml::from_str(toml).expect("parse");
    assert_eq!(cfg.server.port, 4891);
    assert_eq!(cfg.providers.len(), 1);
    assert_eq!(cfg.providers[0].kind, ProviderKind::OpenAI);
    assert_eq!(cfg.providers[0].weight, 100);
    assert_eq!(cfg.cache.exact_match.ttl_seconds, 60);
    assert_eq!(cfg.storage.retention_days, 7);
}

#[test]
fn provider_weight_defaults_to_100_when_missing() {
    let toml = r#"
        [server]
        host = "127.0.0.1"
        port = 4891
        request_timeout_ms = 5000
        max_connections = 64

        [cache]
        enabled = false

        [cache.exact_match]
        enabled = false
        ttl_seconds = 0
        max_entries = 0

        [cache.semantic]
        enabled = false
        similarity_threshold = 0.9
        ttl_seconds = 0

        [telemetry]
        metrics_enabled = false
        metrics_path = "/metrics"
        tracing_enabled = false
        log_level = "error"
        log_format = "text"

        [auth]
        enabled = false

        [storage]
        database_url = "sqlite::memory:"
        log_bodies = false
        retention_days = 0

        [[providers]]
        name = "p"
        kind = "openai"
        api_key = "x"
    "#;
    let cfg: GatewayConfig = toml::from_str(toml).expect("parse");
    assert_eq!(cfg.providers[0].weight, 100, "weight should default to 100");
    assert_eq!(cfg.providers[0].timeout_ms, 30_000, "timeout_ms should default to 30s");
}

#[test]
fn route_matches_glob_and_prefix_and_exact() {
    let toml = r#"
        [server]
        host = "0.0.0.0"
        port = 4891
        request_timeout_ms = 5000
        max_connections = 64

        [cache]
        enabled = false

        [cache.exact_match]
        enabled = false
        ttl_seconds = 0
        max_entries = 0

        [cache.semantic]
        enabled = false
        similarity_threshold = 0.95
        ttl_seconds = 0

        [telemetry]
        metrics_enabled = false
        metrics_path = "/metrics"
        tracing_enabled = false
        log_level = "error"
        log_format = "text"

        [auth]
        enabled = false

        [storage]
        database_url = "sqlite::memory:"
        log_bodies = false
        retention_days = 0

        [[providers]]
        name = "p"
        kind = "openai"
        api_key = "x"

        [[routes]]
        id = "claude-route"
        models = ["claude-*", "gpt-4o"]
        strategy = "sequential"
        providers = [{ name = "p", weight = 100 }]

        [[routes]]
        id = "everything"
        strategy = "sequential"
        providers = [{ name = "p", weight = 100 }]
    "#;
    let cfg: GatewayConfig = toml::from_str(toml).unwrap();
    assert_eq!(cfg.routes.len(), 2);
    let r0 = &cfg.routes[0];
    assert!(r0.matches_model("claude-3.5-sonnet"), "prefix match");
    assert!(r0.matches_model("gpt-4o"), "exact match");
    assert!(!r0.matches_model("gemini-pro"), "non-match");

    let r1 = &cfg.routes[1];
    assert!(r1.matches_model("any-model"), "default models=[\"*\"] should match everything");
}

// ─── load_config (file path) ─────────────────────────────────────────────────

#[test]
fn load_config_from_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("g.toml");
    std::fs::write(&path, r#"
        [server]
        host = "0.0.0.0"
        port = 1234
        request_timeout_ms = 5000
        max_connections = 8

        [cache]
        enabled = false

        [cache.exact_match]
        enabled = false
        ttl_seconds = 0
        max_entries = 0

        [cache.semantic]
        enabled = false
        similarity_threshold = 0.95
        ttl_seconds = 0

        [telemetry]
        metrics_enabled = false
        metrics_path = "/metrics"
        tracing_enabled = false
        log_level = "error"
        log_format = "json"

        [auth]
        enabled = false

        [storage]
        database_url = "sqlite::memory:"
        log_bodies = false
        retention_days = 0
    "#).unwrap();
    let cfg = load_config(&path).expect("load");
    assert_eq!(cfg.server.port, 1234);
    assert!(matches!(cfg.telemetry.log_format, LogFormat::Json));
}

#[test]
fn load_config_missing_file_errors() {
    let res = load_config("/nonexistent/path/that/should/not/exist.toml");
    assert!(res.is_err());
}
