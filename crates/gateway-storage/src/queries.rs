use sqlx::{Any, Pool, Row};

use crate::models::{
    BreakdownItem, LogDetail, LogRow, LogsPage, RequestSummary, StorageStatus,
    TimeseriesPoint,
};

use super::models::LogEntry;

// ─── Write (accept a bare connection so callers can wrap in a transaction) ────

/// Insert one request log row.  Pass `&mut tx` when inside a transaction.
pub async fn insert_log<'e, E>(executor: E, e: &LogEntry) -> anyhow::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Any>,
{
    sqlx::query(
        "INSERT INTO requests
         (id, ts, model, provider, status, latency_ms,
          prompt_tokens, completion_tokens, total_tokens, cost_usd,
          cached, stream, error, flags, request_body, response_body)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&e.id)
    .bind(e.ts)
    .bind(&e.model)
    .bind(&e.provider)
    .bind(e.status)
    .bind(e.latency_ms)
    .bind(e.prompt_tokens)
    .bind(e.completion_tokens)
    .bind(e.total_tokens)
    .bind(e.cost_usd)
    .bind(if e.cached { 1i32 } else { 0i32 })
    .bind(if e.stream { 1i32 } else { 0i32 })
    .bind(&e.error)
    .bind(&e.flags)
    .bind(&e.request_body)
    .bind(&e.response_body)
    .execute(executor)
    .await?;
    Ok(())
}

/// Upsert a pre-aggregated metric row — one call per unique (bucket, model, provider).
/// Callers aggregate across the batch first, then call this once per group.
#[allow(clippy::too_many_arguments)]
pub async fn upsert_metric_batch<'e, E>(
    executor: E,
    bucket: i64,
    model: &str,
    provider: &str,
    request_count: i64,
    error_count: i64,
    total_latency_ms: i64,
    prompt_tokens: i64,
    completion_tokens: i64,
    cost_usd: f64,
    cache_hits: i64,
) -> anyhow::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Any>,
{
    sqlx::query(
        "INSERT INTO metrics_1m
         (bucket, model, provider, request_count, error_count, total_latency_ms,
          prompt_tokens, completion_tokens, cost_usd, cache_hits)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(bucket, model, provider) DO UPDATE SET
           request_count     = request_count     + excluded.request_count,
           error_count       = error_count       + excluded.error_count,
           total_latency_ms  = total_latency_ms  + excluded.total_latency_ms,
           prompt_tokens     = prompt_tokens     + excluded.prompt_tokens,
           completion_tokens = completion_tokens + excluded.completion_tokens,
           cost_usd          = cost_usd          + excluded.cost_usd,
           cache_hits        = cache_hits        + excluded.cache_hits",
    )
    .bind(bucket)
    .bind(model)
    .bind(provider)
    .bind(request_count)
    .bind(error_count)
    .bind(total_latency_ms)
    .bind(prompt_tokens)
    .bind(completion_tokens)
    .bind(cost_usd)
    .bind(cache_hits)
    .execute(executor)
    .await?;
    Ok(())
}

// ─── Analytics reads ──────────────────────────────────────────────────────────

pub async fn query_summary(
    pool: &Pool<Any>,
    from_ms: i64,
    to_ms: i64,
) -> anyhow::Result<RequestSummary> {
    let row = sqlx::query(
        "SELECT
           COALESCE(COUNT(*), 0)                                           AS total,
           COALESCE(SUM(CASE WHEN status < 400 THEN 1 ELSE 0 END), 0)     AS success,
           COALESCE(SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END), 0)    AS errors,
           COALESCE(SUM(total_tokens), 0)                                  AS tokens,
           COALESCE(SUM(cost_usd), 0.0)                                    AS cost,
           COALESCE(AVG(CAST(latency_ms AS REAL)), 0.0)                   AS avg_lat,
           COALESCE(SUM(cached), 0)                                        AS hits
         FROM requests WHERE ts >= ? AND ts < ?",
    )
    .bind(from_ms)
    .bind(to_ms)
    .fetch_one(pool)
    .await?;

    Ok(RequestSummary {
        total_requests: row.try_get::<i64, _>("total").unwrap_or(0),
        success_requests: row.try_get::<i64, _>("success").unwrap_or(0),
        error_requests: row.try_get::<i64, _>("errors").unwrap_or(0),
        total_tokens: row.try_get::<i64, _>("tokens").unwrap_or(0),
        total_cost_usd: row.try_get::<f64, _>("cost").unwrap_or(0.0),
        avg_latency_ms: row.try_get::<f64, _>("avg_lat").unwrap_or(0.0),
        cache_hits: row.try_get::<i64, _>("hits").unwrap_or(0),
    })
}

