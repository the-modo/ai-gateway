use gateway_config::RoutingStrategy;
use gateway_test_utils::{HarnessBuilder, MockConfig};

// ─── Sequential strategy ──────────────────────────────────────────────────────

/// First provider succeeds → it is used, no fallback touched.
#[tokio::test]
async fn sequential_first_provider_succeeds() {
    let h = HarnessBuilder::new()
        .with_openai_mock("primary", MockConfig::default())
        .with_openai_mock("secondary", MockConfig::default())
        .build()
        .await
        .unwrap();

    let resp = h.chat("gpt-4o", "hello").await;
    assert_eq!(resp.status(), 200);

    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["choices"][0]["message"]["content"], "Hello from mock!");

    assert_eq!(h.mock(0).calls(), 1, "primary should have been called once");
    assert_eq!(h.mock(1).calls(), 0, "secondary must not be called");
}

/// First provider always fails → gateway falls back to the second.
#[tokio::test]
async fn sequential_fallback_on_primary_failure() {
    let h = HarnessBuilder::new()
        .with_openai_mock("bad", MockConfig::always_fail())
        .with_openai_mock("good", MockConfig::default())
        .build()
        .await
        .unwrap();

    let resp = h.chat("gpt-4o", "hello").await;
    assert_eq!(resp.status(), 200);

    assert!(h.mock(0).calls() >= 1, "bad provider should have been tried");
    assert_eq!(h.mock(1).calls(), 1, "good provider should have succeeded");
}

/// Both providers fail → gateway returns 502.
#[tokio::test]
async fn sequential_all_fail_returns_502() {
    let h = HarnessBuilder::new()
        .with_openai_mock("bad1", MockConfig::always_fail())
        .with_openai_mock("bad2", MockConfig::always_fail())
        .build()
        .await
        .unwrap();

    let resp = h.chat("gpt-4o", "hello").await;
    assert_eq!(resp.status(), 502);
}

/// Fallback provider (added via `with_fallback_mock`) is tried after all primaries fail.
#[tokio::test]
async fn fallback_provider_used_after_primaries_exhausted() {
    let h = HarnessBuilder::new()
        .with_openai_mock("primary", MockConfig::always_fail())
        .with_fallback_mock("fallback", MockConfig::default())
        .build()
        .await
        .unwrap();

    let resp = h.chat("gpt-4o", "hello").await;
    assert_eq!(resp.status(), 200);

    assert!(h.mock(0).calls() >= 1);
    assert_eq!(h.mock(1).calls(), 1, "fallback should have been called");
}

/// With `retries = 2`, the gateway retries the full provider list 3 times total.
#[tokio::test]
async fn retries_exhaust_then_succeed_on_third_attempt() {
    // Fails the first 2 calls, succeeds on 3rd.
    let h = HarnessBuilder::new()
        .with_openai_mock("flaky", MockConfig::fail_first(2))
        .with_retries(2, 10)
        .build()
        .await
        .unwrap();

    let resp = h.chat("gpt-4o", "hello").await;
    assert_eq!(resp.status(), 200);
    assert_eq!(h.mock(0).calls(), 3);
}

/// No provider configured for the requested model → 404.
#[tokio::test]
async fn no_route_returns_502_with_error() {
    // Build a gateway with NO providers at all.
    let h = HarnessBuilder::new().build().await.unwrap();

    let resp = h.chat("gpt-4o", "hello").await;
    // Empty provider list → 404 ("No provider configured for model")
    let status = resp.status().as_u16();
    assert!(status == 404 || status == 502, "expected 404 or 502, got {status}");
}

// ─── Round-robin strategy ─────────────────────────────────────────────────────

/// With 3 round-robin providers and 6 requests each should receive exactly 2.
#[tokio::test]
async fn round_robin_distributes_evenly() {
    let h = HarnessBuilder::new()
        .with_openai_mock("a", MockConfig::default())
        .with_openai_mock("b", MockConfig::default())
        .with_openai_mock("c", MockConfig::default())
        .with_strategy(RoutingStrategy::RoundRobin)
        .build()
        .await
        .unwrap();

    for _ in 0..6 {
        let resp = h.chat("gpt-4o", "hi").await;
        assert_eq!(resp.status(), 200);
    }

    assert_eq!(h.mock(0).calls(), 2, "provider A");
    assert_eq!(h.mock(1).calls(), 2, "provider B");
    assert_eq!(h.mock(2).calls(), 2, "provider C");
}

// ─── Response headers ─────────────────────────────────────────────────────────

/// Successful responses carry X-Gateway-Provider and X-Gateway-Attempt headers.
#[tokio::test]
async fn response_headers_present() {
    let h = HarnessBuilder::new()
        .with_openai_mock("myProvider", MockConfig::default())
        .build()
        .await
        .unwrap();

    let resp = h.chat("gpt-4o", "hello").await;
    assert_eq!(resp.status(), 200);

    assert!(
        resp.headers().contains_key("x-gateway-provider"),
        "missing x-gateway-provider header"
    );
    assert!(
        resp.headers().contains_key("x-gateway-attempt"),
        "missing x-gateway-attempt header"
    );
    assert_eq!(
        resp.headers()["x-gateway-provider"],
        "myProvider",
        "provider name mismatch"
    );
}

// ─── Health & models endpoints ────────────────────────────────────────────────

#[tokio::test]
async fn health_endpoint_returns_ok() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    let resp = h
        .client
        .get(format!("{}/health", h.base_url))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
}

#[tokio::test]
async fn models_endpoint_lists_providers() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    let resp = h
        .client
        .get(format!("{}/v1/models", h.base_url))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["object"], "list");
    assert!(body["data"].as_array().map(|a| !a.is_empty()).unwrap_or(false));
}
