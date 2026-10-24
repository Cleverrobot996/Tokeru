import type { AttemptMode } from "./types";

export const QTYPE_LABEL: Record<string, string> = {
  choice_single: "单项选择",
  choice_multi: "多项选择",
  fill_blank: "填空",
  cloze: "完形填空",
  true_false: "判断",
  short_answer: "简答",
  writing: "写作",
  dictation: "听写",
  matching: "匹配",
};

export function qtypeLabel(t: string): string {
  return QTYPE_LABEL[t] ?? t;
}

export function modeLabel(m: AttemptMode | string): string {
  if (m === "exam") return "整卷";
  if (m === "review") return "错题复习";
  if (m === "custom") return "自选练习";
  return String(m);
}

/** 2026-10-22 21:03:00 → 10-22 21:03 */
export function fmtTime(s?: string | null): string {
  if (!s) return "—";
  const t = s.replace("T", " ");
  return t.length >= 16 ? t.slice(5, 16) : t;
}

/** 2026-10-22 21:03:00 → 2026-10-22 */
export function fmtDay(s?: string | null): string {
  if (!s) return "未完成";
  return s.replace("T", " ").slice(0, 10);
}

/** 人类可读的日期标题 */
export function dayTitle(day: string): string {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const t = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const y = new Date(today.getTime() - 86400000);
  const yt = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;
  if (day === t) return `今天 · ${day}`;
  if (day === yt) return `昨天 · ${day}`;
  return day;
}

export function elapsed(start?: string | null, end?: string | null): string {
  if (!start) return "—";
  const a = new Date(start.replace(" ", "T")).getTime();
  const b = end ? new Date(end.replace(" ", "T")).getTime() : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return "—";
  const min = Math.round((b - a) / 60000);
  if (min < 1) return "不到 1 分钟";
  if (min < 60) return `${min} 分钟`;
  return `${Math.floor(min / 60)} 小时 ${min % 60} 分`;
}

export function scoreText(score: number | null | undefined, max: number | null | undefined): string {
  if (score == null) return "—";
  const s = Number.isInteger(score) ? String(score) : score.toFixed(1);
  return max ? `${s} / ${max}` : s;
}
/** 从 question.answer 里抽出"正确答案"文案：correct → accept/accepted → reference */
export function answerText(answer: { correct?: string | string[] | null; accept?: string[] | null; accepted?: string[] | null; reference?: string | null } | null | undefined): string {
  if (!answer) return "见参考答案";
  if (Array.isArray(answer.correct) && answer.correct.length) return answer.correct.join(" / ");
  if (typeof answer.correct === "string" && answer.correct.trim()) return answer.correct;
  const acc = answer.accept?.length ? answer.accept : answer.accepted?.length ? answer.accepted : null;
  if (acc?.length) return acc.join(" / ");
  if (answer.reference?.trim()) return answer.reference;
  return "见参考答案";
}

/** 可接受答案（去掉与答案本身重复的写法） */
export function acceptText(answer: { correct?: string | string[] | null; accept?: string[] | null; accepted?: string[] | null } | null | undefined): string {
  if (!answer) return "";
  const acc = answer.accept?.length ? answer.accept : answer.accepted ?? [];
  const base = Array.isArray(answer.correct) ? answer.correct : answer.correct ? [answer.correct] : [];
  const rest = acc.filter((a) => !base.includes(a));
  return rest.join(" / ");
}
