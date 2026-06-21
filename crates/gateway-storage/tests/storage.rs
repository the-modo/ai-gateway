use std::sync::Arc;

use gateway_storage::{
    LogEntry, queries, run_migrations,
};

async fn fresh_pool() -> Arc<sqlx::Pool<sqlx::Any>> {
    sqlx::any::install_default_drivers();
    let pool = sqlx::any::AnyPoolOptions::new()
        .max_connections(1) // shared in-memory DB across all callers
        .connect("sqlite::memory:")
        .await
        .expect("connect");
    let pool = Arc::new(pool);
    run_migrations(&pool).await.expect("migrate");
    pool
}

fn entry(id: &str, ts: i64, status: i32, latency_ms: i64, model: &str, provider: &str, cached: bool, prompt: i64, completion: i64) -> LogEntry {
    LogEntry {
        id: id.into(),
        ts,
        model: model.into(),
        provider: provider.into(),
        status,
        latency_ms,
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: prompt + completion,
        cost_usd: 0.001,
        cached,
        stream: false,
        error: None,
        flags: None,
        request_body: None,
        response_body: None,
    }
}

#[tokio::test]
async fn migrations_create_required_tables() {
    let pool = fresh_pool().await;
    // Each of the major tables should be queryable post-migration.
    sqlx::query("SELECT * FROM requests LIMIT 1").execute(&*pool).await.unwrap();
    sqlx::query("SELECT * FROM metrics_1m LIMIT 1").execute(&*pool).await.unwrap();
    sqlx::query("SELECT * FROM api_keys LIMIT 1").execute(&*pool).await.unwrap();
    sqlx::query("SELECT * FROM config_entries LIMIT 1").execute(&*pool).await.unwrap();
}

#[tokio::test]
async fn insert_and_read_summary() {
    let pool = fresh_pool().await;
    let base = 1_000_000_000_000i64;
    queries::insert_log(&*pool, &entry("a", base, 200, 100, "gpt-4o", "openai", false, 10, 5)).await.unwrap();
    queries::insert_log(&*pool, &entry("b", base + 100, 200, 200, "gpt-4o", "openai", true,  10, 0)).await.unwrap();
    queries::insert_log(&*pool, &entry("c", base + 200, 500, 300, "gpt-4o", "openai", false, 0,  0)).await.unwrap();

    let summary = queries::query_summary(&*pool, base, base + 1_000).await.unwrap();
    assert_eq!(summary.total_requests, 3);
    assert_eq!(summary.success_requests, 2);
    assert_eq!(summary.error_requests, 1);
    assert_eq!(summary.cache_hits, 1);
    assert_eq!(summary.total_tokens, 25); // 15 + 10 + 0
}

#[tokio::test]
async fn breakdown_groups_by_model() {
    let pool = fresh_pool().await;
    let base = 1_000_000_000_000i64;
    // metric rollup happens through the logger background task; query_breakdown
    // reads from metrics_1m so insert metric rows directly.
    queries::upsert_metric_batch(&*pool, base, "gpt-4o", "openai", 5, 0, 500, 20, 10, 0.05, 1).await.unwrap();
    queries::upsert_metric_batch(&*pool, base, "claude", "anthropic", 3, 1, 600, 15, 0, 0.03, 0).await.unwrap();

    let rows = queries::query_breakdown(&*pool, base, base + 60_000, "model").await.unwrap();
    assert_eq!(rows.len(), 2);
    let by: std::collections::HashMap<_, _> =
        rows.into_iter().map(|r| (r.key.clone(), r)).collect();
    assert_eq!(by["gpt-4o"].request_count, 5);
    assert_eq!(by["claude"].request_count, 3);
}

#[tokio::test]
async fn timeseries_buckets_correctly() {
    let pool = fresh_pool().await;
    let base = 1_700_000_000_000i64; // arbitrary recent epoch ms
    // two events in same minute, one in next minute
    queries::upsert_metric_batch(&*pool, base,                   "m", "p", 2, 0, 100, 10, 5, 0.01, 0).await.unwrap();
    queries::upsert_metric_batch(&*pool, base + 60_000,          "m", "p", 1, 0, 80,  10, 5, 0.01, 0).await.unwrap();

    let series = queries::query_timeseries(&*pool, base, base + 120_000, 60_000).await.unwrap();
    assert_eq!(series.len(), 2, "two distinct minute buckets");
    let total: i64 = series.iter().map(|p| p.request_count).sum();
    assert_eq!(total, 3);
}

