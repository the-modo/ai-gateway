use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;
use serde_json::json;
use tracing::instrument;

use crate::{
    error::ProviderError,
    types::{
        BoxStream, ChatRequest, ChatResponse, Choice, Message, MessageContent, Role, Usage, Provider,
    },
};

const ANTHROPIC_API_VERSION: &str = "2023-06-01";

pub struct AnthropicProvider {
    client: Client,
    api_key: String,
    base_url: String,
    models: Vec<String>,
    name: String,
}

impl AnthropicProvider {
    pub fn new(name: String, api_key: String, base_url: Option<String>, models: Vec<String>) -> Self {
        let client = Client::builder()
            .http2_prior_knowledge()
            .pool_max_idle_per_host(32)
            .build()
            .expect("Failed to build HTTP client");

        Self {
            client,
            api_key,
            base_url: base_url.unwrap_or_else(|| "https://api.anthropic.com".to_string()),
            models,
            name,
        }
    }

    fn to_anthropic_payload(&self, req: &ChatRequest) -> serde_json::Value {
        let (system, messages): (Option<String>, Vec<serde_json::Value>) = {
            let mut sys = None;
            let msgs: Vec<_> = req
                .messages
                .iter()
                .filter_map(|m| {
                    if m.role == Role::System {
                        if let MessageContent::Text(t) = &m.content {
                            sys = Some(t.clone());
                        }
                        None
                    } else {
                        let role = match m.role {
                            Role::User => "user",
                            Role::Assistant => "assistant",
                            _ => return None,
                        };
                        let content = match &m.content {
                            MessageContent::Text(t) => json!(t),
                            MessageContent::Parts(parts) => json!(parts),
                        };
                        Some(json!({ "role": role, "content": content }))
                    }
                })
                .collect();
            (sys, msgs)
        };

        let mut payload = json!({
            "model": req.model,
            "messages": messages,
            "max_tokens": req.max_tokens.unwrap_or(4096),
        });

        if let Some(sys) = system {
            payload["system"] = json!(sys);
        }
        if let Some(temp) = req.temperature {
            payload["temperature"] = json!(temp);
        }

        payload
    }

    fn from_anthropic_response(&self, raw: serde_json::Value) -> anyhow::Result<ChatResponse> {
        let id = raw["id"].as_str().unwrap_or("").to_string();
        let model = raw["model"].as_str().unwrap_or("").to_string();

        let text = raw["content"]
            .as_array()
            .and_then(|arr| arr.first())
            .and_then(|b| b["text"].as_str())
            .unwrap_or("")
            .to_string();

        let finish_reason = raw["stop_reason"].as_str().map(|s| s.to_string());

        let usage = Usage {
            prompt_tokens: raw["usage"]["input_tokens"].as_u64().unwrap_or(0) as u32,
            completion_tokens: raw["usage"]["output_tokens"].as_u64().unwrap_or(0) as u32,
            total_tokens: (raw["usage"]["input_tokens"].as_u64().unwrap_or(0)
                + raw["usage"]["output_tokens"].as_u64().unwrap_or(0)) as u32,
        };

        Ok(ChatResponse {
            id,
            model,
            choices: vec![Choice {
                index: 0,
                message: Message {
                    role: Role::Assistant,
                    content: MessageContent::Text(text),
                },
                finish_reason,
            }],
            usage,
            created: chrono::Utc::now().timestamp(),
        })
    }
}

#[async_trait]
impl Provider for AnthropicProvider {
    fn name(&self) -> &str {
        &self.name
    }

    fn supported_models(&self) -> &[String] {
        &self.models
    }

    #[instrument(skip(self), fields(provider = %self.name, model = %req.model))]
    async fn chat(&self, req: ChatRequest) -> anyhow::Result<ChatResponse> {
        let url = format!("{}/v1/messages", self.base_url);
        let payload = self.to_anthropic_payload(&req);

        let resp = self
            .client
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_API_VERSION)
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

        let raw: serde_json::Value = resp.json().await?;
        self.from_anthropic_response(raw)
    }

    #[instrument(skip(self), fields(provider = %self.name, model = %req.model))]
    async fn chat_stream(&self, req: ChatRequest) -> anyhow::Result<BoxStream> {
        let url = format!("{}/v1/messages", self.base_url);
        let mut payload = self.to_anthropic_payload(&req);
        payload["stream"] = json!(true);

        let resp = self
            .client
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_API_VERSION)
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

        let stream = resp.bytes_stream().map(|r| r.map_err(anyhow::Error::from));
        Ok(Box::pin(stream))
    }
}
