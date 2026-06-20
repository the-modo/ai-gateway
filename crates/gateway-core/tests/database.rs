use sqlx::Row;
use gateway_test_utils::{HarnessBuilder, MockConfig};

// ─── Helper: count rows in a table ───────────────────────────────────────────

async fn count_requests(h: &gateway_test_utils::TestHarness) -> i64 {
    let row = sqlx::query("SELECT COUNT(*) AS cnt FROM requests")
        .fetch_one(&*h.db)
        .await
        .unwrap();
    row.try_get::<i64, _>("cnt").unwrap()
}

async fn count_metrics(h: &gateway_test_utils::TestHarness) -> i64 {
    let row = sqlx::query("SELECT COUNT(*) AS cnt FROM metrics_1m")
        .fetch_one(&*h.db)
        .await
        .unwrap();
    row.try_get::<i64, _>("cnt").unwrap()
}

// ─── Tests ────────────────────────────────────────────────────────────────────

/// A successful request must be logged in the `requests` table.
#[tokio::test]
async fn successful_request_is_logged() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    assert_eq!(count_requests(&h).await, 0);

    let resp = h.chat("gpt-4o", "hello").await;
    assert_eq!(resp.status(), 200);

    h.wait_for_db_flush().await;

    assert_eq!(count_requests(&h).await, 1, "request should be logged");
}

/// A failed upstream request must also be logged with a non-200 status.
#[tokio::test]
async fn failed_request_is_logged_with_error_status() {
    let h = HarnessBuilder::new()
        .with_openai_mock("bad", MockConfig::always_fail())
        .build()
        .await
        .unwrap();

    let resp = h.chat("gpt-4o", "hello").await;
    assert_eq!(resp.status(), 502);

    h.wait_for_db_flush().await;

    assert_eq!(count_requests(&h).await, 1);

    let row = sqlx::query("SELECT status FROM requests LIMIT 1")
        .fetch_one(&*h.db)
        .await
        .unwrap();
    let status: i32 = row.try_get("status").unwrap();
    assert!(status >= 400, "logged status should indicate an error, got {status}");
}

/// After N requests the `metrics_1m` table must have at least one bucket row.
#[tokio::test]
async fn metrics_1m_is_updated() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    for _ in 0..3 {
        h.chat("gpt-4o", "hi").await;
    }

    h.wait_for_db_flush().await;

    let buckets = count_metrics(&h).await;
    assert!(buckets >= 1, "expected at least one metrics_1m row, got {buckets}");
}

/// Token counts from the mock response must be stored.
#[tokio::test]
async fn token_counts_stored_correctly() {
    let cfg = MockConfig {
        prompt_tokens: 42,
        completion_tokens: 17,
        ..MockConfig::default()
    };

    let h = HarnessBuilder::new()
        .with_openai_mock("p", cfg)
        .build()
        .await
        .unwrap();

    h.chat("gpt-4o", "test").await;
    h.wait_for_db_flush().await;

    let row =
        sqlx::query("SELECT prompt_tokens, completion_tokens, total_tokens FROM requests LIMIT 1")
            .fetch_one(&*h.db)
            .await
            .unwrap();

    let prompt: i64 = row.try_get("prompt_tokens").unwrap();
    let completion: i64 = row.try_get("completion_tokens").unwrap();
    let total: i64 = row.try_get("total_tokens").unwrap();

    assert_eq!(prompt, 42);
    assert_eq!(completion, 17);
    assert_eq!(total, 59);
}

/// Multiple requests accumulate correctly in `metrics_1m.request_count`.
#[tokio::test]
async fn metrics_request_count_accumulates() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    for _ in 0..5 {
        h.chat("gpt-4o", "ping").await;
    }

    h.wait_for_db_flush().await;

    let row = sqlx::query("SELECT SUM(request_count) AS total FROM metrics_1m")
        .fetch_one(&*h.db)
        .await
        .unwrap();
    let total: i64 = row.try_get("total").unwrap_or(0);
    assert_eq!(total, 5, "metrics_1m.request_count should sum to 5");
}

/// cost_usd must be positive for models with known pricing.
#[tokio::test]
async fn cost_is_estimated_and_stored() {
    let cfg = MockConfig {
        prompt_tokens: 1000,
        completion_tokens: 500,
        ..MockConfig::default()
    };

    let h = HarnessBuilder::new()
        .with_openai_mock("p", cfg)
        .build()
        .await
        .unwrap();

    h.chat("gpt-4o", "cost test").await;
    h.wait_for_db_flush().await;

    let row = sqlx::query("SELECT cost_usd FROM requests LIMIT 1")
        .fetch_one(&*h.db)
        .await
        .unwrap();
    let cost: f64 = row.try_get("cost_usd").unwrap();
    assert!(cost > 0.0, "expected positive cost_usd, got {cost}");
}

/// The provider name in the log must match the provider that actually served the request.
#[tokio::test]
async fn provider_name_logged_correctly() {
    let h = HarnessBuilder::new()
        .with_openai_mock("my-special-provider", MockConfig::default())
        .build()
        .await
        .unwrap();

    h.chat("gpt-4o", "hi").await;
    h.wait_for_db_flush().await;

    let row = sqlx::query("SELECT provider FROM requests LIMIT 1")
        .fetch_one(&*h.db)
        .await
        .unwrap();
    let provider: String = row.try_get("provider").unwrap();
    assert_eq!(provider, "my-special-provider");
}

/// Streaming requests are logged with `stream = 1`.
#[tokio::test]
async fn streaming_request_logged_with_stream_flag() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    // Consume the stream body so the gateway can finish logging
    let resp = h.chat_stream("gpt-4o", "stream test").await;
    let _body = resp.bytes().await.unwrap();

    h.wait_for_db_flush().await;

    let row = sqlx::query("SELECT stream FROM requests LIMIT 1")
        .fetch_one(&*h.db)
        .await
        .unwrap();
    let stream_flag: i32 = row.try_get("stream").unwrap();
    assert_eq!(stream_flag, 1, "stream flag should be 1 for streaming requests");
}