#[tokio::test]
async fn retention_purge_deletes_old_rows() {
    let pool = fresh_pool().await;
    let now = 1_700_000_000_000i64;
    // 5 rows: 3 old, 2 recent
    for (i, ts) in [(1, now - 1_000_000), (2, now - 800_000), (3, now - 600_000),
                    (4, now - 100),       (5, now)].iter() {
        queries::insert_log(&*pool, &entry(
            &format!("r{i}"), *ts, 200, 10, "m", "p", false, 1, 1,
        )).await.unwrap();
    }
    let deleted = queries::delete_old_logs(&*pool, now - 500_000).await.unwrap();
    assert_eq!(deleted, 3, "rows with ts < cutoff must be deleted");
    let summary = queries::query_summary(&*pool, 0, now + 1).await.unwrap();
    assert_eq!(summary.total_requests, 2);
}

#[tokio::test]
async fn delete_all_clears_table() {
    let pool = fresh_pool().await;
    queries::insert_log(&*pool, &entry("x", 0, 200, 1, "m", "p", false, 0, 0)).await.unwrap();
    queries::insert_log(&*pool, &entry("y", 1, 200, 1, "m", "p", false, 0, 0)).await.unwrap();
    let n = queries::delete_all_requests(&*pool).await.unwrap();
    assert_eq!(n, 2);
    let s = queries::query_summary(&*pool, 0, 1_000_000).await.unwrap();
    assert_eq!(s.total_requests, 0);
}

#[tokio::test]
async fn delete_by_ids_only_targets_specified() {
    let pool = fresh_pool().await;
    queries::insert_log(&*pool, &entry("a", 0, 200, 1, "m", "p", false, 0, 0)).await.unwrap();
    queries::insert_log(&*pool, &entry("b", 0, 200, 1, "m", "p", false, 0, 0)).await.unwrap();
    queries::insert_log(&*pool, &entry("c", 0, 200, 1, "m", "p", false, 0, 0)).await.unwrap();

    let n = queries::delete_requests_by_ids(&*pool, &["a", "c"]).await.unwrap();
    assert_eq!(n, 2);
    let s = queries::query_summary(&*pool, 0, 1_000_000).await.unwrap();
    assert_eq!(s.total_requests, 1);
}

#[tokio::test]
async fn config_round_trip() {
    let pool = fresh_pool().await;
    assert!(queries::config_load(&*pool, "guardrails").await.unwrap().is_none());

    queries::config_save(&*pool, "guardrails", r#"{"enabled":true}"#).await.unwrap();
    let v = queries::config_load(&*pool, "guardrails").await.unwrap();
    assert_eq!(v.as_deref(), Some(r#"{"enabled":true}"#));

    // Overwrite
    queries::config_save(&*pool, "guardrails", r#"{"enabled":false}"#).await.unwrap();
    let v = queries::config_load(&*pool, "guardrails").await.unwrap();
    assert_eq!(v.as_deref(), Some(r#"{"enabled":false}"#));
}

#[tokio::test]
async fn log_detail_returns_full_record() {
    let pool = fresh_pool().await;
    let mut e = entry("the-id", 100, 200, 42, "m", "p", false, 7, 3);
    e.request_body = Some(r#"{"messages":[]}"#.into());
    e.response_body = Some(r#"{"choices":[]}"#.into());
    queries::insert_log(&*pool, &e).await.unwrap();

    let got = queries::get_log_detail(&*pool, "the-id").await.unwrap().expect("found");
    assert_eq!(got.row.id, "the-id");
    assert_eq!(got.row.latency_ms, 42);
    assert_eq!(got.request_body.as_deref(), Some(r#"{"messages":[]}"#));
}

#[tokio::test]
async fn storage_status_reports_count_and_backend() {
    let pool = fresh_pool().await;
    queries::insert_log(&*pool, &entry("x", 0, 200, 1, "m", "p", false, 0, 0)).await.unwrap();
    queries::insert_log(&*pool, &entry("y", 1, 200, 1, "m", "p", false, 0, 0)).await.unwrap();

    let status = queries::get_storage_status(&*pool, "sqlite", "sqlite::memory:").await.unwrap();
    assert_eq!(status.backend, "sqlite");
    assert_eq!(status.total_requests, 2);
}

#[tokio::test]
async fn backend_tag_detects_postgres_vs_sqlite() {
    assert_eq!(gateway_storage::backend_tag("sqlite://./gateway.db"), "sqlite");
    assert_eq!(gateway_storage::backend_tag("postgres://u:p@h/db"), "postgres");
    assert_eq!(gateway_storage::backend_tag("postgresql://u:p@h/db"), "postgres");
    assert_eq!(gateway_storage::backend_tag("mysql://u:p@h/db"), "sqlite", "unknown maps to sqlite default");
}
