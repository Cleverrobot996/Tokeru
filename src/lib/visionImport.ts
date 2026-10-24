import { api } from "./api";
import { buildPrompt } from "./importPrompt";
import { cropPage, loadImage, type PageImage } from "./pdf";
import type { ImportPreview } from "./types";

/** 单张题图写入题干前允许的最大字节数（base64 解码后）。 */
export const MAX_FIGURE_BYTES = 300 * 1024;
/** 整卷所有题图允许的最大字节数；超过后不再写入，只保留文字提示。 */
export const MAX_TOTAL_FIGURE_BYTES = 8 * 1024 * 1024;

const VISION_BATCH_PAGES = 4;
const VISION_INPUT_BATCH_BYTES = 8 * 1024 * 1024;
const FIGURE_TOKEN_RE = /\{\{fig:([^}]+)\}\}/g;
const BRACKET_FIGURE_RE = /\[\[\s*fig\s*:\s*([^\]]+)\]\]/gi;

export type VisionBBox = [number, number, number, number];

export interface VisionFigure {
  id: string;
  dataUrl: string;
  alt?: string;
  page?: number;
  /** 归一化 [左上 x, 左上 y, 宽, 高]，用于从整页图裁出题图。 */
  bbox?: VisionBBox;
}

export interface VisionPageText {
  markdown: string;
  figures: VisionFigure[];
  page?: number;
}

export interface MergedVisionPages {
  markdown: string;
  figures: VisionFigure[];
  pages: number;
}

export interface FigureResolution {
  text: string;
  used: number;
  skipped: number;
  bytes: number;
}

export interface VisionCleanOptions {
  pages: PageImage[];
  title?: string;
  extra?: string;
  onProgress?: (label: string, done: number, total: number) => void;
}

export interface VisionCleanResult {
  json: string;
  markdown: string;
  preview: ImportPreview;
  figures: number;
  figureBytes: number;
  warnings: string[];
}

/** 计算 data URL 里图片解码后的字节数，用于执行 300KB / 8MB 限制。 */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const body = dataUrl.slice(comma + 1).replace(/\s/g, "");
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}

/** 把数据 URL 压缩到 maxBytes 以内；压不动时返回原图，由调用方决定是否跳过。 */
async function compressDataUrl(dataUrl: string, maxBytes: number): Promise<string> {
  if (dataUrlBytes(dataUrl) <= maxBytes) return dataUrl;
  try {
    const img = await loadImage(dataUrl);
    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;
    if (!width || !height) return dataUrl;
    let quality = 0.82;
    let best = dataUrl;
    for (let i = 0; i < 14; i += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      const ctx = canvas.getContext("2d");
      if (!ctx) return best;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      best = canvas.toDataURL("image/jpeg", quality);
      if (dataUrlBytes(best) <= maxBytes) return best;
      width *= 0.82;
      height *= 0.82;
      quality = Math.max(0.45, quality - 0.06);
      if (width < 240 || height < 240) break;
    }
    return best;
  } catch {
    return dataUrl;
  }
}

function stripCodeFence(source: string): string {
  const text = source.trim();
  const fenced = text.match(/^```[a-zA-Z0-9_-]*\s*\r?\n([\s\S]*?)\r?\n```\s*$/);
  return fenced ? fenced[1].trim() : text;
}

/** 从任意文本里截出第一个完整的 JSON 对象，避免模型在 JSON 外说多余的话。 */
function outermostJson(source: string): string | null {
  const text = stripCodeFence(source);
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function bareId(value: string): string {
  return value.trim().replace(/^fig:/i, "");
}

/** 把 OCR 返回的 [[FIG:id]] 统一成 {{fig:id}}，后续只处理一种占位符。 */
function normalizeFigureTokens(markdown: string): string {
  return markdown.replace(BRACKET_FIGURE_RE, (_match, value: string) => `{{fig:${bareId(value)}}}`);
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (text.endsWith("%")) {
    const percent = Number(text.slice(0, -1));
    return Number.isFinite(percent) ? percent / 100 : null;
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 解析常见的 bbox 写法；坐标 clamp 到页面内，过小的框返回 null。 */
function readBBox(value: unknown): VisionBBox | null {
  if (Array.isArray(value) && value.length >= 4) {
    const numbers = value.slice(0, 4).map(numberValue);
    if (numbers.some((item) => item === null)) return null;
    let [x, y, w, h] = numbers as [number, number, number, number];
    const max = Math.max(x, y, w, h);
    if (max > 1.5) {
      x /= 100;
      y /= 100;
      w /= 100;
      h /= 100;
    }
    const nx = clamp(x, 0, 1);
    const ny = clamp(y, 0, 1);
    const nw = Math.min(Math.max(w, 0), 1 - nx);
    const nh = Math.min(Math.max(h, 0), 1 - ny);
    if (nw < 0.004 || nh < 0.004) return null;
    return [nx, ny, nw, nh];
  }
  if (value && typeof value === "object") {
    const box = value as Record<string, unknown>;
    if ("x1" in box && "y1" in box && "x2" in box && "y2" in box) {
      const x1 = numberValue(box.x1);
      const y1 = numberValue(box.y1);
      const x2 = numberValue(box.x2);
      const y2 = numberValue(box.y2);
      if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
      return readBBox([Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)]);
    }
    return readBBox([box.x ?? box.left, box.y ?? box.top, box.w ?? box.width, box.h ?? box.height]);
  }
  return null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function toDataUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(text)) return text;
  if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.replace(/\s/g, "").length > 120) {
    return `data:image/jpeg;base64,${text.replace(/\s/g, "")}`;
  }
  return "";
}

