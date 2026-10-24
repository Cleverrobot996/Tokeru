import rawSeed from "../../data/seed/math_2024.json";
import type {
  AiConfigInput,
  AiTestResult,
  AnswerSpec,
  AppSettings,
  AttemptDetail,
  AttemptMode,
  AttemptQuestion,
  AttemptSummary,
  BankFilters,
  BankResult,
  ClassifyItem,
  Folder,
  ImportPreview,
  Material,
  Mistake,
  Question,
  Section,
  SetDetail,
  SetSummary,
  TagGroup,
  TagInfo,
  TagSuggestion,
} from "./types";

/* The browser preview uses this in-memory/localStorage store so the whole UI
   can be developed without a Rust build. In the desktop app every command
   below is replaced by the Rust backend. */

const seed = rawSeed as any;
const STORE_KEY = "tokero.mock.v2";

type MockAnswer = {
  attempt_id: number;
  question_id: number;
  raw: string;
  is_correct: number | null;
  score: number;
  max_score: number;
  graded_by: string;
  comment?: string;
};

type MockAttempt = AttemptSummary & {
  question_ids: number[];
  time_limit: number;
};

type MockState = {
  version: number;
  attempts: MockAttempt[];
  answers: MockAnswer[];
  mistakes: Mistake[];
  settings: AppSettings;
  imports: ImportPreview[];
  folders: Folder[];
  setFolder: Record<number, number>;
  tagGroups: TagGroup[];
  /** 标签名 → 标签栏 id；没有键表示未归类。 */
  tagAssignments: Record<string, number>;
  nextId: number;
  deletedSets?: number[];
};

/** 演示数据版本：结构变化时自增，旧 localStorage 会被重置成新的演示数据。 */
const MOCK_VERSION = 6;

const qtypeMap: Record<string, Question["qtype"]> = {
  choice: "choice_single",
  choice_single: "choice_single",
  choice_multi: "choice_multi",
  fill: "fill_blank",
  fill_blank: "fill_blank",
  cloze: "cloze",
  true_false: "true_false",
  short_answer: "short_answer",
  writing: "writing",
  dictation: "dictation",
  matching: "matching",
};

const sections: Section[] = (seed.sections as any[]).map((s, index) => ({
  ...s,
  id: index + 1,
  set_id: 1,
  material_id: s.material ? (seed.materials as any[]).findIndex((m) => m.key === s.material) + 1 : null,
}));

const materials: Material[] = (seed.materials as any[]).map((m, index) => ({
  ...m,
  id: index + 1,
  set_id: 1,
}));

const sectionByKey = new Map(sections.map((s) => [s.key, s]));
const materialByKey = new Map(materials.map((m) => [m.key, m]));

const questions: Question[] = (seed.questions as any[]).map((q, index) => {
  const answer = q.answer ?? {};
  const section = sectionByKey.get(q.section);
  const material = q.material ? materialByKey.get(q.material) : null;
  return {
    id: index + 1,
    set_id: 1,
    section_id: section?.id ?? 1,
    material_id: material?.id ?? null,
    number: q.number,
    label: q.label ?? String(q.number),
    qtype: qtypeMap[q.qtype] ?? qtypeMap[answer.kind] ?? "fill_blank",
    stem: q.stem ?? "",
    options: q.options ?? [],
    answer,
    explanation: q.explanation ?? "",
    points: q.points ?? 1,
    position: index,
    source: q.source ?? "original",
    tags: Array.isArray(q.tags) && q.tags.length ? q.tags : [qtypeMap[q.qtype] === "choice_single" ? "单项选择" : (q.qtype ?? "英语")],
    archived: false,
  };
});

const defaultSettings: AppSettings = {
  model: "",
  base_url: "",
  vision_model: "",
  vision_base_url: "",
  thinking: false,
  has_api_key: false,
  custom_prompt: "",
  timer_presets: [30, 60, 90, 130],
  default_timer: 0,
  accent: "violet",
  theme: "system",
};

const defaultTagGroups: TagGroup[] = [
  { id: 1, name: "学科", color: "violet", position: 0, tag_count: 0 },
  { id: 2, name: "题型", color: "teal", position: 1, tag_count: 0 },
  { id: 3, name: "难度", color: "amber", position: 2, tag_count: 0 },
];

const tagGroupDictionary: Record<string, string[]> = {
  学科: ["英语", "数学", "语文", "物理", "化学", "生物", "政治", "历史", "地理"],
  题型: ["单项选择", "多项选择", "单选", "多选", "填空", "完形", "完形填空", "阅读", "听力", "听写", "简答", "写作", "作文", "翻译", "改错", "判断", "匹配", "词汇", "语法", "听力音频"],
  难度: ["易", "中", "难"],
};

function defaultTagAssignments(): Record<string, number> {
  const map: Record<string, number> = {};
  for (const group of defaultTagGroups) {
    for (const tag of tagGroupDictionary[group.name] ?? []) map[tag] = group.id;
  }
  return map;
}

/* ---------- 演示数据：浏览器模式没有后端，这里放几条真实的练习记录与错题 ---------- */

type DemoAnswer = [question_id: number, raw: string, is_correct: number | null, score: number, graded_by: string];

