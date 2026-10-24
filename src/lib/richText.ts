/**
 * 富文本：题干/材料默认按纯文本处理（转义 HTML、下划线变填空）。
 * 只有显式带 <figure> / <img> 的导入内容才按 HTML 渲染，用于数学几何图、表格截图等。
 * 数学公式保留原始 TeX，渲染结果不写回数据；KaTeX 只负责显示。
 *
 * 安全边界：题干和材料可以被 MCP / 导入 JSON 写入，必须当成不可信输入。
 * 媒体块只允许 figure / figcaption / img / br，img.src 只允许 data:image；
 * 其余标签、属性、事件处理器和远程 URL 一律丢弃，避免 stored XSS。
 */

import katex from "katex";
import "katex/contrib/mhchem";

const MEDIA_RE = /<(?:figure|img)\b/i;
const MEDIA_BLOCK_RE = /(<figure\b[\s\S]*?<\/figure>|<img\b[^>]*>)/gi;
const DROP_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "LINK", "META"]);
const ALLOWED_TAGS = new Set(["FIGURE", "FIGCAPTION", "IMG", "BR"]);
const DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i;
const MATH_SOURCE = String.raw`\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\\)\$(?!\$)(?=\S)[^$\n]*?(?<=\S)(?<!\\)\$(?!\$)`;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const TABLE_ROW = /\|/;

export function hasRichMedia(text: string): boolean {
  return MEDIA_RE.test(text || "");
}

/** 是否包含可识别的公式定界符；仅用于决定是否进入 KaTeX 分支。 */
export function hasMath(text: string): boolean {
  if (!text || (!text.includes("$") && !text.includes("\\(") && !text.includes("\\["))) return false;
  const re = new RegExp(MATH_SOURCE, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (mathBody(match[0])) return true;
  }
  return false;
}

function mathBody(raw: string): string {
  if (raw.startsWith("$$")) return raw.slice(2, -2).trim();
  if (raw.startsWith("\\[")) return raw.slice(2, -2).trim();
  if (raw.startsWith("\\(")) return raw.slice(2, -2).trim();
  if (raw.startsWith("$")) return raw.slice(1, -1).trim();
  return "";
}

function escapePlain(text: string, breaks: boolean): string {
  const safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return breaks ? safe.split("\n").join("<br/>") : safe;
}

function escapeText(text: string, breaks: boolean, blanks: boolean): string {
  const safe = escapePlain(text, false);
  const withBlanks = blanks ? safe.replace(/_{2,}/g, '<span class="blank"></span>') : safe;
  return breaks ? withBlanks.split("\n").join("<br/>") : withBlanks;
}

function renderMath(tex: string, display: boolean): string {
  try {
    const html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      trust: false,
      strict: "ignore",
      output: "html",
    });
    return display
      ? '<span class="math-display">' + html + "</span>"
      : '<span class="math-inline">' + html + "</span>";
  } catch {
    const raw = (display ? "$$" : "$") + tex + (display ? "$$" : "$");
    return escapePlain(raw, false);
  }
}

/** 把一段纯文本里的公式交给 KaTeX，其余部分按白名单转义。 */
function renderText(text: string, breaks: boolean, blanks: boolean): string {
  if (!hasMath(text)) return escapeText(text, breaks, blanks);
  const re = new RegExp(MATH_SOURCE, "g");
  let out = "";
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    out += escapeText(text.slice(cursor, match.index), breaks, blanks);
    const tex = mathBody(match[0]);
    if (tex) {
      out += renderMath(tex, match[0].startsWith("$$") || match[0].startsWith("\\["));
    } else {
      out += escapeText(match[0], false, blanks);
    }
    cursor = re.lastIndex;
  }
  if (cursor < text.length) out += escapeText(text.slice(cursor), breaks, blanks);
  return out;
}

function safeClass(value: string): string {
  return value
    .split(/\s+/)
    .filter((name) => /^[a-z0-9_-]{1,40}$/i.test(name))
    .join(" ");
}

function sanitizeAttributes(source: Element, target: Element): boolean {
  const tag = target.tagName;
  if (tag === "IMG") {
    const src = source.getAttribute("src") || "";
    if (!DATA_IMAGE_RE.test(src)) return false;
    target.setAttribute("src", src);
    const alt = source.getAttribute("alt");
    if (alt) target.setAttribute("alt", alt.slice(0, 300));
    for (const attr of ["width", "height"]) {
      const value = source.getAttribute(attr);
      if (value && /^\d{1,5}$/.test(value)) target.setAttribute(attr, value);
    }
    const loading = source.getAttribute("loading");
    if (loading === "lazy" || loading === "eager") target.setAttribute("loading", loading);
  }
  const className = source.getAttribute("class");
  if (className) {
    const safe = safeClass(className);
    if (safe) target.setAttribute("class", safe);
  }
  return true;
}

