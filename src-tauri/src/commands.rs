use crate::ai;
use crate::db::{self, now, put_setting, Db};
use crate::grading;
use crate::models::*;
use crate::repo;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::fs;
use tauri::State;

type R<T> = Result<T, String>;

fn lock<'a>(state: &'a State<'_, Db>) -> std::sync::MutexGuard<'a, rusqlite::Connection> {
    state.conn.lock().unwrap()
}

#[tauri::command]
pub fn list_sets(state: State<'_, Db>) -> R<Vec<SetSummary>> {
    let conn = lock(&state);
    repo::list_set_summaries(&conn)
}

#[tauri::command]
pub fn get_set(state: State<'_, Db>, set_id: Option<i64>) -> R<SetDetail> {
    let conn = lock(&state);
    repo::get_set_detail(&conn, set_id)
}

#[tauri::command]
pub fn list_bank(state: State<'_, Db>, filters: BankFilters) -> R<BankResult> {
    let conn = lock(&state);
    repo::list_bank(&conn, &filters)
}

#[tauri::command]
pub fn create_attempt(state: State<'_, Db>, set_id: Option<i64>, question_ids: Option<Vec<i64>>, mode: Option<String>, title: Option<String>, time_limit: Option<i64>) -> R<i64> {
    let conn = lock(&state);
    let ids: Vec<i64> = match question_ids {
        Some(v) if !v.is_empty() => v,
        _ => {
            let sid = set_id.ok_or("至少选一道题。")?;
            let mut stmt = conn.prepare("SELECT id FROM questions WHERE set_id=? ORDER BY position,number").map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![sid], |r| r.get(0)).map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<i64>, _>>().map_err(|e| e.to_string())?
        }
    };
    if ids.is_empty() { return Err("至少选一道题。".into()); }
    let title = title.unwrap_or_else(|| {
        set_id.and_then(|sid| conn.query_row("SELECT title FROM sets WHERE id=?", params![sid], |r| r.get::<_, String>(0)).ok()).unwrap_or_else(|| "自选题".into())
    });
    let max_score = {
        let mut stmt = conn.prepare("SELECT COALESCE(SUM(points),0) FROM questions WHERE id IN (SELECT value FROM json_each(?))").map_err(|e| e.to_string())?;
        stmt.query_row(params![serde_json::to_string(&ids).unwrap()], |r| r.get::<_, i64>(0)).map_err(|e| e.to_string())?
    };
    conn.execute(
        "INSERT INTO attempts(set_id,title,mode,status,started_at,time_limit,total_score,max_score,question_ids_json,paper_answers_json) VALUES(?,?,?, 'in_progress',?,?,0,?,?,'{}')",
        params![set_id, title, mode.unwrap_or_else(|| "custom".into()), now(), time_limit.unwrap_or(0), max_score, serde_json::to_string(&ids).unwrap()],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

/* 同一份试卷如果还有没交卷的整卷练习，就直接接着做，避免每次进页面都新建一条空记录。 */
#[tauri::command]
pub fn resume_attempt(state: State<'_, Db>, set_id: i64) -> R<Option<i64>> {
    let conn = lock(&state);
    conn.query_row(
        "SELECT id FROM attempts WHERE status='in_progress' AND set_id=? ORDER BY id DESC LIMIT 1",
        params![set_id],
        |r| r.get::<_, i64>(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_attempt(state: State<'_, Db>, attempt_id: i64) -> R<AttemptDetail> {
    let conn = lock(&state);
    repo::get_attempt_detail(&conn, attempt_id)
}

#[tauri::command]
pub fn save_answer(state: State<'_, Db>, attempt_id: i64, question_id: i64, raw: String) -> R<()> {
    let conn = lock(&state);
    let points: i64 = conn.query_row("SELECT points FROM questions WHERE id=?", params![question_id], |r| r.get(0)).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO answers(attempt_id,question_id,raw,is_correct,score,max_score,graded_by,updated_at) VALUES(?,?,?,NULL,0,?,'auto',?)
         ON CONFLICT(attempt_id,question_id) DO UPDATE SET raw=excluded.raw, updated_at=excluded.updated_at",
        params![attempt_id, question_id, raw, points, now()],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn submit_attempt(state: State<'_, Db>, attempt_id: i64) -> R<i64> {
    let conn = lock(&state);
    let detail = repo::get_attempt_detail(&conn, attempt_id)?;
    let mut total = 0i64;
    for aq in &detail.questions {
        let g = grading::grade_one(&aq.question, &aq.answer_raw);
        total += g.score;
        conn.execute(
            "INSERT INTO answers(attempt_id,question_id,raw,is_correct,score,max_score,graded_by,updated_at) VALUES(?,?,?,?,?,?,?,?)
             ON CONFLICT(attempt_id,question_id) DO UPDATE SET raw=excluded.raw,is_correct=excluded.is_correct,score=excluded.score,max_score=excluded.max_score,graded_by=excluded.graded_by,updated_at=excluded.updated_at",
            params![attempt_id, aq.question.id, aq.answer_raw, g.is_correct, g.score, aq.question.points, g.graded_by, now()],
        ).map_err(|e| e.to_string())?;
    }
    conn.execute("UPDATE attempts SET status='submitted',finished_at=?,total_score=? WHERE id=?", params![now(), total, attempt_id]).map_err(|e| e.to_string())?;
    Ok(attempt_id)
}

#[tauri::command]
pub fn self_grade(state: State<'_, Db>, attempt_id: i64, question_id: i64, score: i64) -> R<()> {
    let conn = lock(&state);
    let max: i64 = conn.query_row("SELECT points FROM questions WHERE id=?", params![question_id], |r| r.get(0)).map_err(|e| e.to_string())?;
    let score = score.clamp(0, max);
    conn.execute(
        "UPDATE answers SET score=?,is_correct=?,graded_by='self',updated_at=? WHERE attempt_id=? AND question_id=?",
        params![score, if score >= max { 1 } else { 0 }, now(), attempt_id, question_id],
    ).map_err(|e| e.to_string())?;
    let total: i64 = conn.query_row("SELECT COALESCE(SUM(score),0) FROM answers WHERE attempt_id=?", params![attempt_id], |r| r.get(0)).map_err(|e| e.to_string())?;
    conn.execute("UPDATE attempts SET total_score=? WHERE id=?", params![total, attempt_id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_records(state: State<'_, Db>, from: Option<String>, to: Option<String>) -> R<Vec<AttemptSummary>> {
    let conn = lock(&state);
    repo::list_records(&conn, from, to)
}

#[tauri::command]
pub fn delete_attempt(state: State<'_, Db>, attempt_id: i64) -> R<()> {
    let conn = lock(&state);
    conn.execute("DELETE FROM answers WHERE attempt_id=?", params![attempt_id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM attempts WHERE id=?", params![attempt_id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_mistakes(state: State<'_, Db>) -> R<Vec<Mistake>> {
    let conn = lock(&state);
    repo::list_mistakes(&conn)
}

#[tauri::command]
pub fn collect_mistakes(state: State<'_, Db>, question_ids: Vec<i64>, origin: Option<String>) -> R<()> {
    let conn = lock(&state);
    for id in question_ids {
        repo::add_mistake(&conn, id, origin.as_deref().unwrap_or("manual"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_mistake_status(state: State<'_, Db>, mistake_id: i64, status: String) -> R<()> {
    let conn = lock(&state);
    let streak = if status == "mastered" { 2 } else { 0 };
    conn.execute("UPDATE mistakes SET status=?,correct_streak=MAX(correct_streak,?) WHERE id=?", params![status, streak, mistake_id]).map_err(|e| e.to_string())?;
    Ok(())
}

fn setting(conn: &rusqlite::Connection, key: &str, default: &str) -> String {
    db::get_setting(conn, key).unwrap_or_else(|| default.to_string())
}

/// 读取 API Key，兼容旧版本使用的 deepseek_api_key。
fn api_key(conn: &rusqlite::Connection) -> String {
    let current = setting(conn, "api_key", "");
    if current.trim().is_empty() { setting(conn, "deepseek_api_key", "") } else { current }
}

#[tauri::command]
pub fn get_settings(state: State<'_, Db>) -> R<AppSettings> {
    let conn = lock(&state);
    let presets: Vec<i64> = serde_json::from_str(&setting(&conn, "timer_presets", "[30,60,90,130]")).unwrap_or_else(|_| vec![30, 60, 90, 130]);
    Ok(AppSettings {
        model: setting(&conn, "model", ""),
        base_url: setting(&conn, "base_url", ""),
        thinking: setting(&conn, "thinking", "0") == "1",
        has_api_key: !api_key(&conn).trim().is_empty(),
        custom_prompt: setting(&conn, "custom_prompt", ""),
        timer_presets: presets,
        default_timer: setting(&conn, "default_timer", "0").parse().unwrap_or(0),
        accent: setting(&conn, "accent", "violet"),
        theme: setting(&conn, "theme", "system"),
        vision_model: setting(&conn, "vision_model", ""),
        vision_base_url: setting(&conn, "vision_base_url", ""),
    })
}

#[tauri::command]
pub fn save_settings(state: State<'_, Db>, settings: Value) -> R<AppSettings> {
    let conn = lock(&state);
    let obj = settings.as_object().ok_or("settings 必须是对象")?;
    for (k, v) in obj {
        let key = match k.as_str() {
            "apiKey" => "api_key",
            "clearKey" => continue,
            "base_url" => "base_url",
            "custom_prompt" => "custom_prompt",
            "timer_presets" => "timer_presets",
            "default_timer" => "default_timer",
            "accent" => "accent",
            "theme" => "theme",
            "thinking" => "thinking",
            "model" => "model",
            "vision_model" => "vision_model",
            "vision_base_url" => "vision_base_url",
            _ => continue,
        };
        let text = match v {
            Value::String(s) => s.clone(),
            Value::Bool(b) => if *b { "1".into() } else { "0".into() },
            Value::Number(n) => n.to_string(),
            Value::Array(a) => serde_json::to_string(a).unwrap_or_default(),
            _ => continue,
        };
        if key != "api_key" || !text.is_empty() {
            put_setting(&conn, key, &text);
        }
    }
    if obj.get("clearKey").and_then(|v| v.as_bool()).unwrap_or(false) {
        put_setting(&conn, "api_key", "");
        put_setting(&conn, "deepseek_api_key", "");
    }
    drop(conn);
    get_settings(state)
}

fn is_local_base(base: &str) -> bool {
    ["127.0.0.1", "localhost", "0.0.0.0", "[::1]"].iter().any(|h| base.contains(h))
}

/// 临时配置优先（设置页未保存的表单值），空字段回退到已保存设置。
/// Key 只在本次调用中使用，不写数据库，也不出现在日志里。
fn resolve_ai_config(conn: &rusqlite::Connection, cfg: Option<&AiConfigInput>) -> (String, String, String, bool) {
    let base = cfg
        .map(|c| c.base_url.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| setting(conn, "base_url", ""));
    let model = cfg
        .map(|c| c.model.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| setting(conn, "model", ""));
    let key = cfg
        .and_then(|c| c.api_key.clone())
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .unwrap_or_else(|| api_key(conn));
    let thinking = cfg
        .and_then(|c| c.thinking)
        .unwrap_or_else(|| setting(conn, "thinking", "0") == "1");
    (key, base, model, thinking)
}

/// 测试连接：只用配置本身发一句最短的请求，不依赖题库里有没有题目。
/// 成功会返回实际模型名和耗时；失败把服务端原文带回设置页，避免只显示“测试失败”。
#[tauri::command]
pub async fn ai_test(state: State<'_, Db>, config: AiConfigInput, kind: Option<String>) -> R<AiTestResult> {
    let (key, base, model, thinking) = {
        let conn = lock(&state);
        resolve_ai_config(&conn, Some(&config))
    };
    if base.trim().is_empty() || model.trim().is_empty() {
        return Err("请先填写 API 地址和模型名。".into());
    }
    if key.trim().is_empty() && !is_local_base(&base) {
        return Err("还没有填写 API Key。".into());
    }
    let started = std::time::Instant::now();
    let result = if kind.as_deref() == Some("vision") {
        ai::vision_test(&key, &base, &model, thinking).await?
    } else {
        ai::complete("你是连接测试助手。只回复 OK，不要解释。", "请回复 OK。", &key, &base, &model, thinking).await?
    };
    Ok(AiTestResult {
        ok: true,
        model: result.model,
        elapsed_ms: started.elapsed().as_millis() as i64,
        message: if result.content.trim().is_empty() { "连接成功".into() } else { result.content.trim().chars().take(80).collect() },
    })
}

/// 通用补全：导入材料清洗、标签整理等场景直接复用已保存的 AI 配置。
#[tauri::command]
pub async fn ai_complete(state: State<'_, Db>, system: String, user: String, config: Option<AiConfigInput>) -> R<AiResult> {
    if user.trim().is_empty() {
        return Err("没有要发送给 AI 的内容。".into());
    }
    let (key, base, model, thinking) = {
        let conn = lock(&state);
        resolve_ai_config(&conn, config.as_ref())
    };
    if base.trim().is_empty() || model.trim().is_empty() {
        return Err("未配置 AI 服务，请先到设置页填写 API 地址与模型。".into());
    }
    if key.trim().is_empty() && !is_local_base(&base) {
        return Err("还没有配置 API Key，请先到设置页填写。".into());
    }
    ai::complete(&system, &user, &key, &base, &model, thinking).await
}

#[tauri::command]
pub async fn ai_explain(state: State<'_, Db>, question_id: i64, mode: Option<String>, custom_prompt: Option<String>, followup: Option<String>, thinking: Option<bool>) -> R<AiResult> {
    let (question, key, base, model, prompt_setting, req_thinking) = {
        let conn = lock(&state);
        let q = repo::question_by_id(&conn, question_id)?;
        let key = api_key(&conn);
        let base = setting(&conn, "base_url", "");
        let model = setting(&conn, "model", "");
        let prompt = setting(&conn, "custom_prompt", "");
        let th = thinking.unwrap_or_else(|| setting(&conn, "thinking", "0") == "1");
        (q, key, base, model, prompt, th)
    };
    if base.trim().is_empty() || model.trim().is_empty() {
        return Err("未配置 AI 服务，请先到设置页选择服务并填写 API 地址与模型。".into());
    }
    let local = ["127.0.0.1", "localhost", "0.0.0.0", "[::1]"].iter().any(|h| base.contains(h));
    if key.trim().is_empty() && !local {
        return Err("还没有配置 API Key，请先到设置页填写。".into());
    }
    let mode = mode.unwrap_or_else(|| "explain".into());
    let custom = custom_prompt.unwrap_or(prompt_setting);
    let content = ai::explain(&question, &mode, &custom, followup.as_deref(), &key, &base, &model, req_thinking).await?;
    Ok(content)
}

/// 多模态自动分图：把页面图片和题目清单交给视觉模型，返回原始 JSON 文本。
/// 返回内容由前端做宽松解析，兼容不同模型对 bbox/题号的写法。
#[tauri::command]
pub async fn ai_vision_segment(state: State<'_, Db>, pages: Vec<String>, questions: Vec<VisionQuestion>) -> R<AiResult> {
    if pages.is_empty() {
        return Err("没有可分析的页面，请先选择 PDF 或图片。".into());
    }
    if pages.len() > 20 {
        return Err("一次最多分析 20 页，请分批处理。".into());
    }
    if questions.is_empty() {
        return Err("这份试卷还没有题目。".into());
    }
    let (key, base, model) = {
        let conn = lock(&state);
        let key = api_key(&conn);
        let vision_base = setting(&conn, "vision_base_url", "");
        let vision_model = setting(&conn, "vision_model", "");
        let base = if vision_base.trim().is_empty() { setting(&conn, "base_url", "") } else { vision_base };
        let model = if vision_model.trim().is_empty() { setting(&conn, "model", "") } else { vision_model };
        (key, base, model)
    };
    if base.trim().is_empty() || model.trim().is_empty() {
        return Err("未配置视觉模型。请到设置页填写「多模态模型」和端点，或沿用上面的 AI 服务。".into());
    }
    let local = ["127.0.0.1", "localhost", "0.0.0.0", "[::1]"].iter().any(|h| base.contains(h));
    if key.trim().is_empty() && !local {
        return Err("还没有配置 API Key，请先到设置页填写。".into());
    }
    ai::vision_segment(&pages, &questions, &key, &base, &model).await
}

#[tauri::command]
pub async fn ai_vision_ocr(state: State<'_, Db>, pages: Vec<String>) -> R<AiResult> {
    if pages.is_empty() {
        return Err("没有可识别的页面，请先选择 PDF 或图片。".into());
    }
    if pages.len() > 8 {
        return Err("单次最多识别 8 页，请分批处理。".into());
    }
    let (key, base, model) = {
        let conn = lock(&state);
        let key = api_key(&conn);
        let vision_base = setting(&conn, "vision_base_url", "");
        let vision_model = setting(&conn, "vision_model", "");
        let base = if vision_base.trim().is_empty() { setting(&conn, "base_url", "") } else { vision_base };
        let model = if vision_model.trim().is_empty() { setting(&conn, "model", "") } else { vision_model };
        (key, base, model)
    };
    if base.trim().is_empty() || model.trim().is_empty() {
        return Err("未配置视觉模型。请到设置页填写「多模态模型」和端点，或沿用上面的 AI 服务。".into());
    }
    let local = ["127.0.0.1", "localhost", "0.0.0.0", "[::1]"].iter().any(|h| base.contains(h));
    if key.trim().is_empty() && !local {
        return Err("还没有配置 API Key，请先到设置页填写。".into());
    }
    ai::vision_ocr(&pages, &key, &base, &model).await
}

fn ai_object(raw: &str) -> R<Value> {
    let start = raw.find('{').ok_or("AI 没有返回 JSON 对象。")?;
    let end = raw.rfind('}').ok_or("AI 返回的 JSON 不完整。")?;
    if end <= start {
        return Err("AI 返回的 JSON 不完整。".into());
    }
    serde_json::from_str(&raw[start..=end]).map_err(|e| format!("AI 返回的 JSON 无法解析：{e}"))
}

/// 把 AI 给的分值缩放成目标总分。浮点只用于比例，最终仍是整数。
fn normalize_score_plan(items: &mut [ScoreItem], total: i64) -> R<()> {
    if items.is_empty() {
        return Err("没有可分配分值的题目。".into());
    }
    let n = items.len() as i64;
    let sum: i64 = items.iter().map(|i| i.points.max(0)).sum();
    if sum == total {
        return Ok(());
    }
    if sum <= 0 {
        let base = total / n;
        let mut remain = total - base * n;
        for item in items.iter_mut() {
            item.points = base + if remain > 0 { 1 } else { 0 };
            remain -= 1;
        }
        return Ok(());
    }
    for item in items.iter_mut() {
        item.points = ((item.points.max(0) as f64) * (total as f64) / (sum as f64)).floor() as i64;
    }
    let mut remain = total - items.iter().map(|i| i.points).sum::<i64>();
    let mut index = 0usize;
    while remain > 0 {
        items[index % items.len()].points += 1;
        remain -= 1;
        index += 1;
    }
    Ok(())
}

/// 让 AI 按指定总分给整份试卷分配每题分值。
/// 返回结构化结果，用户确认后再调用 apply_score_plan 落库。
#[tauri::command]
pub async fn ai_plan_scores(state: State<'_, Db>, set_id: i64, total: i64, instructions: Option<String>) -> R<ScorePlanResult> {
    if !(1..=10000).contains(&total) {
        return Err("目标总分需要在 1 到 10000 之间。".into());
    }
    let (set_title, questions, key, base, model, thinking) = {
        let conn = lock(&state);
        let detail = repo::get_set_detail(&conn, Some(set_id))?;
        let (key, base, model, thinking) = resolve_ai_config(&conn, None);
        (detail.summary.title, detail.questions, key, base, model, thinking)
    };
    if questions.is_empty() {
        return Err("这份试卷还没有题目。".into());
    }
    if base.trim().is_empty() || model.trim().is_empty() {
        return Err("未配置 AI 服务，请先到设置页填写 API 地址与模型。".into());
    }
    if key.trim().is_empty() && !is_local_base(&base) {
        return Err("还没有配置 API Key，请先到设置页填写。".into());
    }
    let mut list = String::new();
    for q in &questions {
        let stem = q.stem.chars().take(300).collect::<String>().replace(['\n', '\r'], " ");
        list.push_str(&format!(
            "- number={} label={} 题型={} 当前分值={} 题干={}\n",
            q.number, q.label, q.qtype, q.points, stem
        ));
    }
    let extra = instructions.unwrap_or_default();
    let user = format!(
        "试卷：{set_title}\n目标总分：{total} 分。共 {} 道题。\n\
         请按题型、难度和题量把总分分配到每一道题；所有题目分值之和必须正好等于 {total}。\n\
         题型参考：单选/多选通常 3-6 分，填空 2-5 分，简答/写作按工作量给更高分值；不要给 0 分。\n\
         只能使用下面列出的 number，不要新增、合并或遗漏题目。\n\
         {}{}\n\
         只输出 JSON，格式：{{\"items\":[{{\"number\":1,\"points\":5,\"reason\":\"简短理由\"}}]}}\n\n题目清单：\n{list}",
        questions.len(),
        if extra.trim().is_empty() { String::new() } else { format!("用户补充要求：{}\n", extra.trim()) },
        ""
    );
    let result = ai::complete(
        "你是考试命题与评分助手。你只输出 JSON，不输出解释或 Markdown。分值必须是正整数或 0，且总和严格等于用户要求的总分。",
        &user,
        &key,
        &base,
        &model,
        thinking,
    )
    .await?;
    let value = ai_object(&result.content)?;
    let arr = value
        .get("items")
        .or_else(|| value.get("scores"))
        .or_else(|| value.get("questions"))
        .and_then(Value::as_array)
        .ok_or("AI 没有返回 items 数组。")?;
    let mut items: Vec<ScoreItem> = Vec::new();
    for it in arr {
        let number = import_i64(it, &["number", "no", "题号", "label"], -1);
        let points = import_i64(it, &["points", "score", "分值"], -1);
        if number < 0 || points < 0 {
            continue;
        }
        let reason = import_text(it, &["reason", "why", "理由", "说明"]);
        items.push(ScoreItem { number, points: points.min(10000), reason });
    }
    if items.is_empty() {
        return Err("AI 没有返回可用的分值分配，请重试。".into());
    }
    let mut wanted: Vec<i64> = questions.iter().map(|q| q.number).collect();
    wanted.sort_unstable();
    wanted.dedup();
    let mut got: Vec<i64> = items.iter().map(|i| i.number).collect();
    got.sort_unstable();
    got.dedup();
    if wanted != got {
        let missing: Vec<String> = wanted.iter().filter(|n| !got.contains(n)).map(|n| n.to_string()).collect();
        let extra: Vec<String> = got.iter().filter(|n| !wanted.contains(n)).map(|n| n.to_string()).collect();
        return Err(format!(
            "AI 分配的题号与试卷不一致（缺 {}，多 {}），请重试。",
            if missing.is_empty() { "无".into() } else { missing.join("、") },
            if extra.is_empty() { "无".into() } else { extra.join("、") }
        ));
    }
    let before: i64 = items.iter().map(|i| i.points).sum();
    normalize_score_plan(&mut items, total)?;
    let allocated: i64 = items.iter().map(|i| i.points).sum();
    let note = if before == total {
        "分值合计与目标总分一致。".into()
    } else {
        format!("AI 原始合计 {before} 分，已按目标总分等比调整为 {allocated} 分。")
    };
    Ok(ScorePlanResult { total, allocated, items, model: result.model, note })
}

/// 把用户确认过的分值写回题库，并同步进行中的练习总分。
#[tauri::command]
pub fn apply_score_plan(state: State<'_, Db>, set_id: i64, items: Vec<ScoreItem>) -> R<SetSummary> {
    if items.is_empty() {
        return Err("没有要应用的分值。".into());
    }
    let mut conn = lock(&state);
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for item in &items {
        let updated = tx
            .execute(
                "UPDATE questions SET points=? WHERE set_id=? AND number=?",
                params![item.points.max(0), set_id, item.number],
            )
            .map_err(|e| e.to_string())?;
        if updated == 0 {
            return Err(format!("试卷里找不到题号 {}，分值未写入。", item.number));
        }
    }
    // 进行中的练习还保留着旧分值，必须一起改，否则答题卡与新分值会对不上。
    tx.execute(
        "UPDATE answers SET max_score=COALESCE((SELECT points FROM questions q WHERE q.id=answers.question_id), max_score)
         WHERE attempt_id IN (SELECT id FROM attempts WHERE set_id=? AND status='in_progress')",
        params![set_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE answers SET score=max_score
         WHERE attempt_id IN (SELECT id FROM attempts WHERE set_id=? AND status='in_progress') AND score > max_score",
        params![set_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE attempts SET
           max_score=(SELECT COALESCE(SUM(q.points),0) FROM questions q WHERE q.id IN (SELECT value FROM json_each(attempts.question_ids_json))),
           total_score=(SELECT COALESCE(SUM(score),0) FROM answers WHERE attempt_id=attempts.id)
         WHERE set_id=? AND status='in_progress'",
        params![set_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    repo::set_summary(&conn, Some(set_id))
}

/// AI 判主观题：只处理已作答的主观题，按参考答案与评分点给分并写评语。
/// 选择题/填空/完形仍由本地 grading.rs 自动判分，避免 AI 改坏客观题结果。
#[tauri::command]
pub async fn ai_grade_attempt(state: State<'_, Db>, attempt_id: i64, only_pending: Option<bool>) -> R<GradeAttemptResult> {
    let only_pending = only_pending.unwrap_or(true);
    let (detail, key, base, model, thinking) = {
        let conn = lock(&state);
        let detail = repo::get_attempt_detail(&conn, attempt_id)?;
        let (key, base, model, thinking) = resolve_ai_config(&conn, None);
        (detail, key, base, model, thinking)
    };
    if base.trim().is_empty() || model.trim().is_empty() {
        return Err("未配置 AI 服务，请先到设置页填写 API 地址与模型。".into());
    }
    if key.trim().is_empty() && !is_local_base(&base) {
        return Err("还没有配置 API Key，请先到设置页填写。".into());
    }
    let targets: Vec<&AttemptQuestion> = detail
        .questions
        .iter()
        .filter(|aq| {
            let raw = aq.answer_raw.trim();
            if raw.is_empty() {
                return false;
            }
            let subjective = matches!(aq.question.qtype.as_str(), "short_answer" | "writing" | "dictation");
            let pending = aq.is_correct.is_none() || aq.graded_by.as_deref() == Some("pending");
            if only_pending {
                pending && (subjective || aq.graded_by.as_deref() == Some("pending"))
            } else {
                subjective || pending
            }
        })
        .collect();
    if targets.is_empty() {
        return Err(if only_pending {
            "没有待判的主观题。客观题已自动判分，需要重判时再点「AI 判卷」。".into()
        } else {
            "这次练习没有可判的主观题。".into()
        });
    }
    if targets.len() > 60 {
        return Err("一次最多判 60 道主观题，请减少题量后重试。".into());
    }
    let payload: Vec<Value> = targets
        .iter()
        .map(|aq| {
            let reference = serde_json::to_string(&aq.question.answer).unwrap_or_default();
            json!({
                "number": aq.question.number,
                "label": aq.question.label,
                "qtype": aq.question.qtype,
                "points": aq.question.points,
                "stem": aq.question.stem.chars().take(2000).collect::<String>(),
                "reference": reference.chars().take(2400).collect::<String>(),
                "explanation": aq.question.explanation.chars().take(1200).collect::<String>(),
                "student_answer": aq.answer_raw.chars().take(4000).collect::<String>(),
            })
        })
        .collect();
    let user = format!(
        "试卷：{}\n请逐题判分。分数必须是 0 到该题满分之间的整数；按参考答案和评分点给分，允许部分分。\n\
         评语用简体中文，60 字内，指出得分点和最需要改的一处，不要重复题干。\n\
         题号必须使用输入里的 number，不要漏题。\n\
         只输出 JSON：{{\"items\":[{{\"number\":1,\"score\":3,\"comment\":\"...\"}}]}}\n\n题目与作答：\n{}",
        detail.summary.title,
        serde_json::to_string_pretty(&payload).unwrap_or_default()
    );
    let result = ai::complete(
        "你是严格但公平的阅卷老师。只输出 JSON，不输出 Markdown 或解释。你必须按参考答案判分，不能因为字迹或表达偏好随意扣分。",
        &user,
        &key,
        &base,
        &model,
        thinking,
    )
    .await?;
    let value = ai_object(&result.content)?;
    let arr = value
        .get("items")
        .or_else(|| value.get("scores"))
        .or_else(|| value.get("questions"))
        .and_then(Value::as_array)
        .ok_or("AI 没有返回 items 数组。")?;
    let mut grades: std::collections::HashMap<i64, (i64, String)> = std::collections::HashMap::new();
    for it in arr {
        let number = import_i64(it, &["number", "no", "题号", "label"], -1);
        let score = import_i64(it, &["score", "points", "得分"], -1);
        if number < 0 || score < 0 {
            continue;
        }
        let comment = import_text(it, &["comment", "comments", "reason", "评语", "反馈"]);
        grades.insert(number, (score, comment.chars().take(500).collect()));
    }
    if grades.is_empty() {
        return Err("AI 没有返回可用的判分结果，请重试。".into());
    }
    let mut conn = lock(&state);
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut items: Vec<GradeItemResult> = Vec::new();
    let mut missing: Vec<i64> = Vec::new();
    for aq in &targets {
        let Some((raw_score, comment)) = grades.get(&aq.question.number).cloned() else {
            missing.push(aq.question.number);
            continue;
        };
        let max_score = aq.question.points.max(1);
        let score = raw_score.clamp(0, max_score);
        let is_correct = if score >= max_score { 1 } else { 0 };
        tx.execute(
            "INSERT INTO answers(attempt_id,question_id,raw,is_correct,score,max_score,graded_by,comment,updated_at)
             VALUES(?,?,?,?,?,?, 'ai', ?,?)
             ON CONFLICT(attempt_id,question_id) DO UPDATE SET score=excluded.score,is_correct=excluded.is_correct,max_score=excluded.max_score,graded_by='ai',comment=excluded.comment,updated_at=excluded.updated_at",
            params![attempt_id, aq.question.id, aq.answer_raw, is_correct, score, max_score, comment, now()],
        )
        .map_err(|e| e.to_string())?;
        items.push(GradeItemResult {
            question_id: aq.question.id,
            number: aq.question.number,
            label: aq.question.label.clone(),
            score,
            max_score,
            comment,
        });
    }
    if items.is_empty() {
        return Err("AI 返回的题号与这次练习不匹配，没有写入分数。".into());
    }
    let (total_score, max_score): (i64, i64) = tx
        .query_row(
            "SELECT
               (SELECT COALESCE(SUM(score),0) FROM answers WHERE attempt_id=?1),
               (SELECT COALESCE(SUM(q.points),0) FROM questions q
                 WHERE q.id IN (SELECT value FROM json_each(
                   (SELECT question_ids_json FROM attempts WHERE id=?1))))",
            params![attempt_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    tx.execute("UPDATE attempts SET total_score=?,max_score=? WHERE id=?", params![total_score, max_score, attempt_id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(GradeAttemptResult {
        attempt_id,
        graded: items.len() as i64,
        total_score,
        max_score,
        model: result.model,
        items,
        missing,
    })
}

#[tauri::command]
pub fn ai_classify(state: State<'_, Db>, question_ids: Vec<i64>, instruction: Option<String>) -> R<Vec<ClassifyItem>> {
    let conn = lock(&state);
    let want = instruction.unwrap_or_default();
    let mut out = vec![];
    for id in question_ids.iter().take(200) {
        if let Ok(q) = repo::question_by_id(&conn, *id) {
            out.push(ClassifyItem {
                question_id: q.id, number: q.number, stem: q.stem.clone(), current_type: q.qtype.clone(),
                proposed_type: q.qtype.clone(), proposed_tags: q.tags.clone(), duplicate_group: None,
                reason: if want.is_empty() { "本地规则：保持原题型，可手动修改后应用。".into() } else { format!("本地规则预览（AI 整理需在设置里配置 Key）：{want}") },
            });
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn update_question(
    state: State<'_, Db>,
    question_id: i64,
    qtype: Option<String>,
    tags: Option<Vec<String>>,
    stem: Option<String>,
) -> R<()> {
    let conn = lock(&state);
    if let Some(qt) = qtype.filter(|s| !s.trim().is_empty()) {
        conn.execute("UPDATE questions SET qtype=? WHERE id=?", params![qt, question_id]).map_err(|e| e.to_string())?;
    }
    if let Some(t) = tags {
        conn.execute("UPDATE questions SET tags_json=? WHERE id=?", params![serde_json::to_string(&t).unwrap(), question_id]).map_err(|e| e.to_string())?;
    }
    if let Some(stem_html) = stem {
        if stem_html.len() > 8 * 1024 * 1024 {
            return Err("题图太大：单题题干请控制在 8 MB 以内。".into());
        }
        conn.execute("UPDATE questions SET stem=? WHERE id=?", params![stem_html, question_id]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_system_fonts() -> Vec<String> {
    crate::fonts::list_system_fonts()
}

#[tauri::command]
pub fn rename_set(state: State<'_, Db>, set_id: i64, title: String) -> R<SetSummary> {
    let conn = lock(&state);
    repo::update_set_title(&conn, set_id, &title)?;
    repo::set_summary(&conn, Some(set_id))
}

#[tauri::command]
pub fn update_set_tags(state: State<'_, Db>, set_id: i64, tags: Vec<String>) -> R<SetSummary> {
    let conn = lock(&state);
    repo::update_set_tags(&conn, set_id, &tags)?;
    repo::set_summary(&conn, Some(set_id))
}

/// 删除整份试卷：连同它的练习记录、答案、错题和导入批次一起清掉。
/// 只能在事务里执行；任何一步失败都回滚，避免留下半份试卷。
#[tauri::command]
pub fn delete_set(state: State<'_, Db>, set_id: i64) -> R<()> {
    let mut conn = lock(&state);
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM answers WHERE attempt_id IN (SELECT id FROM attempts WHERE set_id=?)",
        params![set_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM attempts WHERE set_id=?", params![set_id]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM import_batches WHERE set_id=?", params![set_id]).map_err(|e| e.to_string())?;
    let removed = tx.execute("DELETE FROM sets WHERE id=?", params![set_id]).map_err(|e| e.to_string())?;
    if removed == 0 {
        return Err("试卷不存在，可能已经被删除。".into());
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_tags(state: State<'_, Db>) -> R<Vec<TagInfo>> {
    let conn = lock(&state);
    repo::list_tags(&conn)
}

fn strip_tag(json: &str, tag: &str) -> String {
    let mut tags: Vec<String> = serde_json::from_str(json).unwrap_or_default();
    tags.retain(|t| t != tag);
    serde_json::to_string(&tags).unwrap_or_else(|_| "[]".into())
}

/// 删除标签：同时清掉 sets/questions 的 tags_json 与 tag_assignments。
/// 这里按行读取再写回，兼容旧库里可能出现的非标准 JSON 数组。
#[tauri::command]
pub fn delete_tag(state: State<'_, Db>, tag: String) -> R<()> {
    let tag = tag.trim();
    if tag.is_empty() {
        return Err("标签不能为空。".into());
    }
    let mut conn = lock(&state);
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM tag_assignments WHERE tag=?", params![tag])
        .map_err(|e| e.to_string())?;
    for table in ["sets", "questions"] {
        let rows: Vec<(i64, String)> = {
            let mut stmt = tx
                .prepare(&format!("SELECT id,tags_json FROM {table}"))
                .map_err(|e| e.to_string())?;
            let mapped = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get::<_, String>(1)?)))
                .map_err(|e| e.to_string())?;
            mapped.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };
        for (id, json) in rows {
            let next = strip_tag(&json, tag);
            if next != json {
                tx.execute(&format!("UPDATE {table} SET tags_json=? WHERE id=?"), params![next, id])
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_tag_groups(state: State<'_, Db>) -> R<Vec<TagGroup>> {
    let conn = lock(&state);
    repo::list_tag_groups(&conn)
}

#[tauri::command]
pub fn create_tag_group(state: State<'_, Db>, name: String, color: Option<String>) -> R<i64> {
    let conn = lock(&state);
    let name = name.trim();
    if name.is_empty() {
        return Err("标签栏名称不能为空。".into());
    }
    let exists: Option<i64> = conn
        .query_row("SELECT id FROM tag_groups WHERE name=?", params![name], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if exists.is_some() {
        return Err(format!("标签栏「{name}」已经存在。"));
    }
    let color = color.map(|c| c.trim().to_string()).filter(|c| !c.is_empty()).unwrap_or_else(|| "violet".into());
    conn.execute(
        "INSERT INTO tag_groups(name,color,position,created_at) VALUES(?,?,(SELECT COALESCE(MAX(position),0)+1 FROM tag_groups),?)",
        params![name, color, now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn rename_tag_group(state: State<'_, Db>, group_id: i64, name: String, color: Option<String>) -> R<()> {
    let conn = lock(&state);
    let name = name.trim();
    if name.is_empty() {
        return Err("标签栏名称不能为空。".into());
    }
    let conflict: Option<i64> = conn
        .query_row("SELECT id FROM tag_groups WHERE name=? AND id<>?", params![name, group_id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if conflict.is_some() {
        return Err(format!("标签栏「{name}」已经存在。"));
    }
    conn.execute("UPDATE tag_groups SET name=? WHERE id=?", params![name, group_id]).map_err(|e| e.to_string())?;
    if let Some(color) = color.map(|c| c.trim().to_string()).filter(|c| !c.is_empty()) {
        conn.execute("UPDATE tag_groups SET color=? WHERE id=?", params![color, group_id]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_tag_group(state: State<'_, Db>, group_id: i64) -> R<()> {
    let conn = lock(&state);
    conn.execute("UPDATE tag_assignments SET group_id=NULL WHERE group_id=?", params![group_id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tag_groups WHERE id=?", params![group_id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn assign_tag_group(state: State<'_, Db>, tag: String, group_id: Option<i64>) -> R<()> {
    let conn = lock(&state);
    repo::set_tag_group(&conn, &tag, group_id)
}

#[tauri::command]
pub fn assign_tags_group(state: State<'_, Db>, tags: Vec<String>, group_id: Option<i64>) -> R<()> {
    let conn = lock(&state);
    for tag in tags {
        repo::set_tag_group(&conn, &tag, group_id)?;
    }
    Ok(())
}

fn json_object_in(text: &str) -> Option<Value> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    serde_json::from_str(&text[start..=end]).ok()
}

fn parse_tag_suggestions(content: &str, allowed_groups: &[String]) -> Vec<TagSuggestion> {
    let Some(v) = json_object_in(content) else { return vec![] };
    let allowed: std::collections::HashSet<&str> = allowed_groups.iter().map(String::as_str).collect();
    let mut out: Vec<TagSuggestion> = vec![];
    let mut push = |tag: &str, group: &str| {
        let tag = tag.trim();
        let group = group.trim();
        if tag.is_empty() || out.iter().any(|s| s.tag == tag) {
            return;
        }
        out.push(TagSuggestion {
            tag: tag.to_string(),
            group: if allowed.contains(group) { group.to_string() } else { String::new() },
        });
    };
    if let Some(items) = v.get("assignments").and_then(Value::as_array).or_else(|| v.get("items").and_then(Value::as_array)) {
        for item in items {
            let tag = item.get("tag").and_then(Value::as_str).unwrap_or("").trim();
            let group = item.get("group").and_then(Value::as_str).unwrap_or("").trim();
            push(tag, group);
        }
        return out;
    }
    if let Some(map) = v.as_object() {
        for (tag, group) in map {
            if let Some(group) = group.as_str() {
                push(tag, group);
            }
        }
    }
    out
}

#[tauri::command]
pub async fn ai_organize_tags(state: State<'_, Db>) -> R<Vec<TagSuggestion>> {
    let (tags, groups, key, base, model, thinking) = {
        let conn = lock(&state);
        let tags = repo::list_tags(&conn)?;
        let groups = repo::list_tag_groups(&conn)?;
        let (key, base, model, thinking) = resolve_ai_config(&conn, None);
        (tags, groups, key, base, model, thinking)
    };
    if tags.is_empty() {
        return Ok(vec![]);
    }
    if base.trim().is_empty() || model.trim().is_empty() {
        return Err("未配置 AI 服务，请先到设置页填写 API 地址与模型。".into());
    }
    if key.trim().is_empty() && !is_local_base(&base) {
        return Err("还没有配置 API Key，请先到设置页填写。".into());
    }
    let group_names = groups.iter().map(|g| g.name.clone()).collect::<Vec<_>>();
    let tag_lines = tags
        .iter()
        .map(|t| {
            let used = t.set_count + t.question_count;
            format!("- {}（出现 {} 次，当前：{}）", t.name, used, if t.group_name.is_empty() { "未归类" } else { &t.group_name })
        })
        .collect::<Vec<_>>()
        .join("\n");
    let example = r#"{"assignments":[{"tag":"数学","group":"学科"},{"tag":"真题","group":""}]}"#;
    let user = format!(
        "现有标签栏（只能使用这些栏目，不要新建）：{}\n\n待整理标签：\n{}\n\n请把每个标签归入最合适的一栏；不确定的留空表示未归类。只输出 JSON：\n{}",
        group_names.join(" / "),
        tag_lines,
        example
    );
    let system = "你是题库标签整理助手。你只做标签分类，不改变标签名，不新建标签栏。只输出 JSON，不要解释。";
    let result = ai::complete(system, &user, &key, &base, &model, thinking).await?;
    let mut suggestions = parse_tag_suggestions(&result.content, &group_names);
    /* 模型漏掉的标签也返回一条“未归类”，让预览完整可勾选。 */
    for tag in &tags {
        if !suggestions.iter().any(|s| s.tag == tag.name) {
            suggestions.push(TagSuggestion { tag: tag.name.clone(), group: String::new() });
        }
    }
    Ok(suggestions)
}

#[tauri::command]
pub fn apply_tag_suggestions(state: State<'_, Db>, items: Vec<TagSuggestion>) -> R<()> {
    let conn = lock(&state);
    for item in items {
        let group_id = if item.group.trim().is_empty() {
            None
        } else {
            repo::tag_group_id_by_name(&conn, &item.group)?
        };
        repo::set_tag_group(&conn, &item.tag, group_id)?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_folders(state: State<'_, Db>) -> R<Vec<Folder>> {
    let conn = lock(&state);
    repo::list_folders(&conn)
}

#[tauri::command]
pub fn create_folder(state: State<'_, Db>, name: String, parent_id: Option<i64>) -> R<i64> {
    let conn = lock(&state);
    conn.execute("INSERT INTO folders(name,parent_id,sort,created_at) VALUES(?,?,(SELECT COALESCE(MAX(sort),0)+1 FROM folders),?)", params![name.trim(), parent_id, now()]).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn rename_folder(state: State<'_, Db>, folder_id: i64, name: String) -> R<()> {
    let conn = lock(&state);
    conn.execute("UPDATE folders SET name=? WHERE id=?", params![name.trim(), folder_id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_folder(state: State<'_, Db>, folder_id: i64) -> R<()> {
    let conn = lock(&state);
    conn.execute("UPDATE folders SET parent_id=NULL WHERE parent_id=?", params![folder_id]).map_err(|e| e.to_string())?;
    conn.execute("UPDATE sets SET folder_id=NULL WHERE folder_id=?", params![folder_id]).map_err(|e| e.to_string())?;
    conn.execute("UPDATE questions SET folder_id=NULL WHERE folder_id=?", params![folder_id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM folders WHERE id=?", params![folder_id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn assign_folder(state: State<'_, Db>, folder_id: Option<i64>, set_id: Option<i64>, question_ids: Option<Vec<i64>>) -> R<()> {
    let conn = lock(&state);
    if let Some(sid) = set_id {
        conn.execute("UPDATE sets SET folder_id=? WHERE id=?", params![folder_id, sid]).map_err(|e| e.to_string())?;
    }
    if let Some(ids) = question_ids {
        for id in ids {
            conn.execute("UPDATE questions SET folder_id=? WHERE id=?", params![folder_id, id]).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn backup_now(state: State<'_, Db>) -> R<String> {
    let dir = state.data_dir.join("backups");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!("tokero-{}.db", chrono::Local::now().format("%Y%m%d-%H%M%S"));
    let target = dir.join(&name);
    let conn = lock(&state);
    conn.execute("VACUUM INTO ?", params![target.to_string_lossy().to_string()]).map_err(|e| e.to_string())?;
    Ok(name)
}

#[tauri::command]
pub fn restore_backup(state: State<'_, Db>, path: String) -> R<()> {
    let conn = lock(&state);
    let src = state.data_dir.join("backups").join(path);
    if !src.exists() { return Err("备份文件不存在。".into()); }
    conn.execute("ATTACH DATABASE ? AS bak", params![src.to_string_lossy().to_string()]).map_err(|e| e.to_string())?;
    for table in ["settings", "sets", "sections", "materials", "questions", "folders", "attempts", "answers", "mistakes", "ai_runs"] {
        let _ = conn.execute(&format!("DELETE FROM main.{table}"), []);
        let _ = conn.execute(&format!("INSERT INTO main.{table} SELECT * FROM bak.{table}"), []);
    }
    conn.execute("DETACH DATABASE bak", []).map_err(|e| e.to_string())?;
    Ok(())
}

struct ImportMaterial { key: String, title: String, content: String }
struct ImportSection { key: String, title: String, subtitle: String, kind: String, position: i64, material_key: Option<String> }
struct ImportQuestion {
    number: i64,
    label: String,
    qtype: String,
    stem: String,
    options: Vec<OptionItem>,
    answer: Value,
    explanation: String,
    points: i64,
    position: i64,
    source: String,
    tags: Vec<String>,
    section_key: String,
    material_key: Option<String>,
    section_id: i64,
    material_id: Option<i64>,
}
struct ParsedImport {
    title: String,
    subtitle: String,
    year: String,
    duration_minutes: i64,
    source: String,
    audio_file: Option<String>,
    description: String,
    materials: Vec<ImportMaterial>,
    sections: Vec<ImportSection>,
    questions: Vec<ImportQuestion>,
    warnings: Vec<String>,
    tags: Vec<String>,
    folder: Option<String>,
}

fn json_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}

fn option_letter(i: usize) -> String {
    if i < 26 { ((b'A' + i as u8) as char).to_string() } else { format!("O{}", i + 1) }
}

fn import_qtype(raw: &str) -> Option<&'static str> {
    match raw.trim().to_lowercase().as_str() {
        "choice_single" | "choice" | "single" | "单选" | "单项选择题" => Some("choice_single"),
        "choice_multi" | "multiple" | "multi" | "多选" | "多项选择题" => Some("choice_multi"),
        "fill_blank" | "fill" | "blank" | "填空" | "填空题" => Some("fill_blank"),
        "cloze" | "完形" | "完形填空" => Some("cloze"),
        "true_false" | "judge" | "判断" | "判断题" => Some("true_false"),
        "short_answer" | "short" | "answer" | "简答" | "解答" | "解答题" | "问答题" => Some("short_answer"),
        "writing" | "essay" | "composition" | "写作" | "作文" | "书面表达" => Some("writing"),
        "dictation" | "listen" | "listening" | "听力" | "听写" => Some("dictation"),
        "matching" | "match" | "匹配" | "连线题" => Some("matching"),
        _ => None,
    }
}

fn import_field<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().find_map(|k| v.get(*k))
}

fn import_text(v: &Value, keys: &[&str]) -> String {
    import_field(v, keys).map(json_text).unwrap_or_default().trim().to_string()
}

fn import_i64(v: &Value, keys: &[&str], default: i64) -> i64 {
    match import_field(v, keys) {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(default),
        Some(Value::String(s)) => s.trim().parse::<i64>().unwrap_or(default),
        _ => default,
    }
}

fn import_string_list(v: Option<&Value>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |s: String| {
        let s = s.trim().to_string();
        if !s.is_empty() && !out.iter().any(|x| x == &s) {
            out.push(s);
        }
    };
    match v {
        Some(Value::Array(items)) => {
            for item in items {
                match item {
                    Value::String(s) => push(s.clone()),
                    Value::Object(o) => {
                        let name = import_text(item, &["name", "tag", "label"]);
                        if !name.is_empty() {
                            push(name);
                        } else if let Some(Value::String(s)) = o.get("value") {
                            push(s.clone());
                        }
                    }
                    _ => push(json_text(item)),
                }
            }
        }
        Some(Value::String(s)) => {
            for part in s.split(|c| c == ',' || c == '，' || c == ';' || c == '；') {
                push(part.to_string());
            }
        }
        Some(other) => push(json_text(other)),
        None => {}
    }
    out
}

fn import_answer(raw: Option<&Value>, qtype: &str) -> Value {
    let choice = matches!(qtype, "choice_single" | "choice_multi" | "true_false" | "matching");
    match raw {
        Some(Value::Object(o)) => {
            if let Some(inner) = o.get("answer").or_else(|| o.get("value")) {
                if o.get("kind").is_none() && o.get("correct").is_none() && o.get("accept").is_none() {
                    return import_answer(Some(inner), qtype);
                }
            }
            Value::Object(o.clone())
        }
        Some(Value::Array(items)) => {
            if choice {
                serde_json::json!({ "kind": "choice", "correct": items })
            } else {
                serde_json::json!({ "kind": "text", "accept": items })
            }
        }
        Some(Value::String(s)) => {
            if s.trim().is_empty() {
                serde_json::json!({})
            } else if choice {
                serde_json::json!({ "kind": "choice", "correct": [s.trim()] })
            } else {
                serde_json::json!({ "kind": "text", "accept": [s.trim()] })
            }
        }
        Some(other) => serde_json::json!({ "kind": "text", "accept": [json_text(other)] }),
        None => serde_json::json!({}),
    }
}

fn import_stem(q: &Value) -> String {
    let mut stem = import_text(q, &["stem", "question", "text", "title", "题干"]);
    if stem.is_empty() {
        if let Some(Value::Array(parts)) = q.get("content") {
            stem = parts.iter().map(json_text).collect::<Vec<_>>().join(" ");
        } else if let Some(v) = q.get("content") {
            stem = json_text(v);
        }
    }
    stem
}

fn import_options(q: &Value) -> Vec<OptionItem> {
    let mut out = Vec::new();
    if let Some(items) = q.get("options").and_then(Value::as_array) {
        for (i, item) in items.iter().enumerate() {
            let mut key = import_text(item, &["key", "label", "letter"]);
            if key.is_empty() {
                key = option_letter(i);
            }
            let text = match item {
                Value::String(s) => s.clone(),
                _ => import_text(item, &["text", "content", "value", "选项"]),
            };
            if !text.trim().is_empty() || !key.trim().is_empty() {
                out.push(OptionItem { key, text });
            }
        }
    }
    out
}
fn parse_import(text: &str, title_hint: Option<&str>) -> R<ParsedImport> {
    let cleaned = text.trim().trim_start_matches(char::from_u32(0xfeff).unwrap());
    let start = cleaned.find('{').ok_or("没有找到 JSON 对象：请先让 AI 按 Tokeru 规范生成 JSON。")?;
    let end = cleaned.rfind('}').ok_or("JSON 没有结束：请检查是否被截断。")?;
    if end < start {
        return Err("JSON 结构不完整：请重新生成。".into());
    }
    let root: Value = serde_json::from_str(&cleaned[start..=end])
        .map_err(|e| format!("JSON 解析失败：{e}"))?;
    if !root.is_object() {
        return Err("JSON 顶层必须是对象。".into());
    }
    let set = root.get("set").filter(|v| v.is_object()).unwrap_or(&root);

    let mut warnings: Vec<String> = Vec::new();
    let title = {
        let t = import_text(set, &["title", "name", "试卷标题"]);
        if t.is_empty() {
            title_hint.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
                .unwrap_or_else(|| "未命名试卷".to_string())
        } else { t }
    };
    let subtitle = import_text(set, &["subtitle", "subTitle", "副标题"]);
    let year = import_text(set, &["year", "年份"]);
    let duration_minutes = import_i64(set, &["duration_minutes", "durationMinutes", "duration", "建议分钟"], 0).max(0);
    let source = {
        let s = import_text(set, &["source", "来源"]);
        if s.is_empty() { "import".to_string() } else { s }
    };
    let audio_file = {
        let a = import_text(set, &["audio_file", "audioFile", "audio"]);
        if a.is_empty() { None } else { Some(a) }
    };
    let description = import_text(set, &["description", "desc", "简介"]);
    let tags = import_string_list(set.get("tags"));
    let folder = {
        let f = import_text(set, &["folder", "folder_name", "文件夹"]);
        if f.is_empty() { None } else { Some(f) }
    };

    let mut materials: Vec<ImportMaterial> = Vec::new();
    if let Some(items) = root.get("materials").and_then(Value::as_array) {
        for (i, item) in items.iter().enumerate() {
            let mut key = import_text(item, &["key", "id"]);
            if key.is_empty() { key = format!("m{}", i + 1); }
            let title = import_text(item, &["title", "name", "材料标题"]);
            let content = {
                let c = import_text(item, &["content", "text", "body", "材料"]);
                if c.is_empty() { json_text(item) } else { c }
            };
            if content.is_empty() && title.is_empty() {
                continue;
            }
            materials.push(ImportMaterial { key, title, content });
        }
    }

    let mut sections: Vec<ImportSection> = Vec::new();
    if let Some(items) = root.get("sections").and_then(Value::as_array) {
        for (i, item) in items.iter().enumerate() {
            let mut key = import_text(item, &["key", "id"]);
            if key.is_empty() { key = format!("s{}", i + 1); }
            let title = import_text(item, &["title", "name", "分区标题"]);
            let subtitle = import_text(item, &["subtitle", "subTitle"]);
            let kind = import_text(item, &["kind", "type"]);
            let position = import_i64(item, &["position", "order"], i as i64);
            let material_key = {
                let m = import_text(item, &["material", "material_key", "materialKey"]);
                if m.is_empty() { None } else { Some(m) }
            };
            let title = if title.is_empty() { format!("第 {} 部分", i + 1) } else { title };
            sections.push(ImportSection { key, title, subtitle, kind, position, material_key });
        }
    }
    if sections.is_empty() {
        let material_key = materials.first().map(|m| m.key.clone());
        sections.push(ImportSection {
            key: "all".into(),
            title: "全部题目".into(),
            subtitle: String::new(),
            kind: "mixed".into(),
            position: 0,
            material_key,
        });
    }

    let section_by_key: std::collections::HashMap<String, (usize, Option<String>)> = sections
        .iter()
        .enumerate()
        .map(|(i, s)| (s.key.clone(), (i, s.material_key.clone())))
        .collect();
    let default_section = sections.first().map(|s| s.key.clone()).unwrap_or_else(|| "all".into());

    let mut questions: Vec<ImportQuestion> = Vec::new();
    let mut seen_numbers: std::collections::HashSet<i64> = std::collections::HashSet::new();
    if let Some(items) = root.get("questions").and_then(Value::as_array) {
        for (i, q) in items.iter().enumerate() {
            let number = import_i64(q, &["number", "no", "题号"], i as i64 + 1);
            let mut label = import_text(q, &["label", "题号标签"]);
            if label.is_empty() { label = number.to_string(); }
            let qtype_raw = import_text(q, &["qtype", "type", "题型"]);
            let qtype = match import_qtype(&qtype_raw) {
                Some(t) => t.to_string(),
                None => {
                    if !qtype_raw.is_empty() {
                        warnings.push(format!("第 {number} 题的题型「{qtype_raw}」不认识，已按简答题导入。"));
                    }
                    "short_answer".to_string()
                }
            };
            let stem = import_stem(q);
            if stem.is_empty() {
                warnings.push(format!("第 {number} 题缺少题干，请在速查与整理里补全。"));
            }
            let options = import_options(q);
            if options.is_empty() && matches!(qtype.as_str(), "choice_single" | "choice_multi" | "true_false") {
                warnings.push(format!("第 {number} 题是选择题但没有选项。"));
            }
            let answer = import_answer(q.get("answer"), &qtype);
            if answer.as_object().map(|o| o.is_empty()).unwrap_or(true) {
                warnings.push(format!("第 {number} 题没有答案，交卷后需要手动评分。"));
            }
            let explanation = import_text(q, &["explanation", "analysis", "解析", "答案解析"]);
            let points = import_i64(q, &["points", "score", "分值"], 1).max(0);
            let position = import_i64(q, &["position", "order"], i as i64);
            let source = {
                let s = import_text(q, &["source", "来源"]);
                if s.is_empty() { "import".to_string() } else { s }
            };
            let qtags = import_string_list(q.get("tags"));
            let mut section_key = import_text(q, &["section", "section_key", "sectionKey"]);
            if section_key.is_empty() { section_key = default_section.clone(); }
            if !section_by_key.contains_key(&section_key) {
                warnings.push(format!("第 {number} 题引用了不存在的分区「{section_key}」，已放进第一个分区。"));
                section_key = default_section.clone();
            }
            let mut material_key = {
                let m = import_text(q, &["material", "material_key", "materialKey"]);
                if m.is_empty() { None } else { Some(m) }
            };
            if material_key.is_none() {
                material_key = section_by_key.get(&section_key).and_then(|(_, m)| m.clone());
            }
            if let Some(m) = &material_key {
                if !materials.iter().any(|x| &x.key == m) {
                    warnings.push(format!("第 {number} 题引用了不存在的材料「{m}」，已忽略。"));
                    material_key = None;
                }
            }
            if !seen_numbers.insert(number) {
                warnings.push(format!("题号 {number} 重复出现，速查与整理里可能不好定位。"));
            }
            let section_id = section_by_key.get(&section_key).map(|(i, _)| 2000 + *i as i64).unwrap_or(2000);
            let material_id = material_key.as_ref().and_then(|m| materials.iter().position(|x| &x.key == m)).map(|i| 1000 + i as i64);
            questions.push(ImportQuestion {
                number,
                label,
                qtype,
                stem,
                options,
                answer,
                explanation,
                points,
                position,
                source,
                tags: qtags,
                section_key,
                material_key,
                section_id,
                material_id,
            });
        }
    }
    if questions.is_empty() {
        return Err("没有解析到题目：请确认 JSON 里有 questions 数组。".into());
    }
    sections.sort_by_key(|s| s.position);
    Ok(ParsedImport {
        title,
        subtitle,
        year,
        duration_minutes,
        source,
        audio_file,
        description,
        materials,
        sections,
        questions,
        warnings,
        tags,
        folder,
    })
}

fn preview_from_parsed(p: &ParsedImport) -> ImportPreview {
    let materials: Vec<Material> = p.materials.iter().enumerate().map(|(i, m)| Material {
        id: 1000 + i as i64,
        set_id: 0,
        key: m.key.clone(),
        title: m.title.clone(),
        content: m.content.clone(),
    }).collect();
    let sections: Vec<Section> = p.sections.iter().enumerate().map(|(i, s)| Section {
        id: 2000 + i as i64,
        set_id: 0,
        key: s.key.clone(),
        title: s.title.clone(),
        subtitle: s.subtitle.clone(),
        kind: s.kind.clone(),
        position: s.position,
        audio_file: p.audio_file.clone(),
        material_id: s.material_key.as_ref().and_then(|k| p.materials.iter().position(|m| &m.key == k)).map(|idx| 1000 + idx as i64),
    }).collect();
    let questions: Vec<Question> = p.questions.iter().map(|q| Question {
        id: 3000 + q.position,
        set_id: 0,
        section_id: q.section_id,
        material_id: q.material_id,
        number: q.number,
        label: q.label.clone(),
        qtype: q.qtype.clone(),
        stem: q.stem.clone(),
        options: q.options.clone(),
        answer: q.answer.clone(),
        explanation: q.explanation.clone(),
        points: q.points,
        position: q.position,
        source: q.source.clone(),
        tags: q.tags.clone(),
        archived: false,
    }).collect();
    ImportPreview {
        title: p.title.clone(),
        set_tags: p.tags.clone(),
        folder: p.folder.clone(),
        question_count: p.questions.len() as i64,
        questions,
        warnings: p.warnings.clone(),
        sections,
        materials,
    }
}

pub(crate) fn import_preview_text(text: &str, title: Option<&str>) -> R<ImportPreview> {
    let parsed = parse_import(text, title)?;
    Ok(preview_from_parsed(&parsed))
}

pub(crate) fn import_confirm_text(conn: &mut rusqlite::Connection, text: &str, title: Option<&str>) -> R<i64> {
    let parsed = parse_import(text, title)?;
    let final_title = title.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).unwrap_or_else(|| parsed.title.clone());
    write_parsed(conn, &parsed, &final_title)
}

pub(crate) fn import_undo_db(conn: &rusqlite::Connection, batch_id: i64) -> R<()> {
    let set_id: Option<i64> = conn
        .query_row("SELECT set_id FROM import_batches WHERE id=?", params![batch_id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    let set_id = set_id.ok_or_else(|| "导入批次不存在。".to_string())?;
    conn.execute("DELETE FROM sets WHERE id=?", params![set_id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM import_batches WHERE id=?", params![batch_id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn preview_import(state: State<'_, Db>, text: Option<String>, path: Option<String>, title: Option<String>, kind: Option<String>) -> R<ImportPreview> {
    let _ = kind;
    let source = if let Some(text) = text.filter(|t| !t.trim().is_empty()) {
        text
    } else if let Some(path) = path.filter(|p| !p.trim().is_empty()) {
        fs::read_to_string(&path).map_err(|e| format!("读取文件失败：{e}"))?
    } else {
        return Err("请先粘贴内容或选择文件。".into());
    };
    let _ = state;
    import_preview_text(&source, title.as_deref())
}

fn ensure_folder(conn: &rusqlite::Connection, name: &str) -> R<i64> {
    let existing: Option<i64> = conn
        .query_row("SELECT id FROM folders WHERE name=?", params![name], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(id) = existing {
        return Ok(id);
    }
    conn.execute("INSERT INTO folders(name,parent_id,sort,created_at) VALUES(?,NULL,0,?)", params![name, now()])
        .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

fn write_parsed(conn: &mut rusqlite::Connection, p: &ParsedImport, title: &str) -> R<i64> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let folder_id = match &p.folder {
        Some(name) if !name.trim().is_empty() => Some(ensure_folder(&tx, name)?),
        _ => None,
    };
    tx.execute(
        "INSERT INTO sets(title,subtitle,year,duration_minutes,source,audio_file,description,tags_json,created_at,folder_id)
         VALUES(?,?,?,?,?,?,?,?,?,?)",
        params![
            if title.trim().is_empty() { p.title.as_str() } else { title.trim() },
            p.subtitle, p.year, p.duration_minutes, p.source, p.audio_file, p.description,
            serde_json::to_string(&p.tags).map_err(|e| e.to_string())?, now(), folder_id
        ],
    ).map_err(|e| e.to_string())?;
    let set_id = tx.last_insert_rowid();

    let mut material_ids: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for m in &p.materials {
        tx.execute(
            "INSERT INTO materials(set_id,key,title,content) VALUES(?,?,?,?)",
            params![set_id, m.key, m.title, m.content],
        ).map_err(|e| e.to_string())?;
        material_ids.insert(m.key.clone(), tx.last_insert_rowid());
    }

    let mut section_ids: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for (i, s) in p.sections.iter().enumerate() {
        let material_id = s.material_key.as_ref().and_then(|k| material_ids.get(k)).copied();
        tx.execute(
            "INSERT INTO sections(set_id,key,title,subtitle,kind,position,audio_file,material_id) VALUES(?,?,?,?,?,?,?,?)",
            params![set_id, s.key, s.title, s.subtitle, s.kind, i as i64, p.audio_file, material_id],
        ).map_err(|e| e.to_string())?;
        section_ids.insert(s.key.clone(), tx.last_insert_rowid());
    }
    let fallback_section = section_ids.values().next().copied().unwrap_or(0);
    for q in &p.questions {
        let section_id = section_ids.get(&q.section_key).copied().unwrap_or(fallback_section);
        let material_id = q.material_key.as_ref().and_then(|k| material_ids.get(k)).copied();
        tx.execute(
            "INSERT INTO questions(set_id,section_id,material_id,number,label,qtype,stem,options_json,answer_json,explanation,points,position,source,tags_json,archived,created_at)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)",
            params![
                set_id, section_id, material_id, q.number, q.label, q.qtype, q.stem,
                serde_json::to_string(&q.options).map_err(|e| e.to_string())?,
                serde_json::to_string(&q.answer).map_err(|e| e.to_string())?,
                q.explanation, q.points, q.position, q.source,
                serde_json::to_string(&q.tags).map_err(|e| e.to_string())?,
                now()
            ],
        ).map_err(|e| e.to_string())?;
    }
    tx.execute(
        "INSERT INTO import_batches(set_id,title,created_at) VALUES(?,?,?)",
        params![set_id, p.title, now()],
    ).map_err(|e| e.to_string())?;
    let batch_id = tx.last_insert_rowid();
    tx.commit().map_err(|e| e.to_string())?;
    Ok(batch_id)
}

#[tauri::command]
pub fn confirm_import(state: State<'_, Db>, text: String, title: Option<String>) -> R<i64> {
    let mut conn = lock(&state);
    import_confirm_text(&mut conn, &text, title.as_deref())
}

#[tauri::command]
pub fn undo_import(state: State<'_, Db>, batch_id: i64) -> R<()> {
    let conn = lock(&state);
    import_undo_db(&conn, batch_id)
}

#[tauri::command]
pub fn media_path(state: State<'_, Db>, file: String) -> R<String> {
    let clean = file.trim().trim_start_matches('/').replace('\\', "/");
    if clean.split('/').any(|part| part == "..") {
        return Err("路径不合法。".into());
    }
    let path = state.data_dir.join(clean.replace('/', std::path::MAIN_SEPARATOR_STR));
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建媒体目录失败：{e}"))?;
    }
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod import_tests {
    use super::*;

    fn sample() -> &'static str {
        r#"{
          "set": {"title": "测试卷", "tags": ["数学"], "folder": "单元测试"},
          "materials": [{"key": "m1", "title": "材料", "content": "一段材料"}],
          "sections": [{"key": "s1", "title": "第一部分", "material": "m1"}],
          "questions": [
            {"number": 1, "section": "s1", "qtype": "choice_single", "stem": "题干", "options": [{"key": "A", "text": "一"}, {"key": "B", "text": "二"}], "answer": {"kind": "choice", "correct": ["A"]}, "points": 5},
            {"number": 2, "section": "s1", "qtype": "fill_blank", "stem": "天空", "answer": "答案", "points": 2}
          ]
        }"#
    }

    #[test]
    fn parses_full_document() {
        let p = parse_import(sample(), None).unwrap();
        assert_eq!(p.title, "测试卷");
        assert_eq!(p.questions.len(), 2);
        assert_eq!(p.questions[0].section_id, 2000);
        assert_eq!(p.questions[0].material_id, Some(1000));
        assert_eq!(p.questions[1].qtype, "fill_blank");
        assert!(p.warnings.is_empty());
    }

    #[test]
    fn wraps_plain_text_tolerantly() {
        let text = format!("{}~~~json\n{{ \"questions\": [ {{ \"stem\": \"只有一题\" }} ] }}\n~~~", char::from_u32(0xfeff).unwrap());
        let p = parse_import(&text, Some("补标题")).unwrap();
        assert_eq!(p.title, "补标题");
        assert_eq!(p.questions[0].qtype, "short_answer");
        assert_eq!(p.sections.len(), 1);
    }

    #[test]
    fn rejects_plain_text() {
        assert!(parse_import("这不是 JSON", None).is_err());
    }

    #[test]
    fn writes_and_undoes_import() {
        let dir = std::env::current_dir().unwrap().join("target").join(format!("test-import-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let db = Db::open(&dir).unwrap();
        let parsed = parse_import(sample(), None).unwrap();
        let batch = {
            let mut conn = db.conn.lock().unwrap();
            write_parsed(&mut conn, &parsed, "测试卷").unwrap()
        };
        {
            let conn = db.conn.lock().unwrap();
            let sets: i64 = conn.query_row("SELECT COUNT(*) FROM sets", [], |r| r.get(0)).unwrap();
            let qs: i64 = conn.query_row("SELECT COUNT(*) FROM questions", [], |r| r.get(0)).unwrap();
            assert_eq!(sets, 1);
            assert_eq!(qs, 2);
            conn.execute("DELETE FROM sets WHERE id=(SELECT set_id FROM import_batches WHERE id=?)", params![batch]).unwrap();
            conn.execute("DELETE FROM import_batches WHERE id=?", params![batch]).unwrap();
        }
        let _ = fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod scoring_tests {
    use super::*;

    fn item(number: i64, points: i64) -> ScoreItem {
        ScoreItem { number, points, reason: String::new() }
    }

    #[test]
    fn extracts_json_from_fenced_text() {
        let value = ai_object("说明\n~~~json\n{\"items\":[{\"number\":1}]}\n~~~").unwrap();
        assert_eq!(value["items"][0]["number"], 1);
    }

    #[test]
    fn normalizes_zero_sum_to_exact_total() {
        let mut items = vec![item(1, 0), item(2, 0), item(3, 0)];
        normalize_score_plan(&mut items, 10).unwrap();
        assert_eq!(items.iter().map(|i| i.points).sum::<i64>(), 10);
        assert_eq!(items.iter().map(|i| i.points).collect::<Vec<_>>(), vec![4, 3, 3]);
    }

    #[test]
    fn normalizes_proportional_sum_to_exact_total() {
        let mut items = vec![item(1, 5), item(2, 3), item(3, 2)];
        normalize_score_plan(&mut items, 20).unwrap();
        assert_eq!(items.iter().map(|i| i.points).sum::<i64>(), 20);
    }
}