function readFigures(raw: unknown, fallbackPage?: number): VisionFigure[] {
  if (!Array.isArray(raw)) return [];
  const out: VisionFigure[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const rawId = firstString(value.id, value.key, value.name);
    if (!rawId) continue;
    const id = bareId(rawId);
    const dataUrl = toDataUrl(
      value.dataUrl ?? value.data_url ?? value.data ?? value.image ?? value.image_url ?? value.url,
    );
    const pageValue = value.page ?? value.page_number;
    const page =
      typeof pageValue === "number" && Number.isFinite(pageValue)
        ? Math.floor(pageValue)
        : fallbackPage;
    const alt = typeof value.alt === "string" ? value.alt : typeof value.caption === "string" ? value.caption : undefined;
    const bbox = readBBox(value.bbox ?? value.box ?? value.rect) ?? undefined;
    const next: VisionFigure = { id, dataUrl, alt, page, bbox };
    const existing = out.findIndex((figure) => figure.id === id);
    if (existing >= 0) {
      out[existing] = {
        ...out[existing],
        ...next,
        dataUrl: next.dataUrl || out[existing].dataUrl,
        bbox: next.bbox ?? out[existing].bbox,
      };
    } else {
      out.push(next);
    }
  }
  return out;
}

function tokenIds(markdown: string): string[] {
  const out: string[] = [];
  for (const match of markdown.matchAll(FIGURE_TOKEN_RE)) {
    const id = bareId(match[1]);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function ensureFigureEntries(markdown: string, figures: VisionFigure[], page?: number): VisionFigure[] {
  const out = [...figures];
  for (const id of tokenIds(markdown)) {
    if (out.some((figure) => figure.id === id)) continue;
    out.push({ id, dataUrl: "", page });
  }
  return out;
}

/** 递归解析 pages 数组时页码由调用方给出，先去掉模型自己的批内页码。 */
function withoutPageFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const copy = { ...(value as Record<string, unknown>) };
  delete copy.page;
  delete copy.page_number;
  return copy;
}

/**
 * 宽松解析视觉模型返回：支持纯 Markdown、Markdown+figures 对象、pages 数组。
 * 返回的 Markdown 里保留 {{fig:id}}，后续统一替换。
 */
export function parseVisionOcr(content: string, page?: number): VisionPageText {
  const raw = normalizeFigureTokens(stripCodeFence(content || ""));
  if (!raw) return { markdown: "", figures: [], page };
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (Array.isArray(parsed)) {
    const base = page ?? 1;
    const chunks = parsed.map((entry, index) => {
      const entryPage = base + index;
      return typeof entry === "string"
        ? { markdown: normalizeFigureTokens(entry), figures: [], page: entryPage }
        : parseVisionOcr(JSON.stringify(withoutPageFields(entry)), entryPage);
    });
    const merged = mergeVisionPages(chunks);
    return { markdown: merged.markdown, figures: merged.figures, page };
  }

  if (parsed && typeof parsed === "object") {
    const object = parsed as Record<string, unknown>;
    const nested = object.pages;
    if (Array.isArray(nested)) {
      const base = page ?? 1;
      const chunks = nested.map((entry, index) => {
        const entryPage = base + index;
        return typeof entry === "string"
          ? { markdown: normalizeFigureTokens(entry), figures: [], page: entryPage }
          : parseVisionOcr(JSON.stringify(withoutPageFields(entry)), entryPage);
      });
      const merged = mergeVisionPages(chunks);
      return { markdown: merged.markdown, figures: merged.figures, page };
    }
    const declaredPage = numberValue(object.page ?? object.page_number);
    const markdown = normalizeFigureTokens(firstString(object.markdown, object.text, object.content, object.ocr));
    const figures = readFigures(object.figures ?? object.images ?? object.crops);
    if (page !== undefined) {
      /* 模型每批从第 1 页开始编号；按调用方给出的起始页换算成全卷页码。 */
      for (const figure of figures) {
        const relative = typeof figure.page === "number" && figure.page > 0 ? figure.page : (declaredPage ?? 1);
        figure.page = page + relative - 1;
      }
    }
    const effectivePage = page !== undefined ? page + (declaredPage ?? 1) - 1 : (declaredPage ?? undefined);
    return {
      markdown: markdown || "",
      figures: ensureFigureEntries(markdown || "", figures, effectivePage),
      page,
    };
  }

  return { markdown: raw, figures: ensureFigureEntries(raw, [], page), page };
}

/** 合并多批 OCR 结果，并把各批内部的 fig id 重编号，避免 id 冲突。 */
export function mergeVisionPages(chunks: VisionPageText[]): MergedVisionPages {
  const parts: string[] = [];
  const figures: VisionFigure[] = [];
  let counter = 1;
  for (const chunk of chunks) {
    const markdown = chunk.markdown.trim();
    if (!markdown) continue;
    const ids = new Set<string>([...tokenIds(markdown), ...chunk.figures.map((figure) => figure.id)]);
    const idMap = new Map<string, string>();
    for (const id of ids) {
      idMap.set(id, `fig${counter}`);
      counter += 1;
    }
    parts.push(
      markdown.replace(FIGURE_TOKEN_RE, (_match, value: string) => {
        const id = bareId(value);
        return `{{fig:${idMap.get(id) ?? id}}}`;
      }),
    );
    for (const figure of chunk.figures) {
      if (!ids.has(figure.id)) continue;
      const nextId = idMap.get(figure.id);
      if (!nextId) continue;
      figures.push({ ...figure, id: nextId });
    }
  }
  return { markdown: parts.filter(Boolean).join("\n\n"), figures, pages: chunks.length };
}

/** 建立占位符 id → 图片 data URL 的映射；有 bbox 时按页裁图，缺失的交给 resolveFigureTokens 提示。 */
export async function buildFigureMap(figures: VisionFigure[], pages: PageImage[] = []): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const figure of figures) {
    let dataUrl = figure.dataUrl;
    if (figure.bbox && figure.page) {
      const page = pages[figure.page - 1];
      if (page) {
        try {
          const crop = await cropPage(page, figure.bbox);
          if (crop) dataUrl = crop;
        } catch {
          /* 裁剪失败时保留模型返回的 dataUrl；没有图就交给后面输出占位提示。 */
        }
      }
    }
    if (dataUrl) map.set(figure.id, dataUrl);
  }
  return map;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function figureHtml(dataUrl: string, alt: string): string {
  return `<figure class="q-figure"><img src="${dataUrl}" alt="${escapeHtml(alt)}" /></figure>`;
}