pub async fn query_timeseries(
    pool: &Pool<Any>,
    from_ms: i64,
    to_ms: i64,
    interval_ms: i64,
) -> anyhow::Result<Vec<TimeseriesPoint>> {
    let rows = sqlx::query(
        "SELECT
           (bucket / ?) * ?                                             AS ts_bucket,
           COALESCE(SUM(request_count), 0)                             AS req_count,
           COALESCE(SUM(error_count), 0)                               AS err_count,
           COALESCE(SUM(prompt_tokens + completion_tokens), 0)         AS tok,
           COALESCE(SUM(cost_usd), 0.0)                                AS cost,
           COALESCE(
             CAST(SUM(total_latency_ms) AS REAL) /
             NULLIF(SUM(request_count), 0), 0.0)                      AS avg_lat,
           COALESCE(SUM(cache_hits), 0)                                AS cache_hits
         FROM metrics_1m
         WHERE bucket >= ? AND bucket < ?
         GROUP BY ts_bucket
         ORDER BY ts_bucket",
    )
    .bind(interval_ms)
    .bind(interval_ms)
    .bind(from_ms)
    .bind(to_ms)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|r| TimeseriesPoint {
            bucket: r.try_get::<i64, _>("ts_bucket").unwrap_or(0),
            request_count: r.try_get::<i64, _>("req_count").unwrap_or(0),
            error_count: r.try_get::<i64, _>("err_count").unwrap_or(0),
            total_tokens: r.try_get::<i64, _>("tok").unwrap_or(0),
            cost_usd: r.try_get::<f64, _>("cost").unwrap_or(0.0),
            avg_latency_ms: r.try_get::<f64, _>("avg_lat").unwrap_or(0.0),
            cache_hits: r.try_get::<i64, _>("cache_hits").unwrap_or(0),
        })
        .collect())
}

pub async fn query_breakdown(
    pool: &Pool<Any>,
    from_ms: i64,
    to_ms: i64,
    group_by: &str, // "model" | "provider"
) -> anyhow::Result<Vec<BreakdownItem>> {
    let col = if group_by == "provider" { "provider" } else { "model" };
    let sql = format!(
        "SELECT
           {col} AS grp_key,
           COALESCE(SUM(request_count), 0)                              AS req_count,
           COALESCE(SUM(error_count), 0)                                AS err_count,
           COALESCE(SUM(prompt_tokens + completion_tokens), 0)          AS tok,
           COALESCE(SUM(cost_usd), 0.0)                                 AS cost,
           COALESCE(
             CAST(SUM(total_latency_ms) AS REAL) /
             NULLIF(SUM(request_count), 0), 0.0)                       AS avg_lat
         FROM metrics_1m
         WHERE bucket >= ? AND bucket < ?
         GROUP BY grp_key
         ORDER BY req_count DESC"
    );

    let rows = sqlx::query(&sql)
        .bind(from_ms)
        .bind(to_ms)
        .fetch_all(pool)
        .await?;

    Ok(rows
        .iter()
        .map(|r| BreakdownItem {
            key: r.try_get::<String, _>("grp_key").unwrap_or_default(),
            request_count: r.try_get::<i64, _>("req_count").unwrap_or(0),
            error_count: r.try_get::<i64, _>("err_count").unwrap_or(0),
            total_tokens: r.try_get::<i64, _>("tok").unwrap_or(0),
            cost_usd: r.try_get::<f64, _>("cost").unwrap_or(0.0),
            avg_latency_ms: r.try_get::<f64, _>("avg_lat").unwrap_or(0.0),
        })
        .collect())
}