function sanitizeNode(node: Node, out: Node[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(document.createTextNode(node.textContent || ""));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (DROP_TAGS.has(el.tagName)) return;
  if (!ALLOWED_TAGS.has(el.tagName)) {
    // 未知标签不保留标签本身，只保留其中的纯文本，避免把 HTML 当指令注入。
    const text = el.textContent || "";
    if (text) out.push(document.createTextNode(text));
    return;
  }
  const clean = document.createElement(el.tagName.toLowerCase());
  if (!sanitizeAttributes(el, clean)) return;
  const children: Node[] = [];
  for (const child of Array.from(el.childNodes)) sanitizeNode(child, children);
  for (const child of children) clean.appendChild(child);
  out.push(clean);
}

/** 把一段含 figure/img 的 HTML 收敛到白名单；不依赖网络与脚本。 */
export function sanitizeMediaHtml(html: string): string {
  if (typeof DOMParser === "undefined") return escapePlain(html, true);
  const doc = new DOMParser().parseFromString('<div id="root">' + html + "</div>", "text/html");
  const root = doc.getElementById("root");
  if (!root) return "";
  const nodes: Node[] = [];
  for (const child of Array.from(root.childNodes)) sanitizeNode(child, nodes);
  const container = doc.createElement("div");
  for (const node of nodes) container.appendChild(node);
  return container.innerHTML;
}

function splitTableRow(line: string): string[] {
  let source = line.trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|")) source = source.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === "\\" && source[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index] || "";
  const separator = lines[index + 1] || "";
  if (!TABLE_ROW.test(header) || !TABLE_SEPARATOR.test(separator)) return false;
  return splitTableRow(header).length === splitTableRow(separator).length;
}

function renderTable(lines: string[], start: number): { html: string; next: number } {
  const header = splitTableRow(lines[start]);
  let index = start + 2;
  const body: string[][] = [];
  while (index < lines.length) {
    const line = lines[index];
    if (!line || !TABLE_ROW.test(line)) break;
    body.push(splitTableRow(line));
    index += 1;
  }
  const head = header.map((cell) => "<th>" + renderText(cell, false, false) + "</th>").join("");
  const rows = body
    .map(
      (row) =>
        "<tr>" +
        header
          .map((_, cell) => "<td>" + renderText(row[cell] ?? "", false, false) + "</td>")
          .join("") +
        "</tr>",
    )
    .join("");
  return {
    html:
      '<div class="table-wrap"><table><thead><tr>' +
      head +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>",
    next: index,
  };
}

function renderBlocks(text: string, breaks: boolean, blanks: boolean): string {
  const lines = text.split("\n");
  let out = "";
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    out += renderText(buffer.join("\n"), breaks, blanks);
    buffer = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    if (isTableStart(lines, index)) {
      flush();
      const table = renderTable(lines, index);
      out += table.html;
      index = table.next - 1;
      continue;
    }
    buffer.push(lines[index]);
  }
  flush();
  return out;
}

export function hasTable(text: string): boolean {
  if (!text || !text.includes("|")) return false;
  const lines = text.split("\n");
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (isTableStart(lines, index)) return true;
  }
  return false;
}

/** 含图/公式/表格的正文：媒体块走白名单，普通文本走转义 + KaTeX。 */
export function richTextHtml(text: string, breaks = false): string {
  if (!hasRichMedia(text) && !hasMath(text) && !hasTable(text)) return escapePlain(text, breaks);
  return text
    .split(new RegExp(MEDIA_BLOCK_RE.source, "gi"))
    .map((part) =>
      /^<(?:figure|img)\b/i.test(part) ? sanitizeMediaHtml(part) : renderBlocks(part, breaks, false),
    )
    .join("");
}

/** 题干 HTML：保留导入里的 figure/img 块，其余内容照旧转义并处理填空线。 */
export function richStemHtml(text: string, breaks = false): string {
  if (!hasRichMedia(text) && !hasMath(text) && !hasTable(text)) return escapeText(text, breaks, true);
  return text
    .split(new RegExp(MEDIA_BLOCK_RE.source, "gi"))
    .map((part) =>
      /^<(?:figure|img)\b/i.test(part) ? sanitizeMediaHtml(part) : renderBlocks(part, breaks, true),
    )
    .join("");
}

/** 选项/短文本：只做转义和公式，不处理填空线。 */
export function richInlineHtml(text: string): string {
  return renderText(text, false, false);
}

/** 材料正文：含图或公式时按白名单渲染；否则交给 React 当纯文本。 */
export function richMaterialHtml(text: string): string | null {
  if (!hasRichMedia(text) && !hasMath(text) && !hasTable(text)) return null;
  return richTextHtml(text, true);
}
