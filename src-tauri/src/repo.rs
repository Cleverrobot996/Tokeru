use crate::db::now;
use crate::models::*;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::Value;
use std::collections::HashMap;

const Q_COLS: &str = "id,set_id,section_id,material_id,number,label,qtype,stem,options_json,answer_json,explanation,points,position,source,tags_json,archived";

pub fn row_to_question(row: &Row) -> rusqlite::Result<Question> {
    let options: Value = serde_json::from_str(&row.get::<_, String>(8)?).unwrap_or(Value::Array(vec![]));
    let answer: Value = serde_json::from_str(&row.get::<_, String>(9)?).unwrap_or(Value::Object(Default::default()));
    let tags: Vec<String> = serde_json::from_str(&row.get::<_, String>(14)?).unwrap_or_default();
    Ok(Question {
        id: row.get(0)?,
        set_id: row.get(1)?,
        section_id: row.get(2)?,
        material_id: row.get(3)?,
        number: row.get(4)?,
        label: row.get(5)?,
        qtype: row.get(6)?,
        stem: row.get(7)?,
        options: serde_json::from_value(options).unwrap_or_default(),
        answer,
        explanation: row.get(10)?,
        points: row.get(11)?,
        position: row.get(12)?,
        source: row.get(13)?,
        tags,
        archived: row.get::<_, i64>(15)? != 0,
    })
}

pub fn question_by_id(conn: &Connection, id: i64) -> Result<Question, String> {
    conn.query_row(&format!("SELECT {Q_COLS} FROM questions WHERE id=?"), params![id], row_to_question)
        .map_err(|e| e.to_string())
}

pub fn section_by_id(conn: &Connection, id: i64) -> Result<Section, String> {
    conn.query_row(
        "SELECT id,set_id,key,title,subtitle,kind,position,audio_file,material_id FROM sections WHERE id=?",
        params![id],
        |r| Ok(Section { id: r.get(0)?, set_id: r.get(1)?, key: r.get(2)?, title: r.get(3)?, subtitle: r.get(4)?, kind: r.get(5)?, position: r.get(6)?, audio_file: r.get(7)?, material_id: r.get(8)? }),
    )
    .map_err(|e| e.to_string())
}

pub fn material_by_id(conn: &Connection, id: i64) -> Result<Material, String> {
    conn.query_row("SELECT id,set_id,key,title,content FROM materials WHERE id=?", params![id], |r| {
        Ok(Material { id: r.get(0)?, set_id: r.get(1)?, key: r.get(2)?, title: r.get(3)?, content: r.get(4)? })
    })
    .map_err(|e| e.to_string())
}

const SET_SUMMARY_COLS: &str = "SELECT s.id,s.title,s.subtitle,s.year,s.duration_minutes,s.source,s.audio_file,s.description,
    (SELECT COUNT(*) FROM questions q WHERE q.set_id=s.id),
    (SELECT COUNT(*) FROM sections x WHERE x.set_id=s.id),
    (SELECT COALESCE(SUM(points),0) FROM questions q WHERE q.set_id=s.id),
    (SELECT MAX(started_at) FROM attempts a WHERE a.set_id=s.id),
    s.tags_json,s.folder_id
    FROM sets s";

fn row_to_set_summary(r: &Row) -> rusqlite::Result<SetSummary> {
    Ok(SetSummary {
        id: r.get(0)?, title: r.get(1)?, subtitle: r.get(2)?, year: r.get(3)?, duration_minutes: r.get(4)?,
        source: r.get(5)?, audio_file: r.get(6)?, description: r.get(7)?, question_count: r.get(8)?,
        section_count: r.get(9)?, total_points: r.get(10)?, last_attempt_at: r.get(11)?,
        tags: parse_tags(r.get::<_, Option<String>>(12)?),
        folder_id: r.get(13)?,
    })
}

pub fn parse_tags(raw: Option<String>) -> Vec<String> {
    raw
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// 全部试卷（按 id 升序）。首页与题库的试卷列表都用它。
pub fn list_set_summaries(conn: &Connection) -> Result<Vec<SetSummary>, String> {
    let mut stmt = conn.prepare(&format!("{SET_SUMMARY_COLS} ORDER BY s.id")).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_set_summary).map_err(|e| e.to_string())?;
    let out: Result<Vec<SetSummary>, rusqlite::Error> = rows.collect();
    out.map_err(|e| e.to_string())
}