// ─── Log listing ──────────────────────────────────────────────────────────────

pub async fn query_logs(
    pool: &Pool<Any>,
    from_ms: i64,
    to_ms: i64,
    model_filter: Option<&str>,
    provider_filter: Option<&str>,
    exclude_provider: Option<&str>,
    status_filter: Option<i32>,
    search: Option<&str>,
    sort_by: Option<&str>,
    sort_dir: Option<&str>,
    page: i64,
    per_page: i64,
) -> anyhow::Result<LogsPage> {
    let offset = (page - 1) * per_page;

    let sort_col = match sort_by {
        Some("model")        => "model",
        Some("provider")     => "provider",
        Some("status")       => "status",
        Some("latency_ms")   => "latency_ms",
        Some("prompt_tokens")     => "prompt_tokens",
        Some("completion_tokens") => "completion_tokens",
        Some("total_tokens") => "total_tokens",
        Some("cost_usd")     => "cost_usd",
        Some("cached")       => "cached",
        _                    => "ts",
    };
    let sort_direction = if sort_dir == Some("asc") { "ASC" } else { "DESC" };

    // Build dynamic WHERE clauses
    let mut where_parts = vec!["ts >= ?".to_string(), "ts < ?".to_string()];
    if model_filter.is_some() {
        where_parts.push("model = ?".to_string());
    }
    if provider_filter.is_some() {
        where_parts.push("provider = ?".to_string());
    }
    if exclude_provider.is_some() {
        where_parts.push("provider != ?".to_string());
    }
    if status_filter.is_some() {
        if status_filter == Some(200) {
            where_parts.push("status < 400".to_string());
        } else {
            where_parts.push("status >= 400".to_string());
        }
    }
    // Full-text search across model, provider, id, and stored bodies
    if search.is_some() {
        where_parts.push(
            "(model LIKE ? OR provider LIKE ? OR id LIKE ? \
             OR request_body LIKE ? OR response_body LIKE ?)".to_string(),
        );
    }
    let where_clause = where_parts.join(" AND ");

    let count_sql = format!("SELECT COUNT(*) AS cnt FROM requests WHERE {where_clause}");
    let list_sql = format!(
        "SELECT id, ts, model, provider, status, latency_ms,
                prompt_tokens, completion_tokens, total_tokens,
                cost_usd, cached, stream, error, flags
         FROM requests WHERE {where_clause}
         ORDER BY {sort_col} {sort_direction} LIMIT ? OFFSET ?"
    );

    // Precompute the LIKE pattern once
    let search_pat: Option<String> = search.map(|s| format!("%{s}%"));

    // Bind helper — handles the fixed positional args; caller chains search + pagination.
    fn bind_base<'a>(
        q: sqlx::query::Query<'a, Any, sqlx::any::AnyArguments<'a>>,
        from_ms: i64,
        to_ms: i64,
        model_filter: Option<&'a str>,
        provider_filter: Option<&'a str>,
        exclude_provider: Option<&'a str>,
    ) -> sqlx::query::Query<'a, Any, sqlx::any::AnyArguments<'a>> {
        let q = q.bind(from_ms).bind(to_ms);
        let q = if let Some(m) = model_filter { q.bind(m) } else { q };
        let q = if let Some(p) = provider_filter { q.bind(p) } else { q };
        if let Some(x) = exclude_provider { q.bind(x) } else { q }
    }

    let count_q = bind_base(sqlx::query(&count_sql), from_ms, to_ms, model_filter, provider_filter, exclude_provider);
    let count_q = if let Some(ref p) = search_pat {
        count_q.bind(p.clone()).bind(p.clone()).bind(p.clone()).bind(p.clone()).bind(p.clone())
    } else { count_q };

    let count_row = count_q.fetch_one(pool).await?;
    let total: i64 = count_row.try_get::<i64, _>("cnt").unwrap_or(0);

    let list_q = bind_base(sqlx::query(&list_sql), from_ms, to_ms, model_filter, provider_filter, exclude_provider);
    let list_q = if let Some(ref p) = search_pat {
        list_q.bind(p.clone()).bind(p.clone()).bind(p.clone()).bind(p.clone()).bind(p.clone())
    } else { list_q };

    let rows = list_q.bind(per_page).bind(offset).fetch_all(pool).await?;

    let items = rows
        .iter()
        .map(|r| LogRow {
            id: r.try_get::<String, _>("id").unwrap_or_default(),
            ts: r.try_get::<i64, _>("ts").unwrap_or(0),
            model: r.try_get::<String, _>("model").unwrap_or_default(),
            provider: r.try_get::<String, _>("provider").unwrap_or_default(),
            status: r.try_get::<i32, _>("status").unwrap_or(0),
            latency_ms: r.try_get::<i64, _>("latency_ms").unwrap_or(0),
            prompt_tokens: r.try_get::<i64, _>("prompt_tokens").unwrap_or(0),
            completion_tokens: r.try_get::<i64, _>("completion_tokens").unwrap_or(0),
            total_tokens: r.try_get::<i64, _>("total_tokens").unwrap_or(0),
            cost_usd: r.try_get::<f64, _>("cost_usd").unwrap_or(0.0),
            cached: r.try_get::<i32, _>("cached").unwrap_or(0) != 0,
            stream: r.try_get::<i32, _>("stream").unwrap_or(0) != 0,
            error: r.try_get::<Option<String>, _>("error").ok().flatten(),
            flags: r.try_get::<Option<String>, _>("flags").ok().flatten(),
        })
        .collect();

    Ok(LogsPage { items, total, page, per_page })
}

