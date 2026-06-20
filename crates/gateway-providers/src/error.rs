use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("Provider '{provider}' returned HTTP {status}: {body}")]
    Upstream {
        provider: String,
        status: u16,
        body: String,
    },

    #[error("Provider '{provider}' request timed out after {ms}ms")]
    Timeout { provider: String, ms: u64 },

    #[error("Provider '{provider}' rate limited")]
    RateLimited {
        provider: String,
        retry_after_ms: Option<u64>,
    },

    #[error("All providers failed for model '{model}'")]
    AllProvidersFailed { model: String },

    #[error("Model '{model}' not supported by provider '{provider}'")]
    ModelNotSupported { model: String, provider: String },

    #[error("Invalid response from provider '{provider}': {reason}")]
    InvalidResponse { provider: String, reason: String },

    #[error(transparent)]
    Http(#[from] reqwest::Error),
}
