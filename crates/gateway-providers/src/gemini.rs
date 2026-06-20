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

pub struct GeminiProvider {
    client: Client,
    api_key: String,
    base_url: String,
    models: Vec<String>,
    name: String,
}

impl GeminiProvider {
    pub fn new(name: String, api_key: String, base_url: Option<String>, models: Vec<String>) -> Self {
        let client = Client::builder()
            .pool_max_idle_per_host(32)
            .build()
            .expect("Failed to build HTTP client");

        Self {
            client,
            api_key,
            base_url: base_url
                .unwrap_or_else(|| "https://generativelanguage.googleapis.com".to_string()),
            models,
            name,
        }
    }

    fn model_url(&self, model: &str, stream: bool) -> String {
        let method = if stream {
            "streamGenerateContent?alt=sse"
        } else {
            "generateContent"
        };
        format!(
            "{}/v1beta/models/{}:{}",
            self.base_url, model, method
        )
    }

    fn to_gemini_payload(&self, req: &ChatRequest) -> serde_json::Value {
        let contents: Vec<serde_json::Value> = req
            .messages
            .iter()
            .filter(|m| m.role != Role::System)
            .map(|m| {
                let role = match m.role {
                    Role::User => "user",
                    Role::Assistant => "model",
                    _ => "user",
                };
                let text = match &m.content {
                    MessageContent::Text(t) => t.clone(),
                    MessageContent::Parts(_) => String::new(),
                };
                json!({
                    "role": role,
                    "parts": [{ "text": text }]
                })
            })
            .collect();

        let mut payload = json!({ "contents": contents });

        if let Some(temp) = req.temperature {
            payload["generationConfig"] = json!({ "temperature": temp });
        }
        if let Some(max_tokens) = req.max_tokens {
            payload["generationConfig"]["maxOutputTokens"] = json!(max_tokens);
        }

        payload
    }

    fn from_gemini_response(
        &self,
        raw: serde_json::Value,
        model: &str,
    ) -> anyhow::Result<ChatResponse> {
        let text = raw["candidates"]
            .as_array()
            .and_then(|c| c.first())
            .and_then(|c| c["content"]["parts"].as_array())
            .and_then(|p| p.first())
            .and_then(|p| p["text"].as_str())
            .unwrap_or("")
            .to_string();

        let finish_reason = raw["candidates"]
            .as_array()
            .and_then(|c| c.first())
            .and_then(|c| c["finishReason"].as_str())
            .map(|s| s.to_lowercase());

        let prompt_tokens = raw["usageMetadata"]["promptTokenCount"]
            .as_u64()
            .unwrap_or(0) as u32;
        let completion_tokens = raw["usageMetadata"]["candidatesTokenCount"]
            .as_u64()
            .unwrap_or(0) as u32;

        Ok(ChatResponse {
            id: uuid::Uuid::new_v4().to_string(),
            model: model.to_string(),
            choices: vec![Choice {
                index: 0,
                message: Message {
                    role: Role::Assistant,
                    content: MessageContent::Text(text),
                },
                finish_reason,
            }],
            usage: Usage {
                prompt_tokens,
                completion_tokens,
                total_tokens: prompt_tokens + completion_tokens,
            },
            created: chrono::Utc::now().timestamp(),
        })
    }
}

#[async_trait]
impl Provider for GeminiProvider {
    fn name(&self) -> &str {
        &self.name
    }

    fn supported_models(&self) -> &[String] {
        &self.models
    }

    #[instrument(skip(self), fields(provider = %self.name, model = %req.model))]
    async fn chat(&self, req: ChatRequest) -> anyhow::Result<ChatResponse> {
        let url = format!("{}&key={}", self.model_url(&req.model, false), self.api_key);
        let payload = self.to_gemini_payload(&req);
        let model = req.model.clone();

        let resp = self.client.post(&url).json(&payload).send().await?;

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
        self.from_gemini_response(raw, &model)
    }

    #[instrument(skip(self), fields(provider = %self.name, model = %req.model))]
    async fn chat_stream(&self, req: ChatRequest) -> anyhow::Result<BoxStream> {
        let url = format!("{}&key={}", self.model_url(&req.model, true), self.api_key);
        let payload = self.to_gemini_payload(&req);

        let resp = self.client.post(&url).json(&payload).send().await?;

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
