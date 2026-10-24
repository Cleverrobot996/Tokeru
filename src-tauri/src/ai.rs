use crate::models::{AiResult, Question, VisionQuestion};
use serde_json::{json, Value};

const DEFAULT_SYSTEM: &str = "你是英语学习教练。回答用简体中文，先把错误原因说透，再给正确答案和可复述的记忆点。涉及写作时，给出可勾选的中文自评清单（内容/结构/语言）。不要编造题目没有的信息。";

fn question_text(q: &Question) -> String {
    let mut s = format!("题型：{}
题干：{}
", q.qtype, q.stem);
    if !q.options.is_empty() {
        s.push_str("选项：
");
        for o in &q.options { s.push_str(&format!("{}. {}
", o.key, o.text)); }
    }
    s.push_str(&format!("参考答案：{}
", q.answer));
    if !q.explanation.is_empty() { s.push_str(&format!("题库原解析：{}
", q.explanation)); }
    s
}

fn with_thinking(body: &mut Value, provider: &str, thinking: bool) {
    if provider == "deepseek" {
        body["thinking"] = json!({"type": if thinking { "enabled" } else { "disabled" }});
    }
}

pub async fn explain(q: &Question, mode: &str, custom: &str, followup: Option<&str>, key: &str, base: &str, model: &str, provider: &str, thinking: bool) -> Result<AiResult, String> {
    if base.trim().is_empty() || model.trim().is_empty() {
        return Err("未配置 AI 服务，请先在设置里选择服务并填写 API 地址与模型。".into());
    }
    let system = if custom.trim().is_empty() { DEFAULT_SYSTEM.to_string() } else { format!("{DEFAULT_SYSTEM}\n\n用户额外要求：{custom}") };
    let mode_text = match mode {
        "brief" => "先给结论，再用 2-4 句话说明关键依据；不要展开成完整解析。",
        "writing" => "按“内容/结构/语言”三项给出自评清单，每项 2-3 个可勾选问题；再给 2 条具体改写建议。",
        _ => "先给出简要结论，再逐项解释为什么正确答案成立、其他选项为什么不对，最后给一个记忆提示。",
    };
    let mut user = format!("{mode_text}\n\n{}", question_text(q));
    if let Some(f) = followup.filter(|f| !f.trim().is_empty()) {
        user.push_str(&format!("\n学生的追问：{f}\n请只回答追问，不要重复整段解析。"));
    }
    let mut body = json!({
        "model": model,
        "messages": [{"role":"system","content":system},{"role":"user","content":user}],
        "temperature": if thinking { 0.4 } else { 0.3 },
        "max_tokens": 4096
    });
    with_thinking(&mut body, provider, thinking);
    post_chat(body, key, base, model, provider, thinking).await
}

/// 通用文本补全：标签整理、分值分配、AI 判卷和连接测试共用。
/// 与 explain 的区别是不绑定具体题目，system/user 完全由调用方给出。
pub async fn complete(system: &str, user: &str, key: &str, base: &str, model: &str, provider: &str, thinking: bool) -> Result<AiResult, String> {
    if base.trim().is_empty() || model.trim().is_empty() {
        return Err("未配置 AI 服务，请先在设置里选择服务并填写 API 地址与模型。".into());
    }
    let mut body = json!({
        "model": model,
        "messages": [{"role":"system","content":system},{"role":"user","content":user}],
        "temperature": if thinking { 0.4 } else { 0.2 },
        "max_tokens": 8192
    });
    with_thinking(&mut body, provider, thinking);
    post_chat(body, key, base, model, provider, thinking).await
}

/// 视觉连接测试：必须真的带上一张图，否则纯文本模型也会返回 OK，形成假阳性。
/// 1x1 透明 PNG 足够触发多模态链路，又不会消耗输入 token 配额。
const TEST_PNG: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

pub async fn vision_test(key: &str, base: &str, model: &str, provider: &str, thinking: bool) -> Result<AiResult, String> {
    if base.trim().is_empty() || model.trim().is_empty() {
        return Err("未配置视觉模型，请先在设置里填写 API 地址与模型。".into());
    }
    let mut body = json!({
        "model": model,
        "messages": [{"role":"user","content":[
            {"type":"text","text":"只回复 OK，不要解释。"},
            {"type":"image_url","image_url":{"url":TEST_PNG}}
        ]}],
        "temperature": 0,
        "max_tokens": 64
    });
    with_thinking(&mut body, provider, thinking);
    post_chat(body, key, base, model, provider, thinking).await
}

const VISION_SYSTEM: &str = "你是试卷排版分析器。你的任务是找出每道题真正需要的图（几何图、函数图、流程图、示意图等），只返回图形本身的位置，不提取文字、选项、表格或答案。位置必须用相对页面宽高的归一化坐标，不要用像素。只输出 JSON，不要解释。";

/// 自动分图：把页面图片和题目清单交给视觉模型。
/// 约定返回 {"figures":[{"question":"1","page":1,"bbox":[x,y,w,h],"caption":"..."}]}，
/// bbox 为相对该页的 [左上 x, 左上 y, 宽, 高]，取值 0..1。
pub async fn vision_segment(pages: &[String], questions: &[VisionQuestion], key: &str, base: &str, model: &str, provider: &str, thinking: bool) -> Result<AiResult, String> {
    if base.trim().is_empty() || model.trim().is_empty() {
        return Err("未配置视觉模型，请先在设置里填写多模态模型与 API 地址。".into());
    }
    let mut question_list = String::new();
    for q in questions.iter().take(200) {
        let stem: String = q.stem.chars().take(400).collect();
        question_list.push_str(&format!("- 题号 {}：{}\n", q.label.trim(), stem.replace(['\n', '\r'], " ")));
    }
    let user_text = format!(
        "同一份试卷共 {} 页图像，按 PAGE 1 到 PAGE {} 的顺序排列。\n\
         请找出下面每道题需要的图形，并给出图形在该页中的位置。\n\
         只返回 JSON：{{\"figures\":[{{\"question\":\"1\",\"page\":1,\"bbox\":[0.1,0.2,0.3,0.25],\"caption\":\"简短说明\"}}]}}\n\
         要求：\n\
         1. bbox 是 [左上角 x, 左上角 y, 宽, 高]，相对该页宽高归一化到 0..1，不要用像素。\n\
         2. 只框图形本身，不要包含题干、选项、表格、答案或大片空白。\n\
         3. 一道题有多张图就输出多条；没有图的题不要输出。\n\
         4. question 用题目清单里的题号，page 用图像页码（从 1 开始）。\n\
         5. 不确定的图不要输出。\n\n题目清单：\n{}",
        pages.len(), pages.len(), question_list
    );
    let mut content: Vec<Value> = vec![json!({"type": "text", "text": user_text})];
    for (index, page) in pages.iter().enumerate() {
        if !page.starts_with("data:image/") {
            return Err("页面图像格式不正确，请重新选择 PDF 或图片。".into());
        }
        content.push(json!({"type": "text", "text": format!("PAGE {}", index + 1)}));
        content.push(json!({"type": "image_url", "image_url": {"url": page}}));
    }
    let mut body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": VISION_SYSTEM},
            {"role": "user", "content": content}
        ],
        "temperature": 0,
        "max_tokens": 3000
    });
    with_thinking(&mut body, provider, thinking);
    post_chat(body, key, base, model, provider, thinking).await
}

const VISION_OCR_SYSTEM: &str = "你是试卷数字化助手。你会收到若干页试卷扫描图或 PDF 渲染图。请按页转写为 Markdown，保留题号、题干、选项、材料、表格、公式与答案；不要编造看不清的文字。每页单独输出，并用 figures 标出该页中真正需要单独成图的图形（几何图、函数图、示意图、流程图、图片），给出归一化 bbox。只输出 JSON，不要解释。";

/// 视觉 OCR + 分图：每批最多 8 页。返回原始 JSON，由前端做宽松解析。
/// 约定 {"pages":[{"page":1,"markdown":"...","figures":[{"id":"p1f1","bbox":[x,y,w,h],"caption":"..."}]}]}
pub async fn vision_ocr(pages: &[String], key: &str, base: &str, model: &str, provider: &str, thinking: bool) -> Result<AiResult, String> {
    if base.trim().is_empty() || model.trim().is_empty() {
        return Err("未配置视觉模型，请先在设置里填写多模态模型与 API 地址。".into());
    }
    if pages.is_empty() {
        return Err("没有可识别的页面。".into());
    }
    if pages.len() > 8 {
        return Err("单次视觉识别最多 8 页，请分批处理。".into());
    }
    let user_text = format!(
        "共 {} 页。请逐页转写并分图。\n\
         只输出 JSON：{{\"pages\":[{{\"page\":1,\"markdown\":\"该页 Markdown 正文\",\"figures\":[{{\"id\":\"p1f1\",\"bbox\":[0.1,0.2,0.3,0.25],\"caption\":\"图注\"}}]}}]}}\n\
         要求：\n\
         1. 页码从 1 开始，必须覆盖每一页；没有图形时 figures 输出 []。\n\
         2. markdown 保留题号、题干、选项、材料、表格、公式；看不清的字用 □ 表示，不要猜。\n\
         3. 选择题选项写成 A. ...，每项一行；填空题空位写成 ____。\n\
         4. 图片本身不要写进 markdown，要在 figures 里给出位置；正文用 [[FIG:id]] 占位，id 必须与 figures 的 id 对应。\n\
         5. bbox 是 [左上 x, 左上 y, 宽, 高]，相对该页宽高归一化到 0..1，不要用像素；只框图形本身，不含题干、选项和大片空白。\n\
         6. 不要输出答案以外的解释文字。",
        pages.len()
    );
    let mut content: Vec<Value> = vec![json!({"type":"text","text":user_text})];
    for (index, page) in pages.iter().enumerate() {
        if !page.starts_with("data:image/") {
            return Err("页面图像格式不正确，请重新选择 PDF 或图片。".into());
        }
        content.push(json!({"type":"text","text":format!("PAGE {}", index + 1)}));
        content.push(json!({"type":"image_url","image_url":{"url":page}}));
    }
    let mut body = json!({
        "model": model,
        "messages": [
            {"role":"system","content":VISION_OCR_SYSTEM},
            {"role":"user","content":content}
        ],
        "temperature": 0,
        "max_tokens": 8192
    });
    with_thinking(&mut body, provider, thinking);
    post_chat(body, key, base, model, provider, thinking).await
}

fn join_api(base: &str, path: &str) -> String {
    let base = base.trim().trim_end_matches('/');
    if base.ends_with("/v1") && path.starts_with("/v1/") {
        format!("{base}{}", &path[3..])
    } else {
        format!("{base}{path}")
    }
}

fn data_image_parts(uri: &str) -> Option<(&str, &str)> {
    let rest = uri.strip_prefix("data:")?;
    let (meta, data) = rest.split_once(',')?;
    let media = meta.strip_suffix(";base64")?;
    Some((media, data))
}

/// 把 OpenAI 风格的请求体转换成 Anthropic Messages 请求体。
/// 回包再转回统一的 AiResult，调用方不需要知道协议差异。
fn anthropic_request(body: &Value, model: &str, thinking: bool) -> Value {
    let mut system = String::new();
    let mut messages: Vec<Value> = Vec::new();
    if let Some(list) = body["messages"].as_array() {
        for message in list {
            let role = message["role"].as_str().unwrap_or("user");
            let content = &message["content"];
            if role == "system" {
                if let Some(text) = content.as_str() {
                    if !system.is_empty() { system.push('\n'); }
                    system.push_str(text);
                }
                continue;
            }
            let anth_content = if let Some(text) = content.as_str() {
                json!(text)
            } else if let Some(parts) = content.as_array() {
                let mut out: Vec<Value> = Vec::new();
                for part in parts {
                    match part["type"].as_str().unwrap_or("") {
                        "text" => out.push(json!({"type":"text","text":part["text"].as_str().unwrap_or("")})),
                        "image_url" => {
                            let uri = part["image_url"]["url"].as_str().unwrap_or("");
                            if let Some((media, data)) = data_image_parts(uri) {
                                out.push(json!({"type":"image","source":{"type":"base64","media_type":media,"data":data}}));
                            }
                        }
                        _ => {}
                    }
                }
                json!(out)
            } else {
                json!("")
            };
            messages.push(json!({"role": if role == "assistant" { "assistant" } else { "user" }, "content": anth_content}));
        }
    }
    let max_tokens = body["max_tokens"].as_i64().unwrap_or(4096).max(1024);
    let mut req = json!({
        "model": model,
        "max_tokens": if thinking { max_tokens.max(4096) } else { max_tokens },
        "messages": messages
    });
    if !system.is_empty() { req["system"] = json!(system); }
    if thinking {
        req["thinking"] = json!({"type":"enabled","budget_tokens":2048});
        req["temperature"] = json!(1);
    } else if let Some(temp) = body["temperature"].as_f64() {
        req["temperature"] = json!(temp);
    }
    req
}

async fn post_anthropic(body: Value, key: &str, base: &str, model: &str, thinking: bool) -> Result<AiResult, String> {
    let client = reqwest::Client::new();
    let url = join_api(base, "/v1/messages");
    let req = client
        .post(url)
        .header("anthropic-version", "2023-06-01")
        .header("x-api-key", key)
        .json(&anthropic_request(&body, model, thinking));
    let resp = req.send().await.map_err(|e| format!("网络错误：{e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("AI 服务返回 {status}：{}", text.chars().take(300).collect::<String>()));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("响应不是 JSON：{e}"))?;
    let mut content = String::new();
    let mut reasoning = String::new();
    if let Some(blocks) = v["content"].as_array() {
        for block in blocks {
            match block["type"].as_str().unwrap_or("") {
                "text" => content.push_str(block["text"].as_str().unwrap_or("")),
                "thinking" => reasoning.push_str(block["thinking"].as_str().unwrap_or("")),
                _ => {}
            }
        }
    }
    if content.trim().is_empty() && reasoning.trim().is_empty() {
        return Err("模型没有返回内容。".into());
    }
    Ok(AiResult { content, reasoning, model: v["model"].as_str().unwrap_or(model).to_string(), cached: false })
}

async fn post_openai(body: Value, key: &str, base: &str, model: &str) -> Result<AiResult, String> {
    let client = reqwest::Client::new();
    let url = join_api(base, "/chat/completions");
    let mut req = client.post(url).json(&body);
    if !key.trim().is_empty() {
        req = req.bearer_auth(key);
    }
    let resp = req.send().await.map_err(|e| format!("网络错误：{e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("AI 服务返回 {status}：{}", text.chars().take(300).collect::<String>()));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("响应不是 JSON：{e}"))?;
    let message = &v["choices"][0]["message"];
    let content = message["content"].as_str().unwrap_or("").to_string();
    let reasoning = message["reasoning_content"].as_str().unwrap_or("").to_string();
    if content.trim().is_empty() && reasoning.trim().is_empty() {
        return Err("模型没有返回内容。".into());
    }
    Ok(AiResult { content, reasoning, model: v["model"].as_str().unwrap_or(model).to_string(), cached: false })
}

async fn post_chat(body: Value, key: &str, base: &str, model: &str, provider: &str, thinking: bool) -> Result<AiResult, String> {
    if provider == "anthropic" {
        post_anthropic(body, key, base, model, thinking).await
    } else {
        post_openai(body, key, base, model).await
    }
}

/// 获取模型列表。不同协议的回包形状不一样，这里统一成模型 id。
pub async fn list_models(key: &str, base: &str, provider: &str) -> Result<Vec<String>, String> {
    if base.trim().is_empty() {
        return Err("请先填写 API 地址。".into());
    }
    let client = reqwest::Client::new();
    let (url, req) = match provider {
        "anthropic" => (
            join_api(base, "/v1/models?limit=100"),
            client.get(join_api(base, "/v1/models?limit=100"))
                .header("anthropic-version", "2023-06-01")
                .header("x-api-key", key),
        ),
        "ollama" => {
            let root = base.trim().trim_end_matches('/').trim_end_matches("/v1");
            let url = format!("{root}/api/tags");
            (url.clone(), client.get(url))
        }
        "dashscope" => {
            let url = join_api(base, "/models");
            (url.clone(), client.get(url).bearer_auth(key))
        }
        _ => {
            let url = join_api(base, "/models");
            (url.clone(), client.get(url).bearer_auth(key))
        }
    };
    let resp = req.send().await.map_err(|e| format!("网络错误：{e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("获取模型列表失败（{status}）：{}", text.chars().take(240).collect::<String>()));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("模型列表不是 JSON：{e}"))?;
    let mut out: Vec<String> = Vec::new();
    let mut push = |id: &str| {
        let id = id.trim();
        if !id.is_empty() && !out.iter().any(|x| x == id) { out.push(id.to_string()); }
    };
    if let Some(items) = v["data"].as_array().or_else(|| v["models"].as_array()) {
        for item in items {
            if let Some(id) = item["id"].as_str().or_else(|| item["name"].as_str()) {
                push(id);
            }
        }
    }
    if out.is_empty() {
        return Err(format!("{url} 没有返回可用的模型。"));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn join_api_does_not_double_v1() {
        assert_eq!(join_api("https://api.deepseek.com", "/chat/completions"), "https://api.deepseek.com/chat/completions");
        assert_eq!(join_api("https://api.openai.com/v1/", "/models"), "https://api.openai.com/v1/models");
        assert_eq!(join_api("https://api.anthropic.com", "/v1/messages"), "https://api.anthropic.com/v1/messages");
    }

    #[test]
    fn anthropic_request_converts_system_and_image() {
        let body = json!({
            "messages": [
                {"role":"system","content":"系统提示"},
                {"role":"user","content":[
                    {"type":"text","text":"看图"},
                    {"type":"image_url","image_url":{"url":"data:image/png;base64,AAAA"}}
                ]}
            ],
            "max_tokens": 2048,
            "temperature": 0.3
        });
        let req = anthropic_request(&body, "claude-sonnet-4-5", false);
        assert_eq!(req["system"], "系统提示");
        assert_eq!(req["messages"][0]["content"][0]["type"], "text");
        assert_eq!(req["messages"][0]["content"][1]["type"], "image");
        assert_eq!(req["messages"][0]["content"][1]["source"]["media_type"], "image/png");
        assert_eq!(req["messages"][0]["content"][1]["source"]["data"], "AAAA");
        assert_eq!(req["temperature"], 0.3);
        assert!(req.get("thinking").is_none());
    }

    #[test]
    fn anthropic_thinking_uses_budget_and_temperature_one() {
        let body = json!({"messages":[{"role":"user","content":"hi"}],"max_tokens":1024});
        let req = anthropic_request(&body, "claude-sonnet-4-5", true);
        assert_eq!(req["thinking"]["type"], "enabled");
        assert_eq!(req["thinking"]["budget_tokens"], 2048);
        assert_eq!(req["temperature"], 1.0);
        assert_eq!(req["max_tokens"], 4096);
    }
}
