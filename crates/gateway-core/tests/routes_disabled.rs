// Smoke-test the issue #20 endpoints: route blob persistence + disabled-vendor
// enforcement at chat-route time.

use gateway_test_utils::{HarnessBuilder, MockConfig};
use serde_json::json;

async fn login_token(h: &gateway_test_utils::TestHarness) -> String {
    let r = h.client.post(format!("{}/dashboard/login", h.base_url))
        .json(&json!({"username":"admin","password":"admin"}))
        .send().await.unwrap();
    let v: serde_json::Value = r.json().await.unwrap();
    v["token"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn routes_blob_persists() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build().await.unwrap();
    let tok = login_token(&h).await;

    let put = h.client.put(format!("{}/config/routes", h.base_url))
        .bearer_auth(&tok)
        .json(&json!([{"id":"r1","name":"My route","enabled":true}]))
        .send().await.unwrap();
    assert_eq!(put.status(), 200);

    let get = h.client.get(format!("{}/config/routes", h.base_url))
        .bearer_auth(&tok)
        .send().await.unwrap();
    assert_eq!(get.status(), 200);
    let body: serde_json::Value = get.json().await.unwrap();
    assert_eq!(body[0]["id"], "r1");
    assert_eq!(body[0]["name"], "My route");
}

#[tokio::test]
async fn mcp_routes_blob_persists() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build().await.unwrap();
    let tok = login_token(&h).await;

    h.client.put(format!("{}/config/mcp-routes", h.base_url))
        .bearer_auth(&tok)
        .json(&json!([{"id":"m1","servers":["test"]}]))
        .send().await.unwrap();

    let body: serde_json::Value = h.client
        .get(format!("{}/config/mcp-routes", h.base_url))
        .bearer_auth(&tok).send().await.unwrap().json().await.unwrap();
    assert_eq!(body[0]["id"], "m1");
}

#[tokio::test]
async fn disabled_vendor_skips_provider_at_route_time() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build().await.unwrap();
    let tok = login_token(&h).await;

    // Disable "custom" (the mock provider's effective kind in the harness).
    h.client.put(format!("{}/config/providers/disabled", h.base_url))
        .bearer_auth(&tok)
        .json(&json!({"disabled":["custom"]}))
        .send().await.unwrap();

    // Request a chat — the only provider is "custom", so it should now be filtered.
    let r = h.chat("gpt-4o", "hi").await;
    assert_eq!(r.status(), 404, "all providers were filtered out");
    assert_eq!(h.mock(0).calls(), 0);

    // Re-enable: gateway should work again.
    h.client.put(format!("{}/config/providers/disabled", h.base_url))
        .bearer_auth(&tok)
        .json(&json!({"disabled":[]}))
        .send().await.unwrap();
    let r = h.chat("gpt-4o", "hi").await;
    assert_eq!(r.status(), 200);
    assert_eq!(h.mock(0).calls(), 1);
}

#[tokio::test]
async fn endpoints_require_dashboard_auth() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build().await.unwrap();
    // The harness's default client auto-attaches a bearer token. Use a fresh
    // client so we actually exercise the unauthenticated path.
    let anon = reqwest::Client::new();
    for url in [
        "/config/routes", "/config/mcp-routes", "/config/providers/disabled",
    ] {
        let r = anon.get(format!("{}{}", h.base_url, url)).send().await.unwrap();
        assert_eq!(r.status(), 401, "{url} should require auth");
    }
}
