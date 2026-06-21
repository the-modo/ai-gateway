use gateway_config::ApiKeyConfig;
use gateway_test_utils::{HarnessBuilder, MockConfig};

// ─── Auth disabled ────────────────────────────────────────────────────────────

/// When auth is disabled (default), requests without a key must succeed.
#[tokio::test]
async fn auth_disabled_allows_unauthenticated_requests() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    let resp = h.chat("gpt-4o", "no auth needed").await;
    assert_eq!(resp.status(), 200);
}

/// When auth is disabled, any arbitrary Bearer token is also accepted.
#[tokio::test]
async fn auth_disabled_ignores_bearer_token() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    let resp = h.chat_with_key("gpt-4o", "hello", "garbage-key").await;
    assert_eq!(resp.status(), 200);
}

// ─── Auth enabled ─────────────────────────────────────────────────────────────

fn make_keys(keys: &[&str]) -> Vec<ApiKeyConfig> {
    keys.iter()
        .enumerate()
        .map(|(i, k)| ApiKeyConfig {
            key: k.to_string(),
            name: format!("test-key-{i}"),
            allowed_models: None,
            monthly_budget_usd: None,
        })
        .collect()
}

/// Valid Bearer token in the `Authorization` header → 200.
#[tokio::test]
async fn auth_enabled_valid_key_passes() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .with_auth(make_keys(&["sk-valid-key"]))
        .build()
        .await
        .unwrap();

    let resp = h.chat_with_key("gpt-4o", "hello", "sk-valid-key").await;
    assert_eq!(resp.status(), 200);
}

/// Wrong Bearer token → 401.
#[tokio::test]
async fn auth_enabled_invalid_key_rejected() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .with_auth(make_keys(&["sk-valid-key"]))
        .build()
        .await
        .unwrap();

    let resp = h.chat_with_key("gpt-4o", "hello", "sk-WRONG").await;
    assert_eq!(resp.status(), 401);
}

/// No Authorization header when auth is enabled → 401.
#[tokio::test]
async fn auth_enabled_missing_header_rejected() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .with_auth(make_keys(&["sk-valid-key"]))
        .build()
        .await
        .unwrap();

    let resp = h.chat("gpt-4o", "no header").await;
    assert_eq!(resp.status(), 401);
}

/// Multiple keys can be configured; each must be independently valid.
#[tokio::test]
async fn auth_multiple_keys_each_valid() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .with_auth(make_keys(&["sk-key-one", "sk-key-two", "sk-key-three"]))
        .build()
        .await
        .unwrap();

    for key in &["sk-key-one", "sk-key-two", "sk-key-three"] {
        let resp = h.chat_with_key("gpt-4o", "hello", key).await;
        assert_eq!(resp.status(), 200, "key {key} should be accepted");
    }
}

/// Analytics/logs endpoints require a valid dashboard session token.
/// (Regression test: these were previously reachable unauthenticated.)
#[tokio::test]
async fn analytics_endpoints_require_dashboard_auth() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .with_auth(make_keys(&["sk-valid-key"]))
        .build()
        .await
        .unwrap();

    // A tokenless client represents an anonymous internet caller.
    let anon = reqwest::Client::new();

    // /health — always public
    let health = anon.get(format!("{}/health", h.base_url)).send().await.unwrap();
    assert_eq!(health.status(), 200, "/health should be public");

    // /analytics/summary — must reject anonymous callers
    let summary = anon
        .get(format!("{}/analytics/summary", h.base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(summary.status(), 401, "/analytics/summary must require auth");

    // /logs — must reject anonymous callers
    let logs = anon.get(format!("{}/logs", h.base_url)).send().await.unwrap();
    assert_eq!(logs.status(), 401, "/logs must require auth");

    // With a valid dashboard token (the harness client) it succeeds.
    let ok = h.client.get(format!("{}/analytics/summary", h.base_url)).send().await.unwrap();
    assert_eq!(ok.status(), 200, "authenticated analytics request should succeed");
}

/// Both the chat endpoint (gateway key) and analytics (dashboard token) reject
/// unauthenticated callers.
#[tokio::test]
async fn chat_and_analytics_both_require_auth() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .with_auth(make_keys(&["sk-valid"]))
        .build()
        .await
        .unwrap();

    let chat_resp = h.chat("gpt-4o", "blocked").await;
    assert_eq!(chat_resp.status(), 401, "unauthenticated chat must be blocked");

    let anon = reqwest::Client::new();
    let analytics_resp = anon
        .get(format!("{}/analytics/summary", h.base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(analytics_resp.status(), 401, "unauthenticated analytics must be blocked");
}
