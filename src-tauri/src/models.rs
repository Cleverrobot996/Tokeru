use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Clone)]
pub struct SetSummary {
    pub id: i64,
    pub title: String,
    pub subtitle: String,
    pub year: String,
    pub duration_minutes: i64,
    pub source: String,
    pub audio_file: Option<String>,
    pub description: String,
    pub question_count: i64,
    pub section_count: i64,
    pub total_points: i64,
    pub last_attempt_at: Option<String>,
    pub tags: Vec<String>,
    pub folder_id: Option<i64>,
}

#[derive(Serialize, Clone)]
pub struct TagInfo {
    pub name: String,
    pub set_count: i64,
    pub question_count: i64,
    /// 标签栏（学科/题型/难度或自定义栏）；未归类时为空。
    pub group_id: Option<i64>,
    pub group_name: String,
    pub group_color: String,
}

#[derive(Serialize, Clone)]
pub struct TagGroup {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub position: i64,
    pub tag_count: i64,
}

/// 一条「标签 → 标签栏」的整理建议；group 为空表示未归类。
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TagSuggestion {
    pub tag: String,
    pub group: String,
}

#[derive(Serialize, Clone)]
pub struct Section {
    pub id: i64,
    pub set_id: i64,
    pub key: String,
    pub title: String,
    pub subtitle: String,
    pub kind: String,
    pub position: i64,
    pub audio_file: Option<String>,
    pub material_id: Option<i64>,
}

#[derive(Serialize, Clone)]
pub struct Material {
    pub id: i64,
    pub set_id: i64,
    pub key: String,
    pub title: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct OptionItem {
    pub key: String,
    pub text: String,
}

#[derive(Serialize, Clone)]
pub struct Question {
    pub id: i64,
    pub set_id: i64,
    pub section_id: i64,
    pub material_id: Option<i64>,
    pub number: i64,
    pub label: String,
    pub qtype: String,
    pub stem: String,
    pub options: Vec<OptionItem>,
    pub answer: Value,
    pub explanation: String,
    pub points: i64,
    pub position: i64,
    pub source: String,
    pub tags: Vec<String>,
    pub archived: bool,
}

#[derive(Serialize, Clone)]
pub struct AttemptQuestion {
    #[serde(flatten)]
    pub question: Question,
    pub answer_raw: String,
    pub is_correct: Option<i64>,
    pub score: Option<i64>,
    pub graded_by: Option<String>,
    /// AI 或自评留下的评语；自动判分时为空。
    pub comment: String,
}

#[derive(Serialize, Clone)]
pub struct SetDetail {
    #[serde(flatten)]
    pub summary: SetSummary,
    pub sections: Vec<Section>,
    pub materials: Vec<Material>,
    pub questions: Vec<Question>,
}

#[derive(Serialize, Clone)]
pub struct AttemptSummary {
    pub id: i64,
    pub set_id: Option<i64>,
    pub title: String,
    pub mode: String,
    pub status: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub total_score: i64,
    pub max_score: i64,
    pub question_count: i64,
    pub answered_count: i64,
}

#[derive(Serialize, Clone)]
pub struct AttemptDetail {
    #[serde(flatten)]
    pub summary: AttemptSummary,
    pub question_ids: Vec<i64>,
    pub questions: Vec<AttemptQuestion>,
    pub sections: Vec<Section>,
    pub materials: Vec<Material>,
    pub time_limit: i64,
    pub set: Option<SetSummary>,
}

#[derive(Serialize, Clone)]
pub struct Mistake {
    pub id: i64,
    pub question_id: i64,
    pub question: Question,
    pub set_title: String,
    pub section_title: String,
    pub wrong_count: i64,
    pub correct_streak: i64,
    pub last_wrong_at: Option<String>,
    pub last_correct_at: Option<String>,
    pub status: String,
    pub origin: String,
    pub due_at: String,
    pub note: String,
}

#[derive(Deserialize, Default, Clone)]
pub struct BankFilters {
    pub set_id: Option<i64>,
    pub section_id: Option<i64>,
    pub qtype: Option<String>,
    pub tag: Option<String>,
    pub q: Option<String>,
    pub sort: Option<String>,
    pub archived: Option<String>,
    pub folder_id: Option<i64>,
    pub set_ids: Option<Vec<i64>>,
    pub tags: Option<Vec<String>>,
    pub limit: Option<i64>,
}

#[derive(Serialize, Clone)]
pub struct BankResult {
    pub total: i64,
    pub questions: Vec<Question>,
}

#[derive(Serialize, Clone)]
pub struct Folder {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub sort: i64,
    pub set_count: i64,
    pub question_count: i64,
    pub children: Vec<Folder>,
}

#[derive(Serialize, Clone)]
pub struct AppSettings {
    pub model: String,
    pub base_url: String,
    pub thinking: bool,
    pub has_api_key: bool,
    pub custom_prompt: String,
    pub timer_presets: Vec<i64>,
    pub default_timer: i64,
    pub accent: String,
    pub theme: String,
    /// 多模态模型（自动分图）；留空时沿用 model。
    pub vision_model: String,
    /// 视觉模型端点；留空时沿用 base_url。
    pub vision_base_url: String,
}

#[derive(Serialize, Clone)]
pub struct AiResult {
    pub content: String,
    pub reasoning: String,
    pub model: String,
    pub cached: bool,
}

#[derive(Serialize, Clone)]
pub struct AiTestResult {
    pub ok: bool,
    pub model: String,
    pub elapsed_ms: i64,
    pub message: String,
}

/// 设置页「测试连接」和通用 AI 调用使用的临时配置。
/// 字段留空时回退到已保存设置；api_key 只在本次请求内使用，不落库。
#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigInput {
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
    pub thinking: Option<bool>,
}

