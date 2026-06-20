use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("Config file not found: {path}")]
    NotFound { path: String },

    #[error("Failed to parse config: {0}")]
    ParseError(#[from] config::ConfigError),

    #[error("Invalid provider '{name}': {reason}")]
    InvalidProvider { name: String, reason: String },

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}
