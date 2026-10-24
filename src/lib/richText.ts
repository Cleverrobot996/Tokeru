/**
 * 富文本：题干/材料默认按纯文本处理（转义 HTML、下划线变填空）。
 * 只有显式带 <figure> / <img> 的导入内容才按 HTML 渲染，用于数学几何图、表格截图等。
 * 图床统一用 data URL，随 JSON 一起进本地 SQLite，不依赖网络。
 *
 * 安全边界：题干和材料可以被 MCP / 导入 JSON 写入，必须当成不可信输入。
 * 媒体块只允许 figure / figcaption / img / br，img.src 只允许 data:image；
 * 其余标签、属性、事件处理器和远程 URL 一律丢弃，避免 stored XSS。
 */

const MEDIA_RE = /<(?:figure|img)\b/i;
const MEDIA_BLOCK_RE = /(<figure\b[\s\S]*?<\/figure>|<img\b[^>]*>)/gi;
const DROP_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "LINK", "META"]);
const ALLOWED_TAGS = new Set(["FIGURE", "FIGCAPTION", "IMG", "BR"]);
const DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i;

export function hasRichMedia(text: string): boolean {
  return MEDIA_RE.test(text || "");
}

function escapePlain(text: string, breaks: boolean): string {
  const safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return breaks ? safe.split("\n").join("<br/>") : safe;
}

function escapeAndBlanks(text: string, breaks: boolean): string {
  const safe = escapePlain(text, false).replace(/_{2,}/g, '<span class="blank"></span>');
  return breaks ? safe.split("\n").join("<br/>") : safe;
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

/** 题干 HTML：保留导入里的 figure/img 块，其余内容照旧转义并处理填空线。 */
export function richStemHtml(text: string, breaks = false): string {
  if (!hasRichMedia(text)) return escapeAndBlanks(text, breaks);
  return text
    .split(MEDIA_BLOCK_RE)
    .map((part) =>
      /^<(?:figure|img)\b/i.test(part) ? sanitizeMediaHtml(part) : escapeAndBlanks(part, breaks),
    )
    .join("");
}

/** 材料正文：含图时按白名单渲染；否则交给 React 当纯文本。 */
export function richMaterialHtml(text: string): string | null {
  if (!hasRichMedia(text)) return null;
  return text
    .split(MEDIA_BLOCK_RE)
    .map((part) =>
      /^<(?:figure|img)\b/i.test(part) ? sanitizeMediaHtml(part) : escapePlain(part, true),
    )
    .join("");
}