function toLocalStamp(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

function stamp(days: number, hour = 20, minute = 30) {
  const d = new Date(Date.now() - days * 86400000);
  d.setHours(hour, minute, 0, 0);
  return toLocalStamp(d);
}

function dateOffset(days: number) {
  const d = new Date(Date.now() + days * 86400000);
  const p = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function demoAnswers(attemptId: number, rows: DemoAnswer[]): MockAnswer[] {
  return rows.map(([question_id, raw, is_correct, score, graded_by]) => ({
    attempt_id: attemptId,
    question_id,
    raw,
    is_correct,
    score,
    max_score: findQuestion(question_id)?.points ?? 1,
    graded_by,
  }));
}

function demoMistake(id: number, questionId: number, wrongCount: number, dueInDays: number, lastWrongAt: string): Mistake {
  const q = findQuestion(questionId)!;
  return {
    id,
    question_id: questionId,
    question: clone(q),
    set_title: seed.set.title,
    section_title: sections.find((s) => s.id === q.section_id)?.title ?? "",
    wrong_count: wrongCount,
    correct_streak: 0,
    last_wrong_at: lastWrongAt,
    last_correct_at: null,
    status: "learning",
    origin: "wrong",
    due_at: dateOffset(dueInDays),
    note: "",
  };
}

function demoState(): MockState {
  const A1 = [1, 2, 3, 4, 5, 6, 7, 8];
  const A2 = [9, 10, 11];
  const A3 = [12, 13, 14];
  const A4 = [15, 16];

  const answers: MockAnswer[] = [
    ...demoAnswers(1, [
      [1, "A", 1, 5, "auto"],
      [2, "B", 1, 5, "auto"],
      [3, "C", 0, 0, "wrong"],
      [4, "D", 1, 5, "auto"],
      [5, "A", 1, 5, "auto"],
      [6, "B", 0, 0, "wrong"],
      [7, "C", 1, 5, "auto"],
      [8, "D", 1, 5, "auto"],
    ]),
    ...demoAnswers(2, [
      [9, "AB", 1, 5, "auto"],
      [10, "AC", 0, 0, "wrong"],
      [11, "BCD", 1, 5, "auto"],
    ]),
    ...demoAnswers(3, [
      [12, "√2", 1, 5, "auto"],
      [13, "B", 1, 5, "auto"],
      [14, "x>1", null, 0, "pending"],
    ]),
    ...demoAnswers(4, [
      [15, "2", null, 0, "pending"],
    ]),
  ];

  const scoreOf = (ids: number[]) => answers.filter((a) => ids.includes(a.question_id)).reduce((s, a) => s + a.score, 0);
  const maxOf = (ids: number[]) => ids.reduce((s, id) => s + (findQuestion(id)?.points ?? 0), 0);

  const attempts: MockAttempt[] = [
    {
      id: 1, set_id: 1, title: "选择题 · 限时练", mode: "exam", status: "submitted",
      started_at: stamp(2, 9, 5), finished_at: stamp(2, 9, 35),
      total_score: scoreOf(A1), max_score: maxOf(A1), question_count: A1.length,
      answered_count: 0, question_ids: A1, time_limit: 30,
    },
    {
      id: 2, set_id: 1, title: "多选题 · 专项", mode: "custom", status: "submitted",
      started_at: stamp(5, 19, 0), finished_at: stamp(5, 19, 20),
      total_score: scoreOf(A2), max_score: maxOf(A2), question_count: A2.length,
      answered_count: 0, question_ids: A2, time_limit: 0,
    },
    {
      id: 3, set_id: 1, title: "填空与解答 · 精练", mode: "review", status: "submitted",
      started_at: stamp(1, 14, 0), finished_at: stamp(1, 14, 40),
      total_score: scoreOf(A3), max_score: maxOf(A3), question_count: A3.length,
      answered_count: 0, question_ids: A3, time_limit: 45,
    },
    {
      id: 4, set_id: 1, title: "解答题 · 进行中", mode: "custom", status: "in_progress",
      started_at: stamp(0, 8, 30), finished_at: null,
      total_score: 0, max_score: maxOf(A4), question_count: A4.length,
      answered_count: 0, question_ids: A4, time_limit: 0,
    },
  ];

  const mistakes: Mistake[] = [
    demoMistake(501, 3, 2, 0, stamp(2, 9, 35)),
    demoMistake(502, 10, 1, 0, stamp(5, 19, 20)),
    demoMistake(503, 12, 3, 1, stamp(1, 14, 40)),
  ];

  return {
    version: MOCK_VERSION,
    attempts, answers, mistakes,
    settings: defaultSettings,
    imports: [],
    folders: [
      { id: 101, name: "高考数学真题", parent_id: null, sort: 0, set_count: 1, question_count: 0 },
    ],
    setFolder: { 1: 101 },
    tagGroups: clone(defaultTagGroups),
    tagAssignments: defaultTagAssignments(),
    nextId: 600,
  };
}

function emptyState(): MockState {
  return demoState();
}

function load(): MockState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as MockState;
    if (parsed.version !== MOCK_VERSION) return emptyState();
    return { ...emptyState(), ...parsed, settings: { ...defaultSettings, ...parsed.settings } };
  } catch {
    return emptyState();
  }
}

