use crate::models::Question;
use serde_json::Value;
use std::collections::HashSet;

pub struct Grade {
    pub is_correct: Option<i64>,
    pub score: i64,
    pub graded_by: String,
}

fn norm(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn tf_token(raw: &str) -> Option<&'static str> {
    match raw.trim().to_lowercase().as_str() {
        "对" | "正确" | "√" | "✓" | "true" | "t" | "yes" | "是" | "1" => Some("T"),
        "错" | "错误" | "×" | "✗" | "false" | "f" | "no" | "否" | "0" => Some("F"),
        _ => None,
    }
}

/// 选项/判断题的单个答案归一化：判断题把中英文对错统一成 T/F，其余转大写。
pub fn normalize_choice_token(raw: &str, qtype: &str) -> String {
    if qtype == "true_false" {
        if let Some(v) = tf_token(raw) {
            return v.to_string();
        }
    }
    raw.trim().to_uppercase()
}

/// 把 "ACD"、"A,C"、"A、C"、"A C" 拆成独立选项；判断题保持单个 token。
/// 多选题顺序无关，这里只负责拆分和去重，比较交给调用方。
pub fn split_choice_tokens(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let mut out: Vec<String> = Vec::new();
    let mut push = |token: &str| {
        let token = token.trim_matches(|c: char| {
            matches!(c, '.' | '。' | '、' | ',' | '，' | ';' | '；' | ':' | '：' | '(' | ')' | '（' | '）')
        });
        if token.is_empty() {
            return;
        }
        if token.chars().all(|c| c.is_ascii_alphabetic()) && token.chars().count() > 1 {
            for ch in token.chars() {
                out.push(ch.to_ascii_uppercase().to_string());
            }
        } else {
            out.push(token.to_uppercase());
        }
    };
    if trimmed.chars().all(|c| c.is_ascii_alphabetic()) && trimmed.chars().count() > 1 {
        push(trimmed);
    } else {
        for part in trimmed.split(|c: char| matches!(c, ',' | '，' | ';' | '；' | '、') || c.is_whitespace()) {
            push(part);
        }
    }
    let mut seen = HashSet::new();
    out.retain(|token| seen.insert(token.clone()));
    out
}

/// 判断题必须整串归一化，不能按字母拆："true" 拆开会变成 T/R/U/E。
pub fn tokens_for_choice(raw: &str, qtype: &str) -> Vec<String> {
    if qtype == "true_false" {
        let token = normalize_choice_token(raw, qtype);
        return if token.is_empty() { Vec::new() } else { vec![token] };
    }
    split_choice_tokens(raw)
}

fn answer_tokens(value: &Value, qtype: &str) -> Vec<String> {
    let raw: Vec<String> = match value {
        Value::Array(items) => items
            .iter()
            .map(|v| match v {
                Value::String(s) => s.clone(),
                Value::Bool(b) => if *b { "true".into() } else { "false".into() },
                other => other.to_string(),
            })
            .collect(),
        Value::String(s) => vec![s.clone()],
        Value::Bool(b) => vec![if *b { "true".into() } else { "false".into() }],
        _ => Vec::new(),
    };
    let mut out: Vec<String> = Vec::new();
    for item in raw {
        for token in tokens_for_choice(&item, qtype) {
            out.push(normalize_choice_token(&token, qtype));
        }
    }
    let mut seen = HashSet::new();
    out.retain(|token| seen.insert(token.clone()));
    out.sort();
    out
}

pub fn grade_one(q: &Question, raw: &str) -> Grade {
    let text = raw.trim();
    if text.is_empty() {
        let subjective = matches!(q.qtype.as_str(), "short_answer" | "writing" | "dictation");
        return Grade {
            is_correct: None,
            score: 0,
            graded_by: if subjective { "pending".into() } else { "unanswered".into() },
        };
    }
    if matches!(q.qtype.as_str(), "choice_single" | "choice_multi" | "true_false" | "matching") {
        let mut wanted = match &q.answer {
            Value::Object(o) => o.get("correct").map(|v| answer_tokens(v, &q.qtype)).unwrap_or_default(),
            _ => Vec::new(),
        };
        wanted.sort();
        let mut got = tokens_for_choice(text, &q.qtype)
            .into_iter()
            .map(|token| normalize_choice_token(&token, &q.qtype))
            .collect::<Vec<_>>();
        got.sort();
        got.dedup();
        let ok = !wanted.is_empty() && wanted == got;
        return Grade {
            is_correct: Some(if ok { 1 } else { 0 }),
            score: if ok { q.points } else { 0 },
            graded_by: if ok { "auto".into() } else { "wrong".into() },
        };
    }
    if matches!(q.qtype.as_str(), "fill_blank" | "cloze") {
        let wanted: Vec<String> = match &q.answer {
            Value::Object(o) => {
                let list = o.get("accept").or_else(|| o.get("accepted"));
                match list {
                    Some(Value::Array(a)) => a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect(),
                    Some(Value::String(s)) => vec![s.clone()],
                    _ => match o.get("correct") {
                        Some(Value::Array(a)) => a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect(),
                        Some(Value::String(s)) => vec![s.clone()],
                        _ => vec![],
                    },
                }
            }
            _ => vec![],
        };
        let ok = wanted.iter().any(|w| norm(w) == norm(text));
        return Grade {
            is_correct: Some(if ok { 1 } else { 0 }),
            score: if ok { q.points } else { 0 },
            graded_by: if ok { "auto".into() } else { "wrong".into() },
        };
    }
    Grade { is_correct: None, score: 0, graded_by: "pending".into() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn question(qtype: &str, answer: Value) -> Question {
        Question {
            id: 1,
            set_id: 1,
            section_id: 1,
            material_id: None,
            number: 1,
            label: "1".into(),
            qtype: qtype.into(),
            stem: "stem".into(),
            options: Vec::new(),
            answer,
            explanation: String::new(),
            points: 5,
            position: 1,
            source: String::new(),
            tags: Vec::new(),
            archived: false,
        }
    }

    fn graded(answer: Value, raw: &str) -> Grade {
        grade_one(&question("choice_multi", answer), raw)
    }

    #[test]
    fn choice_multi_accepts_compact_and_split_answers() {
        assert_eq!(graded(json!({"kind":"choice","correct":["A","C","D"]}), "ACD").is_correct, Some(1));
        assert_eq!(graded(json!({"kind":"choice","correct":"ACD"}), "A,C,D").is_correct, Some(1));
        assert_eq!(graded(json!({"kind":"choice","correct":"A,C,D"}), "D、C、A").is_correct, Some(1));
        assert_eq!(graded(json!({"kind":"choice","correct":["A","C","D"]}), "ABD").is_correct, Some(0));
    }

    #[test]
    fn true_false_accepts_chinese_and_english() {
        for answer in ["对", "正确", "√", "true", "T", "YES"] {
            assert_eq!(
                grade_one(&question("true_false", json!({"correct":["T"]})), answer).is_correct,
                Some(1),
                "{answer} should be true"
            );
        }
        for answer in ["错", "错误", "×", "false", "F", "no"] {
            assert_eq!(
                grade_one(&question("true_false", json!({"correct":"F"})), answer).is_correct,
                Some(1),
                "{answer} should be false"
            );
        }
        assert_eq!(
            grade_one(&question("true_false", json!({"correct":["T"]})), "错").is_correct,
            Some(0)
        );
    }
}