use std::sync::Arc;
use anyhow::Context;
use tokio::net::TcpListener;
use tracing::info;

use gateway_config::hot_reload::{load_config, watch_config};
use gateway_storage::{backend_tag, connect, run_migrations, spawn_retention_pruner};
use gateway_telemetry::init_tracing;

use gateway_core::{build_app, AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config_path = std::env::var("GATEWAY_CONFIG")
        .unwrap_or_else(|_| "gateway.toml".to_string());

    let config = load_config(&config_path)
        .with_context(|| format!("Failed to load config from '{config_path}'"))?;

    init_tracing(&config.telemetry);
    info!("AI Gateway starting...");

    let (config_tx, config_rx) = tokio::sync::watch::channel(Arc::new(config.clone()));

    {
        let path = config_path.clone();
        tokio::spawn(async move {
            if let Err(e) = watch_config(path, config_tx).await {
                tracing::warn!("Config watcher stopped: {e}");
            }
        });
    }

    // Resolve a relative sqlite:// path against the config file's directory so
    // the database is always created next to gateway.toml regardless of which
    // working directory the process was launched from.
    let db_url_owned = resolve_db_url(&config.storage.database_url, &config_path);
    let db_url = &db_url_owned;
    let db_backend = backend_tag(db_url).to_string();

    info!("Connecting to storage backend: {db_backend} ({db_url})");
    let db = connect(db_url)
        .await
        .with_context(|| format!("Failed to connect to storage at '{db_url}'"))?;

    run_migrations(&db)
        .await
        .context("Failed to run storage migrations")?;

    info!("Storage ready");

    spawn_retention_pruner(Arc::clone(&db), config.storage.retention_days);

    let state = AppState::new(config_rx, Some(db), Some(db_backend)).await?;
    let app = build_app(state);

    let addr = format!("{}:{}", config.server.host, config.server.port);
    let listener = TcpListener::bind(&addr).await?;
    info!("Listening on {addr}");

    axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>())
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

/// If `url` is a SQLite URL with a relative path (e.g. `sqlite://./gateway.db`),
/// resolve it to an absolute path anchored at the directory that contains the
/// config file.  This lets the gateway find/create its database correctly
/// regardless of what working directory the process was launched from.
///
/// Avoids canonicalize() — that API adds OS-specific prefixes (\\?\ on Windows)
/// and requires the file to already exist, both of which caused bugs here.
fn resolve_db_url(url: &str, config_path: &str) -> String {
    let db_name = if let Some(s) = url.strip_prefix("sqlite://./") {
        s
    } else if let Some(s) = url.strip_prefix("sqlite://.\\") {
        s
    } else {
        return url.to_string();
    };

    // Find the directory that holds gateway.toml.
    let config_p = std::path::Path::new(config_path);
    let config_dir = if config_p.is_absolute() {
        config_p.parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::path::PathBuf::from("."))
    } else {
        // config_path is relative — anchor it to the current working directory.
        let cwd = std::env::current_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."));
        let full = cwd.join(config_p);
        full.parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::env::current_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from(".")))
    };

    let abs = config_dir.join(db_name);
    // Use forward slashes everywhere (SQLite URLs require this on all platforms).
    let path_str = abs.to_string_lossy().replace('\\', "/");

    // Unix absolute paths start with '/' → sqlite:// + /path = sqlite:///path (3 slashes).
    // Windows drive-letter paths have no leading slash → sqlite:/// + C:/path (also 3 slashes).
    if path_str.starts_with('/') {
        format!("sqlite://{path_str}")
    } else {
        format!("sqlite:///{path_str}")
    }
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to listen for ctrl+c");
    info!("Shutdown signal received");
}
