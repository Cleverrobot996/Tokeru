import type { CSSProperties } from "react";

export type PaperFont = "serif" | "sans";
export type PaperContrast = "normal" | "high";

export interface PaperStyle {
  font: PaperFont;
  size: number;
  leading: number;
  gap: number;
  width: number;
  /** 标准对比 / 高对比：高对比会压掉浅色底并加强分隔线。 */
  contrast: PaperContrast;
  /** 自定义字体族；为空时使用内置的阅读体 / 界面体。 */
  family: string;
  /** 展示用的字体名（系统字体名或文件名）。 */
  familyLabel?: string;
}

export const PAPER_STORAGE_KEY = "tokero:paper-style";
export const PAPER_FONT_STORAGE_KEY = "tokero:paper-font";
export const CUSTOM_FONT_FAMILY = "Tokero Custom";

export const PAPER_DEFAULT: PaperStyle = {
  font: "serif",
  size: 16,
  leading: 1.85,
  gap: 12,
  width: 880,
  contrast: "normal",
  family: "",
  familyLabel: "",
};

export const PAPER_PRESETS: { id: string; label: string; hint: string; style: PaperStyle }[] = [
  { id: "default", label: "默认", hint: "纸面、留白适中", style: PAPER_DEFAULT },
  { id: "compact", label: "紧凑", hint: "一屏看得更多", style: { font: "serif", size: 15, leading: 1.65, gap: 6, width: 820, contrast: "normal", family: "", familyLabel: "" } },
  { id: "airy", label: "宽松", hint: "行距与段落更舒展", style: { font: "serif", size: 16.5, leading: 2, gap: 18, width: 920, contrast: "normal", family: "", familyLabel: "" } },
  { id: "large", label: "大字", hint: "长时间阅读更省力", style: { font: "serif", size: 18.5, leading: 1.9, gap: 14, width: 860, contrast: "normal", family: "", familyLabel: "" } },
];

export function normalizePaperStyle(input: Partial<PaperStyle> | null | undefined): PaperStyle {
  const clamp = (value: unknown, fallback: number, min: number, max: number) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  const family = typeof input?.family === "string" ? input.family.trim().slice(0, 120) : "";
  const label = typeof input?.familyLabel === "string" ? input.familyLabel.trim().slice(0, 160) : "";
  return {
    font: input?.font === "sans" ? "sans" : "serif",
    size: clamp(input?.size, PAPER_DEFAULT.size, 14, 22),
    leading: clamp(input?.leading, PAPER_DEFAULT.leading, 1.4, 2.2),
    gap: clamp(input?.gap, PAPER_DEFAULT.gap, 4, 28),
    width: clamp(input?.width, PAPER_DEFAULT.width, 720, 1040),
    contrast: input?.contrast === "high" ? "high" : "normal",
    family,
    familyLabel: label || family,
  };
}

export function loadPaperStyle(): PaperStyle {
  try {
    const raw = localStorage.getItem(PAPER_STORAGE_KEY);
    if (!raw) return PAPER_DEFAULT;
    return normalizePaperStyle(JSON.parse(raw) as Partial<PaperStyle>);
  } catch {
    return PAPER_DEFAULT;
  }
}

export function savePaperStyle(style: PaperStyle): void {
  try {
    localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify(normalizePaperStyle(style)));
  } catch {
    /* 无痕模式或存储已满时忽略，当前会话仍然生效 */
  }
}

export function paperCssVars(style: PaperStyle): CSSProperties {
  const s = normalizePaperStyle(style);
  const family = s.family ? `"${s.family.replace(/"/g, "")}", var(--font-reading)` : undefined;
  const vars = {
    "--paper-font": family ?? (s.font === "sans" ? "var(--font-ui)" : "var(--font-reading)"),
    "--paper-size": s.size + "px",
    "--paper-leading": String(s.leading),
    "--paper-gap": s.gap + "px",
    "--paper-width": s.width + "px",
  } as Record<string, string>;
  if (s.contrast === "high") {
    // paper.css 不在本任务的写范围内：直接在纸面容器上覆盖它已经使用的变量，
    // 就能同时去掉材料/说明/答案的浅色底，并加强分隔线与次要文字。
    Object.assign(vars, {
      "--paper-contrast": "high",
      "--surface-2": "transparent",
      "--line": "color-mix(in srgb, var(--text) 34%, transparent)",
      "--line-strong": "color-mix(in srgb, var(--text) 52%, transparent)",
      "--text-2": "var(--text)",
      "--text-3": "var(--text-2)",
      "--accent-soft": "transparent",
    });
  }
  return vars as CSSProperties;
}

export function samePaperStyle(a: PaperStyle, b: PaperStyle): boolean {
  return (
    a.font === b.font &&
    a.size === b.size &&
    a.leading === b.leading &&
    a.gap === b.gap &&
    a.width === b.width &&
    (a.contrast ?? "normal") === (b.contrast ?? "normal") &&
    (a.family ?? "") === (b.family ?? "")
  );
}

interface StoredFont {
  name: string;
  dataUrl: string;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("读取字体文件失败"));
    reader.readAsDataURL(file);
  });
}

async function registerFont(dataUrl: string): Promise<void> {
  const response = await fetch(dataUrl);
  const buffer = await response.arrayBuffer();
  const face = new FontFace(CUSTOM_FONT_FAMILY, buffer);
  await face.load();
  document.fonts.add(face);
}

/** 选择本地字体文件：立刻注入当前会话；小于约 4 MB 时写入 localStorage，下次启动自动恢复。 */
export async function importCustomFont(file: File): Promise<{ family: string; label: string; persisted: boolean }> {
  const dataUrl = await readFileAsDataUrl(file);
  if (!dataUrl) throw new Error("字体文件为空");
  await registerFont(dataUrl);
  let persisted = false;
  if (dataUrl.length <= 5_600_000) {
    try {
      localStorage.setItem(PAPER_FONT_STORAGE_KEY, JSON.stringify({ name: file.name, dataUrl } satisfies StoredFont));
      persisted = true;
    } catch {
      /* 存储空间不足时只保留当前会话 */
    }
  }
  return { family: CUSTOM_FONT_FAMILY, label: file.name, persisted };
}

/** 启动时恢复上次选择的字体文件。 */
export async function restoreCustomFont(): Promise<string | null> {
  try {
    const raw = localStorage.getItem(PAPER_FONT_STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredFont>;
    if (!stored?.dataUrl) return null;
    await registerFont(stored.dataUrl);
    return stored.name ?? CUSTOM_FONT_FAMILY;
  } catch {
    return null;
  }
}

export function clearCustomFont(): void {
  try {
    localStorage.removeItem(PAPER_FONT_STORAGE_KEY);
  } catch {
    /* 忽略 */
  }
}
