use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct Db {
    pub conn: Mutex<Connection>,
    pub data_dir: PathBuf,
}

impl Db {
    pub fn open(app_data: &Path) -> Result<Self, String> {
        fs::create_dir_all(app_data).map_err(|e| format!("create data dir: {e}"))?;
        fs::create_dir_all(app_data.join("media")).map_err(|e| format!("create media: {e}"))?;
        fs::create_dir_all(app_data.join("backups")).map_err(|e| format!("create backups ({}): {e}", app_data.display()))?;
        let conn = Connection::open(app_data.join("tokero.db")).map_err(|e| format!("open sqlite: {e}"))?;
        init_schema(&conn).map_err(|e| format!("init schema: {e}"))?;
        Ok(Self { conn: Mutex::new(conn), data_dir: app_data.to_path_buf() })
    }
}

pub fn now() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn today_plus(days: i64) -> String {
    (chrono::Local::now() + chrono::Duration::days(days)).format("%Y-%m-%d").to_string()
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS sets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            subtitle TEXT NOT NULL DEFAULT '',
            year TEXT NOT NULL DEFAULT '',
            duration_minutes INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT 'original',
            audio_file TEXT,
            description TEXT NOT NULL DEFAULT '',
            tags_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            parent_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
            sort INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            set_id INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
            key TEXT NOT NULL,
            title TEXT NOT NULL,
            subtitle TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL DEFAULT '',
            position INTEGER NOT NULL DEFAULT 0,
            audio_file TEXT,
            material_id INTEGER
        );
        CREATE TABLE IF NOT EXISTS materials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            set_id INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
            key TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            set_id INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
            section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
            material_id INTEGER,
            number INTEGER NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            qtype TEXT NOT NULL,
            stem TEXT NOT NULL DEFAULT '',
            options_json TEXT NOT NULL DEFAULT '[]',
            answer_json TEXT NOT NULL DEFAULT '{}',
            explanation TEXT NOT NULL DEFAULT '',
            points INTEGER NOT NULL DEFAULT 1,
            position INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT 'original',
            tags_json TEXT NOT NULL DEFAULT '[]',
            archived INTEGER NOT NULL DEFAULT 0,
            folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            set_id INTEGER REFERENCES sets(id) ON DELETE SET NULL,
            title TEXT NOT NULL,
            mode TEXT NOT NULL DEFAULT 'custom',
            status TEXT NOT NULL DEFAULT 'in_progress',
            started_at TEXT NOT NULL,
            finished_at TEXT,
            time_limit INTEGER NOT NULL DEFAULT 0,
            total_score INTEGER NOT NULL DEFAULT 0,
            max_score INTEGER NOT NULL DEFAULT 0,
            question_ids_json TEXT NOT NULL DEFAULT '[]',
            paper_answers_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS answers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
            question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
            raw TEXT NOT NULL DEFAULT '',
            is_correct INTEGER,
            score INTEGER NOT NULL DEFAULT 0,
            max_score INTEGER NOT NULL DEFAULT 1,
            graded_by TEXT NOT NULL DEFAULT 'auto',
            comment TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL,
            UNIQUE(attempt_id, question_id)
        );
        CREATE TABLE IF NOT EXISTS mistakes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question_id INTEGER NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
            origin TEXT NOT NULL DEFAULT 'wrong',
            wrong_count INTEGER NOT NULL DEFAULT 1,
            correct_streak INTEGER NOT NULL DEFAULT 0,
            last_wrong_at TEXT,
            last_correct_at TEXT,
            status TEXT NOT NULL DEFAULT 'learning',
            due_at TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS ai_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question_id INTEGER,
            mode TEXT NOT NULL,
            model TEXT NOT NULL,
            custom_prompt TEXT NOT NULL DEFAULT '',
            prompt_summary TEXT NOT NULL DEFAULT '',
            response_html TEXT NOT NULL DEFAULT '',
            reasoning_html TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS import_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            set_id INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
            title TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tag_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            color TEXT NOT NULL DEFAULT 'violet',
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tag_assignments (
            tag TEXT PRIMARY KEY,
            group_id INTEGER REFERENCES tag_groups(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_questions_set ON questions(set_id);
        CREATE INDEX IF NOT EXISTS idx_answers_attempt ON answers(attempt_id);
        CREATE INDEX IF NOT EXISTS idx_attempts_status ON attempts(status);
        "#,
    )
    .map_err(|e| e.to_string())?;

    let _ = conn.execute("ALTER TABLE sets ADD COLUMN folder_id INTEGER", []);
    let _ = conn.execute("ALTER TABLE sets ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'", []);
    let _ = conn.execute("ALTER TABLE questions ADD COLUMN folder_id INTEGER", []);
    let _ = conn.execute("ALTER TABLE mistakes ADD COLUMN origin TEXT NOT NULL DEFAULT 'wrong'", []);
    let _ = conn.execute("ALTER TABLE ai_runs ADD COLUMN reasoning_html TEXT NOT NULL DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE answers ADD COLUMN comment TEXT NOT NULL DEFAULT ''", []);
    seed_tag_groups(conn).map_err(|e| format!("seed tag groups: {e}"))?;
    Ok(())
}

