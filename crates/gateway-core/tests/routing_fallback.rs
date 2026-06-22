//! End-to-end fallback feature: PUT a /config/routes blob whose canvas has
//! one primary provider (always 500) and one fallback provider (200). Verify
//! the request actually fails over to the fallback.

use gateway_test_utils::{HarnessBuilder, MockConfig};
use serde_json::json;

async fn login_token(h: &gateway_test_utils::TestHarness) -> String {
    let r = h.client.post(format!("{}/dashboard/login", h.base_url))
        .json(&json!({"username":"admin","password":"admin"}))
        .send().await.unwrap();
    r.json::<serde_json::Value>().await.unwrap()["token"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn dashboard_fallback_engaged_on_primary_5xx() {
    // primary always returns 500, fallback works.
    let h = HarnessBuilder::new()
        .with_openai_mock("primary",  MockConfig::always_fail())
        .with_openai_mock("fallback", MockConfig::default())
        .build().await.unwrap();
    let tok = login_token(&h).await;

    // PUT a canvas blob: one route, primary=primary, fallback=fallback.
    let blob = json!([{
        "id": "r1", "name": "Primary + fallback", "enabled": true, "isDefault": true,
        "nodes": [
            { "id": "req", "type": "request",  "data": {} },
            { "id": "p",   "type": "provider", "data": { "name": "primary",  "isFallback": false } },
            { "id": "f",   "type": "provider", "data": { "name": "fallback", "isFallback": true  } },
            { "id": "res", "type": "response", "data": {} }
        ],
        "edges": []
    }]);
    let put = h.client.put(format!("{}/config/routes", h.base_url))
        .bearer_auth(&tok).json(&blob).send().await.unwrap();
    assert_eq!(put.status(), 200);
    let put_body: serde_json::Value = put.json().await.unwrap();
    assert_eq!(put_body["engine_routes_applied"].as_u64(), Some(1),
        "blob should produce one engine RouteConfig: {put_body}");

    // Make a chat request. Primary returns 500; engine should fall back.
    let r = h.chat("gpt-4o", "hello fallback").await;
    assert_eq!(r.status(), 200, "fallback should serve the request");

    // Mock(0) is the primary (failing), Mock(1) is the fallback.
    assert!(h.mock(0).calls() >= 1, "primary should have been tried first");
    assert_eq!(h.mock(1).calls(), 1, "fallback should have been called once");
}

#[tokio::test]
async fn blob_with_no_providers_leaves_engine_unchanged() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build().await.unwrap();
    let tok = login_token(&h).await;

    // A blob with provider nodes whose data.name is empty must NOT replace the
    // engine route table (would 404 every request otherwise).
    let blob = json!([{
        "id": "r-empty", "enabled": true,
        "nodes": [ { "id":"p","type":"provider","data":{"name":"","isFallback":false} } ],
        "edges": []
    }]);
    let put = h.client.put(format!("{}/config/routes", h.base_url))
        .bearer_auth(&tok).json(&blob).send().await.unwrap();
    let b: serde_json::Value = put.json().await.unwrap();
    assert_eq!(b["engine_routes_applied"].as_u64(), Some(0));

    // Engine should still serve via the original route from the harness.
    let r = h.chat("gpt-4o", "hi").await;
    assert_eq!(r.status(), 200);
}

#[tokio::test]
async fn disabled_route_in_blob_is_skipped() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build().await.unwrap();
    let tok = login_token(&h).await;

    let blob = json!([{
        "id": "r-off", "enabled": false,
        "nodes": [ { "id":"p","type":"provider","data":{"name":"p","isFallback":false} } ],
        "edges": []
    }]);
    let put = h.client.put(format!("{}/config/routes", h.base_url))
        .bearer_auth(&tok).json(&blob).send().await.unwrap();
    let b: serde_json::Value = put.json().await.unwrap();
    assert_eq!(b["engine_routes_applied"].as_u64(), Some(0));
    assert_eq!(b["skipped"].as_u64(), Some(1));
}
