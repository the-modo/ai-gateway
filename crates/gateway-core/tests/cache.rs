use sqlx::Row;
use gateway_test_utils::{HarnessBuilder, MockConfig};

// ─── Exact-match cache ────────────────────────────────────────────────────────

/// Sending the identical request twice should result in only ONE upstream call.
#[tokio::test]
async fn identical_request_hits_cache() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .with_cache(3600)
        .build()
        .await
        .unwrap();

    let r1 = h.chat("gpt-4o", "hello cache").await;
    let r2 = h.chat("gpt-4o", "hello cache").await;

    assert_eq!(r1.status(), 200);
    assert_eq!(r2.status(), 200);

    // Only one upstream call should have been made.
    assert_eq!(h.mock(0).calls(), 1, "cache should prevent second upstream call");
}

/// Two identical cache-hit requests must return the same response body.
#[tokio::test]
async fn cached_response_body_matches() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .with_cache(3600)
        .build()
        .await
        .unwrap();

    let b1: serde_json::Value = h.chat("gpt-4o", "same prompt").await.json().await.unwrap();
    let b2: serde_json::Value = h.chat("gpt-4o", "same prompt").await.json().await.unwrap();

    assert_eq!(
        b1["choices"][0]["message"]["content"],
        b2["choices"][0]["message"]["content"],
        "cached response should be identical"
    );
}

/// Different prompts should each reach the upstream provider.
#[tokio::test]
async fn different_prompts_bypass_cache() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .with_cache(3600)
        .build()
        .await
        .unwrap();

    h.chat("gpt-4o", "prompt one").await;
    h.chat("gpt-4o", "prompt two").await;
    h.chat("gpt-4o", "prompt three").await;

    assert_eq!(
        h.mock(0).calls(),
        3,
        "each unique prompt should trigger an upstream call"
    );
}

/// Cache hits must be recorded in the database with `cached = 1`.
#[tokio::test]
async fn cache_hit_logged_in_database() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .with_cache(3600)
        .build()
        .await
        .unwrap();

    h.chat("gpt-4o", "cache me").await;
    h.chat("gpt-4o", "cache me").await; // cache hit

    h.wait_for_db_flush().await;

    let rows = sqlx::query("SELECT cached FROM requests ORDER BY ts ASC")
        .fetch_all(&*h.db)
        .await
        .unwrap();

    assert_eq!(rows.len(), 2, "both requests should be logged");

    let first_cached: i32 = rows[0].try_get("cached").unwrap();
    let second_cached: i32 = rows[1].try_get("cached").unwrap();

    assert_eq!(first_cached, 0, "first request should not be a cache hit");
    assert_eq!(second_cached, 1, "second request should be a cache hit");
}

/// With cache disabled every request should go upstream.
#[tokio::test]
async fn disabled_cache_always_hits_upstream() {
    // cache_enabled defaults to false in HarnessBuilder
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    h.chat("gpt-4o", "no cache").await;
    h.chat("gpt-4o", "no cache").await;

    assert_eq!(h.mock(0).calls(), 2, "both requests should reach the upstream");
}

/// Streaming requests must NOT be served from cache (and must NOT populate it).
#[tokio::test]
async fn streaming_requests_not_cached() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .with_cache(3600)
        .build()
        .await
        .unwrap();

    // Two identical streaming requests
    let r1 = h.chat_stream("gpt-4o", "stream no cache").await;
    let _b1 = r1.bytes().await.unwrap();
    let r2 = h.chat_stream("gpt-4o", "stream no cache").await;
    let _b2 = r2.bytes().await.unwrap();

    assert_eq!(
        h.mock(0).calls(),
        2,
        "streaming requests must always go to the upstream provider"
    );
}

/// A very short TTL (1 s) cache should not serve stale entries after expiry.
#[tokio::test]
async fn cache_ttl_expiry_forces_new_upstream_call() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .with_cache(1) // 1-second TTL
        .build()
        .await
        .unwrap();

    h.chat("gpt-4o", "ttl test").await;
    assert_eq!(h.mock(0).calls(), 1);

    // Wait for cache to expire
    tokio::time::sleep(tokio::time::Duration::from_millis(1_100)).await;

    h.chat("gpt-4o", "ttl test").await;
    assert_eq!(h.mock(0).calls(), 2, "expired cache should trigger a fresh upstream call");
}
