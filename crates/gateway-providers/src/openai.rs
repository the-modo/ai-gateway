use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;
use tracing::{debug, instrument};

use crate::{
    error::ProviderError,
    types::{BoxStream, ChatRequest, ChatResponse, Provider},
};

pub struct OpenAIProvider {
    client: Client,
    api_key: String,
    base_url: String,
    models: Vec<String>,
    name: String,
}

impl OpenAIProvider {
    pub fn new(name: String, api_key: String, base_url: Option<String>, models: Vec<String>) -> Self {
        let client = Client::builder()
            .http2_prior_knowledge()
            .pool_max_idle_per_host(32)
            .build()
            .expect("Failed to build HTTP client");

        Self {
            client,
            api_key,
            base_url: base_url.unwrap_or_else(|| "https://api.openai.com".to_string()),
            models,
            name,
        }
    }
}

#[async_trait]
impl Provider for OpenAIProvider {
    fn name(&self) -> &str {
        &self.name
    }

    fn supported_models(&self) -> &[String] {
        &self.models
    }

    #[instrument(skip(self), fields(provider = %self.name, model = %req.model))]
    async fn chat(&self, req: ChatRequest) -> anyhow::Result<ChatResponse> {
        let url = format!("{}/v1/chat/completions", self.base_url);

        let mut payload = serde_json::to_value(&req)?;
        payload["stream"] = serde_json::Value::Bool(false);

        debug!("Sending request to OpenAI");

        let resp = self
            .client
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Upstream {
                provider: self.name.clone(),
                status: status.as_u16(),
                body,
            }
            .into());
        }

        let response: ChatResponse = resp.json().await?;
        Ok(response)
    }

    #[instrument(skip(self), fields(provider = %self.name, model = %req.model))]
    async fn chat_stream(&self, req: ChatRequest) -> anyhow::Result<BoxStream> {
        let url = format!("{}/v1/chat/completions", self.base_url);

        let mut payload = serde_json::to_value(&req)?;
        payload["stream"] = serde_json::Value::Bool(true);

        let resp = self
            .client
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Upstream {
                provider: self.name.clone(),
                status: status.as_u16(),
                body,
            }
            .into());
        }

        // Zero-copy: pipe the byte stream directly without buffering
        let stream = resp.bytes_stream().map(|r| r.map_err(anyhow::Error::from));
        Ok(Box::pin(stream))
    }
}
