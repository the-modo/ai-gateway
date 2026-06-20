use sha2::{Digest, Sha256};
use gateway_providers::{ChatRequest, ContentPart, MessageContent, Role};

/// Deterministic cache key from a chat request.
/// Excludes fields that don't affect output (e.g. request ID).
pub fn cache_key(req: &ChatRequest) -> String {
    let mut hasher = Sha256::new();
    hasher.update(req.model.as_bytes());
    for msg in &req.messages {
        let serialized = serde_json::to_vec(msg).unwrap_or_default();
        hasher.update(&serialized);
    }
    if let Some(temp) = req.temperature {
        hasher.update(temp.to_le_bytes());
    }
    if let Some(max_tokens) = req.max_tokens {
        hasher.update(max_tokens.to_le_bytes());
    }
    hex::encode(hasher.finalize())
}

/// Semantic-cache scope and match text for a request.
///
/// Returns `(scope, text)` where `text` is the last user message (the part
/// that gets fuzzy-matched) and `scope` hashes everything else that must match
/// exactly: model, all other messages, temperature and max_tokens.
/// Returns `None` when the request has no text-bearing user message.
pub fn semantic_parts(req: &ChatRequest) -> Option<(u64, String)> {
    let last_user_idx = req.messages.iter().rposition(|m| m.role == Role::User)?;

    let text = match &req.messages[last_user_idx].content {
        MessageContent::Text(s) => s.clone(),
        MessageContent::Parts(parts) => {
            let joined = parts
                .iter()
                .filter_map(|p| match p {
                    ContentPart::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join(" ");
            if joined.trim().is_empty() {
                return None;
            }
            joined
        }
    };
    if text.trim().is_empty() {
        return None;
    }

    let mut hasher = Sha256::new();
    hasher.update(req.model.as_bytes());
    for (i, msg) in req.messages.iter().enumerate() {
        if i == last_user_idx {
            continue;
        }
        hasher.update(serde_json::to_vec(msg).unwrap_or_default());
    }
    if let Some(temp) = req.temperature {
        hasher.update(temp.to_le_bytes());
    }
    if let Some(max_tokens) = req.max_tokens {
        hasher.update(max_tokens.to_le_bytes());
    }
    let digest = hasher.finalize();
    let scope = u64::from_le_bytes(digest[..8].try_into().unwrap());
    Some((scope, text))
}
