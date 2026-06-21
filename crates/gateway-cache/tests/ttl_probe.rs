use std::sync::Arc;
use std::time::Duration;
use gateway_cache::ExactCache;
use gateway_providers::{ChatResponse, Choice, Message, MessageContent, Role, Usage};

fn dummy_response() -> ChatResponse {
    ChatResponse {
        id: "test".into(),
        created: 0,
        model: "test".into(),
        choices: vec![Choice {
            index: 0,
            message: Message {
                role: Role::Assistant,
                content: MessageContent::Text("hi".into()),
            },
            finish_reason: Some("stop".into()),
        }],
        usage: Usage {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
        },
    }
}

/// Identical structure to gateway-core state: Arc<ExactCache> shared across awaits.
#[tokio::test]
async fn ttl_one_second_expires_via_arc() {
    let c = Arc::new(ExactCache::new(1000, 1));
    c.insert("k".into(), dummy_response()).await;
    assert!(c.get("k").await.is_some());

    tokio::time::sleep(Duration::from_millis(1_100)).await;
    let still = c.get("k").await;
    println!("after 1.1s: {}", still.is_some());

    tokio::time::sleep(Duration::from_millis(500)).await;
    let after = c.get("k").await;
    println!("after 1.6s: {}", after.is_some());
    assert!(after.is_none(), "expected None after 1.6s with 1s TTL");
}
