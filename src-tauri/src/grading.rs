use crate::models::Question;
use serde_json::Value;

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
        let wanted: Vec<String> = match &q.answer {
            Value::Object(o) => match o.get("correct") {
                Some(Value::Array(a)) => a.iter().filter_map(|v| v.as_str().map(|s| s.to_uppercase())).collect(),
                Some(Value::String(s)) => vec![s.to_uppercase()],
                _ => vec![],
            },
            _ => vec![],
        };
        let got: Vec<String> = text
            .split(|c: char| c == ',' || c == '，' || c.is_whitespace())
            .filter(|s| !s.is_empty())
            .map(|s| s.trim().to_uppercase())
            .collect();
        let ok = !wanted.is_empty()
            && wanted.len() == got.len()
            && got.iter().all(|g| wanted.contains(g));
        return Grade { is_correct: Some(if ok { 1 } else { 0 }), score: if ok { q.points } else { 0 }, graded_by: if ok { "auto".into() } else { "wrong".into() } };
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
        return Grade { is_correct: Some(if ok { 1 } else { 0 }), score: if ok { q.points } else { 0 }, graded_by: if ok { "auto".into() } else { "wrong".into() } };
    }
    Grade { is_correct: None, score: 0, graded_by: "pending".into() }
}
