pub mod logger;
pub mod models;
pub mod queries;

use std::sync::Arc;

use sqlx::{Any, Pool, any::AnyPoolOptions};

pub use logger::RequestLogger;
pub use models::LogEntry;

/// Detect backend tag from URL prefix.
pub fn backend_tag(url: &str) -> &'static str {
    if url.starts_with("postgres") { "postgres" } else { "sqlite" }
}

/// Create a pool for the given URL. Installs any-driver support if needed.
pub async fn connect(database_url: &str) -> anyhow::Result<Arc<Pool<Any>>> {
    sqlx::any::install_default_drivers();

    let pool = AnyPoolOptions::new()
        .max_connections(if database_url.starts_with("sqlite") { 4 } else { 16 })
        .connect(database_url)
        .await?;

    // SQLite performance tuning: WAL journal + relaxed fsync + larger page cache.
    // These pragmas are no-ops on Postgres.
    if database_url.starts_with("sqlite") {
        for pragma in &[
            "PRAGMA journal_mode=WAL",
            "PRAGMA synchronous=NORMAL",
            "PRAGMA cache_size=-65536",   // 64 MB page cache
            "PRAGMA temp_store=MEMORY",
            "PRAGMA mmap_size=268435456", // 256 MB memory-mapped I/O
        ] {
            sqlx::query(pragma).execute(&pool).await.ok();
        }
    }

    Ok(Arc::new(pool))
}

/// Run embedded migrations against the pool.
pub async fn run_migrations(pool: &Pool<Any>) -> anyhow::Result<()> {
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(())
}

/// Spawn a background task that periodically prunes old log entries.
pub fn spawn_retention_pruner(pool: Arc<Pool<Any>>, retention_days: u32) {
    if retention_days == 0 {
        return;
    }
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(tokio::time::Duration::from_secs(3600));
        loop {
            ticker.tick().await;
            let cutoff = chrono::Utc::now().timestamp_millis()
                - (retention_days as i64) * 86_400_000;
            match queries::delete_old_logs(&pool, cutoff).await {
                Ok(n) if n > 0 => tracing::info!("storage: pruned {n} old log rows"),
                Err(e) => tracing::warn!("storage: pruner error: {e}"),
                _ => {}
            }
        }
    });
}