/// 一题的分值分配。number 对应题库里的题号，points 是最终分值。
#[derive(Serialize, Deserialize, Clone)]
pub struct ScoreItem {
    pub number: i64,
    pub points: i64,
    #[serde(default)]
    pub reason: String,
}

#[derive(Serialize, Clone)]
pub struct ScorePlanResult {
    pub total: i64,
    pub allocated: i64,
    pub items: Vec<ScoreItem>,
    pub model: String,
    pub note: String,
}

/// AI 对一道主观题的判分结果。
#[derive(Serialize, Clone)]
pub struct GradeItemResult {
    pub question_id: i64,
    pub number: i64,
    pub label: String,
    pub score: i64,
    pub max_score: i64,
    pub comment: String,
}

#[derive(Serialize, Clone)]
pub struct GradeAttemptResult {
    pub attempt_id: i64,
    pub graded: i64,
    pub total_score: i64,
    pub max_score: i64,
    pub model: String,
    pub items: Vec<GradeItemResult>,
    /// AI 未返回结果的题号；这些题保持原状态，可再次点判卷。
    pub missing: Vec<i64>,
}

/// 自动分图时发给视觉模型的题目概要。
#[derive(Deserialize, Clone)]
pub struct VisionQuestion {
    pub label: String,
    pub stem: String,
}

#[derive(Serialize, Clone)]
pub struct ClassifyItem {
    pub question_id: i64,
    pub number: i64,
    pub stem: String,
    pub current_type: String,
    pub proposed_type: String,
    pub proposed_tags: Vec<String>,
    pub duplicate_group: Option<String>,
    pub reason: String,
}

#[derive(Serialize, Clone)]
pub struct ImportPreview {
    pub title: String,
    pub set_tags: Vec<String>,
    pub folder: Option<String>,
    pub question_count: i64,
    pub questions: Vec<Question>,
    pub warnings: Vec<String>,
    /// 预览用的规范分区（id 为占位序号，set_id=0），供导入页展示分区结构。
    pub sections: Vec<Section>,
    /// 预览用的规范材料（同上）。
    pub materials: Vec<Material>,
}