pub fn set_summary(conn: &Connection, set_id: Option<i64>) -> Result<SetSummary, String> {
    if let Some(id) = set_id {
        conn.query_row(&format!("{SET_SUMMARY_COLS} WHERE s.id=?"), params![id], row_to_set_summary).map_err(|e| e.to_string())
    } else {
        conn.query_row(&format!("{SET_SUMMARY_COLS} ORDER BY s.id LIMIT 1"), [], row_to_set_summary).map_err(|e| e.to_string())
    }
}

pub fn update_set_title(conn: &Connection, set_id: i64, title: &str) -> Result<(), String> {
    let title = title.trim();
    if title.is_empty() { return Err("试卷名不能为空。".into()); }
    conn.execute("UPDATE sets SET title=? WHERE id=?", params![title, set_id]).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_set_tags(conn: &Connection, set_id: i64, tags: &[String]) -> Result<(), String> {
    let clean: Vec<String> = tags.iter().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect();
    conn.execute("UPDATE sets SET tags_json=? WHERE id=?", params![serde_json::to_string(&clean).map_err(|e| e.to_string())?, set_id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// 标签栏列表：名称、颜色、排序和已归类标签数。
pub fn list_tag_groups(conn: &Connection) -> Result<Vec<TagGroup>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT g.id,g.name,g.color,g.position,
             (SELECT COUNT(*) FROM tag_assignments a WHERE a.group_id=g.id)
             FROM tag_groups g ORDER BY g.position,g.id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(TagGroup {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                position: r.get(3)?,
                tag_count: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn tag_group_id_by_name(conn: &Connection, name: &str) -> Result<Option<i64>, String> {
    conn.query_row("SELECT id FROM tag_groups WHERE name=?", params![name.trim()], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())
}

/// 把标签归入某一栏；group_id 为 None 时移出（未归类）。
pub fn set_tag_group(conn: &Connection, tag: &str, group_id: Option<i64>) -> Result<(), String> {
    let tag = tag.trim();
    if tag.is_empty() {
        return Err("标签名不能为空。".into());
    }
    match group_id {
        Some(gid) => {
            let exists: Option<i64> = conn
                .query_row("SELECT id FROM tag_groups WHERE id=?", params![gid], |r| r.get(0))
                .optional()
                .map_err(|e| e.to_string())?;
            if exists.is_none() {
                return Err("标签栏不存在，可能已被删除。".into());
            }
            conn.execute(
                "INSERT INTO tag_assignments(tag,group_id) VALUES(?,?) ON CONFLICT(tag) DO UPDATE SET group_id=excluded.group_id",
                params![tag, gid],
            )
            .map_err(|e| e.to_string())?;
        }
        None => {
            conn.execute("DELETE FROM tag_assignments WHERE tag=?", params![tag]).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 全部标签及使用次数：集合标签（学科/来源等）与题目标签（题型等）合并。
pub fn list_tags(conn: &Connection) -> Result<Vec<TagInfo>, String> {
    let mut groups: HashMap<String, (Option<i64>, String, String)> = HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT a.tag,g.id,g.name,g.color FROM tag_assignments a LEFT JOIN tag_groups g ON g.id=a.group_id")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                let tag: String = r.get(0)?;
                Ok((tag, (r.get(1)?, r.get::<_, Option<String>>(2)?.unwrap_or_default(), r.get::<_, Option<String>>(3)?.unwrap_or_default())))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (tag, group) = row.map_err(|e| e.to_string())?;
            groups.insert(tag, group);
        }
    }
    let mut map: std::collections::BTreeMap<String, (i64, i64)> = std::collections::BTreeMap::new();
    let mut stmt = conn.prepare("SELECT tags_json FROM sets").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| r.get::<_, Option<String>>(0)).map_err(|e| e.to_string())?;
    for row in rows {
        for tag in parse_tags(row.map_err(|e| e.to_string())?) {
            map.entry(tag).or_default().0 += 1;
        }
    }
    let mut stmt = conn.prepare("SELECT tags_json FROM questions WHERE archived=0").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| r.get::<_, Option<String>>(0)).map_err(|e| e.to_string())?;
    for row in rows {
        for tag in parse_tags(row.map_err(|e| e.to_string())?) {
            map.entry(tag).or_default().1 += 1;
        }
    }
    let mut out: Vec<TagInfo> = map
        .into_iter()
        .map(|(name, (set_count, question_count))| {
            let (group_id, group_name, group_color) = groups.remove(&name).unwrap_or((None, String::new(), String::new()));
            TagInfo { name, set_count, question_count, group_id, group_name, group_color }
        })
        .collect();
    out.sort_by(|a, b| (b.set_count + b.question_count).cmp(&(a.set_count + a.question_count)).then(a.name.cmp(&b.name)));
    Ok(out)
}

pub fn get_set_detail(conn: &Connection, set_id: Option<i64>) -> Result<SetDetail, String> {
    let summary = set_summary(conn, set_id)?;
    let id = summary.id;
    let sections = {
        let mut stmt = conn.prepare("SELECT id,set_id,key,title,subtitle,kind,position,audio_file,material_id FROM sections WHERE set_id=? ORDER BY position").map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![id], |r| Ok(Section { id: r.get(0)?, set_id: r.get(1)?, key: r.get(2)?, title: r.get(3)?, subtitle: r.get(4)?, kind: r.get(5)?, position: r.get(6)?, audio_file: r.get(7)?, material_id: r.get(8)? })).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    let materials = {
        let mut stmt = conn.prepare("SELECT id,set_id,key,title,content FROM materials WHERE set_id=? ORDER BY id").map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![id], |r| Ok(Material { id: r.get(0)?, set_id: r.get(1)?, key: r.get(2)?, title: r.get(3)?, content: r.get(4)? })).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    let questions = {
        let mut stmt = conn.prepare(&format!("SELECT {Q_COLS} FROM questions WHERE set_id=? ORDER BY position,number")).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![id], row_to_question).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    Ok(SetDetail { summary, sections, materials, questions })
}

pub fn list_bank(conn: &Connection, f: &BankFilters) -> Result<BankResult, String> {
    let mut where_sql = vec!["1=1".to_string()];
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = vec![];
    if let Some(v) = f.set_id { where_sql.push("set_id=?".into()); args.push(Box::new(v)); }
    if let Some(v) = f.section_id { where_sql.push("section_id=?".into()); args.push(Box::new(v)); }
    if let Some(v) = f.qtype.as_ref().filter(|v| !v.is_empty()) { where_sql.push("qtype=?".into()); args.push(Box::new(v.clone())); }
    if let Some(v) = f.folder_id { where_sql.push("folder_id=?".into()); args.push(Box::new(v)); }
    if let Some(ids) = f.set_ids.as_ref().filter(|v| !v.is_empty()) {
        let marks = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        where_sql.push(format!("set_id IN ({marks})"));
        for id in ids { args.push(Box::new(*id)); }
    }
    if let Some(v) = f.q.as_ref().filter(|v| !v.trim().is_empty()) {
        where_sql.push("(stem LIKE ? OR explanation LIKE ?)".into());
        let pat = format!("%{}%", v);
        args.push(Box::new(pat.clone()));
        args.push(Box::new(pat));
    }
    match f.archived.as_deref() {
        Some("archived") => where_sql.push("archived=1".into()),
        Some("all") => {}
        _ => where_sql.push("archived=0".into()),
    }
    let where_str = where_sql.join(" AND ");
    let total: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM questions WHERE {where_str}"), rusqlite::params_from_iter(args.iter().map(|b| b.as_ref())), |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let order = match f.sort.as_deref() {
        Some("added_desc") => "id DESC",
        Some("added_asc") => "id ASC",
        Some("number_desc") => "number DESC",
        _ => "position ASC, number ASC",
    };
    let limit = f.limit.unwrap_or(500).clamp(1, 2000);
    let mut want_tags: Vec<String> = f.tags.clone().unwrap_or_default().into_iter().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect();
    if let Some(tag) = f.tag.as_ref().map(|t| t.trim()).filter(|t| !t.is_empty()) {
        if !want_tags.iter().any(|x| x == tag) {
            want_tags.push(tag.to_string());
        }
    }
    let scan_limit = if want_tags.is_empty() { limit } else { 5000 };
    let sql = format!("SELECT {Q_COLS} FROM questions WHERE {where_str} ORDER BY {order} LIMIT {scan_limit}");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(args.iter().map(|b| b.as_ref())), row_to_question)
        .map_err(|e| e.to_string())?;
    let mut questions = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    let mut total = total;
    if !want_tags.is_empty() {
        questions.retain(|q| want_tags.iter().all(|tag| q.tags.iter().any(|x| x == tag)));
        total = questions.len() as i64;
        questions.truncate(limit as usize);
    }
    Ok(BankResult { total, questions })
}

pub fn attempt_summary(conn: &Connection, id: i64) -> Result<AttemptSummary, String> {
    conn.query_row(
        "SELECT a.id,a.set_id,a.title,a.mode,a.status,a.started_at,a.finished_at,a.total_score,a.max_score,
         (SELECT COUNT(*) FROM json_each(a.question_ids_json)),
         (SELECT COUNT(*) FROM answers x WHERE x.attempt_id=a.id AND trim(x.raw)<>'')
         FROM attempts a WHERE a.id=?",
        params![id],
        |r| Ok(AttemptSummary {
            id: r.get(0)?, set_id: r.get(1)?, title: r.get(2)?, mode: r.get(3)?, status: r.get(4)?,
            started_at: r.get(5)?, finished_at: r.get(6)?, total_score: r.get(7)?, max_score: r.get(8)?,
            question_count: r.get(9)?, answered_count: r.get(10)?,
        }),
    )
    .map_err(|e| e.to_string())
}

pub fn get_attempt_detail(conn: &Connection, id: i64) -> Result<AttemptDetail, String> {
    let summary = attempt_summary(conn, id)?;
    let (ids_raw, time_limit): (String, i64) = conn
        .query_row("SELECT question_ids_json,time_limit FROM attempts WHERE id=?", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?;
    let ids: Vec<i64> = serde_json::from_str(&ids_raw).unwrap_or_default();
    let mut answers: HashMap<i64, (String, Option<i64>, i64, Option<String>, String)> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT question_id,raw,is_correct,score,graded_by,comment FROM answers WHERE attempt_id=?").map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![id], |r| Ok((r.get::<_, i64>(0)?, (r.get::<_, String>(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get::<_, String>(5)?)))).map_err(|e| e.to_string())?;
        for row in rows {
            let (qid, data) = row.map_err(|e| e.to_string())?;
            answers.insert(qid, data);
        }
    }
    let mut questions = vec![];
    for qid in &ids {
        if let Ok(q) = question_by_id(conn, *qid) {
            let a = answers.get(&qid).cloned().unwrap_or(("".into(), None, 0, None, String::new()));
            questions.push(AttemptQuestion { question: q, answer_raw: a.0, is_correct: a.1, score: if a.3.is_some() { Some(a.2) } else { None }, graded_by: a.3, comment: a.4 });
        }
    }
    let mut section_ids: Vec<i64> = questions.iter().map(|q| q.question.section_id).collect();
    section_ids.sort_unstable();
    section_ids.dedup();
    let mut sections = vec![];
    for sid in section_ids {
        if let Ok(s) = section_by_id(conn, sid) { sections.push(s); }
    }
    let mut material_ids: Vec<i64> = questions.iter().filter_map(|q| q.question.material_id).collect();
    material_ids.sort_unstable();
    material_ids.dedup();
    let mut materials = vec![];
    for mid in material_ids {
        if let Ok(m) = material_by_id(conn, mid) { materials.push(m); }
    }
    let set = match summary.set_id { Some(sid) => set_summary(conn, Some(sid)).ok(), None => None };
    Ok(AttemptDetail { summary, question_ids: ids, questions, sections, materials, time_limit, set })
}

pub fn list_records(conn: &Connection, from: Option<String>, to: Option<String>) -> Result<Vec<AttemptSummary>, String> {
    let mut sql = "SELECT a.id FROM attempts a WHERE a.status='submitted'".to_string();
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = vec![];
    if let Some(v) = from.filter(|v| !v.is_empty()) { sql.push_str(" AND date(a.finished_at)>=date(?)"); args.push(Box::new(v)); }
    if let Some(v) = to.filter(|v| !v.is_empty()) { sql.push_str(" AND date(a.finished_at)<=date(?)"); args.push(Box::new(v)); }
    sql.push_str(" ORDER BY coalesce(a.finished_at,a.started_at) DESC LIMIT 300");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let ids = stmt.query_map(rusqlite::params_from_iter(args.iter().map(|b| b.as_ref())), |r| r.get::<_, i64>(0)).map_err(|e| e.to_string())?;
    let mut out = vec![];
    for id in ids {
        if let Ok(id) = id {
            if let Ok(s) = attempt_summary(conn, id) { out.push(s); }
        }
    }
    Ok(out)
}

pub fn list_mistakes(conn: &Connection) -> Result<Vec<Mistake>, String> {
    let mut stmt = conn.prepare(
        "SELECT m.id,q.id,q.set_id,q.section_id,q.material_id,q.number,q.label,q.qtype,q.stem,q.options_json,q.answer_json,q.explanation,q.points,q.position,q.source,q.tags_json,q.archived,
         s.title,sec.title,m.wrong_count,m.correct_streak,m.last_wrong_at,m.last_correct_at,m.status,m.origin,m.due_at,m.note
         FROM mistakes m JOIN questions q ON q.id=m.question_id
         LEFT JOIN sets s ON s.id=q.set_id LEFT JOIN sections sec ON sec.id=q.section_id
         ORDER BY date(m.due_at) ASC, m.id DESC",
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| {
        let q = Question {
            id: r.get(1)?, set_id: r.get(2)?, section_id: r.get(3)?, material_id: r.get(4)?, number: r.get(5)?,
            label: r.get(6)?, qtype: r.get(7)?, stem: r.get(8)?,
            options: serde_json::from_str(&r.get::<_, String>(9)?).unwrap_or_default(),
            answer: serde_json::from_str(&r.get::<_, String>(10)?).unwrap_or(Value::Null),
            explanation: r.get(11)?, points: r.get(12)?, position: r.get(13)?, source: r.get(14)?,
            tags: serde_json::from_str(&r.get::<_, String>(15)?).unwrap_or_default(), archived: r.get::<_, i64>(16)? != 0,
        };
        Ok(Mistake {
            id: r.get(0)?, question_id: q.id, question: q,
            set_title: r.get(17)?, section_title: r.get(18)?, wrong_count: r.get(19)?, correct_streak: r.get(20)?,
            last_wrong_at: r.get(21)?, last_correct_at: r.get(22)?, status: r.get(23)?, origin: r.get(24)?,
            due_at: r.get(25)?, note: r.get(26)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn list_folders(conn: &Connection) -> Result<Vec<Folder>, String> {
    let mut stmt = conn.prepare(
        "SELECT f.id,f.name,f.parent_id,f.sort,
         (SELECT COUNT(*) FROM sets s WHERE s.folder_id=f.id),
         (SELECT COUNT(*) FROM questions q WHERE q.folder_id=f.id)
         FROM folders f ORDER BY f.sort,f.id",
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(Folder { id: r.get(0)?, name: r.get(1)?, parent_id: r.get(2)?, sort: r.get(3)?, set_count: r.get(4)?, question_count: r.get(5)?, children: vec![] })).map_err(|e| e.to_string())?;
    let flat: Vec<Folder> = rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?;
    let mut by_parent: HashMap<Option<i64>, Vec<Folder>> = HashMap::new();
    let ids: std::collections::HashSet<i64> = flat.iter().map(|f| f.id).collect();
    for f in flat {
        let parent = if f.parent_id.map(|p| ids.contains(&p)).unwrap_or(false) { f.parent_id } else { None };
        by_parent.entry(parent).or_default().push(f);
    }
    fn attach(id: Option<i64>, map: &mut HashMap<Option<i64>, Vec<Folder>>) -> Vec<Folder> {
        let mut list = map.remove(&id).unwrap_or_default();
        for f in &mut list { f.children = attach(Some(f.id), map); }
        list
    }
    Ok(attach(None, &mut by_parent))
}

pub fn add_mistake(conn: &Connection, qid: i64, origin: &str) -> Result<(), String> {
    let existing: Option<i64> = conn.query_row("SELECT id FROM mistakes WHERE question_id=?", params![qid], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    if existing.is_none() {
        conn.execute(
            "INSERT INTO mistakes(question_id,origin,wrong_count,correct_streak,last_wrong_at,status,due_at,note) VALUES(?,?,1,0,?,'learning',?,'')",
            params![qid, origin, now(), crate::db::today_plus(1)],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}