pub async fn get_log_detail(pool: &Pool<Any>, id: &str) -> anyhow::Result<Option<LogDetail>> {
    let row = sqlx::query(
        "SELECT id, ts, model, provider, status, latency_ms, total_tokens, cost_usd,
                cached, stream, error, flags, prompt_tokens, completion_tokens,
                request_body, response_body
         FROM requests WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| LogDetail {
        row: LogRow {
            id: r.try_get::<String, _>("id").unwrap_or_default(),
            ts: r.try_get::<i64, _>("ts").unwrap_or(0),
            model: r.try_get::<String, _>("model").unwrap_or_default(),
            provider: r.try_get::<String, _>("provider").unwrap_or_default(),
            status: r.try_get::<i32, _>("status").unwrap_or(0),
            latency_ms: r.try_get::<i64, _>("latency_ms").unwrap_or(0),
            prompt_tokens: r.try_get::<i64, _>("prompt_tokens").unwrap_or(0),
            completion_tokens: r.try_get::<i64, _>("completion_tokens").unwrap_or(0),
            total_tokens: r.try_get::<i64, _>("total_tokens").unwrap_or(0),
            cost_usd: r.try_get::<f64, _>("cost_usd").unwrap_or(0.0),
            cached: r.try_get::<i32, _>("cached").unwrap_or(0) != 0,
            stream: r.try_get::<i32, _>("stream").unwrap_or(0) != 0,
            error: r.try_get::<Option<String>, _>("error").ok().flatten(),
            flags: r.try_get::<Option<String>, _>("flags").ok().flatten(),
        },
        prompt_tokens: r.try_get::<i64, _>("prompt_tokens").unwrap_or(0),
        completion_tokens: r.try_get::<i64, _>("completion_tokens").unwrap_or(0),
        request_body: r.try_get::<Option<String>, _>("request_body").ok().flatten(),
        response_body: r.try_get::<Option<String>, _>("response_body").ok().flatten(),
    }))
}

