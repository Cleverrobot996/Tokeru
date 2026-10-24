import { useEffect, useMemo, useRef, useState } from "react";
import { Check, FileUp, Image as ImageIcon, Loader2, ScanSearch, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import type { Question } from "../lib/types";
import { cropPage, filesToPages, type PageImage } from "../lib/pdf";
import { Button, Modal } from "./ui";

type Box = [number, number, number, number];

interface FigureRow {
  key: string;
  questionLabel: string;
  qid: number | null;
  page: number;
  bbox: Box;
  caption: string;
  crop: string;
  selected: boolean;
  note: string;
}

interface RawFigure {
  question: string;
  page: number;
  bbox: Box;
  caption: string;
}

/* 后端单次最多 20 页；每批 8 页并请求高细节图，兼顾精度与请求体大小。 */
const PAGE_BATCH = 8;

const cleanLabel = (value: string) =>
  value.trim().replace(/^第\s*/, "").replace(/\s*题$/, "").replace(/[\s．.、]/g, "").toLowerCase();

function num(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function readBox(value: unknown): Box | null {
  if (Array.isArray(value) && value.length >= 4) {
    let [x, y, w, h] = value.map((v) => num(v));
    const max = Math.max(Math.abs(x), Math.abs(y), Math.abs(w), Math.abs(h));
    const scale = max <= 1 ? 1 : max <= 100 ? 100 : max <= 1000 ? 1000 : max <= 10000 ? 10000 : 0;
    if (!scale) return null;
    x /= scale;
    y /= scale;
    w /= scale;
    h /= scale;
    if (![x, y, w, h].every(Number.isFinite)) return null;
    if (x < -0.01 || y < -0.01 || w <= 0.004 || h <= 0.004) return null;
    if (x + w > 1.02 || y + h > 1.02) return null;
    return [Math.max(0, x), Math.max(0, y), Math.min(w, 1 - Math.max(0, x)), Math.min(h, 1 - Math.max(0, y))];
  }
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if ("x1" in v && "y1" in v && "x2" in v && "y2" in v) {
      const x1 = num(v.x1);
      const y1 = num(v.y1);
      const x2 = num(v.x2);
      const y2 = num(v.y2);
      return readBox([Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)]);
    }
    return readBox([v.x ?? v.left, v.y ?? v.top, v.w ?? v.width, v.h ?? v.height]);
  }
  return null;
}

/** 宽松解析视觉模型返回的 JSON：允许围栏、前后说明文字和几种常见的 bbox 写法。 */
export function parseFigures(text: string): { figures: RawFigure[]; skipped: number } {
  const cleaned = text.replace(/[\u0060]{3}(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回可解析的 JSON。");
  const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
  const root = parsed as Record<string, unknown>;
  const raw = Array.isArray(parsed) ? parsed : root.figures ?? root.items ?? root.data;
  if (!Array.isArray(raw)) throw new Error("返回的 JSON 里没有 figures 数组。");
  const figures: RawFigure[] = [];
  let skipped = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      skipped += 1;
      continue;
    }
    const f = item as Record<string, unknown>;
    const bbox = readBox(f.bbox ?? f.box ?? f.rect);
    const question = String(f.question ?? f.label ?? f.q ?? "").trim();
    const page = Math.round(num(f.page ?? f.page_no ?? 0, 0));
    if (!bbox || !question || page < 1) {
      skipped += 1;
      continue;
    }
    figures.push({
      question,
      page,
      bbox,
      caption: String(f.caption ?? f.note ?? f.description ?? "").trim(),
    });
  }
  return { figures, skipped };
}

function targetMap(questions: Question[]) {
  const map = new Map<string, Question>();
  for (const q of questions) {
    const label = (q.label ?? "").trim();
    for (const key of [label, String(q.number), cleanLabel(label), cleanLabel(String(q.number))]) {
      const k = cleanLabel(key);
      if (k && !map.has(k)) map.set(k, q);
    }
  }
  return map;
}