/** 把文本里的 {{fig:id}} 替换成题图 HTML；缺图时留下中文提示。 */
export async function resolveFigureTokens(
  text: string,
  figures: Map<string, string>,
  options: { alt?: string; maxFigureBytes?: number; maxTotalBytes?: number; usedBytes?: number } = {},
): Promise<FigureResolution> {
  const maxFigure = options.maxFigureBytes ?? MAX_FIGURE_BYTES;
  const maxTotal = options.maxTotalBytes ?? MAX_TOTAL_FIGURE_BYTES;
  const alt = options.alt || "题图";
  const alreadyUsed = options.usedBytes ?? 0;
  let cursor = 0;
  let used = 0;
  let skipped = 0;
  let bytes = 0;
  const parts: string[] = [];
  for (const match of text.matchAll(FIGURE_TOKEN_RE)) {
    const index = match.index ?? 0;
    parts.push(text.slice(cursor, index));
    const id = bareId(match[1]);
    const source = figures.get(id);
    if (!source) {
      skipped += 1;
      parts.push("（原题有图，见原卷）");
      cursor = index + match[0].length;
      continue;
    }
    const dataUrl = await compressDataUrl(source, maxFigure);
    const size = dataUrlBytes(dataUrl);
    if (size > maxFigure || alreadyUsed + bytes + size > maxTotal) {
      skipped += 1;
      parts.push("（原题有图，见原卷）");
    } else {
      parts.push(figureHtml(dataUrl, alt));
      used += 1;
      bytes += size;
    }
    cursor = index + match[0].length;
  }
  parts.push(text.slice(cursor));
  return { text: parts.join(""), used, skipped, bytes };
}

async function resolveJsonFigures(
  value: unknown,
  map: Map<string, string>,
  stats: { used: number; skipped: number; bytes: number },
): Promise<unknown> {
  if (typeof value === "string") {
    const result = await resolveFigureTokens(value, map, { usedBytes: stats.bytes });
    stats.used += result.used;
    stats.skipped += result.skipped;
    stats.bytes += result.bytes;
    return result.text;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) out.push(await resolveJsonFigures(item, map, stats));
    return out;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = await resolveJsonFigures(item, map, stats);
    }
    return out;
  }
  return value;
}

