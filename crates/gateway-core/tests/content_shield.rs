use gateway_test_utils::{HarnessBuilder, MockConfig};
use serde_json::json;

fn last_outgoing_text(h: &gateway_test_utils::TestHarness) -> String {
    let body = h.mock(0).last_request_body().expect("mock saw a request");
    // OpenAI-style: messages[].content (string)
    body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|m| m["content"].as_str().map(|s| s.to_string()))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Built-in email pattern: send "Email me at alice@example.com" and the
/// upstream must receive the redacted form.
#[tokio::test]
async fn shield_redacts_email_before_upstream() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    let put = h.client.put(format!("{}/config/content-shield", h.base_url))
        .json(&json!({
            "rules": [{
                "id":          "email",
                "label":       "email",
                "pattern":     "",
                "action":      "redact",
                "replacement": "[REDACTED-EMAIL]",
                "scope":       "request",
                "enabled":     true,
            }]
        }))
        .send().await.unwrap();
    assert_eq!(put.status(), 200);

    let r = h.chat("gpt-4o", "Email me at alice@example.com please").await;
    assert_eq!(r.status(), 200);

    let outgoing = last_outgoing_text(&h);
    assert!(!outgoing.contains("alice@example.com"), "raw email leaked: {outgoing}");
    assert!(outgoing.contains("[REDACTED-EMAIL]"), "replacement missing: {outgoing}");
}

/// Block on credit card — upstream is not reached.
#[tokio::test]
async fn shield_block_on_credit_card_rejects() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    h.client.put(format!("{}/config/content-shield", h.base_url))
        .json(&json!({
            "rules": [{
                "id":          "cc",
                "label":       "credit card",
                "pattern":     "",
                "action":      "block",
                "replacement": "",
                "scope":       "request",
                "enabled":     true,
            }]
        }))
        .send().await.unwrap();

    let r = h.chat("gpt-4o", "my card 4111 1111 1111 1111 ok?").await;
    assert_eq!(r.status(), 400, "block must reject");
    assert_eq!(h.mock(0).calls(), 0);
}

/// Custom pattern overrides the built-in default — verify the custom regex
/// path actually runs.
#[tokio::test]
async fn shield_custom_pattern_redacts() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    h.client.put(format!("{}/config/content-shield", h.base_url))
        .json(&json!({
            "rules": [{
                "id":          "internal-id",
                "label":       "internal id",
                "pattern":     r"EMP-\d{4,}",
                "action":      "redact",
                "replacement": "<EMP>",
                "scope":       "request",
                "enabled":     true,
            }]
        }))
        .send().await.unwrap();

    let r = h.chat("gpt-4o", "user EMP-12345 needs reset").await;
    assert_eq!(r.status(), 200);
    let outgoing = last_outgoing_text(&h);
    assert!(outgoing.contains("<EMP>"));
    assert!(!outgoing.contains("EMP-12345"));
}

/// Disabled rule must not act.
#[tokio::test]
async fn shield_disabled_rule_is_no_op() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    h.client.put(format!("{}/config/content-shield", h.base_url))
        .json(&json!({
            "rules": [{
                "id":          "email",
                "label":       "email",
                "pattern":     "",
                "action":      "redact",
                "replacement": "[X]",
                "scope":       "request",
                "enabled":     false,
            }]
        }))
        .send().await.unwrap();

    let r = h.chat("gpt-4o", "ping bob@example.com").await;
    assert_eq!(r.status(), 200);
    let outgoing = last_outgoing_text(&h);
    assert!(outgoing.contains("bob@example.com"), "redaction should NOT have run");
}

/// Multiple matches in one message all get redacted.
#[tokio::test]
async fn shield_redacts_every_occurrence() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build()
        .await
        .unwrap();

    h.client.put(format!("{}/config/content-shield", h.base_url))
        .json(&json!({
            "rules": [{
                "id": "email", "label": "email", "pattern": "",
                "action": "redact", "replacement": "[E]",
                "scope": "request", "enabled": true,
            }]
        }))
        .send().await.unwrap();

    let r = h.chat("gpt-4o", "a@b.com and c@d.org and e@f.net").await;
    assert_eq!(r.status(), 200);
    let outgoing = last_outgoing_text(&h);
    assert_eq!(outgoing.matches("[E]").count(), 3);
}