pub async fn get_storage_status(
    pool: &Pool<Any>,
    backend: &str,
    database_url: &str,
) -> anyhow::Result<StorageStatus> {
    let count_row = sqlx::query("SELECT COUNT(*) AS cnt FROM requests")
        .fetch_one(pool)
        .await?;
    let total_requests: i64 = count_row.try_get::<i64, _>("cnt").unwrap_or(0);

    // SQLite page_count * page_size gives approximate DB size
    let db_size_bytes = if backend == "sqlite" {
        sqlx::query("SELECT page_count * page_size AS sz FROM pragma_page_count(), pragma_page_size()")
            .fetch_optional(pool)
            .await
            .ok()
            .flatten()
            .and_then(|r| r.try_get::<i64, _>("sz").ok())
    } else {
        None
    };

    // Mask password in URL
    let masked = mask_url(database_url);

    Ok(StorageStatus {
        enabled: true,
        backend: backend.to_string(),
        database_url_masked: masked,
        total_requests,
        db_size_bytes,
    })
}

pub async fn delete_all_requests(pool: &Pool<Any>) -> anyhow::Result<u64> {
    let res = sqlx::query("DELETE FROM requests")
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}

pub async fn delete_requests_by_ids(pool: &Pool<Any>, ids: &[&str]) -> anyhow::Result<u64> {
    if ids.is_empty() {
        return Ok(0);
    }
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!("DELETE FROM requests WHERE id IN ({placeholders})");
    let mut q = sqlx::query(&sql);
    for id in ids {
        q = q.bind(*id);
    }
    let res = q.execute(pool).await?;
    Ok(res.rows_affected())
}

pub async fn delete_old_logs(pool: &Pool<Any>, cutoff_ms: i64) -> anyhow::Result<u64> {
    let res = sqlx::query("DELETE FROM requests WHERE ts < ?")
        .bind(cutoff_ms)
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}

fn mask_url(url: &str) -> String {
    if let Some(at) = url.find('@') {
        if let Some(scheme_end) = url.find("://") {
            let scheme = &url[..scheme_end + 3];
            let host_and_rest = &url[at..];
            return format!("{scheme}***{host_and_rest}");
        }
    }
    url.to_string()
}

// ─── API Key queries ──────────────────────────────────────────────────────────

pub async fn api_keys_list(pool: &Pool<Any>) -> anyhow::Result<Vec<serde_json::Value>> {
    let rows = sqlx::query(
        "SELECT id, name, description, key_value, created_at, expires_at,
         rate_enabled, rate_requests, rate_window,
         spend_enabled, spend_cap_usd, spend_period, spend_used,
         allowed_models, allowed_routes, allowed_ips,
         total_requests, total_spend_usd, last_used_at, status
         FROM api_keys ORDER BY created_at DESC"
    )
    .fetch_all(pool)
    .await?;

    let keys = rows.iter().map(|row| {
        serde_json::json!({
            "id": row.get::<String, _>("id"),
            "name": row.get::<String, _>("name"),
            "description": row.get::<String, _>("description"),
            "key": row.get::<String, _>("key_value"),
            "created": row.get::<i64, _>("created_at"),
            "expiresAt": row.get::<Option<i64>, _>("expires_at"),
            "rateEnabled": row.get::<i64, _>("rate_enabled") != 0,
            "rateRequests": row.get::<i64, _>("rate_requests"),
            "rateWindow": row.get::<String, _>("rate_window"),
            "spendEnabled": row.get::<i64, _>("spend_enabled") != 0,
            "spendCapUsd": row.get::<f64, _>("spend_cap_usd"),
            "spendPeriod": row.get::<String, _>("spend_period"),
            "spendUsed": row.get::<f64, _>("spend_used"),
            "allowedModels": serde_json::from_str::<serde_json::Value>(&row.get::<String, _>("allowed_models")).unwrap_or(serde_json::json!("all")),
            "allowedRoutes": serde_json::from_str::<serde_json::Value>(&row.get::<String, _>("allowed_routes")).unwrap_or(serde_json::json!("all")),
            "allowedIPs": serde_json::from_str::<serde_json::Value>(&row.get::<String, _>("allowed_ips")).unwrap_or(serde_json::json!([])),
            "totalRequests": row.get::<i64, _>("total_requests"),
            "totalSpendUsd": row.get::<f64, _>("total_spend_usd"),
            "lastUsedAt": row.get::<Option<i64>, _>("last_used_at"),
            "status": row.get::<String, _>("status"),
        })
    }).collect();

    Ok(keys)
}

