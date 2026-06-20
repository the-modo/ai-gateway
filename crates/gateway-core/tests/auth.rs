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

/// Analytics endpoints are NOT protected by auth middleware.
#[tokio::test]
async fn analytics_endpoints_bypass_auth() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .with_auth(make_keys(&["sk-valid-key"]))
        .build()
        .await
        .unwrap();

    // /health — always public
    let health = h.client.get(format!("{}/health", h.base_url)).send().await.unwrap();
    assert_eq!(health.status(), 200, "/health should be public");

    // /analytics/summary — not behind auth
    let summary = h
        .client
        .get(format!("{}/analytics/summary", h.base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(summary.status(), 200, "/analytics/summary should be public");

    // /logs — not behind auth
    let logs = h
        .client
        .get(format!("{}/logs", h.base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(logs.status(), 200, "/logs should be public");
}

/// chat endpoint without auth is blocked, analytics endpoint without auth is allowed.
#[tokio::test]
async fn chat_blocked_analytics_public_when_auth_enabled() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .with_auth(make_keys(&["sk-valid"]))
        .build()
        .await
        .unwrap();

    let chat_resp = h.chat("gpt-4o", "blocked").await;
    assert_eq!(chat_resp.status(), 401, "unauthenticated chat must be blocked");

    let analytics_resp = h
        .client
        .get(format!("{}/analytics/summary", h.base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(analytics_resp.status(), 200, "analytics must remain public");
}
