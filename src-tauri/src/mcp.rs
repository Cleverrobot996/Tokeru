use crate::commands;
use crate::db::Db;
use crate::models::*;
use crate::repo;
use axum::{
    extract::{Request, State as AxumState},
    http::{header, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    Router,
};
use rmcp::{
    handler::server::wrapper::Parameters,
    model::{ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router,
    transport::{
        streamable_http_server::session::local::LocalSessionManager,
        StreamableHttpServerConfig, StreamableHttpService,
    },
    ErrorData as McpError, Json, ServerHandler,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State as TauriState};
use tokio::sync::watch;

pub const DEFAULT_PORT: u16 = 17890;
const PREVIEW_TTL: Duration = Duration::from_secs(2 * 60 * 60);

type TokeruService = StreamableHttpService<TokeruMcp, LocalSessionManager>;

fn err(message: impl Into<String>) -> McpError {
    McpError::internal_error(message.into(), None)
}

fn ok(value: impl Serialize) -> Result<Json<Value>, McpError> {
    serde_json::to_value(value).map(Json).map_err(|e| err(format!("序列化失败：{e}")))
}
fn clamp_limit(value: Option<i64>, default: i64, max: i64) -> i64 {
    value.unwrap_or(default).clamp(0, max)
}

fn count_sql(conn: &rusqlite::Connection, sql: &str) -> Result<i64, String> {
    conn.query_row(sql, [], |row| row.get(0)).map_err(|e| e.to_string())
}

fn clean_tags(tags: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for tag in tags {
        let tag = tag.trim();
        if tag.is_empty() || out.iter().any(|existing| existing == tag) {
            continue;
        }
        out.push(tag.to_string());
    }
    out
}

#[derive(Default)]
struct ManagerState {
    stop: Option<watch::Sender<()>>,
    running: bool,
    port: u16,
    token: String,
    readonly: bool,
    last_error: Option<String>,
}

pub struct McpManager {
    inner: Mutex<ManagerState>,
}

impl Default for McpManager {
    fn default() -> Self {
        Self {
            inner: Mutex::new(ManagerState {
                port: DEFAULT_PORT,
                readonly: true,
                ..Default::default()
            }),
        }
    }
}

impl McpManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn stop(&self) {
        if let Ok(mut state) = self.inner.lock() {
            if let Some(tx) = state.stop.take() {
                let _ = tx.send(());
            }
            state.running = false;
        }
    }

    fn snapshot(&self) -> ManagerState {
        let state = self.inner.lock().unwrap();
        ManagerState {
            stop: None,
            running: state.running,
            port: state.port,
            token: state.token.clone(),
            readonly: state.readonly,
            last_error: state.last_error.clone(),
        }
    }

    pub async fn start(&self, app: AppHandle, port: u16, token: String, readonly: bool) -> Result<(), String> {
        self.stop();
        // 旧监听优雅退出需要一点时间；立刻 bind 同一端口会命中 WSAEADDRINUSE，
        // 所以重试最多 2 秒，避免用户在设置页反复应用时看到假失败。
        let mut listener = None;
        let mut last_error = String::new();
        for _ in 0..40 {
            match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
                Ok(l) => {
                    listener = Some(l);
                    break;
                }
                Err(e) => {
                    last_error = e.to_string();
                    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                }
            }
        }
        let listener = listener.ok_or_else(|| format!("无法监听 127.0.0.1:{port}：{last_error}"))?;
        let previews: Arc<Mutex<HashMap<String, PreviewEntry>>> = Arc::new(Mutex::new(HashMap::new()));
        let handler = TokeruMcp::new(app, readonly, previews);
        let service: TokeruService = StreamableHttpService::new(
            move || Ok(handler.clone()),
            Default::default(),
            // 导入规范允许整卷题图预算 8 MB；rmcp 默认 4 MiB 会在带 data URL 的
            // preview_import 上先返回 413。这里留一倍余量。
            StreamableHttpServerConfig::default().with_max_request_body_bytes(16 * 1024 * 1024),
        );
        let auth = AuthState { token: Arc::new(token.clone()) };
        let router = Router::new()
            .route_service("/mcp", service)
            .layer(middleware::from_fn_with_state(auth, auth_middleware))
            .layer(middleware::from_fn(cors_middleware));
        let (stop_tx, mut stop_rx) = watch::channel(());
        tokio::spawn(async move {
            let server = axum::serve(listener, router).with_graceful_shutdown(async move {
                let _ = stop_rx.changed().await;
            });
            if let Err(e) = server.await {
                eprintln!("MCP 服务停止：{e}");
            }
        });
        if let Ok(mut state) = self.inner.lock() {
            state.stop = Some(stop_tx);
            state.running = true;
            state.port = port;
            state.token = token;
            state.readonly = readonly;
            state.last_error = None;
        }
        Ok(())
    }

    fn set_error(&self, message: String) {
        if let Ok(mut state) = self.inner.lock() {
            state.running = false;
            state.last_error = Some(message);
        }
    }
}

#[derive(Clone)]
struct AuthState {
    token: Arc<String>,
}

async fn auth_middleware(AxumState(auth): AxumState<AuthState>, request: Request, next: Next) -> Response {
    if request.method() == Method::OPTIONS {
        return StatusCode::NO_CONTENT.into_response();
    }
    let provided = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .map(str::to_string)
        .or_else(|| {
            request.uri().query().and_then(|q| {
                q.split('&')
                    .find_map(|part| part.strip_prefix("token="))
                    .map(|v| v.to_string())
            })
        });
    if provided.as_deref() == Some(auth.token.as_str()) {
        next.run(request).await
    } else {
        (StatusCode::UNAUTHORIZED, "Unauthorized: missing or invalid MCP token").into_response()
    }
}

async fn cors_middleware(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".parse().unwrap());
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        "authorization, content-type, mcp-session-id, mcp-protocol-version".parse().unwrap(),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        "GET, POST, DELETE, OPTIONS".parse().unwrap(),
    );
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        "mcp-session-id".parse().unwrap(),
    );
    response
}

