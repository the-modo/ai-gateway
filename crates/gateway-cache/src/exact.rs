use std::sync::Arc;
use std::time::Duration;
use moka::future::Cache;
use gateway_providers::ChatResponse;

#[derive(Clone)]
pub struct ExactCache {
    inner: Cache<String, Arc<ChatResponse>>,
}

impl ExactCache {
    pub fn new(max_entries: u64, ttl_seconds: u64) -> Self {
        let cache = Cache::builder()
            .max_capacity(max_entries)
            .time_to_live(Duration::from_secs(ttl_seconds))
            .build();
        Self { inner: cache }
    }

    pub async fn get(&self, key: &str) -> Option<Arc<ChatResponse>> {
        self.inner.get(key).await
    }

    pub async fn insert(&self, key: String, response: ChatResponse) {
        self.inner.insert(key, Arc::new(response)).await;
    }

    pub fn entry_count(&self) -> u64 {
        self.inner.entry_count()
    }
}