/* 只认明确的题号：单个数字、第 N 题、N-M 范围，或逗号分隔的多个题号；不从题干里猜数字。 */
function matchQuestions(value: string, questions: Question[], map: Map<string, Question>): Question[] {
  const key = cleanLabel(value);
  const direct = map.get(key);
  if (direct) return [direct];
  const plain = value.trim().match(/^(?:第)?\s*(\d+)\s*(?:题)?$/);
  if (plain) return questions.filter((q) => q.number === Number(plain[1]));
  const range = value.trim().match(/^(\d+)\s*[-–—~至]\s*(\d+)$/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    return questions.filter((q) => q.number >= low && q.number <= high);
  }
  const parts = value.split(/[,，、;；\s]+/).map((part) => map.get(cleanLabel(part))).filter(Boolean) as Question[];
  return [...new Map(parts.map((q) => [q.id, q])).values()];
}

export default function AutoFigures({
  open,
  onClose,
  questions,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  questions: Question[];
  onApplied: () => Promise<void> | void;
}) {
  const [pages, setPages] = useState<PageImage[]>([]);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [rows, setRows] = useState<FigureRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const map = useMemo(() => targetMap(questions), [questions]);

  useEffect(() => {
    if (!open) return;
    setPages([]);
    setSelectedPages(new Set());
    setRows([]);
    setBusy(false);
    setStatus("");
    setError("");
    setApplying(false);
  }, [open]);

  async function chooseFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    setBusy(true);
    setError("");
    setRows([]);
    setStatus("正在把页面渲染成图片…");
    try {
      const next = await filesToPages(files, (done, total) => setStatus("正在渲染页面 " + done + "/" + total + "…"));
      if (!next.length) throw new Error("没有读到页面，请确认文件是 PDF 或图片。");
      setPages(next);
      setSelectedPages(new Set(next.map((p) => p.page)));
      setStatus("已读取 " + next.length + " 页，确认要分析的页面后开始识别。");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function togglePage(page: number) {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  }

  async function identify() {
    const chosen = pages.filter((p) => selectedPages.has(p.page));
    if (!chosen.length) {
      setError("至少选一页再识别。");
      return;
    }
    if (!questions.length) {
      setError("这份试卷还没有题目。");
      return;
    }
    setBusy(true);
    setError("");
    setRows([]);
    setStatus("视觉模型正在找图，页面多时需要几十秒…");
    const questionPayload = questions.map((q) => ({
      label: (q.label ?? "").trim() || String(q.number),
      stem: q.stem.slice(0, 160),
    }));
    const batches = Math.ceil(chosen.length / PAGE_BATCH);
    try {
      const figures: RawFigure[] = [];
      let skipped = 0;
      let outOfRange = 0;
      for (let batchIndex = 0; batchIndex < batches; batchIndex += 1) {
        const start = batchIndex * PAGE_BATCH;
        const batch = chosen.slice(start, start + PAGE_BATCH);
        setStatus(
          "视觉模型正在找图（第 " +
            (batchIndex + 1) +
            "/" +
            batches +
            " 批，第 " +
            batch[0].page +
            "–" +
            batch[batch.length - 1].page +
            " 页）…",
        );
        const result = await api.aiVisionSegment(
          batch.map((p) => p.dataUrl),
          questionPayload,
        );
        const parsed = parseFigures(result.content);
        skipped += parsed.skipped;
        for (const figure of parsed.figures) {
          /* 模型按本批 PAGE 1 起编号；越界结果直接丢弃，不夹到首尾页。 */
          if (figure.page > batch.length) {
            outOfRange += 1;
            continue;
          }
          figures.push({ ...figure, page: start + figure.page });
        }
      }
      if (!figures.length) {
        setStatus(
          "模型没有找到需要单独成图的图形。" +
            (skipped || outOfRange ? "（跳过 " + (skipped + outOfRange) + " 条无效结果）" : ""),
        );
        return;
      }
      const baseKey = Date.now();
      const prepared: FigureRow[] = [];
      let unmatched = 0;
      for (let i = 0; i < figures.length; i += 1) {
        const f = figures[i];
        const page = chosen[f.page - 1];
        const matched = matchQuestions(f.question, questions, map);
        if (!matched.length) {
          unmatched += 1;
          continue;
        }
        let crop = "";
        let note = "";
        try {
          crop = await cropPage(page, f.bbox);
        } catch (e) {
          note = e instanceof Error ? e.message : String(e);
        }
        for (const q of matched) {
          prepared.push({
            key: baseKey + "-" + i + "-" + q.id,
            questionLabel: f.question,
            qid: q.id,
            page: page.page,
            bbox: f.bbox,
            caption: f.caption,
            crop,
            selected: !!crop,
            note,
          });
        }
      }
      setRows(prepared);
      const ignored = skipped + outOfRange + unmatched;
      setStatus(
        "找到 " +
          prepared.length +
          " 处图形，确认后写入题干。" +
          (ignored ? " 另有 " + ignored + " 条未采用。" : ""),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  function toggleRow(key: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, selected: !r.selected } : r)));
  }

  async function apply() {
    const chosen = rows.filter((r) => r.selected && r.qid && r.crop);
    if (!chosen.length) {
      setError("没有勾选可写入的图。");
      return;
    }
    setApplying(true);
    setError("");
    const stems = new Map(questions.map((q) => [q.id, q.stem]));
    const done = new Set<string>();
    let ok = 0;
    let failed = 0;
    for (const row of chosen) {
      const qid = row.qid!;
      const current = stems.get(qid) ?? questions.find((q) => q.id === qid)?.stem ?? "";
      const figure = '<figure class="q-figure"><img src="' + row.crop + '" alt="题图" /></figure>';
      try {
        await api.updateQuestion(qid, undefined, undefined, current + figure);
        stems.set(qid, current + figure);
        done.add(row.key);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setRows((prev) => prev.filter((row) => !done.has(row.key)));
    setApplying(false);
    await onApplied();
    if (failed) toast.error("已写入 " + ok + " 张图，" + failed + " 张失败，可重试失败项。");
    else toast.success("已写入 " + ok + " 张题图");
    if (!failed) onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="自动分图" width={900}>
      <div className="auto-fig">
        <p className="small muted auto-fig-intro">
          选择这份试卷的 PDF 或题目页截图。模型只找需要单独成图的图形，不识别文字；识别结果会先给你勾选，再写进题干。
          需要先在设置里填好「多模态模型」。
        </p>

        <div className="auto-fig-pick">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/*"
            multiple
            className="auto-fig-file"
            onChange={(e) => void chooseFiles(e.target.files)}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={busy}>
            <FileUp size={15} /> 选择 PDF / 图片
          </Button>
          <span className="small muted">最多 50 页；扫描件也可以。</span>
        </div>

        {pages.length ? (
          <div className="auto-fig-pages">
            {pages.map((p) => (
              <button
                key={p.page}
                type="button"
                className="auto-fig-page"
                data-on={selectedPages.has(p.page) ? "true" : "false"}
                onClick={() => togglePage(p.page)}
                title={selectedPages.has(p.page) ? "点击取消这一页" : "点击选择这一页"}
              >
                <img src={p.dataUrl} alt={"第 " + p.page + " 页"} />
                <span className="auto-fig-page-no">
                  {selectedPages.has(p.page) ? <Check size={12} /> : <ImageIcon size={12} />} 第 {p.page} 页
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="auto-fig-actions">
          <Button variant="primary" onClick={() => void identify()} disabled={busy || !pages.length}>
            {busy ? <Loader2 size={15} className="spin" /> : <ScanSearch size={15} />} 开始识别
          </Button>
          {status ? <span className="small muted">{status}</span> : null}
        </div>

        {error ? <div className="auto-fig-error">{error}</div> : null}

        {rows.length ? (
          <div className="auto-fig-results">
            {rows.map((r) => (
              <div className="auto-fig-row" key={r.key} data-off={!r.selected}>
                <button type="button" className="auto-fig-check" onClick={() => toggleRow(r.key)} aria-pressed={r.selected}>
                  <span className="check-box" data-on={r.selected ? "true" : "false"}>{r.selected ? <Check size={12} /> : null}</span>
                </button>
                <div className="auto-fig-crop">
                  {r.crop ? <img src={r.crop} alt="裁剪预览" /> : <span className="small muted">不可用</span>}
                </div>
                <div className="auto-fig-meta">
                  <div>
                    <b>第 {r.questionLabel} 题</b>
                    <span className="small muted"> · 原页 {r.page}</span>
                  </div>
                  <div className="small muted">{r.caption || "图形"}</div>
                  {r.note ? <div className="small auto-fig-note">{r.note}</div> : null}
                </div>
              </div>
            ))}
            <div className="auto-fig-apply">
              <Button variant="primary" onClick={() => void apply()} disabled={applying}>
                {applying ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} 写入选中的 {rows.filter((r) => r.selected && r.crop).length} 张图
              </Button>
              <span className="small muted">图片会追加到题干末尾，不覆盖原来的文字。</span>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
