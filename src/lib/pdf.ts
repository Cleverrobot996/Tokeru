import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/* pdf.js 6 不会自动猜 worker 路径；Vite 把 worker 作为静态资源发出来后显式指向它。 */
GlobalWorkerOptions.workerSrc = workerUrl;

export interface PageImage {
  page: number;
  dataUrl: string;
  width: number;
  height: number;
}

const MAX_PAGES = 50;
const MAX_WIDTH = 1400;

function canvasToJpeg(canvas: HTMLCanvasElement) {
  return canvas.toDataURL("image/jpeg", 0.84);
}

/** 把一张位图画到限宽的画布上，返回 JPEG data URL 与实际尺寸。 */
async function bitmapToPage(bitmap: ImageBitmap, page: number): Promise<PageImage> {
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持图片处理。");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { page, dataUrl: canvasToJpeg(canvas), width, height };
}

export async function imageFileToPages(file: File): Promise<PageImage[]> {
  const bitmap = await createImageBitmap(file);
  try {
    return [await bitmapToPage(bitmap, 1)];
  } finally {
    bitmap.close?.();
  }
}

/** 用 pdf.js 把 PDF 前 N 页渲染成图片。只用于自动分图，不进入题库存储。 */
export async function pdfFileToPages(file: File, onProgress?: (done: number, total: number) => void): Promise<PageImage[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const loading = getDocument({ data });
  const doc = await loading.promise;
  try {
    const total = Math.min(doc.numPages, MAX_PAGES);
    const pages: PageImage[] = [];
    for (let i = 1; i <= total; i += 1) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.2, MAX_WIDTH / base.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("浏览器不支持 PDF 渲染。");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport }).promise;
      page.cleanup();
      pages.push({ page: i, dataUrl: canvasToJpeg(canvas), width: canvas.width, height: canvas.height });
      onProgress?.(i, total);
    }
    return pages;
  } finally {
    await loading.destroy();
  }
}

export async function filesToPages(files: File[], onProgress?: (done: number, total: number) => void): Promise<PageImage[]> {
  const out: PageImage[] = [];
  let done = 0;
  for (const file of files) {
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const pages = isPdf ? await pdfFileToPages(file, (d, t) => onProgress?.(done + Math.min(d, t), done + t)) : await imageFileToPages(file);
    out.push(...pages);
    done += pages.length;
    onProgress?.(done, out.length);
    if (out.length >= MAX_PAGES) break;
  }
  /* 多文件时不重复页码，统一按处理顺序编号。 */
  return out.slice(0, MAX_PAGES).map((p, i) => ({ ...p, page: i + 1 }));
}

/** 提取 PDF 前 maxPages 页的文字；页间用两个换行分隔，返回页数与总页数供界面提示截断。 */
export interface PdfTextResult {
  text: string;
  pages: number;
  totalPages: number;
}

export async function pdfFileToText(file: File, maxPages = 20): Promise<PdfTextResult> {
  const limit = Math.max(1, Math.floor(maxPages) || 20);
  const data = new Uint8Array(await file.arrayBuffer());
  const loading = getDocument({ data });
  const doc = await loading.promise;
  try {
    const totalPages = doc.numPages;
    const count = Math.min(totalPages, limit);
    const chunks: string[] = [];
    for (let i = 1; i <= count; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let pageText = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        pageText += item.str;
        if (item.hasEOL) pageText += "\n";
        else if (item.str && !/[\s]$/.test(item.str)) pageText += " ";
      }
      page.cleanup();
      chunks.push(
        pageText
          .replace(/[ \t]+\n/g, "\n")
          .replace(/[ \t]{2,}/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim(),
      );
    }
    const text = chunks.filter(Boolean).join("\n\n");
    if (!text) throw new Error("PDF 里没有可提取的文字；扫描件请先 OCR 或复制文字。");
    return { text, pages: count, totalPages };
  } finally {
    await loading.destroy();
  }
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("无法读取这一页图片。"));
    img.src = src;
  });
}

/** 从整页图上按归一化 bbox 裁出一块，用于预览和写入题干。 */
export async function cropPage(page: PageImage, bbox: [number, number, number, number]): Promise<string> {
  const img = await loadImage(page.dataUrl);
  const [x, y, w, h] = bbox;
  const pad = 0.012;
  const sx = Math.max(0, Math.floor((x - pad) * page.width));
  const sy = Math.max(0, Math.floor((y - pad) * page.height));
  const sw = Math.min(page.width - sx, Math.ceil((w + pad * 2) * page.width));
  const sh = Math.min(page.height - sy, Math.ceil((h + pad * 2) * page.height));
  if (sw < 6 || sh < 6) throw new Error("模型给出的图形范围太小，已跳过。");
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持图片处理。");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL("image/jpeg", 0.9);
}
