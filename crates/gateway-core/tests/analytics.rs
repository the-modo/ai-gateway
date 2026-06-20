use gateway_test_utils::{HarnessBuilder, MockConfig};

// ─── Storage status ───────────────────────────────────────────────────────────

#[tokio::test]
async fn storage_status_reports_enabled() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    let resp = h
        .client
        .get(format!("{}/storage/status", h.base_url))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["enabled"], true);
    assert_eq!(body["backend"], "sqlite");
}

// ─── Summary ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn summary_on_empty_db_returns_zeros() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    let resp = h
        .client
        .get(format!("{}/analytics/summary", h.base_url))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["total_requests"], 0);
    assert_eq!(body["success_requests"], 0);
    assert_eq!(body["error_requests"], 0);
}

#[tokio::test]
async fn summary_counts_successful_requests() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    for _ in 0..4 {
        h.chat("gpt-4o", "hi").await;
    }
    h.wait_for_db_flush().await;

    let now_ms = chrono::Utc::now().timestamp_millis();
    let from_ms = now_ms - 3_600_000;

    let resp = h
        .client
        .get(format!(
            "{}/analytics/summary?from={}&to={}",
            h.base_url, from_ms, now_ms
        ))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["total_requests"], 4, "should count 4 requests");
    assert_eq!(body["success_requests"], 4);
    assert_eq!(body["error_requests"], 0);
}

#[tokio::test]
async fn summary_counts_error_requests() {
    let h = HarnessBuilder::new()
        .with_openai_mock("bad1", MockConfig::always_fail())
        .with_openai_mock("bad2", MockConfig::always_fail())
        .build()
        .await
        .unwrap();

    h.chat("gpt-4o", "error").await; // will fail with 502
    h.wait_for_db_flush().await;

    let now_ms = chrono::Utc::now().timestamp_millis();
    let from_ms = now_ms - 3_600_000;

    let resp = h
        .client
        .get(format!(
            "{}/analytics/summary?from={}&to={}",
            h.base_url, from_ms, now_ms
        ))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    // Each provider attempt is logged separately; at least one error row
    assert!(
        body["error_requests"].as_i64().unwrap_or(0) >= 1,
        "at least one error should be counted"
    );
}

// ─── Timeseries ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn timeseries_returns_array() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    h.chat("gpt-4o", "ts test").await;
    h.wait_for_db_flush().await;

    let now_ms = chrono::Utc::now().timestamp_millis();
    let from_ms = now_ms - 3_600_000;

    let resp = h
        .client
        .get(format!(
            "{}/analytics/timeseries?from={}&to={}&interval=300000",
            h.base_url, from_ms, now_ms
        ))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body.is_array(), "timeseries response should be an array");
    // Should have at least one bucket containing our request
    let arr = body.as_array().unwrap();
    let total_reqs: i64 = arr.iter().map(|b| b["request_count"].as_i64().unwrap_or(0)).sum();
    assert!(total_reqs >= 1, "should have at least one request in timeseries");
}

// ─── Breakdown ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn breakdown_by_model_groups_correctly() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    h.chat("gpt-4o", "model a").await;
    h.chat("gpt-4o-mini", "model b").await;
    h.wait_for_db_flush().await;

    let now_ms = chrono::Utc::now().timestamp_millis();
    let from_ms = now_ms - 3_600_000;

    let resp = h
        .client
        .get(format!(
            "{}/analytics/breakdown?from={}&to={}&group_by=model",
            h.base_url, from_ms, now_ms
        ))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    let arr = body.as_array().expect("breakdown should be an array");
    let keys: Vec<&str> = arr.iter().filter_map(|r| r["key"].as_str()).collect();
    assert!(keys.contains(&"gpt-4o"), "gpt-4o should appear in breakdown");
    assert!(keys.contains(&"gpt-4o-mini"), "gpt-4o-mini should appear in breakdown");
}

#[tokio::test]
async fn breakdown_by_provider_groups_correctly() {
    let h = HarnessBuilder::new()
        .with_openai_mock("openai-primary", MockConfig::default())
        .build()
        .await
        .unwrap();

    h.chat("gpt-4o", "by provider").await;
    h.wait_for_db_flush().await;

    let now_ms = chrono::Utc::now().timestamp_millis();
    let from_ms = now_ms - 3_600_000;

    let resp = h
        .client
        .get(format!(
            "{}/analytics/breakdown?from={}&to={}&group_by=provider",
            h.base_url, from_ms, now_ms
        ))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    let arr = body.as_array().expect("breakdown should be an array");
    let keys: Vec<&str> = arr.iter().filter_map(|r| r["key"].as_str()).collect();
    assert!(
        keys.contains(&"openai-primary"),
        "openai-primary should appear in provider breakdown"
    );
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn logs_endpoint_returns_paginated_results() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    for _ in 0..3 {
        h.chat("gpt-4o", "log entry").await;
    }
    h.wait_for_db_flush().await;

    let resp = h
        .client
        .get(format!("{}/logs?per_page=10", h.base_url))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["total"].as_i64().unwrap_or(0) >= 3);
    assert!(body["items"].as_array().map(|a| !a.is_empty()).unwrap_or(false));
}

#[tokio::test]
async fn logs_model_filter_works() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    h.chat("gpt-4o", "first").await;
    h.chat("gpt-4o-mini", "second").await;
    h.wait_for_db_flush().await;

    let now_ms = chrono::Utc::now().timestamp_millis();
    let from_ms = now_ms - 3_600_000;

    let resp = h
        .client
        .get(format!(
            "{}/logs?from={}&to={}&model=gpt-4o-mini",
            h.base_url, from_ms, now_ms
        ))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    let total = body["total"].as_i64().unwrap_or(0);
    assert_eq!(total, 1, "filter should return only gpt-4o-mini requests");

    let model = body["items"][0]["model"].as_str().unwrap();
    assert_eq!(model, "gpt-4o-mini");
}

#[tokio::test]
async fn log_detail_endpoint_returns_full_record() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    h.chat("gpt-4o", "detail test").await;
    h.wait_for_db_flush().await;

    // Fetch the log ID from the listing
    let list_resp: serde_json::Value = h
        .client
        .get(format!("{}/logs?per_page=1", h.base_url))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let id = list_resp["items"][0]["id"].as_str().expect("log entry should have id");

    // Fetch the detail
    let detail_resp = h
        .client
        .get(format!("{}/logs/{}", h.base_url, id))
        .send()
        .await
        .unwrap();

    assert_eq!(detail_resp.status(), 200);
    let detail: serde_json::Value = detail_resp.json().await.unwrap();
    assert_eq!(detail["id"], id);
    assert!(detail.get("prompt_tokens").is_some(), "detail should include prompt_tokens");
    assert!(detail.get("completion_tokens").is_some());
}

#[tokio::test]
async fn log_detail_404_for_unknown_id() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    let resp = h
        .client
        .get(format!("{}/logs/nonexistent-id", h.base_url))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 404);
}