/// 首次创建标签栏时写入「学科 / 题型 / 难度」并归类常见旧标签。
/// 用 settings 里的标记保证只执行一次：用户删掉分组后不会在下次启动时又冒出来。
fn seed_tag_groups(conn: &Connection) -> Result<(), String> {
    if get_setting(conn, "tag_groups_seeded").is_some() {
        return Ok(());
    }
    let groups = [
        ("学科", "violet"),
        ("题型", "teal"),
        ("难度", "amber"),
    ];
    for (index, (name, color)) in groups.iter().enumerate() {
        conn.execute(
            "INSERT OR IGNORE INTO tag_groups(name,color,position,created_at) VALUES(?,?,?,?)",
            params![name, color, index as i64, now()],
        )
        .map_err(|e| e.to_string())?;
    }
    let subjects = ["英语", "数学", "语文", "物理", "化学", "生物", "政治", "历史", "地理"];
    let types = [
        "单项选择", "多项选择", "单选", "多选", "填空", "完形", "完形填空", "阅读", "听力", "听写",
        "简答", "简答", "写作", "作文", "翻译", "改错", "判断", "匹配", "词汇", "语法", "听力音频",
    ];
    let levels = ["易", "中", "难"];
    let assign = |tag: &str, group: &str| -> Result<(), String> {
        let gid: Option<i64> = conn
            .query_row("SELECT id FROM tag_groups WHERE name=?", params![group], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(gid) = gid {
            conn.execute(
                "INSERT OR IGNORE INTO tag_assignments(tag,group_id) VALUES(?,?)",
                params![tag, gid],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    };
    for tag in subjects { assign(tag, "学科")?; }
    for tag in types { assign(tag, "题型")?; }
    for tag in levels { assign(tag, "难度")?; }
    put_setting(conn, "tag_groups_seeded", "1");
    Ok(())
}

pub fn seed_if_empty(conn: &Connection, data_dir: &Path, seed_json: &str, audio_source: Option<&Path>) -> Result<(), String> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM questions", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if count > 0 {
        return Ok(());
    }
    let root: serde_json::Value = serde_json::from_str(seed_json).map_err(|e| e.to_string())?;
    let set = &root["set"];
    conn.execute(
        "INSERT INTO sets(title,subtitle,year,duration_minutes,source,audio_file,description,tags_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        params![
            set["title"].as_str().unwrap_or("未命名题集"),
            set["subtitle"].as_str().unwrap_or(""),
            set["year"].as_i64().map(|n| n.to_string()).or_else(|| set["year"].as_str().map(str::to_string)).unwrap_or_default(),
            set["duration_minutes"].as_i64().unwrap_or(130),
            set["source"].as_str().unwrap_or("original"),
            set["audio_file"].as_str(),
            set["description"].as_str().unwrap_or(""),
            serde_json::to_string(&set["tags"]).unwrap_or_else(|_| "[]".into()),
            now()
        ],
    )
    .map_err(|e| e.to_string())?;
    let set_id = conn.last_insert_rowid();

    let mut material_ids: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    if let Some(materials) = root["materials"].as_array() {
        for m in materials {
            let key = m["key"].as_str().unwrap_or("").to_string();
            conn.execute(
                "INSERT INTO materials(set_id,key,title,content) VALUES(?,?,?,?)",
                params![set_id, key, m["title"].as_str().unwrap_or(""), m["content"].as_str().unwrap_or("")],
            )
            .map_err(|e| e.to_string())?;
            material_ids.insert(key, conn.last_insert_rowid());
        }
    }

    let mut section_ids: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    if let Some(sections) = root["sections"].as_array() {
        for (i, s) in sections.iter().enumerate() {
            let key = s["key"].as_str().unwrap_or("").to_string();
            let mid = s["material"].as_str().and_then(|k| material_ids.get(k).copied());
            conn.execute(
                "INSERT INTO sections(set_id,key,title,subtitle,kind,position,audio_file,material_id) VALUES(?,?,?,?,?,?,?,?)",
                params![
                    set_id,
                    key,
                    s["title"].as_str().unwrap_or(""),
                    s["subtitle"].as_str().unwrap_or(""),
                    s["kind"].as_str().unwrap_or(""),
                    i as i64,
                    s["audio_file"].as_str(),
                    mid
                ],
            )
            .map_err(|e| e.to_string())?;
            section_ids.insert(key, conn.last_insert_rowid());
        }
    }

    if let Some(questions) = root["questions"].as_array() {
        for (i, q) in questions.iter().enumerate() {
            let key = q["section"].as_str().unwrap_or("");
            let section_id = *section_ids.get(key).ok_or_else(|| format!("unknown section {key}"))?;
            let material_id = q["material"].as_str().and_then(|k| material_ids.get(k).copied());
            conn.execute(
                "INSERT INTO questions(set_id,section_id,material_id,number,label,qtype,stem,options_json,answer_json,explanation,points,position,source,tags_json,archived,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)",
                params![
                    set_id,
                    section_id,
                    material_id,
                    q["number"].as_i64().unwrap_or((i + 1) as i64),
                    q["label"].as_str().unwrap_or(""),
                    q["qtype"].as_str().unwrap_or("fill_blank"),
                    q["stem"].as_str().unwrap_or(""),
                    serde_json::to_string(&q["options"]).unwrap_or_else(|_| "[]".into()),
                    serde_json::to_string(&q["answer"]).unwrap_or_else(|_| "{}".into()),
                    q["explanation"].as_str().unwrap_or(""),
                    q["points"].as_i64().unwrap_or(1),
                    i as i64,
                    q["source"].as_str().unwrap_or("original"),
                    serde_json::to_string(&q["tags"]).unwrap_or_else(|_| "[]".into()),
                    now()
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    if let Some(af) = set["audio_file"].as_str() {
        if let Some(src) = audio_source {
            if src.exists() {
                let _ = fs::copy(src, data_dir.join("media").join(af));
            }
        }
    }
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key=?", params![key], |r| r.get(0)).optional().ok().flatten()
}

pub fn put_setting(conn: &Connection, key: &str, value: &str) {
    let _ = conn.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key, value]);
}