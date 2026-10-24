export type QType =
  | "choice_single"
  | "choice_multi"
  | "fill_blank"
  | "cloze"
  | "true_false"
  | "short_answer"
  | "writing"
  | "dictation"
  | "matching";

export type AttemptMode = "exam" | "custom" | "review";
export type AttemptStatus = "in_progress" | "submitted";

export interface QuestionOption {
  key: string;
  text: string;
}

export interface AnswerSpec {
  kind?: string;
  correct?: string | string[];
  accept?: string[];
  accepted?: string[];
  reference?: string;
  rubric?: Record<string, string[]>;
  strict_letters?: boolean;
}

export interface Question {
  id: number;
  set_id: number;
  section_id: number;
  material_id: number | null;
  number: number;
  label: string;
  qtype: QType;
  stem: string;
  options: QuestionOption[];
  answer: AnswerSpec;
  explanation: string;
  points: number;
  position: number;
  source: string;
  tags: string[];
  archived: boolean;
}

export interface Section {
  id: number;
  set_id: number;
  key: string;
  title: string;
  kind: string;
  position: number;
  instructions: string;
  duration_minutes: number | null;
  material_id: number | null;
  question_count?: number;
}

export interface Material {
  id: number;
  set_id: number;
  key: string;
  kind: string;
  title: string;
  content: string;
  position: number;
}

export interface SetSummary {
  id: number;
  title: string;
  subtitle: string;
  year: number | string | null;
  duration_minutes: number | null;
  source: string;
  audio_file: string | null;
  description: string;
  question_count: number;
  section_count: number;
  total_points: number;
  last_attempt_at: string | null;
  tags: string[];
  folder_id: number | null;
}

export interface SetDetail extends SetSummary {
  sections: Section[];
  materials: Material[];
  questions: Question[];
}

export interface AttemptSummary {
  id: number;
  set_id: number | null;
  title: string;
  mode: AttemptMode;
  status: AttemptStatus;
  started_at: string;
  finished_at: string | null;
  total_score: number;
  max_score: number;
  question_count: number;
  answered_count: number;
}

export interface AttemptQuestion extends Question {
  answer_raw: string;
  is_correct: number | null;
  score: number | null;
  graded_by: string | null;
  /** AI 或自评留下的评语；自动判分时为空。 */
  comment?: string;
  time_spent?: number;
}

export interface AttemptDetail extends AttemptSummary {
  question_ids: number[];
  questions: AttemptQuestion[];
  sections: Section[];
  materials: Material[];
  time_limit: number;
  set?: SetSummary | null;
}

export interface Mistake {
  id: number;
  question_id: number;
  question: Question;
  set_title: string;
  section_title: string;
  wrong_count: number;
  correct_streak: number;
  last_wrong_at: string | null;
  last_correct_at: string | null;
  status: "learning" | "mastered";
  origin: string;
  due_at: string | null;
  note: string;
}

export type AiProvider = "deepseek" | "openai" | "anthropic" | "ollama" | "dashscope";

export interface AppSettings {
  model: string;
  base_url: string;
  provider: AiProvider | "";
  vision_model: string;
  vision_base_url: string;
  thinking: boolean;
  thinking_organize: boolean;
  thinking_vision: boolean;
  thinking_explain: boolean;
  has_api_key: boolean;
  custom_prompt: string;
  timer_presets: number[];
  default_timer: number;
  accent: string;
  theme: "light" | "dark" | "system";
}

export interface AiResult {
  content: string;
  reasoning: string;
  model: string;
  cached: boolean;
}

/** 本地 MCP Server 的运行状态与连接信息。 */
export interface McpStatus {
  enabled: boolean;
  port: number;
  readonly: boolean;
  running: boolean;
  url: string;
  token: string;
  lastError: string | null;
}

/** 「测试连接」的结果；elapsed_ms 来自后端，成功时也返回实际使用的模型名。 */
export interface AiTestResult {
  ok: boolean;
  model: string;
  elapsed_ms: number;
  message: string;
}

/** 设置页里尚未保存的 AI 配置；留空字段回退到已保存设置。 */
export interface AiConfigInput {
  baseUrl: string;
  model: string;
  provider?: AiProvider | "";
  apiKey?: string;
  thinking?: boolean;
}

/** 一题的分值分配。 */
export interface ScoreItem {
  number: number;
  points: number;
  reason: string;
}

/** AI 按目标总分生成的分配方案；确认后才会写回题库。 */
export interface ScorePlanResult {
  total: number;
  allocated: number;
  items: ScoreItem[];
  model: string;
  note: string;
}

export interface GradeItemResult {
  question_id: number;
  number: number;
  label: string;
  score: number;
  max_score: number;
  comment: string;
}

/** AI 判主观题的结果。 */
export interface GradeAttemptResult {
  attempt_id: number;
  graded: number;
  total_score: number;
  max_score: number;
  model: string;
  items: GradeItemResult[];
  missing: number[];
}

export interface BankFilters {
  set_id?: number | null;
  set_ids?: number[] | null;
  section_id?: number | null;
  qtype?: string;
  tag?: string;
  tags?: string[] | null;
  q?: string;
  sort?: "added_desc" | "added_asc" | "number_asc" | "number_desc";
  limit?: number;
  offset?: number;
}

export interface BankResult {
  total: number;
  questions: Question[];
}

export interface Folder {
  id: number;
  name: string;
  parent_id: number | null;
  sort: number;
  set_count: number;
  question_count: number;
  children?: Folder[];
}

export interface TagInfo {
  name: string;
  set_count: number;
  question_count: number;
  /** 所属标签栏；未归类时为 null。 */
  group_id: number | null;
  group_name: string;
  group_color: string;
}

/** 标签栏：学科 / 题型 / 难度，或用户自定义的栏。 */
export interface TagGroup {
  id: number;
  name: string;
  color: string;
  position: number;
  tag_count: number;
}

/** AI 整理预览里的一条「标签 → 标签栏」建议；group 为空表示未归类。 */
export interface TagSuggestion {
  tag: string;
  group: string;
}

export interface ClassifyItem {
  question_id: number;
  number: number;
  stem: string;
  current_type: QType;
  proposed_type: QType;
  proposed_tags: string[];
  duplicate_group: string | null;
  reason: string;
}

export interface ImportPreview {
  title: string;
  set_tags?: string[];
  folder?: string | null;
  question_count: number;
  questions: Question[];
  warnings: string[];
  /** 预览时附带的规范化分区 / 材料，供导入页按区展示；真正写入由后端重新解析完成。 */
  sections?: Section[];
  materials?: Material[];
  raw?: string;
}