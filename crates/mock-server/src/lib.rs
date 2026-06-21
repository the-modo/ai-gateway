//! Library bits of the mock LLM server — exposed so we can unit-test the
//! token-counting helpers without spinning up the HTTP layer.

use serde_json::Value;

/// ~4 chars per token — the standard rough estimate.
pub fn estimate_tokens(text: &str) -> u32 {
    ((text.chars().count() as u32) / 4).max(1)
}

/// Collect all string values under "content"/"text" keys (covers OpenAI,
/// Anthropic and Gemini request shapes).
pub fn collect_input_text(v: &Value, out: &mut String) {
    match v {
        Value::Object(map) => {
            for (k, val) in map {
                match val {
                    Value::String(s) if k == "content" || k == "text" => {
                        out.push_str(s);
                        out.push(' ');
                    }
                    _ => collect_input_text(val, out),
                }
            }
        }
        Value::Array(items) => {
            for item in items { collect_input_text(item, out); }
        }
        _ => {}
    }
}

/// Estimate (prompt_tokens, completion_tokens) for a request body and reply.
pub fn usage_for(body: &Value, reply: &str) -> (u32, u32) {
    let mut input = String::new();
    collect_input_text(body, &mut input);
    (estimate_tokens(&input), estimate_tokens(reply))
}