async function prepareVisionPages(
  pages: PageImage[],
  onProgress?: VisionCleanOptions["onProgress"],
): Promise<PageImage[]> {
  const out: PageImage[] = [];
  for (let i = 0; i < pages.length; i += 1) {
    onProgress?.(`正在压缩第 ${i + 1}/${pages.length} 页`, i + 1, pages.length);
    const dataUrl = dataUrlBytes(pages[i].dataUrl) > MAX_FIGURE_BYTES
      ? await compressDataUrl(pages[i].dataUrl, MAX_FIGURE_BYTES)
      : pages[i].dataUrl;
    out.push({ ...pages[i], dataUrl });
  }
  return out;
}

export function chunkPages(
  pages: PageImage[],
  maxPerChunk = VISION_BATCH_PAGES,
  maxBytes = VISION_INPUT_BATCH_BYTES,
): PageImage[][] {
  const out: PageImage[][] = [];
  let current: PageImage[] = [];
  let bytes = 0;
  for (const page of pages) {
    const size = dataUrlBytes(page.dataUrl);
    if (current.length > 0 && (current.length >= maxPerChunk || bytes + size > maxBytes)) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(page);
    bytes += size;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * 视觉导入主流程：
 * 页面压缩 → 分批视觉 OCR → 合并 Markdown（保留图占位）→ 按规范生成 JSON
 * → 替换题图 → previewImport 校验。
 */
export async function visionCleanPipeline(options: VisionCleanOptions): Promise<VisionCleanResult> {
  const { pages, title, extra, onProgress } = options;
  if (!pages.length) throw new Error("没有可视觉识别的页面，请重新选择 PDF 或图片。");

  const prepared = await prepareVisionPages(pages, onProgress);
  const batches = chunkPages(prepared);
  const chunks: VisionPageText[] = [];

  for (let i = 0; i < batches.length; i += 1) {
    onProgress?.(`视觉识别第 ${i + 1}/${batches.length} 批`, i, batches.length);
    const result = await api.aiVisionOcr(batches[i].map((page) => page.dataUrl));
    const parsed = parseVisionOcr(result.content, batches[i][0]?.page);
    if (!parsed.markdown.trim() && parsed.figures.every((figure) => !figure.dataUrl)) {
      throw new Error(`视觉识别第 ${i + 1} 批没有返回可读文字，请检查 AI 配置后重试。`);
    }
    chunks.push(parsed);
  }

  const merged = mergeVisionPages(chunks);
  if (!merged.markdown.trim()) throw new Error("视觉识别没有返回可用文字，请重试。");

  onProgress?.("正在按导入规范整理 JSON", batches.length, batches.length);
  const prompt = buildPrompt({
    material: merged.markdown,
    title: title?.trim() || undefined,
    extra: [
      extra?.trim(),
      "这是从试卷图片 OCR 出来的 Markdown。材料里的 {{fig:...}} 是题图占位符，必须原样保留在对应题干或材料内容里，不要删除、改写或移动。",
    ]
      .filter(Boolean)
      .join("\n"),
  });
  const result = await api.aiComplete(
    "你是 Tokeru 的试卷整理助手。严格按用户给出的清洗规范输出，只返回一个完整 JSON 对象。",
    prompt,
  );
  const raw = outermostJson(result.content);
  if (!raw) throw new Error("AI 没有返回 JSON 对象，请重试。");
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error("AI 返回的 JSON 无法读取，请重试。");
  }

  const figureMap = await buildFigureMap(merged.figures, pages);
  const stats = { used: 0, skipped: 0, bytes: 0 };
  const resolved = await resolveJsonFigures(parsedJson, figureMap, stats);
  const json = JSON.stringify(resolved, null, 2);

  onProgress?.("正在校验导入结构", batches.length, batches.length);
  const preview = await api.previewImport({ text: json, title: title?.trim() || undefined, kind: "json" });
  const warnings = [...preview.warnings];
  if (stats.skipped > 0) {
    warnings.unshift(`${stats.skipped} 个题图未能提取，已在题目中标为「原题有图，见原卷」。`);
  }
  const originalTokens = tokenIds(merged.markdown).length;
  if (originalTokens > 0 && stats.used === 0 && stats.skipped === 0) {
    warnings.unshift("AI 输出没有保留题图占位符，题图可能缺失。");
  }
  return {
    json,
    markdown: merged.markdown,
    preview: { ...preview, warnings },
    figures: stats.used,
    figureBytes: stats.bytes,
    warnings,
  };
}