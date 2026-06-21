use gateway_test_utils::{HarnessBuilder, MockConfig};
use serde_json::json;

/// /mcp-test endpoint without an id (notification) must reply 202.
#[tokio::test]
async fn mcp_test_notification_returns_202() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build().await.unwrap();

    let r = h.client.post(format!("{}/mcp-test", h.base_url))
        .json(&json!({ "jsonrpc": "2.0", "method": "ping" }))
        .send().await.unwrap();
    assert_eq!(r.status(), 202);
}

/// /mcp-test initialize returns server info and protocol version.
#[tokio::test]
async fn mcp_test_initialize_returns_server_info() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build().await.unwrap();

    let r = h.client.post(format!("{}/mcp-test", h.base_url))
        .json(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }))
        .send().await.unwrap();
    assert_eq!(r.status(), 200);
    let v: serde_json::Value = r.json().await.unwrap();
    assert_eq!(v["jsonrpc"], "2.0");
    assert_eq!(v["id"], 1);
    assert!(v["result"]["protocolVersion"].is_string());
    assert_eq!(v["result"]["serverInfo"]["name"], "Modo Test MCP Server");
}

#[tokio::test]
async fn mcp_test_tools_list_returns_three_tools() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build().await.unwrap();

    let r = h.client.post(format!("{}/mcp-test", h.base_url))
        .json(&json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/list" }))
        .send().await.unwrap();
    assert_eq!(r.status(), 200);
    let v: serde_json::Value = r.json().await.unwrap();
    let tools = v["result"]["tools"].as_array().expect("tools array");
    assert_eq!(tools.len(), 3);
    let names: Vec<_> = tools.iter().map(|t| t["name"].as_str().unwrap().to_string()).collect();
    assert!(names.contains(&"echo".to_string()));
    assert!(names.contains(&"current_time".to_string()));
    assert!(names.contains(&"add".to_string()));
}

#[tokio::test]
async fn mcp_test_tools_call_echo_works() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build().await.unwrap();

    let r = h.client.post(format!("{}/mcp-test", h.base_url))
        .json(&json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": { "name": "echo", "arguments": { "text": "hello world" } }
        }))
        .send().await.unwrap();
    assert_eq!(r.status(), 200);
    let v: serde_json::Value = r.json().await.unwrap();
    // tool_text wraps as {content: [{type, text}]}
    let text = v["result"]["content"][0]["text"].as_str().unwrap_or("");
    assert!(text.contains("hello world"), "echo content = {text}");
}

#[tokio::test]
async fn mcp_test_tools_call_add_returns_sum() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build().await.unwrap();

    let r = h.client.post(format!("{}/mcp-test", h.base_url))
        .json(&json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": { "name": "add", "arguments": { "a": 3.5, "b": 1.25 } }
        }))
        .send().await.unwrap();
    let v: serde_json::Value = r.json().await.unwrap();
    let text = v["result"]["content"][0]["text"].as_str().unwrap_or("");
    assert_eq!(text, "4.75");
}

#[tokio::test]
async fn mcp_test_unknown_method_returns_jsonrpc_error() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build().await.unwrap();

    let r = h.client.post(format!("{}/mcp-test", h.base_url))
        .json(&json!({ "jsonrpc": "2.0", "id": 9, "method": "does/not/exist" }))
        .send().await.unwrap();
    let v: serde_json::Value = r.json().await.unwrap();
    assert_eq!(v["error"]["code"], -32601);
}

#[tokio::test]
async fn mcp_config_round_trip() {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig::default())
        .build().await.unwrap();

    let put = h.client.put(format!("{}/config/mcp", h.base_url))
        .json(&json!({
            "servers": [{
                "id":          "s1",
                "name":        "Server 1",
                "url":         "http://localhost:9999/mcp",
                "auth_header": "",
                "enabled":     true,
            }]
        }))
        .send().await.unwrap();
    assert_eq!(put.status(), 200);

    let get = h.client.get(format!("{}/config/mcp", h.base_url))
        .send().await.unwrap();
    assert_eq!(get.status(), 200);
    let v: serde_json::Value = get.json().await.unwrap();
    assert_eq!(v["servers"].as_array().unwrap().len(), 1);
    assert_eq!(v["servers"][0]["id"], "s1");
}
