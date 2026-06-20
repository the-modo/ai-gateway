use std::path::Path;
use std::sync::Arc;
use tokio::sync::watch;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use tracing::{info, warn};
use crate::GatewayConfig;

pub async fn watch_config(
    path: impl AsRef<Path>,
    tx: watch::Sender<Arc<GatewayConfig>>,
) -> anyhow::Result<()> {
    let path = path.as_ref().to_path_buf();

    let (notify_tx, mut notify_rx) = tokio::sync::mpsc::channel(16);

    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                let _ = notify_tx.blocking_send(event);
            }
        },
        notify::Config::default(),
    )?;

    watcher.watch(&path, RecursiveMode::NonRecursive)?;

    while let Some(event) = notify_rx.recv().await {
        if matches!(
            event.kind,
            notify::EventKind::Modify(_) | notify::EventKind::Create(_)
        ) {
            match load_config(&path) {
                Ok(cfg) => {
                    info!("Config reloaded from {}", path.display());
                    let _ = tx.send(Arc::new(cfg));
                }
                Err(e) => warn!("Config reload failed: {e}"),
            }
        }
    }

    Ok(())
}

pub fn load_config(path: impl AsRef<Path>) -> anyhow::Result<GatewayConfig> {
    let content = std::fs::read_to_string(path)?;
    let cfg: GatewayConfig = toml::from_str(&content)?;
    Ok(cfg)
}
