use gateway_config::{
    AuthConfig, CacheConfig, DashboardAuthConfig, GatewayConfig, ProviderConfig, ProviderKind,
    ProviderRoute, RouteConfig, RoutingStrategy, ServerConfig, StorageConfig, TelemetryConfig,
};
use gateway_providers::ProviderRegistry;

fn provider(name: &str, kind: ProviderKind, models: Vec<&str>) -> ProviderConfig {
    ProviderConfig {
        name: name.into(),
        kind,
        api_key: Some("unused".into()),
        api_key_env: None,
        base_url: Some("http://127.0.0.1:0".into()),
        weight: 100,
        timeout_ms: 5_000,
        models: models.into_iter().map(String::from).collect(),
    }
}

fn cfg(providers: Vec<ProviderConfig>, routes: Vec<RouteConfig>) -> GatewayConfig {
    GatewayConfig {
        server: ServerConfig {
            host: "127.0.0.1".into(),
            port: 0,
            request_timeout_ms: 5_000,
            max_connections: 8,
        },
        providers,
        routes,
        cache: CacheConfig::default(),
        telemetry: TelemetryConfig::default(),
        auth: AuthConfig::default(),
        storage: StorageConfig::default(),
        dashboard_auth: DashboardAuthConfig::default(),
    }
}

fn route(id: &str, models: Vec<&str>, strategy: RoutingStrategy, providers: Vec<(&str, u32)>, fallbacks: Vec<&str>) -> RouteConfig {
    RouteConfig {
        id: id.into(),
        models: models.into_iter().map(String::from).collect(),
        strategy,
        providers: providers.into_iter().map(|(n, w)| ProviderRoute { name: n.into(), weight: w }).collect(),
        fallbacks: fallbacks.into_iter().map(String::from).collect(),
        retries: 0,
        retry_delay_ms: 50,
        timeout_ms: None,
        rate_limit: None,
    }
}

// ─── Construction ────────────────────────────────────────────────────────────

#[test]
fn from_config_registers_all_providers() {
    let providers = vec![
        provider("p1", ProviderKind::OpenAI, vec!["gpt-4o"]),
        provider("p2", ProviderKind::Anthropic, vec!["claude-3.5-sonnet"]),
        provider("p3", ProviderKind::Gemini, vec!["gemini-pro"]),
    ];
    let reg = ProviderRegistry::from_config(&cfg(providers, vec![])).unwrap();
    assert!(reg.get("p1").is_some());
    assert!(reg.get("p2").is_some());
    assert!(reg.get("p3").is_some());
    assert!(reg.get("unknown").is_none());
    assert_eq!(reg.all().len(), 3);
}

#[test]
fn from_config_with_zero_providers_ok() {
    let reg = ProviderRegistry::from_config(&cfg(vec![], vec![])).unwrap();
    assert_eq!(reg.all().len(), 0);
    assert!(reg.ordered_providers("anything").is_empty());
}

// ─── ordered_providers ──────────────────────────────────────────────────────

#[test]
fn sequential_strategy_preserves_order() {
    let providers = vec![
        provider("a", ProviderKind::OpenAI, vec!["*"]),
        provider("b", ProviderKind::OpenAI, vec!["*"]),
        provider("c", ProviderKind::OpenAI, vec!["*"]),
    ];
    let routes = vec![route(
        "r",
        vec!["*"],
        RoutingStrategy::Sequential,
        vec![("a", 100), ("b", 100), ("c", 100)],
        vec![],
    )];
    let reg = ProviderRegistry::from_config(&cfg(providers, routes)).unwrap();
    let ordered = reg.ordered_providers("gpt-4o");
    let names: Vec<_> = ordered.iter().map(|p| p.name()).collect();
    assert_eq!(names, vec!["a", "b", "c"]);
}

#[test]
fn round_robin_rotates_starting_provider() {
    let providers = vec![
        provider("a", ProviderKind::OpenAI, vec!["*"]),
        provider("b", ProviderKind::OpenAI, vec!["*"]),
        provider("c", ProviderKind::OpenAI, vec!["*"]),
    ];
    let routes = vec![route(
        "r",
        vec!["*"],
        RoutingStrategy::RoundRobin,
        vec![("a", 100), ("b", 100), ("c", 100)],
        vec![],
    )];
    let reg = ProviderRegistry::from_config(&cfg(providers, routes)).unwrap();
    let first  = reg.ordered_providers("any")[0].name().to_string();
    let second = reg.ordered_providers("any")[0].name().to_string();
    let third  = reg.ordered_providers("any")[0].name().to_string();
    assert_ne!(first, second, "round robin should advance");
    assert_ne!(second, third);
}

#[test]
fn fallback_providers_appended_to_primary_list() {
    let providers = vec![
        provider("primary", ProviderKind::OpenAI, vec!["*"]),
        provider("fallback", ProviderKind::OpenAI, vec!["*"]),
    ];
    let routes = vec![route(
        "r",
        vec!["*"],
        RoutingStrategy::Sequential,
        vec![("primary", 100)],
        vec!["fallback"],
    )];
    let reg = ProviderRegistry::from_config(&cfg(providers, routes)).unwrap();
    let ordered = reg.ordered_providers("any");
    assert_eq!(ordered.len(), 2);
    assert_eq!(ordered[0].name(), "primary");
    assert_eq!(ordered[1].name(), "fallback");
}

#[test]
fn no_route_falls_back_to_any_supporting_provider() {
    let providers = vec![
        provider("openai-p", ProviderKind::OpenAI, vec!["gpt-4o", "gpt-4o-mini"]),
        provider("anthropic-p", ProviderKind::Anthropic, vec!["claude-3.5-sonnet"]),
    ];
    let reg = ProviderRegistry::from_config(&cfg(providers, vec![])).unwrap();
    let ordered = reg.ordered_providers("gpt-4o");
    assert_eq!(ordered.len(), 1);
    assert_eq!(ordered[0].name(), "openai-p");
}

#[test]
fn latency_strategy_prefers_lower_latency() {
    let providers = vec![
        provider("slow", ProviderKind::OpenAI, vec!["*"]),
        provider("fast", ProviderKind::OpenAI, vec!["*"]),
    ];
    let routes = vec![route(
        "r",
        vec!["*"],
        RoutingStrategy::Latency,
        vec![("slow", 100), ("fast", 100)],
        vec![],
    )];
    let reg = ProviderRegistry::from_config(&cfg(providers, routes)).unwrap();
    reg.record_latency("slow", 500.0);
    reg.record_latency("fast", 20.0);
    let ordered = reg.ordered_providers("any");
    assert_eq!(ordered[0].name(), "fast", "lowest latency provider should be first");
}

#[test]
fn route_params_returns_retries_and_delay() {
    let providers = vec![provider("p", ProviderKind::OpenAI, vec!["*"])];
    let routes = vec![RouteConfig {
        id: "r".into(),
        models: vec!["*".into()],
        strategy: RoutingStrategy::Sequential,
        providers: vec![ProviderRoute { name: "p".into(), weight: 100 }],
        fallbacks: vec![],
        retries: 3,
        retry_delay_ms: 250,
        timeout_ms: None,
        rate_limit: None,
    }];
    let reg = ProviderRegistry::from_config(&cfg(providers, routes)).unwrap();
    let (retries, delay) = reg.route_params("anything");
    assert_eq!(retries, 3);
    assert_eq!(delay, 250);
}