struct PreviewEntry {
    text: String,
    title: Option<String>,
    created: Instant,
}

#[derive(Clone)]
pub struct TokeruMcp {
    app: AppHandle,
    readonly: bool,
    previews: Arc<Mutex<HashMap<String, PreviewEntry>>>,
}

impl TokeruMcp {
    pub fn new(app: AppHandle, readonly: bool, previews: Arc<Mutex<HashMap<String, PreviewEntry>>>) -> Self {
        Self { app, readonly, previews }
    }

    fn write_guard(&self) -> Result<(), McpError> {
        if self.readonly {
            Err(err("当前 MCP 连接是只读模式。请在 Tokeru「设置 → MCP 连接」里关闭只读后重试。"))
        } else {
            Ok(())
        }
    }

    fn db(&self) -> Result<TauriState<'_, Db>, McpError> {
        self.app.try_state::<Db>().ok_or_else(|| err("数据库尚未初始化。"))
    }

    fn with_conn<T>(&self, f: impl FnOnce(&rusqlite::Connection) -> Result<T, String>) -> Result<T, McpError> {
        let db = self.db()?;
        let conn = db.conn.lock().map_err(|_| err("数据库锁不可用。"))?;
        f(&conn).map_err(err)
    }

    fn with_conn_mut<T>(&self, f: impl FnOnce(&mut rusqlite::Connection) -> Result<T, String>) -> Result<T, McpError> {
        let db = self.db()?;
        let mut conn = db.conn.lock().map_err(|_| err("数据库锁不可用。"))?;
        f(&mut conn).map_err(err)
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetSetParams {
    /// 试卷 id；省略时返回第一份试卷。
    #[serde(default)]
    pub set_id: Option<i64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct BankParams {
    /// 关键词，匹配题干或解析。
    #[serde(default)]
    pub q: Option<String>,
    /// 按试卷 id 过滤。
    #[serde(default)]
    pub set_id: Option<i64>,
    /// 按分区 id 过滤。
    #[serde(default)]
    pub section_id: Option<i64>,
    /// 按题型过滤，如 choice_single / fill_blank。
    #[serde(default)]
    pub qtype: Option<String>,
    /// 单个标签过滤。
    #[serde(default)]
    pub tag: Option<String>,
    /// 标签列表；同一标签栏内 OR、跨标签栏 AND 的语义由调用方自行组合。
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// 文件夹 id。
    #[serde(default)]
    pub folder_id: Option<i64>,
    /// 返回上限，1..2000，默认 100。
    #[serde(default)]
    pub limit: Option<i64>,
}

impl BankParams {
    fn into_filters(self) -> BankFilters {
        BankFilters {
            set_id: self.set_id,
            section_id: self.section_id,
            qtype: self.qtype,
            tag: self.tag,
            q: self.q,
            sort: Some("position".into()),
            archived: Some("active".into()),
            folder_id: self.folder_id,
            set_ids: None,
            tags: self.tags,
            limit: Some(self.limit.unwrap_or(100).clamp(1, 2000)),
        }
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct QuestionParams {
    /// 题目 id。
    pub question_id: i64,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListRecordsParams {
    /// 起始日期 YYYY-MM-DD（含）。
    #[serde(default)]
    pub from: Option<String>,
    /// 结束日期 YYYY-MM-DD（含）。
    #[serde(default)]
    pub to: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct AttemptParams {
    /// 练习记录 id。
    pub attempt_id: i64,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct PreviewParams {
    /// 要清洗的 JSON 或 Markdown 文本；应遵循 get_import_spec 的规范。
    pub text: String,
    /// 可选试卷标题。
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ConfirmParams {
    /// preview_import 返回的 preview_id。
    pub preview_id: String,
    /// 可选，覆盖预览里的标题。
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct UndoParams {
    /// confirm_import 返回的 batch_id。
    pub batch_id: i64,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct UpdateQuestionParams {
    pub question_id: i64,
    /// 新题型；省略则不改。
    #[serde(default)]
    pub qtype: Option<String>,
    /// 新标签列表；省略则不改。
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// 新题干（可含 HTML / data URL 题图）；省略则不改。
    #[serde(default)]
    pub stem: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct RenameSetParams {
    pub set_id: i64,
    pub title: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SetTagsParams {
    pub set_id: i64,
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateFolderParams {
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<i64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct AssignFolderParams {
    pub set_id: i64,
    /// 目标文件夹；null / 省略表示移到未分类。
    #[serde(default)]
    pub folder_id: Option<i64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct LibraryParams {
    /// overview / folders / materials / sections / batches / attempts / mistakes / stats / export_set / export_bank
    pub action: String,
    /// 限定某份试卷（export_set 必填，其他动作可选）。
    #[serde(default)]
    pub set_id: Option<i64>,
    /// 限定某个文件夹。
    #[serde(default)]
    pub folder_id: Option<i64>,
    /// 返回题目上限，1..2000，默认 300；export_bank 为 0 时不返回题目。
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct QuestionsParams {
    /// list / search / get / batch_get / stats
    pub action: String,
    /// 关键词，匹配题干或解析。
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub set_id: Option<i64>,
    #[serde(default)]
    pub section_id: Option<i64>,
    #[serde(default)]
    pub qtype: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub folder_id: Option<i64>,
    #[serde(default)]
    pub limit: Option<i64>,
    /// get 的题目 id。
    #[serde(default)]
    pub question_id: Option<i64>,
    /// batch_get 的题目 id 列表，最多 100 个。
    #[serde(default)]
    pub question_ids: Option<Vec<i64>>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct EditParams {
    /// update_question / update_material / update_section / delete_set
    pub action: String,
    #[serde(default)]
    pub question_id: Option<i64>,
    #[serde(default)]
    pub material_id: Option<i64>,
    #[serde(default)]
    pub section_id: Option<i64>,
    #[serde(default)]
    pub set_id: Option<i64>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub subtitle: Option<String>,
    #[serde(default)]
    pub stem: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub qtype: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// delete_set 必须显式传 true。
    #[serde(default)]
    pub confirm: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub enabled: bool,
    pub port: u16,
    pub readonly: bool,
    pub running: bool,
    pub url: String,
    pub token: String,
    pub last_error: Option<String>,
}

fn status_of(manager: &McpManager) -> McpStatus {
    let snap = manager.snapshot();
    McpStatus {
        enabled: snap.running,
        port: snap.port,
        readonly: snap.readonly,
        running: snap.running,
        url: format!("http://127.0.0.1:{}/mcp", snap.port),
        token: snap.token,
        last_error: snap.last_error,
    }
}

#[tool_router]
impl TokeruMcp {
    #[tool(name = "get_import_spec", description = "返回 Tokeru 当前使用的导入规范（JSON 结构、字段、题型与视觉分图规则）。清洗材料前先调用。", annotations(read_only_hint = true, idempotent_hint = true))]
    async fn get_import_spec(&self) -> Result<Json<Value>, McpError> {
        const SPEC: &str = include_str!("../../shared/import-spec.md");
        Ok(Json(json!({ "spec": SPEC })))
    }

    #[tool(name = "list_sets", description = "列出全部试卷：标题、题量、分区数、总分、标签、文件夹、最近练习时间。", annotations(read_only_hint = true, idempotent_hint = true))]
    async fn list_sets(&self) -> Result<Json<Value>, McpError> {
        let sets = self.with_conn(repo::list_set_summaries)?;
        ok(sets)
    }

    #[tool(name = "get_set", description = "读取一份试卷的完整结构：分区、材料、全部题目（含答案与解析）。不传 set_id 时返回第一份。", annotations(read_only_hint = true, idempotent_hint = true))]
    async fn get_set(&self, Parameters(p): Parameters<GetSetParams>) -> Result<Json<Value>, McpError> {
        let detail = self.with_conn(|c| repo::get_set_detail(c, p.set_id))?;
        ok(detail)
    }

    #[tool(name = "list_bank", description = "按关键词/试卷/分区/题型/标签/文件夹筛选题库。默认返回 100 题，最多 2000 题。", annotations(read_only_hint = true, idempotent_hint = true))]
    async fn list_bank(&self, Parameters(p): Parameters<BankParams>) -> Result<Json<Value>, McpError> {
        let result = self.with_conn(|c| repo::list_bank(c, &p.into_filters()))?;
        ok(result)
    }

    #[tool(name = "search_questions", description = "按题干或解析关键词搜索题目，返回匹配数量和题目。", annotations(read_only_hint = true, idempotent_hint = true))]
    async fn search_questions(&self, Parameters(p): Parameters<BankParams>) -> Result<Json<Value>, McpError> {
        let result = self.with_conn(|c| repo::list_bank(c, &p.into_filters()))?;
        ok(result)
    }

    #[tool(name = "get_question", description = "读取一道题的完整内容：题干、选项、答案、解析、分值、标签。", annotations(read_only_hint = true, idempotent_hint = true))]
    async fn get_question(&self, Parameters(p): Parameters<QuestionParams>) -> Result<Json<Value>, McpError> {
        let q = self.with_conn(|c| repo::question_by_id(c, p.question_id))?;
        ok(q)
    }

    #[tool(name = "list_tags", description = "列出全部标签、使用次数、所属标签栏和颜色。", annotations(read_only_hint = true, idempotent_hint = true))]
    async fn list_tags(&self) -> Result<Json<Value>, McpError> {
        let tags = self.with_conn(repo::list_tags)?;
        ok(tags)
    }

    #[tool(name = "list_tag_groups", description = "列出标签栏（学科/题型/难度/自定义）。", annotations(read_only_hint = true, idempotent_hint = true))]
    async fn list_tag_groups(&self) -> Result<Json<Value>, McpError> {
        let groups = self.with_conn(repo::list_tag_groups)?;
        ok(groups)
    }

    #[tool(name = "bank_stats", description = "题库统计：试卷数、题目数、分区数、材料数、标签数、练习记录数、错题数。", annotations(read_only_hint = true, idempotent_hint = true))]
    async fn bank_stats(&self) -> Result<Json<Value>, McpError> {
        let stats = self.with_conn(|c| {
            let q = |sql: &str| -> i64 { c.query_row(sql, [], |r| r.get(0)).unwrap_or(0) };
            Ok(json!({
                "sets": q("SELECT COUNT(*) FROM sets"),
                "questions": q("SELECT COUNT(*) FROM questions WHERE archived=0"),
                "sections": q("SELECT COUNT(*) FROM sections"),
                "materials": q("SELECT COUNT(*) FROM materials"),
                "tags": q("SELECT COUNT(DISTINCT value) FROM (SELECT tags_json AS j FROM sets UNION ALL SELECT tags_json FROM questions), json_each(j)"),
                "attempts": q("SELECT COUNT(*) FROM attempts"),
                "mistakes": q("SELECT COUNT(*) FROM mistakes")
            }))
        })?;
        Ok(Json(stats))
    }

    #[tool(name = "list_records", description = "列出已交卷的练习记录，可按日期范围过滤。", annotations(read_only_hint = true, idempotent_hint = true))]
    async fn list_records(&self, Parameters(p): Parameters<ListRecordsParams>) -> Result<Json<Value>, McpError> {
        let records = self.with_conn(|c| repo::list_records(c, p.from, p.to))?;
        ok(records)
    }

    #[tool(name = "get_attempt", description = "读取一次练习的作答、得分、AI 评语和关联题目。", annotations(read_only_hint = true, idempotent_hint = true))]
    async fn get_attempt(&self, Parameters(p): Parameters<AttemptParams>) -> Result<Json<Value>, McpError> {
        let detail = self.with_conn(|c| repo::get_attempt_detail(c, p.attempt_id))?;
        ok(detail)
    }

    #[tool(name = "preview_import", description = "校验并预览一份待导入试卷（JSON/Markdown），返回题目数、警告、预览结构和 preview_id；确认前不会写入数据库。", annotations(read_only_hint = false, destructive_hint = false, idempotent_hint = false))]
    async fn preview_import(&self, Parameters(p): Parameters<PreviewParams>) -> Result<Json<Value>, McpError> {
        self.write_guard()?;
        let preview = commands::import_preview_text(&p.text, p.title.as_deref()).map_err(err)?;
        let id = uuid::Uuid::new_v4().simple().to_string();
        let mut cache = self.previews.lock().map_err(|_| err("预览缓存不可用。"))?;
        cache.retain(|_, entry| entry.created.elapsed() < PREVIEW_TTL);
        cache.insert(id.clone(), PreviewEntry { text: p.text, title: p.title, created: Instant::now() });
        ok(json!({ "preview_id": id, "preview": preview, "expires_in_seconds": PREVIEW_TTL.as_secs() }))
    }

    #[tool(name = "confirm_import", description = "把 preview_import 的预览结果写入题库，创建一份新试卷。必须传 preview_id。", annotations(read_only_hint = false, destructive_hint = false, idempotent_hint = false))]
    async fn confirm_import(&self, Parameters(p): Parameters<ConfirmParams>) -> Result<Json<Value>, McpError> {
        self.write_guard()?;
        let entry = {
            let mut cache = self.previews.lock().map_err(|_| err("预览缓存不可用。"))?;
            cache.remove(&p.preview_id)
        };
        let entry = entry.ok_or_else(|| err("preview_id 不存在或已过期，请重新 preview_import。"))?;
        if entry.created.elapsed() >= PREVIEW_TTL {
            return Err(err("预览已超过 2 小时，请重新 preview_import。"));
        }
        let title = p.title.or(entry.title);
        let batch_id = self.with_conn_mut(|c| commands::import_confirm_text(c, &entry.text, title.as_deref()))?;
        let set_id = self.with_conn(|c| {
            c.query_row("SELECT set_id FROM import_batches WHERE id=?", rusqlite::params![batch_id], |r| r.get::<_, i64>(0))
                .map_err(|e| e.to_string())
        })?;
        ok(json!({ "set_id": set_id, "batch_id": batch_id }))
    }

    #[tool(name = "undo_import", description = "撤销一次导入：删除该批次创建的整份试卷及其练习记录。", annotations(read_only_hint = false, destructive_hint = true, idempotent_hint = false))]
    async fn undo_import(&self, Parameters(p): Parameters<UndoParams>) -> Result<Json<Value>, McpError> {
        self.write_guard()?;
        self.with_conn(|c| commands::import_undo_db(c, p.batch_id))?;
        ok(json!({ "batch_id": p.batch_id, "deleted": true }))
    }

    #[tool(name = "library", description = "按领域读取题库：试卷、文件夹、材料、分区、导入批次、练习记录、错题、统计与导出。action=overview/folders/materials/sections/batches/attempts/mistakes/stats/export_set/export_bank。材料与题目正文保留 Markdown/LaTeX/HTML 原文，不回写渲染结果。", annotations(read_only_hint = true, idempotent_hint = true))]
    async fn library(&self, Parameters(p): Parameters<LibraryParams>) -> Result<Json<Value>, McpError> {
        let action = p.action.trim().to_ascii_lowercase();
        match action.as_str() {
            "overview" => {
                let sets = self.with_conn(repo::list_set_summaries)?;
                let tags = self.with_conn(repo::list_tags)?;
                let groups = self.with_conn(repo::list_tag_groups)?;
                let folders = self.with_conn(repo::list_folders)?;
                let stats = self.with_conn(|c| {
                    Ok(json!({
                        "sets": count_sql(c, "SELECT COUNT(*) FROM sets")?,
                        "questions": count_sql(c, "SELECT COUNT(*) FROM questions WHERE archived=0")?,
                        "materials": count_sql(c, "SELECT COUNT(*) FROM materials")?,
                        "sections": count_sql(c, "SELECT COUNT(*) FROM sections")?,
                        "attempts": count_sql(c, "SELECT COUNT(*) FROM attempts")?,
                        "mistakes": count_sql(c, "SELECT COUNT(*) FROM mistakes")?,
                    }))
                })?;
                ok(json!({ "sets": sets, "tags": tags, "tagGroups": groups, "folders": folders, "stats": stats }))
            }
            "folders" => ok(self.with_conn(repo::list_folders)?),
            "materials" => {
                let limit = clamp_limit(p.limit, 50, 200);
                let rows = self.with_conn(|c| {
                    let mut stmt = c.prepare("SELECT m.id,m.set_id,s.title,m.key,m.title,m.content FROM materials m JOIN sets s ON s.id=m.set_id ORDER BY m.set_id,m.id LIMIT ?1").map_err(|e| e.to_string())?;
                    let list = stmt.query_map(rusqlite::params![limit], |r| Ok(json!({
                        "id": r.get::<_,i64>(0)?, "setId": r.get::<_,i64>(1)?, "setTitle": r.get::<_,String>(2)?,
                        "key": r.get::<_,String>(3)?, "title": r.get::<_,String>(4)?, "content": r.get::<_,String>(5)?,
                    }))).map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
                    Ok(list)
                })?;
                ok(json!({ "materials": rows, "limit": limit }))
            }
            "sections" => {
                let rows = self.with_conn(|c| {
                    let mut stmt = c.prepare("SELECT id,set_id,key,title,subtitle,kind,position,audio_file,material_id FROM sections ORDER BY set_id,position,id").map_err(|e| e.to_string())?;
                    let list = stmt.query_map([], |r| Ok(json!({
                        "id": r.get::<_,i64>(0)?, "setId": r.get::<_,i64>(1)?, "key": r.get::<_,String>(2)?,
                        "title": r.get::<_,String>(3)?, "subtitle": r.get::<_,String>(4)?, "kind": r.get::<_,String>(5)?,
                        "position": r.get::<_,i64>(6)?, "audioFile": r.get::<_,Option<String>>(7)?, "materialId": r.get::<_,Option<i64>>(8)?,
                    }))).map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
                    Ok(list)
                })?;
                ok(json!({ "sections": rows }))
            }
            "batches" => {
                let rows = self.with_conn(|c| {
                    let mut stmt = c.prepare("SELECT b.id,b.set_id,s.title,b.title,b.created_at FROM import_batches b LEFT JOIN sets s ON s.id=b.set_id ORDER BY b.id DESC LIMIT 200").map_err(|e| e.to_string())?;
                    let list = stmt.query_map([], |r| Ok(json!({
                        "id": r.get::<_,i64>(0)?, "setId": r.get::<_,i64>(1)?, "setTitle": r.get::<_,Option<String>>(2)?,
                        "title": r.get::<_,String>(3)?, "createdAt": r.get::<_,String>(4)?,
                    }))).map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
                    Ok(list)
                })?;
                ok(json!({ "batches": rows }))
            }
            "attempts" => {
                let set_id = p.set_id;
                let rows = self.with_conn(move |c| {
                    let mut stmt = c.prepare("SELECT a.id,a.set_id,s.title,a.status,a.total_score,a.max_score,a.started_at,a.finished_at,(SELECT COUNT(*) FROM answers WHERE attempt_id=a.id AND TRIM(answer_raw)<>'') FROM attempts a LEFT JOIN sets s ON s.id=a.set_id WHERE (?1 IS NULL OR a.set_id=?1) ORDER BY a.id DESC LIMIT 200").map_err(|e| e.to_string())?;
                    let list = stmt.query_map(rusqlite::params![set_id], |r| Ok(json!({
                        "id": r.get::<_,i64>(0)?, "setId": r.get::<_,Option<i64>>(1)?, "setTitle": r.get::<_,Option<String>>(2)?,
                        "status": r.get::<_,String>(3)?, "totalScore": r.get::<_,Option<i64>>(4)?, "maxScore": r.get::<_,Option<i64>>(5)?,
                        "startedAt": r.get::<_,String>(6)?, "finishedAt": r.get::<_,Option<String>>(7)?, "answered": r.get::<_,i64>(8)?,
                    }))).map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
                    Ok(list)
                })?;
                ok(json!({ "attempts": rows }))
            }
            "mistakes" => ok(json!({ "mistakes": self.with_conn(repo::list_mistakes)? })),
            "stats" => {
                let stats = self.with_conn(|c| {
                    let mut by_type = Vec::new();
                    let mut stmt = c.prepare("SELECT qtype,COUNT(*),COALESCE(SUM(points),0) FROM questions WHERE archived=0 GROUP BY qtype ORDER BY COUNT(*) DESC").map_err(|e| e.to_string())?;
                    let rows = stmt.query_map([], |r| Ok(json!({"qtype": r.get::<_,String>(0)?, "count": r.get::<_,i64>(1)?, "points": r.get::<_,i64>(2)?}))).map_err(|e| e.to_string())?;
                    for row in rows { by_type.push(row.map_err(|e| e.to_string())?); }
                    Ok(json!({
                        "sets": count_sql(c, "SELECT COUNT(*) FROM sets")?,
                        "questions": count_sql(c, "SELECT COUNT(*) FROM questions WHERE archived=0")?,
                        "attempts": count_sql(c, "SELECT COUNT(*) FROM attempts")?,
                        "mistakes": count_sql(c, "SELECT COUNT(*) FROM mistakes")?,
                        "byQtype": by_type,
                    }))
                })?;
                ok(stats)
            }
            "export_set" => {
                let set_id = p.set_id.ok_or_else(|| err("export_set 需要 set_id。"))?;
                let detail = self.with_conn(|c| repo::get_set_detail(c, Some(set_id)))?;
                ok(json!({ "set": detail }))
            }
            "export_bank" => {
                let limit = clamp_limit(p.limit, 300, 2000);
                let sets = self.with_conn(repo::list_set_summaries)?;
                let tags = self.with_conn(repo::list_tags)?;
                let groups = self.with_conn(repo::list_tag_groups)?;
                let folders = self.with_conn(repo::list_folders)?;
                let questions = if limit > 0 {
                    let filters = BankFilters {
                        set_id: p.set_id,
                        folder_id: p.folder_id,
                        q: None,
                        section_id: None,
                        qtype: None,
                        tag: None,
                        tags: None,
                        set_ids: None,
                        sort: Some("position".into()),
                        archived: Some("active".into()),
                        limit: Some(limit),
                    };
                    Some(self.with_conn(|c| repo::list_bank(c, &filters))?)
                } else {
                    None
                };
                ok(json!({ "sets": sets, "tags": tags, "tagGroups": groups, "folders": folders, "questions": questions }))
            }
            other => Err(err(format!("未知的 library action：{other}"))),
        }
    }

    #[tool(name = "questions", description = "按领域读取题目：list/search/get/batch_get/stats。get 会同时返回题目、所属分区和共享材料；batch_get 一次最多 100 题。公式保留 TeX 原文。", annotations(read_only_hint = true, idempotent_hint = true))]
    async fn questions(&self, Parameters(p): Parameters<QuestionsParams>) -> Result<Json<Value>, McpError> {
        let action = p.action.trim().to_ascii_lowercase();
        match action.as_str() {
            "list" | "search" => {
                if action == "search" && p.q.as_deref().map(str::trim).unwrap_or("").is_empty() {
                    return Err(err("search 需要 q 关键词。"));
                }
                let filters = BankFilters {
                    set_id: p.set_id,
                    section_id: p.section_id,
                    qtype: p.qtype.clone(),
                    tag: p.tag.clone(),
                    q: p.q.clone(),
                    sort: Some("position".into()),
                    archived: Some("active".into()),
                    folder_id: p.folder_id,
                    set_ids: None,
                    tags: p.tags.clone(),
                    limit: Some(clamp_limit(p.limit, 100, 2000)),
                };
                ok(self.with_conn(|c| repo::list_bank(c, &filters))?)
            }
            "get" => {
                let id = p.question_id.or_else(|| p.question_ids.as_ref().and_then(|v| v.first().copied()))
                    .ok_or_else(|| err("get 需要 question_id。"))?;
                let payload = self.with_conn(move |c| {
                    let question = repo::question_by_id(c, id)?;
                    let section = c.query_row("SELECT id,set_id,key,title,subtitle,kind,position,audio_file,material_id FROM sections WHERE id=?", rusqlite::params![question.section_id], |r| Ok(json!({
                        "id": r.get::<_,i64>(0)?, "setId": r.get::<_,i64>(1)?, "key": r.get::<_,String>(2)?, "title": r.get::<_,String>(3)?,
                        "subtitle": r.get::<_,String>(4)?, "kind": r.get::<_,String>(5)?, "position": r.get::<_,i64>(6)?,
                        "audioFile": r.get::<_,Option<String>>(7)?, "materialId": r.get::<_,Option<i64>>(8)?,
                    }))).ok();
                    let material = match question.material_id {
                        Some(mid) => c.query_row("SELECT id,set_id,key,title,content FROM materials WHERE id=?", rusqlite::params![mid], |r| Ok(json!({
                            "id": r.get::<_,i64>(0)?, "setId": r.get::<_,i64>(1)?, "key": r.get::<_,String>(2)?,
                            "title": r.get::<_,String>(3)?, "content": r.get::<_,String>(4)?,
                        }))).ok(),
                        None => None,
                    };
                    Ok(json!({ "question": question, "section": section, "material": material }))
                })?;
                ok(payload)
            }
            "batch_get" => {
                let ids = p.question_ids.unwrap_or_default();
                if ids.is_empty() { return Err(err("batch_get 需要 question_ids。")); }
                if ids.len() > 100 { return Err(err("batch_get 一次最多 100 题。")); }
                let mut list = Vec::with_capacity(ids.len());
                for id in ids {
                    list.push(self.with_conn(move |c| repo::question_by_id(c, id))?);
                }
                ok(json!({ "questions": list }))
            }
            "stats" => {
                let stats = self.with_conn(|c| {
                    let mut by_type = Vec::new();
                    let mut stmt = c.prepare("SELECT qtype,COUNT(*),COALESCE(SUM(points),0) FROM questions WHERE archived=0 GROUP BY qtype ORDER BY COUNT(*) DESC").map_err(|e| e.to_string())?;
                    let rows = stmt.query_map([], |r| Ok(json!({"qtype": r.get::<_,String>(0)?, "count": r.get::<_,i64>(1)?, "points": r.get::<_,i64>(2)?}))).map_err(|e| e.to_string())?;
                    for row in rows { by_type.push(row.map_err(|e| e.to_string())?); }
                    Ok(json!({
                        "total": count_sql(c, "SELECT COUNT(*) FROM questions WHERE archived=0")?,
                        "byQtype": by_type,
                    }))
                })?;
                ok(stats)
            }
            other => Err(err(format!("未知的 questions action：{other}"))),
        }
    }

    #[tool(name = "edit", description = "按领域修改题库：update_question/update_material/update_section/delete_set。只提交要改的字段；正文必须沿用导入规范的 Markdown/LaTeX/HTML 语法。delete_set 需要 confirm=true。", annotations(read_only_hint = false, idempotent_hint = false))]
    async fn edit(&self, Parameters(p): Parameters<EditParams>) -> Result<Json<Value>, McpError> {
        self.write_guard()?;
        let action = p.action.trim().to_ascii_lowercase();
        match action.as_str() {
            "update_question" => {
                let qid = p.question_id.ok_or_else(|| err("update_question 需要 question_id。"))?;
                if p.qtype.is_none() && p.tags.is_none() && p.stem.is_none() {
                    return Err(err("update_question 没有要修改的字段。"));
                }
                let result = self.with_conn_mut(move |c| {
                    let exists: i64 = c.query_row("SELECT COUNT(*) FROM questions WHERE id=?", rusqlite::params![qid], |r| r.get(0)).map_err(|e| e.to_string())?;
                    if exists == 0 { return Err("题目不存在。".into()); }
                    if let Some(qtype) = p.qtype.as_deref() {
                        let qtype = qtype.trim();
                        if qtype.is_empty() { return Err("题型不能为空。".into()); }
                        c.execute("UPDATE questions SET qtype=? WHERE id=?", rusqlite::params![qtype, qid]).map_err(|e| e.to_string())?;
                    }
                    if let Some(tags) = p.tags.as_ref() {
                        let tags = clean_tags(tags);
                        c.execute("UPDATE questions SET tags_json=? WHERE id=?", rusqlite::params![serde_json::to_string(&tags).unwrap_or_else(|_| "[]".into()), qid]).map_err(|e| e.to_string())?;
                    }
                    if let Some(stem) = p.stem.as_deref() {
                        if stem.trim().is_empty() { return Err("题干不能为空。".into()); }
                        if stem.len() > 8 * 1024 * 1024 { return Err("题干超过 8 MB。".into()); }
                        c.execute("UPDATE questions SET stem=? WHERE id=?", rusqlite::params![stem, qid]).map_err(|e| e.to_string())?;
                    }
                    Ok(json!({ "updated": true, "questionId": qid }))
                })?;
                ok(result)
            }
            "update_material" => {
                let mid = p.material_id.ok_or_else(|| err("update_material 需要 material_id。"))?;
                let content = p.content.as_deref().ok_or_else(|| err("update_material 需要 content。"))?;
                if content.len() > 8 * 1024 * 1024 { return Err(err("材料超过 8 MB。")); }
                let result = self.with_conn_mut(move |c| {
                    let changed = c.execute("UPDATE materials SET content=? WHERE id=?", rusqlite::params![content, mid]).map_err(|e| e.to_string())?;
                    if changed == 0 { return Err("材料不存在。".into()); }
                    Ok(json!({ "updated": true, "materialId": mid }))
                })?;
                ok(result)
            }
            "update_section" => {
                let sid = p.section_id.ok_or_else(|| err("update_section 需要 section_id。"))?;
                if p.title.is_none() && p.subtitle.is_none() { return Err(err("update_section 没有要修改的字段。")); }
                let result = self.with_conn_mut(move |c| {
                    if let Some(title) = p.title.as_deref() { c.execute("UPDATE sections SET title=? WHERE id=?", rusqlite::params![title, sid]).map_err(|e| e.to_string())?; }
                    if let Some(subtitle) = p.subtitle.as_deref() { c.execute("UPDATE sections SET subtitle=? WHERE id=?", rusqlite::params![subtitle, sid]).map_err(|e| e.to_string())?; }
                    Ok(json!({ "updated": true, "sectionId": sid }))
                })?;
                ok(result)
            }
            "delete_set" => {
                if p.confirm != Some(true) { return Err(err("删除试卷需要 confirm=true。")); }
                let set_id = p.set_id.ok_or_else(|| err("delete_set 需要 set_id。"))?;
                let result = self.with_conn_mut(move |c| {
                    let tx = c.transaction().map_err(|e| e.to_string())?;
                    tx.execute("DELETE FROM answers WHERE attempt_id IN (SELECT id FROM attempts WHERE set_id=?)", rusqlite::params![set_id]).map_err(|e| e.to_string())?;
                    tx.execute("DELETE FROM attempts WHERE set_id=?", rusqlite::params![set_id]).map_err(|e| e.to_string())?;
                    tx.execute("DELETE FROM import_batches WHERE set_id=?", rusqlite::params![set_id]).map_err(|e| e.to_string())?;
                    let removed = tx.execute("DELETE FROM sets WHERE id=?", rusqlite::params![set_id]).map_err(|e| e.to_string())?;
                    if removed == 0 { return Err("试卷不存在，可能已经被删除。".into()); }
                    tx.commit().map_err(|e| e.to_string())?;
                    Ok(json!({ "deleted": true, "setId": set_id }))
                })?;
                ok(result)
            }
            other => Err(err(format!("未知的 edit action：{other}"))),
        }
    }

    #[tool(name = "update_question", description = "修改一道题的题型、标签或题干 HTML。只传需要改的字段。", annotations(read_only_hint = false, destructive_hint = false, idempotent_hint = true))]
    async fn update_question(&self, Parameters(p): Parameters<UpdateQuestionParams>) -> Result<Json<Value>, McpError> {
        self.write_guard()?;
        self.with_conn(|c| {
            if let Some(qtype) = p.qtype.filter(|s| !s.trim().is_empty()) {
                c.execute("UPDATE questions SET qtype=? WHERE id=?", rusqlite::params![qtype, p.question_id]).map_err(|e| e.to_string())?;
            }
            if let Some(tags) = p.tags {
                c.execute("UPDATE questions SET tags_json=? WHERE id=?", rusqlite::params![serde_json::to_string(&tags).unwrap_or_else(|_| "[]".into()), p.question_id]).map_err(|e| e.to_string())?;
            }
            if let Some(stem) = p.stem {
                if stem.len() > 8 * 1024 * 1024 {
                    return Err("题图太大：单题题干请控制在 8 MB 以内。".into());
                }
                c.execute("UPDATE questions SET stem=? WHERE id=?", rusqlite::params![stem, p.question_id]).map_err(|e| e.to_string())?;
            }
            Ok(())
        })?;
        ok(json!({ "question_id": p.question_id, "updated": true }))
    }

    #[tool(name = "rename_set", description = "重命名一份试卷。", annotations(read_only_hint = false, destructive_hint = false, idempotent_hint = true))]
    async fn rename_set(&self, Parameters(p): Parameters<RenameSetParams>) -> Result<Json<Value>, McpError> {
        self.write_guard()?;
        let summary = self.with_conn(|c| { repo::update_set_title(c, p.set_id, &p.title)?; repo::set_summary(c, Some(p.set_id)) })?;
        ok(summary)
    }

    #[tool(name = "update_set_tags", description = "覆盖一份试卷的标签列表。", annotations(read_only_hint = false, destructive_hint = false, idempotent_hint = true))]
    async fn update_set_tags(&self, Parameters(p): Parameters<SetTagsParams>) -> Result<Json<Value>, McpError> {
        self.write_guard()?;
        let summary = self.with_conn(|c| { repo::update_set_tags(c, p.set_id, &p.tags)?; repo::set_summary(c, Some(p.set_id)) })?;
        ok(summary)
    }

    #[tool(name = "create_folder", description = "新建一个文件夹，返回 folder_id。", annotations(read_only_hint = false, destructive_hint = false, idempotent_hint = false))]
    async fn create_folder(&self, Parameters(p): Parameters<CreateFolderParams>) -> Result<Json<Value>, McpError> {
        self.write_guard()?;
        let id = self.with_conn(|c| {
            let name = p.name.trim();
            if name.is_empty() { return Err("文件夹名不能为空。".into()); }
            c.execute("INSERT INTO folders(name,parent_id,sort,created_at) VALUES(?,?,0,?)", rusqlite::params![name, p.parent_id, crate::db::now()]).map_err(|e| e.to_string())?;
            Ok(c.last_insert_rowid())
        })?;
        ok(json!({ "folder_id": id }))
    }

    #[tool(name = "assign_set_folder", description = "把一份试卷移到某个文件夹；folder_id 为空表示移出文件夹。", annotations(read_only_hint = false, destructive_hint = false, idempotent_hint = true))]
    async fn assign_set_folder(&self, Parameters(p): Parameters<AssignFolderParams>) -> Result<Json<Value>, McpError> {
        self.write_guard()?;
        self.with_conn(|c| {
            if let Some(fid) = p.folder_id {
                let exists: i64 = c.query_row("SELECT COUNT(*) FROM folders WHERE id=?", rusqlite::params![fid], |r| r.get(0)).unwrap_or(0);
                if exists == 0 { return Err("目标文件夹不存在。".into()); }
            }
            c.execute("UPDATE sets SET folder_id=? WHERE id=?", rusqlite::params![p.folder_id, p.set_id]).map_err(|e| e.to_string())?;
            Ok(())
        })?;
        ok(json!({ "set_id": p.set_id, "folder_id": p.folder_id, "updated": true }))
    }
}

#[tool_handler]
impl ServerHandler for TokeruMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build()).with_instructions(
            "Tokeru 是本地试卷与练习数据库。先用 get_import_spec 读取导入规范，再 preview_import 校验，确认后用 confirm_import 写入。所有写操作在只读模式下会被拒绝。",
        )
    }
}

#[tauri::command]
pub fn mcp_status(state: TauriState<'_, Db>, manager: TauriState<'_, McpManager>) -> Result<McpStatus, String> {
    let conn = state.conn.lock().map_err(|_| "数据库锁不可用。".to_string())?;
    let enabled = crate::db::get_setting(&conn, "mcp_enabled").as_deref() == Some("1");
    let port = crate::db::get_setting(&conn, "mcp_port").and_then(|v| v.parse().ok()).unwrap_or(DEFAULT_PORT);
    let readonly = crate::db::get_setting(&conn, "mcp_readonly").as_deref() != Some("0");
    let token = crate::db::get_setting(&conn, "mcp_token").unwrap_or_default();
    drop(conn);
    let mut status = status_of(&manager);
    status.enabled = enabled;
    /* 关闭时服务没启动，manager 里没有端口/Token；用设置里的值填回去，设置页才能复制完整配置。 */
    if status.token.trim().is_empty() {
        status.token = token;
    }
    if !status.running {
        status.port = port;
        status.readonly = readonly;
        status.url = format!("http://127.0.0.1:{port}/mcp");
    }
    Ok(status)
}

#[tauri::command]
pub async fn mcp_configure(
    app: AppHandle,
    state: TauriState<'_, Db>,
    manager: TauriState<'_, McpManager>,
    enabled: bool,
    port: Option<u16>,
    readonly: Option<bool>,
    regenerate: Option<bool>,
) -> Result<McpStatus, String> {
    let (port, token, readonly) = {
        let conn = state.conn.lock().map_err(|_| "数据库锁不可用。".to_string())?;
        let port = port.unwrap_or_else(|| crate::db::get_setting(&conn, "mcp_port").and_then(|v| v.parse().ok()).unwrap_or(DEFAULT_PORT));
        let readonly = readonly.unwrap_or_else(|| crate::db::get_setting(&conn, "mcp_readonly").as_deref() != Some("0"));
        let mut token = crate::db::get_setting(&conn, "mcp_token").unwrap_or_default();
        if regenerate.unwrap_or(false) || token.trim().is_empty() {
            token = new_token();
            crate::db::put_setting(&conn, "mcp_token", &token);
        }
        crate::db::put_setting(&conn, "mcp_enabled", if enabled { "1" } else { "0" });
        crate::db::put_setting(&conn, "mcp_port", &port.to_string());
        crate::db::put_setting(&conn, "mcp_readonly", if readonly { "1" } else { "0" });
        (port, token, readonly)
    };
    if enabled {
        if let Err(e) = manager.start(app.clone(), port, token.clone(), readonly).await {
            manager.set_error(e.clone());
            return Err(e);
        }
    } else {
        manager.stop();
    }
    let mut status = status_of(&manager);
    status.enabled = enabled;
    if !enabled {
        status.port = port;
        status.readonly = readonly;
        status.url = format!("http://127.0.0.1:{port}/mcp");
        status.token = token;
    }
    Ok(status)
}

#[tauri::command]
pub async fn mcp_regenerate_token(
    app: AppHandle,
    state: TauriState<'_, Db>,
    manager: TauriState<'_, McpManager>,
) -> Result<McpStatus, String> {
    let (enabled, port, readonly, token) = {
        let conn = state.conn.lock().map_err(|_| "数据库锁不可用。".to_string())?;
        let enabled = crate::db::get_setting(&conn, "mcp_enabled").as_deref() == Some("1");
        let port = crate::db::get_setting(&conn, "mcp_port").and_then(|v| v.parse().ok()).unwrap_or(DEFAULT_PORT);
        let readonly = crate::db::get_setting(&conn, "mcp_readonly").as_deref() != Some("0");
        let token = new_token();
        crate::db::put_setting(&conn, "mcp_token", &token);
        (enabled, port, readonly, token)
    };
    if enabled {
        manager.start(app.clone(), port, token.clone(), readonly).await?;
    }
    let mut status = status_of(&manager);
    status.enabled = enabled;
    if !enabled {
        status.port = port;
        status.readonly = readonly;
        status.url = format!("http://127.0.0.1:{port}/mcp");
        status.token = token;
    }
    Ok(status)
}

pub async fn boot(app: AppHandle) {
    let Some(manager) = app.try_state::<McpManager>() else { return };
    let Some(db) = app.try_state::<Db>() else { return };
    let (enabled, port, readonly, token) = {
        let conn = match db.conn.lock() {
            Ok(c) => c,
            Err(_) => return,
        };
        let enabled = crate::db::get_setting(&conn, "mcp_enabled").as_deref() == Some("1");
        let port = crate::db::get_setting(&conn, "mcp_port").and_then(|v| v.parse().ok()).unwrap_or(DEFAULT_PORT);
        let readonly = crate::db::get_setting(&conn, "mcp_readonly").as_deref() != Some("0");
        let mut token = crate::db::get_setting(&conn, "mcp_token").unwrap_or_default();
        if token.trim().is_empty() {
            token = new_token();
            crate::db::put_setting(&conn, "mcp_token", &token);
        }
        (enabled, port, readonly, token)
    };
    drop(db);
    if enabled {
        if let Err(e) = manager.start(app.clone(), port, token.clone(), readonly).await {
            manager.set_error(e);
        }
    }
}

fn new_token() -> String {
    format!("tk_{}", uuid::Uuid::new_v4().simple())
}