pub async fn api_key_upsert(pool: &Pool<Any>, key: &serde_json::Value) -> anyhow::Result<()> {
    let allowed_models = serde_json::to_string(key.get("allowedModels").unwrap_or(&serde_json::json!("all")))?;
    let allowed_routes = serde_json::to_string(key.get("allowedRoutes").unwrap_or(&serde_json::json!("all")))?;
    let allowed_ips = serde_json::to_string(key.get("allowedIPs").unwrap_or(&serde_json::json!([])))?;

    sqlx::query(
        "INSERT INTO api_keys (id, name, description, key_value, created_at, expires_at,
         rate_enabled, rate_requests, rate_window, spend_enabled, spend_cap_usd, spend_period, spend_used,
         allowed_models, allowed_routes, allowed_ips, total_requests, total_spend_usd, last_used_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, description=excluded.description,
           expires_at=excluded.expires_at, rate_enabled=excluded.rate_enabled,
           rate_requests=excluded.rate_requests, rate_window=excluded.rate_window,
           spend_enabled=excluded.spend_enabled, spend_cap_usd=excluded.spend_cap_usd,
           spend_period=excluded.spend_period, spend_used=excluded.spend_used,
           allowed_models=excluded.allowed_models, allowed_routes=excluded.allowed_routes,
           allowed_ips=excluded.allowed_ips, total_requests=excluded.total_requests,
           total_spend_usd=excluded.total_spend_usd, last_used_at=excluded.last_used_at,
           status=excluded.status"
    )
    .bind(key["id"].as_str().unwrap_or(""))
    .bind(key["name"].as_str().unwrap_or(""))
    .bind(key["description"].as_str().unwrap_or(""))
    .bind(key["key"].as_str().unwrap_or(""))
    .bind(key["created"].as_i64().unwrap_or(0))
    .bind(key["expiresAt"].as_i64())
    .bind(if key["rateEnabled"].as_bool().unwrap_or(false) { 1i64 } else { 0i64 })
    .bind(key["rateRequests"].as_i64().unwrap_or(60))
    .bind(key["rateWindow"].as_str().unwrap_or("minute"))
    .bind(if key["spendEnabled"].as_bool().unwrap_or(false) { 1i64 } else { 0i64 })
    .bind(key["spendCapUsd"].as_f64().unwrap_or(0.0))
    .bind(key["spendPeriod"].as_str().unwrap_or("month"))
    .bind(key["spendUsed"].as_f64().unwrap_or(0.0))
    .bind(&allowed_models)
    .bind(&allowed_routes)
    .bind(&allowed_ips)
    .bind(key["totalRequests"].as_i64().unwrap_or(0))
    .bind(key["totalSpendUsd"].as_f64().unwrap_or(0.0))
    .bind(key["lastUsedAt"].as_i64())
    .bind(key["status"].as_str().unwrap_or("active"))
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn api_key_delete(pool: &Pool<Any>, id: &str) -> anyhow::Result<()> {
    sqlx::query("DELETE FROM api_keys WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ─── Config entry persistence ─────────────────────────────────────────────────

pub async fn config_save(pool: &Pool<Any>, key: &str, value: &str) -> anyhow::Result<()> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    sqlx::query(
        "INSERT INTO config_entries (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
    )
    .bind(key)
    .bind(value)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn config_load(pool: &Pool<Any>, key: &str) -> anyhow::Result<Option<String>> {
    let row = sqlx::query("SELECT value FROM config_entries WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| r.get::<String, _>("value")))
}