function save(state: MockState) {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function now() {
  return toLocalStamp(new Date());
}

function nextId(state: MockState) {
  state.nextId += 1;
  return state.nextId;
}

function findQuestion(id: number) {
  return questions.find((q) => q.id === id);
}

/** 浏览器预览里的标签统计；与桌面版一样带标签栏信息。 */
function tagStats(state: MockState): TagInfo[] {
  const setTags: string[] = Array.isArray(seed.set.tags) ? seed.set.tags : ["英语", "真题"];
  const counts = new Map<string, { set_count: number; question_count: number }>();
  for (const tag of setTags) counts.set(tag, { set_count: 1, question_count: 0 });
  for (const q of questions) {
    for (const tag of q.tags) {
      const prev = counts.get(tag) ?? { set_count: 0, question_count: 0 };
      counts.set(tag, { ...prev, question_count: prev.question_count + 1 });
    }
  }
  return [...counts.entries()]
    .map(([name, v]) => {
      const gid = state.tagAssignments[name] ?? null;
      const group = gid == null ? null : state.tagGroups.find((g) => g.id === gid);
      return {
        name,
        ...v,
        group_id: group?.id ?? null,
        group_name: group?.name ?? "",
        group_color: group?.color ?? "",
      };
    })
    .sort((a, b) => (b.set_count + b.question_count) - (a.set_count + a.question_count) || a.name.localeCompare(b.name, "zh"));
}

function groupByName(state: MockState, name: string): TagGroup | undefined {
  const key = name.trim();
  return state.tagGroups.find((g) => g.name === key);
}

function setSummary(): SetSummary {
  return {
    id: 1,
    title: seed.set.title,
    subtitle: seed.set.subtitle,
    year: seed.set.year == null ? null : String(seed.set.year),
    duration_minutes: seed.set.duration_minutes,
    source: seed.set.source,
    audio_file: seed.set.audio_file,
    description: seed.set.description,
    question_count: questions.length,
    section_count: sections.length,
    total_points: questions.reduce((sum, q) => sum + q.points, 0),
    last_attempt_at: null,
    tags: Array.isArray(seed.set.tags) ? seed.set.tags : ["数学", "高考"],
    folder_id: null,
  };
}

function setSummaryFor(state: MockState, attempt?: MockAttempt): SetSummary {
  const base = setSummary();
  return {
    ...base,
    last_attempt_at: attempt?.started_at ?? state.attempts.filter((a) => a.set_id === 1).sort((a, b) => b.id - a.id)[0]?.started_at ?? null,
    folder_id: state.setFolder[1] ?? null,
  };
}

function toSummary(a: MockAttempt, state: MockState): AttemptSummary {
  return {
    id: a.id,
    set_id: a.set_id,
    title: a.title,
    mode: a.mode,
    status: a.status,
    started_at: a.started_at,
    finished_at: a.finished_at,
    total_score: a.total_score,
    max_score: a.max_score,
    question_count: a.question_ids.length,
    answered_count: state.answers.filter((x) => x.attempt_id === a.id && x.raw.trim()).length,
  };
}

function attemptAnswers(state: MockState, attemptId: number) {
  const attempt = state.attempts.find((a) => a.id === attemptId);
  if (!attempt) return [];
  return state.answers.filter((a) => a.attempt_id === attemptId);
}

function gradeOne(q: Question, raw: string): { correct: boolean | null; score: number; gradedBy: string } {
  const text = raw.trim();
  if (!text) {
    const subjective = ["short_answer", "writing", "dictation"].includes(q.qtype);
    return { correct: null, score: 0, gradedBy: subjective ? "pending" : "unanswered" };
  }
  const answer = q.answer ?? {};
  if (q.qtype === "choice_single" || q.qtype === "choice_multi" || q.qtype === "true_false" || q.qtype === "matching") {
    const wanted = Array.isArray(answer.correct) ? answer.correct : answer.correct ? [answer.correct] : [];
    const got = text.split(/[,，\s]+/).filter(Boolean).map((x) => x.toUpperCase());
    const correct = wanted.length > 0 && got.length === wanted.length && got.every((x) => wanted.map((y) => String(y).toUpperCase()).includes(x));
    return { correct, score: correct ? q.points : 0, gradedBy: correct ? "auto" : "wrong" };
  }
  if (q.qtype === "fill_blank" || q.qtype === "cloze") {
    const accept: string[] = Array.isArray(answer.accept) ? answer.accept
      : Array.isArray(answer.accepted) ? answer.accepted
        : answer.correct ? (Array.isArray(answer.correct) ? answer.correct : [answer.correct]) : [];
    const norm = (s: string) => s.toLowerCase().replace(/[\s.,;:'"!?]+/g, " ").trim();
    const correct = accept.some((x) => norm(String(x)) === norm(text));
    return { correct, score: correct ? q.points : 0, gradedBy: correct ? "auto" : "wrong" };
  }
  return { correct: null, score: 0, gradedBy: "pending" };
}

function recompute(state: MockState, attemptId: number) {
  const attempt = state.attempts.find((a) => a.id === attemptId);
  if (!attempt) return;
  const ans = state.answers.filter((a) => a.attempt_id === attemptId);
  attempt.max_score = attempt.question_ids.reduce((sum, id) => sum + (findQuestion(id)?.points ?? 0), 0);
  attempt.total_score = ans.reduce((sum, a) => sum + a.score, 0);
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

/* ---------- 导入处理：与 Rust 端 normalize_import 保持同一套规则，浏览器里也能走完预览 ---------- */

const IMPORT_QTYPE: Record<string, Question["qtype"]> = {
  choice_single: "choice_single",
  choice: "choice_single",
  single: "choice_single",
  单选: "choice_single",
  choice_multi: "choice_multi",
  multiple: "choice_multi",
  multi: "choice_multi",
  多选: "choice_multi",
  fill_blank: "fill_blank",
  fill: "fill_blank",
  blank: "fill_blank",
  填空: "fill_blank",
  cloze: "cloze",
  完形: "cloze",
  true_false: "true_false",
  judge: "true_false",
  判断: "true_false",
  short_answer: "short_answer",
  short: "short_answer",
  简答: "short_answer",
  writing: "writing",
  essay: "writing",
  写作: "writing",
  dictation: "dictation",
  听写: "dictation",
  matching: "matching",
  match: "matching",
  匹配: "matching",
};

const CHOICE_TYPES = ["choice_single", "choice_multi", "true_false", "matching"];

function toLetters(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim().toUpperCase()).filter(Boolean);
  if (typeof v === "string") {
    const t = v.trim().toUpperCase();
    if (!t) return [];
    if (/[,，/、\s]/.test(t)) return t.split(/[,，/、\s]+/).filter(Boolean);
    return t.length <= 4 ? t.split("") : [t];
  }
  return [];
}

function toTrueFalse(v: unknown): string[] {
  const raw = Array.isArray(v) ? v[0] : v;
  const t = String(raw ?? "").trim().toUpperCase();
  const map: Record<string, string> = {
    对: "T", 正确: "T", 是: "T", "√": "T", TRUE: "T",
    错: "F", 错误: "F", 否: "F", "×": "F", FALSE: "F",
  };
  return [map[t] ?? t];
}

function importAnswer(qtype: Question["qtype"], ans: unknown, number: number, warnings: string[]): AnswerSpec {
  const a = (ans && typeof ans === "object" ? ans : {}) as Record<string, any>;
  if (CHOICE_TYPES.includes(qtype)) {
    let correct = qtype === "true_false" ? toTrueFalse(a.correct ?? a.answer) : toLetters(a.correct ?? a.answer);
    if (!correct.length) warnings.push(`第 ${number} 题缺少正确答案（answer.correct）。`);
    if (qtype === "choice_single" && correct.length > 1) {
      warnings.push(`第 ${number} 题是单选却给了 ${correct.length} 个答案，已只保留第一个。`);
      correct = correct.slice(0, 1);
    }
    if (qtype === "choice_multi" && correct.length === 1) warnings.push(`第 ${number} 题是多选但只有 1 个答案。`);
    return { kind: "choice", correct };
  }
  if (qtype === "fill_blank" || qtype === "cloze") {
    const accept = (Array.isArray(a.accept) ? a.accept : Array.isArray(a.accepted) ? a.accepted : a.correct ? (Array.isArray(a.correct) ? a.correct : [a.correct]) : [])
      .map((s: any) => String(s).trim())
      .filter(Boolean);
    if (!accept.length) warnings.push(`第 ${number} 题缺少可接受答案（answer.accept 至少写一个）。`);
    return { kind: "text", accept };
  }
  const reference = String(a.reference ?? a.correct ?? (Array.isArray(a.accept) ? a.accept[0] : "") ?? "").trim();
  if (!reference) warnings.push(`第 ${number} 题缺少参考答案（answer.reference）。`);
  const rubric = a.rubric && typeof a.rubric === "object" ? (a.rubric as Record<string, string[]>) : undefined;
  return rubric ? { kind: "reference", reference, rubric } : { kind: "reference", reference };
}

function normalizeImport(root: any, fallbackTitle = "导入题目"): ImportPreview {
  const warnings: string[] = [];
  const set = root?.set && typeof root.set === "object" ? root.set : {};
  const title = String(set.title ?? root?.title ?? fallbackTitle).trim() || fallbackTitle;

  const matByKey = new Map<string, number>();
  const materials: Material[] = (Array.isArray(root?.materials) ? root.materials : []).map((m: any, i: number) => {
    let key = String(m?.key ?? `m${i + 1}`).trim() || `m${i + 1}`;
    if (matByKey.has(key)) {
      warnings.push(`材料 key「${key}」重复，已改名为 ${key}-${i + 1}。`);
      key = `${key}-${i + 1}`;
    }
    matByKey.set(key, i + 1);
    return {
      id: i + 1,
      set_id: 0,
      key,
      kind: String(m?.kind ?? "reading"),
      title: String(m?.title ?? `材料 ${i + 1}`),
      content: String(m?.content ?? ""),
      position: i,
    };
  });

  const secByKey = new Map<string, number>();
  const sections: Section[] = (Array.isArray(root?.sections) ? root.sections : []).map((s: any, i: number) => {
    let key = String(s?.key ?? `part-${i + 1}`).trim() || `part-${i + 1}`;
    if (secByKey.has(key)) {
      warnings.push(`分区 key「${key}」重复，已改名为 ${key}-${i + 1}。`);
      key = `${key}-${i + 1}`;
    }
    secByKey.set(key, i + 1);
    const materialId = s?.material ? matByKey.get(String(s.material)) ?? null : null;
    if (s?.material && materialId === null) warnings.push(`分区「${key}」引用了不存在的材料「${s.material}」。`);
    const duration = Number(s?.duration_minutes);
    return {
      id: i + 1,
      set_id: 0,
      key,
      title: String(s?.title ?? key),
      kind: String(s?.kind ?? "mixed"),
      position: i,
      instructions: String(s?.instructions ?? s?.subtitle ?? ""),
      duration_minutes: Number.isFinite(duration) && duration > 0 ? duration : null,
      material_id: materialId,
      question_count: 0,
    };
  });

  const rawQuestions: any[] = Array.isArray(root?.questions) ? root.questions : [];
  if (!sections.length && rawQuestions.length) {
    sections.push({
      id: 1,
      set_id: 0,
      key: "all",
      title: "全部题目",
      kind: "mixed",
      position: 0,
      instructions: "",
      duration_minutes: null,
      material_id: null,
      question_count: 0,
    });
    secByKey.set("all", 1);
    warnings.push("JSON 里没有 sections，已自动归入「全部题目」分区。");
  }

  const numbers = new Set<number>();
  const questions: Question[] = rawQuestions.map((q: any, i: number) => {
    const rawType = String(q?.qtype ?? q?.type ?? "").trim();
    const qtype = IMPORT_QTYPE[rawType] ?? IMPORT_QTYPE[rawType.toLowerCase()] ?? "fill_blank";
    if (!IMPORT_QTYPE[rawType] && !IMPORT_QTYPE[rawType.toLowerCase()]) {
      warnings.push(`第 ${i + 1} 题题型「${rawType || "空"}」无法识别，已按填空题处理。`);
    }
    let number = Number(q?.number);
    if (!Number.isFinite(number) || number <= 0) number = i + 1;
    if (numbers.has(number)) {
      warnings.push(`题号 ${number} 重复，已顺延。`);
      while (numbers.has(number)) number += 1;
    }
    numbers.add(number);

    const sectionKey = String(q?.section ?? q?.section_key ?? "");
    const sectionId = secByKey.get(sectionKey) ?? sections[0]?.id ?? 1;
    if (sectionKey && !secByKey.has(sectionKey)) warnings.push(`第 ${number} 题引用了不存在的分区「${sectionKey}」，已归入第一分区。`);

    let materialId = q?.material ? matByKey.get(String(q.material)) ?? null : null;
    if (q?.material && materialId === null) warnings.push(`第 ${number} 题引用了不存在的材料「${q.material}」。`);

    const options: { key: string; text: string }[] = Array.isArray(q?.options)
      ? q.options.map((o: any, j: number) =>
          typeof o === "string" ? { key: String.fromCharCode(65 + j), text: o } : { key: String(o?.key ?? String.fromCharCode(65 + j)), text: String(o?.text ?? "") },
        )
      : [];
    if ((qtype === "choice_single" || qtype === "choice_multi") && options.length < 2) {
      warnings.push(`第 ${number} 题是选择题，但选项不足 2 个。`);
    }

    const pointsRaw = Number(q?.points);
    const points = Number.isFinite(pointsRaw) && pointsRaw > 0 ? Math.round(pointsRaw) : 1;
    if (Number.isFinite(pointsRaw) && pointsRaw <= 0) warnings.push(`第 ${number} 题分值不是正数，已改为 1 分。`);

    const stem = String(q?.stem ?? "").trim();
    if (!stem) warnings.push(`第 ${number} 题题干为空。`);

    return {
      id: i + 1,
      set_id: 0,
      section_id: sectionId,
      material_id: materialId,
      number,
      label: String(q?.label ?? number),
      qtype,
      stem,
      options,
      answer: importAnswer(qtype, q?.answer, number, warnings),
      explanation: String(q?.explanation ?? ""),
      points,
      position: i,
      source: String(q?.source ?? "import"),
      tags: Array.isArray(q?.tags) ? q.tags.map(String) : [],
      archived: false,
    };
  });

  for (const s of sections) s.question_count = questions.filter((q) => q.section_id === s.id).length;
  if (!questions.length) warnings.push("没有处理出题目：请确认 JSON 顶层有 questions 数组。");

  const setTags: string[] = Array.isArray(set.tags) ? set.tags.map((x: any) => String(x).trim()).filter(Boolean) : [];
  const folder = String(set.folder ?? "").trim() || null;
  return { title, set_tags: setTags, folder, question_count: questions.length, questions, warnings, sections, materials };
}

function parseImportSource(text: string): ImportPreview {
  const t = text.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("没有找到完整的 JSON 对象：请把 AI 返回的 JSON 原样粘贴进来（含最外层 { }）。");
  }
  let root: any;
  try {
    root = JSON.parse(t.slice(start, end + 1));
  } catch (err: any) {
    throw new Error(`JSON 读取失败：${err?.message ?? "格式不正确"}。常见原因是代码块围栏、尾逗号、单引号或注释。`);
  }
  return normalizeImport(root);
}

export async function mockCommand<T>(name: string, args: Record<string, any> = {}): Promise<T> {
  const state = load();
  switch (name) {
    case "list_sets": {
      if ((state.deletedSets ?? []).includes(1)) return [] as T;
      return [setSummaryFor(state)] as T;
    }
    case "get_set": {
      if ((state.deletedSets ?? []).includes(1)) throw new Error("试卷不存在。");
      const s = setSummaryFor(state);
      return { ...s, id: s.id, sections: clone(sections), materials: clone(materials), questions: clone(questions.map((q) => ({ ...q, set_id: s.id }))) } as T;
    }
    case "list_bank": {
      const f = (args.filters ?? {}) as BankFilters;
      let list = questions.filter((q) => !q.archived);
      if (f.set_id) list = list.filter((q) => q.set_id === f.set_id);
      if (f.set_ids?.length) list = list.filter((q) => f.set_ids!.includes(q.set_id));
      if (f.section_id) list = list.filter((q) => q.section_id === f.section_id);
      if (f.qtype) list = list.filter((q) => q.qtype === f.qtype);
      if (f.tag) list = list.filter((q) => q.tags.includes(f.tag!));
      if (f.tags?.length) list = list.filter((q) => f.tags!.every((tag) => q.tags.includes(tag)));
      if (f.q) {
        const q = f.q.toLowerCase();
        list = list.filter((x) => x.stem.toLowerCase().includes(q) || x.explanation.toLowerCase().includes(q));
      }
      list = [...list].sort((a, b) => f.sort === "added_asc" || f.sort === "number_desc" ? b.id - a.id : a.id - b.id);
      return { total: list.length, questions: clone(list.slice(0, f.limit ?? 500)) } as T;
    }
    case "create_attempt": {
      const ids: number[] = args.questionIds?.length ? args.questionIds : (args.setId ? questions.filter((q) => q.set_id === args.setId).map((q) => q.id) : []);
      if (!ids.length) throw new Error("至少选一道题。");
      const title = args.title ?? (args.setId ? setSummary().title : "自选题");
      const attempt: MockAttempt = {
        id: nextId(state),
        set_id: args.setId ?? null,
        title,
        mode: args.mode ?? "custom",
        status: "in_progress",
        started_at: now(),
        finished_at: null,
        total_score: 0,
        max_score: ids.reduce((sum, id) => sum + (findQuestion(id)?.points ?? 0), 0),
        question_count: ids.length,
        answered_count: 0,
        question_ids: ids,
        time_limit: args.timeLimit ?? 0,
      };
      state.attempts.push(attempt);
      save(state);
      return attempt.id as T;
    }
    case "resume_attempt": {
      const hit = [...state.attempts]
        .filter((a) => a.status === "in_progress" && a.set_id === (args.setId ?? null) && a.mode === "exam")
        .sort((a, b) => b.id - a.id)[0];
      return (hit ? hit.id : null) as T;
    }
    case "get_attempt": {
      const attempt = state.attempts.find((a) => a.id === args.attemptId);
      if (!attempt) throw new Error("记录不存在。");
      const qs = attempt.question_ids.map((id) => findQuestion(id)).filter(Boolean) as Question[];
      const ans = attemptAnswers(state, attempt.id);
      const out: AttemptDetail = {
        ...toSummary(attempt, state),
        question_ids: attempt.question_ids,
        questions: qs.map((q) => {
          const a = ans.find((x) => x.question_id === q.id);
          return {
            ...q,
            answer_raw: a?.raw ?? "",
            is_correct: a?.is_correct ?? null,
            score: a?.score ?? null,
            graded_by: a?.graded_by ?? null,
            comment: a?.comment ?? "",
          };
        }),
        sections: clone(sections.filter((s) => qs.some((q) => q.section_id === s.id))),
        materials: clone(materials.filter((m) => qs.some((q) => q.material_id === m.id))),
        time_limit: attempt.time_limit,
        set: attempt.set_id ? setSummary() : null,
      };
      return out as T;
    }
    case "save_answer": {
      const attempt = state.attempts.find((a) => a.id === args.attemptId);
      if (!attempt) throw new Error("记录不存在。");
      const q = findQuestion(args.questionId);
      if (!q) throw new Error("题目不存在。");
      const existing = state.answers.find((a) => a.attempt_id === attempt.id && a.question_id === q.id);
      if (existing) existing.raw = args.raw ?? "";
      else state.answers.push({ attempt_id: attempt.id, question_id: q.id, raw: args.raw ?? "", is_correct: null, score: 0, max_score: q.points, graded_by: "auto" });
      recompute(state, attempt.id);
      save(state);
      return null as T;
    }
    case "submit_attempt": {
      const attempt = state.attempts.find((a) => a.id === args.attemptId);
      if (!attempt) throw new Error("记录不存在。");
      for (const id of attempt.question_ids) {
        const q = findQuestion(id);
        if (!q) continue;
        const a = state.answers.find((x) => x.attempt_id === attempt.id && x.question_id === id);
        const result = gradeOne(q, a?.raw ?? "");
        if (a) {
          a.is_correct = result.correct ? 1 : result.correct === false ? 0 : null;
          a.score = result.score;
          a.max_score = q.points;
          a.graded_by = result.gradedBy;
        } else {
          state.answers.push({ attempt_id: attempt.id, question_id: id, raw: "", is_correct: null, score: 0, max_score: q.points, graded_by: "unanswered" });
        }
      }
      attempt.status = "submitted";
      attempt.finished_at = now();
      recompute(state, attempt.id);
      save(state);
      return attempt.id as T;
    }
    case "self_grade": {
      const attempt = state.attempts.find((a) => a.id === args.attemptId);
      if (!attempt) throw new Error("记录不存在。");
      const a = state.answers.find((x) => x.attempt_id === attempt.id && x.question_id === args.questionId);
      if (a) {
        a.score = Math.max(0, Math.min(a.max_score, Number(args.score) || 0));
        a.is_correct = a.score >= a.max_score ? 1 : 0;
        a.graded_by = "self";
        a.comment = "";
      }
      recompute(state, attempt.id);
      save(state);
      return null as T;
    }
    case "list_records": {
      const records = state.attempts
        .filter((a) => a.status === "submitted")
        .sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""))
        .map((a) => toSummary(a, state));
      return records as T;
    }
    case "delete_attempt": {
      const idx = state.attempts.findIndex((a) => a.id === args.attemptId);
      if (idx >= 0) state.attempts.splice(idx, 1);
      state.answers = state.answers.filter((a) => a.attempt_id !== args.attemptId);
      save(state);
      return null as T;
    }
    case "list_mistakes": {
      return clone(state.mistakes) as T;
    }
    case "collect_mistakes": {
      const ids: number[] = args.questionIds ?? [];
      for (const id of ids) {
        const q = findQuestion(id);
        if (!q) continue;
        if (state.mistakes.some((m) => m.question_id === id)) continue;
        const due = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        state.mistakes.push({
          id: nextId(state),
          question_id: id,
          question: clone(q),
          set_title: setSummary().title,
          section_title: sections.find((s) => s.id === q.section_id)?.title ?? "",
          wrong_count: 1,
          correct_streak: 0,
          last_wrong_at: now(),
          last_correct_at: null,
          status: "learning",
          origin: args.origin ?? "manual",
          due_at: due,
          note: "",
        });
      }
      save(state);
      return null as T;
    }
    case "set_mistake_status": {
      const m = state.mistakes.find((x) => x.id === args.mistakeId);
      if (m) {
        m.status = args.status;
        if (args.status === "mastered") m.correct_streak = Math.max(m.correct_streak, 2);
      }
      save(state);
      return null as T;
    }
    case "rename_set": {
      const title = String(args.title ?? "").trim();
      if (!title) throw new Error("试卷名不能为空。");
      seed.set.title = title;
      save(state);
      return setSummaryFor(state) as T;
    }
    case "update_set_tags": {
      const tags = (args.tags ?? []).map((x: any) => String(x).trim()).filter(Boolean);
      seed.set.tags = tags;
      save(state);
      return setSummaryFor(state) as T;
    }
    case "delete_tag": {
      const tag = String(args.tag ?? "").trim();
      if (!tag) throw new Error("标签不能为空。");
      delete state.tagAssignments[tag];
      for (const q of questions) q.tags = q.tags.filter((x) => x !== tag);
      seed.set.tags = (Array.isArray(seed.set.tags) ? seed.set.tags : []).filter((x: string) => x !== tag);
      save(state);
      return null as T;
    }
    case "list_tags": {
      return tagStats(state) as T;
    }
    case "list_tag_groups": {
      const out = state.tagGroups.map((g) => ({
        ...g,
        tag_count: Object.values(state.tagAssignments).filter((id) => id === g.id).length,
      }));
      return out as T;
    }
    case "create_tag_group": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("标签栏名不能为空。");
      if (state.tagGroups.some((g) => g.name === name)) throw new Error("已经有同名的标签栏。");
      const id = nextId(state);
      state.tagGroups.push({ id, name, color: args.color || "violet", position: state.tagGroups.length, tag_count: 0 });
      save(state);
      return id as T;
    }
    case "rename_tag_group": {
      const g = state.tagGroups.find((x) => x.id === args.groupId);
      if (!g) throw new Error("标签栏不存在。");
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("标签栏名不能为空。");
      g.name = name;
      if (args.color) g.color = args.color;
      save(state);
      return null as T;
    }
    case "delete_tag_group": {
      state.tagGroups = state.tagGroups.filter((x) => x.id !== args.groupId);
      for (const tag of Object.keys(state.tagAssignments)) {
        if (state.tagAssignments[tag] === args.groupId) delete state.tagAssignments[tag];
      }
      save(state);
      return null as T;
    }
    case "assign_tag_group": {
      const tag = String(args.tag ?? "").trim();
      if (!tag) return null as T;
      if (args.groupId == null) delete state.tagAssignments[tag];
      else state.tagAssignments[tag] = Number(args.groupId);
      save(state);
      return null as T;
    }
    case "assign_tags_group": {
      const tags: string[] = args.tags ?? [];
      for (const raw of tags) {
        const tag = String(raw).trim();
        if (!tag) continue;
        if (args.groupId == null) delete state.tagAssignments[tag];
        else state.tagAssignments[tag] = Number(args.groupId);
      }
      save(state);
      return null as T;
    }
    case "ai_organize_tags": {
      const out: TagSuggestion[] = tagStats(state).map((t) => ({ tag: t.name, group: t.group_name }));
      return out as T;
    }
    case "apply_tag_suggestions": {
      const items: TagSuggestion[] = args.items ?? [];
      for (const item of items) {
        const group = groupByName(state, item.group);
        if (group) state.tagAssignments[item.tag] = group.id;
        else delete state.tagAssignments[item.tag];
      }
      save(state);
      return null as T;
    }
    case "delete_set": {
      const id = Number(args.setId);
      state.deletedSets = [...(state.deletedSets ?? []).filter((x) => x !== id), id];
      state.attempts = state.attempts.filter((a) => a.set_id !== id);
      save(state);
      return null as T;
    }
    case "get_settings": {
      return clone(state.settings) as T;
    }
    case "save_settings": {
      const s = args.settings ?? {};
      state.settings = { ...state.settings, ...s, has_api_key: !!(s.apiKey || state.settings.has_api_key) };
      if (s.clearKey) state.settings.has_api_key = false;
      save(state);
      return clone(state.settings) as T;
    }
    case "ai_test": {
      return { ok: true, model: String(args.config?.model || "mock"), elapsed_ms: 12, message: "浏览器预览模式：未真正联网。" } as T;
    }
    case "ai_complete": {
      return { content: "", reasoning: "浏览器预览模式不调用真实 AI。", model: "mock", cached: false } as T;
    }
    case "ai_explain": {
      return { content: "浏览器预览模式不调用真实 AI。", reasoning: "", model: "mock", cached: false } as T;
    }
    case "ai_vision_segment": {
      return { content: '{"figures":[]}', reasoning: "浏览器预览模式不调用真实 AI。", model: "mock", cached: false } as T;
    }
    case "ai_plan_scores": {
      const total = Math.max(0, Number(args.total) || 0);
      const list = questions.slice().sort((a, b) => a.number - b.number);
      const base = list.length ? Math.floor(total / list.length) : 0;
      let remain = total - base * list.length;
      const items = list.map((q) => {
        const extra = remain > 0 ? 1 : 0;
        if (remain > 0) remain -= 1;
        return { number: q.number, points: base + extra, reason: "浏览器预览模式：平均分配" };
      });
      return { total, allocated: items.reduce((sum, x) => sum + x.points, 0), items, model: "mock", note: "" } as T;
    }
    case "apply_score_plan": {
      const items: { number: number; points: number }[] = args.items ?? [];
      for (const item of items) {
        const q = questions.find((x) => x.number === item.number);
        if (q) q.points = Math.max(0, Number(item.points) || 0);
      }
      for (const attempt of state.attempts) {
        for (const a of state.answers.filter((x) => x.attempt_id === attempt.id)) {
          a.max_score = findQuestion(a.question_id)?.points ?? a.max_score;
        }
        recompute(state, attempt.id);
      }
      save(state);
      return setSummaryFor(state) as T;
    }
    case "ai_grade_attempt": {
      const attempt = state.attempts.find((a) => a.id === Number(args.attemptId));
      if (!attempt) throw new Error("练习记录不存在。");
      const items: any[] = [];
      for (const id of attempt.question_ids) {
        const q = findQuestion(id);
        const a = state.answers.find((x) => x.attempt_id === attempt.id && x.question_id === id);
        if (!q || !a) continue;
        if (!["short_answer", "writing", "dictation"].includes(q.qtype)) continue;
        if (args.onlyPending !== false && a.graded_by !== "pending") continue;
        if (!a.raw.trim()) continue;
        const score = q.points;
        a.score = score;
        a.max_score = q.points;
        a.is_correct = 1;
        a.graded_by = "ai";
        a.comment = "浏览器预览模式：主观题按满分计入。";
        items.push({ question_id: id, number: q.number, label: q.label, score, max_score: q.points, comment: a.comment });
      }
      recompute(state, attempt.id);
      save(state);
      return { attempt_id: attempt.id, graded: items.length, total_score: attempt.total_score, max_score: attempt.max_score, model: "mock", items, missing: [] } as T;
    }
    case "ai_classify": {
      return [] as T;
    }
    case "update_question": {
      const q = findQuestion(args.questionId);
      if (!q) throw new Error("题目不存在。");
      if (args.qtype) q.qtype = args.qtype;
      if (args.tags) q.tags = args.tags;
      if (args.stem != null) q.stem = args.stem;
      save(state);
      return null as T;
    }
    case "preview_import": {
      const text = String(args.text ?? "");
      if (!text.trim()) throw new Error("没有可导入的内容。");
      return parseImportSource(text) as T;
    }
    case "confirm_import":
    case "undo_import":
    case "restore_backup":
    case "assign_folder":
    case "rename_folder":
    case "delete_folder": {
      save(state);
      return null as T;
    }
    case "backup_now": {
      return "mock-backup" as T;
    }
    case "list_folders": {
      return clone(state.folders) as T;
    }
    case "create_folder": {
      const id = nextId(state);
      state.folders.push({ id, name: String(args.name ?? "新文件夹"), parent_id: args.parentId ?? null, sort: state.folders.length, set_count: 0, question_count: 0 });
      save(state);
      return id as T;
    }
    case "media_path": {
      return String(args.file ?? "") as T;
    }
    default:
      throw new Error(`浏览器预览模式未实现命令：${name}`);
  }
}