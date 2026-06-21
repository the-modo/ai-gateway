use mock_server::{collect_input_text, estimate_tokens, usage_for};
use serde_json::json;

#[test]
fn estimate_tokens_returns_at_least_one() {
    assert_eq!(estimate_tokens(""), 1, "even empty input yields ≥1 token");
    assert_eq!(estimate_tokens("a"), 1);
    assert_eq!(estimate_tokens("aaaa"), 1, "4 chars ≈ 1 token");
    assert_eq!(estimate_tokens("aaaabbbb"), 2, "8 chars ≈ 2 tokens");
}

#[test]
fn collect_input_text_walks_openai_messages() {
    let body = json!({
        "model": "gpt-4o",
        "messages": [
            {"role": "user",      "content": "hello"},
            {"role": "assistant", "content": "hi there"},
        ]
    });
    let mut out = String::new();
    collect_input_text(&body, &mut out);
    assert!(out.contains("hello"));
    assert!(out.contains("hi there"));
    // model name must NOT be included
    assert!(!out.contains("gpt-4o"));
}

#[test]
fn collect_input_text_walks_anthropic_parts() {
    let body = json!({
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": "part one"},
                {"type": "text", "text": "part two"}
            ]
        }]
    });
    let mut out = String::new();
    collect_input_text(&body, &mut out);
    assert!(out.contains("part one"));
    assert!(out.contains("part two"));
}

#[test]
fn collect_input_text_walks_gemini_parts() {
    let body = json!({
        "contents": [{
            "role": "user",
            "parts": [{"text": "gemini prompt body"}]
        }]
    });
    let mut out = String::new();
    collect_input_text(&body, &mut out);
    assert!(out.contains("gemini prompt body"));
}

#[test]
fn usage_for_distinguishes_prompt_and_completion() {
    let body = json!({
        "messages": [{"role": "user", "content": "abcdefghijklmnop"}], // 16 chars
    });
    let reply = "abcd"; // 4 chars
    let (prompt, completion) = usage_for(&body, reply);
    assert!(prompt >= 4, "16 chars should yield ≥ 4 tokens, got {prompt}");
    assert_eq!(completion, 1, "4 chars → 1 token");
}

#[test]
fn collect_input_text_handles_nested_objects() {
    let body = json!({
        "a": {"b": {"c": {"content": "deeply nested"}}},
    });
    let mut out = String::new();
    collect_input_text(&body, &mut out);
    assert!(out.contains("deeply nested"));
}

#[test]
fn usage_for_empty_input_still_returns_at_least_one_token_each() {
    let (p, c) = usage_for(&json!({}), "");
    assert!(p >= 1 && c >= 1, "minimum token counts: p={p} c={c}");
}
