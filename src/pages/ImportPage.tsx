import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Copy,
  Crosshair,
  FileJson,
  FileText,
  Folder,
  Loader2,
  RotateCcw,
  Tag,
  Upload,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { buildPrompt, IMPORT_SPEC, JSON_TEMPLATE } from "../lib/importPrompt";
import { richInlineHtml, richStemHtml } from "../lib/richText";
import type { ImportPreview, Question } from "../lib/types";
import { PaperDoc } from "../components/PaperView";
import type { PaperGroup } from "../components/PaperView";
import { Button, Modal } from "../components/ui";
import { pdfFileToText } from "../lib/pdf";
import "../styles/import.css";

const STEPS = [
  { title: "材料", desc: "文件或粘贴" },
  { title: "生成 JSON", desc: "复制提示词" },
  { title: "预览校验", desc: "结构与警告" },
  { title: "确认导入", desc: "写入或撤销" },
];

const QTYPE_LABEL: Record<string, string> = {
  choice_single: "单选",
  choice_multi: "多选",
  fill_blank: "填空",
  cloze: "完形",
  true_false: "判断",
  short_answer: "简答",
  writing: "写作",
  dictation: "听写",
  matching: "匹配",
};

const SPEC_LINES = IMPORT_SPEC.split("\n").length;

const EMPTY_MATERIAL = "【把试卷材料粘贴到这里】";
const MAX_TEXT_FILE = 8 * 1024 * 1024;
const MAX_PDF_FILE = 100 * 1024 * 1024;
const PDF_MAX_PAGES = 50;
type MaterialCheck =
  | { kind: "empty" }
  | { kind: "json"; count: number; title: string }
  | { kind: "raw"; reason: string; jsonish: boolean };

/** 从可能带说明或代码围栏的文本里截出最外层 JSON 对象。 */
function outermostJson(source: string): string | null {
  const start = source.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
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
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function stripCodeFence(source: string): string {
  let t = source.trim();
  if (!t.startsWith("```")) return t;
  t = t.replace(/^```[^\n]*\n?/, "");
  const close = t.lastIndexOf("```");
  if (close >= 0) t = t.slice(0, close);
  return t.trim();
}

function inspectMaterial(source: string): MaterialCheck {
  const t = source.trim();
  if (!t) return { kind: "empty" };
  const json = outermostJson(t);
  if (!json) return { kind: "raw", reason: "没有找到 JSON 对象。", jsonish: false };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { kind: "raw", reason: "JSON 不完整，检查引号、逗号和括号。", jsonish: true };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { kind: "raw", reason: "顶层必须是一个 JSON 对象。", jsonish: true };
  }
  const obj = data as { questions?: unknown; set?: { title?: unknown } };
  if (!Array.isArray(obj.questions)) {
    return { kind: "raw", reason: "JSON 里没有 questions 数组。", jsonish: true };
  }
  if (!obj.questions.length) {
    return { kind: "raw", reason: "questions 数组是空的。", jsonish: true };
  }
  const title = typeof obj.set?.title === "string" ? obj.set.title.trim() : "";
  return { kind: "json", count: obj.questions.length, title };
}

function errorText(e: unknown) {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return String(e);
}

const SECTION_KIND_LABEL: Record<string, string> = {
  listening: "听力",
  reading: "阅读",
  writing: "写作",
  dictation: "听写",
  cloze: "完形",
  choice: "选择",
  language: "语言知识",
  short_answer: "简答",
  audio: "听力",
  speaking: "口语",
  mixed: "混合",
};

function qtypeLabel(t: string) {
  return QTYPE_LABEL[t] ?? t;
}

function sectionKindLabel(t: string) {
  return SECTION_KIND_LABEL[t] ?? t;
}

/** 从警告文案里找到对应的题，供「定位」把原卷预览滚到那一题。 */
function findWarningQuestion(
  warning: string,
  questions: Question[],
  sections: ImportPreview["sections"],
): Question | null {
  const byNumber = warning.match(/第\s*(\d+)\s*题/);
  if (byNumber) {
    const hit = questions.find((q) => q.number === Number(byNumber[1]));
    if (hit) return hit;
  }
  const bySection = warning.match(/(?:分区|section)\s*[「\"“']([^」\"”']+)[」\"”']/i);
  if (bySection && sections) {
    const section = sections.find((s) => s.key === bySection[1] || s.title === bySection[1]);
    if (section) {
      const hit = questions.find((q) => q.section_id === section.id);
      if (hit) return hit;
    }
  }
  return null;
}

function answerText(q: Question) {
  const a = q.answer ?? {};
  if (Array.isArray(a.correct)) return a.correct.filter(Boolean).join(" / ") || "—";
  if (typeof a.correct === "string" && a.correct.trim()) return a.correct.trim();
  if (a.accept && a.accept.length) return a.accept.slice(0, 3).join(" / ");
  if (a.accepted && a.accepted.length) return a.accepted.slice(0, 3).join(" / ");
  if (a.reference && a.reference.trim()) {
    const t = a.reference.trim();
    return t.length > 120 ? t.slice(0, 120) + "…" : t;
  }
  return "—";
}

async function copyText(value: string, ok: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast.success(ok);
}

export default function ImportPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [title, setTitle] = useState("");
  const [extra, setExtra] = useState("");
  const [pasteBack, setPasteBack] = useState("");
  const [dragging, setDragging] = useState(false);
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [reviewTab, setReviewTab] = useState<"table" | "paper">("table");
  const [flashQid, setFlashQid] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [imported, setImported] = useState(0);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [fileInfo, setFileInfo] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [loadingName, setLoadingName] = useState("");
  const [windowDrag, setWindowDrag] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const windowDragDepth = useRef(0);

  const materialCheck = useMemo(() => inspectMaterial(text), [text]);
  const prompt = useMemo(
    () => buildPrompt({ material: text.trim() || EMPTY_MATERIAL, title: title || undefined, extra: extra || undefined }),
    [text, title, extra],
  );

  const dist = useMemo(() => {
    const map = new Map<string, number>();
    for (const q of preview?.questions ?? []) map.set(q.qtype, (map.get(q.qtype) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [preview]);

  const totalPoints = useMemo(() => (preview?.questions ?? []).reduce((s, q) => s + (q.points || 0), 0), [preview]);

  const paperGroups = useMemo<PaperGroup[]>(() => {
    if (!preview) return [];
    const all = preview.questions;
    const sections = (preview.sections ?? []).slice().sort((a, b) => a.position - b.position);
    const groups: PaperGroup[] = [];
    for (const section of sections) {
      const questions = all.filter((q) => q.section_id === section.id);
      if (!questions.length) continue;
      groups.push({
        id: section.id,
        title: section.title || section.key || "未命名分区",
        meta: questions.length + " 题 · " + sectionKindLabel(section.kind),
        section,
        questions,
      });
    }
    const covered = new Set(groups.flatMap((g) => g.questions.map((q) => q.id)));
    const rest = all.filter((q) => !covered.has(q.id));
    if (rest.length) {
      groups.push({
        id: "import-rest",
        title: groups.length ? "其他题目" : "全部题目",
        meta: rest.length + " 题",
        questions: rest,
      });
    }
    return groups;
  }, [preview]);

  const materialMap = useMemo(
    () => new Map((preview?.materials ?? []).map((m) => [m.id, m] as const)),
    [preview],
  );

  function go(next: number) {
    setStep(next);
    setReached((r) => Math.max(r, next));
  }

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [step]);

  useEffect(() => {
    if (flashQid == null) return;
    const timer = window.setTimeout(() => setFlashQid(null), 2400);
    return () => window.clearTimeout(timer);
  }, [flashQid]);

  function resetMaterial() {
    setText("");
    setFileName("");
    setFileInfo("");
    setPasteBack("");
    setPreview(null);
    setBatchId(null);
    setDragging(false);
    setWindowDrag(false);
    setReviewTab("table");
    setFlashQid(null);
  }

  function copyMaterialPrompt() {
    void copyText(prompt, "已复制清洗提示词，交给任意 AI 后再把 JSON 贴回来");
  }

  async function loadFile(file?: File) {
    if (!file || fileLoading) return;
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const isText = /\.(json|md|markdown|txt)$/i.test(file.name);
    if (!isPdf && !isText) {
      if (file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name)) {
        toast.error("图片先交给外部 AI 转成 Markdown 或 JSON，再粘贴进来。");
      } else {
        toast.error("只支持 PDF / JSON / Markdown / TXT 文件。");
      }
      return;
    }
    if (isPdf && file.size > MAX_PDF_FILE) {
      toast.error("PDF 超过 100 MB，先拆分或压缩后再导入。");
      return;
    }
    if (isText && file.size > MAX_TEXT_FILE) {
      toast.error("文件超过 8 MB，先精简后再导入。");
      return;
    }
    setPreview(null);
    setBatchId(null);
    setReviewTab("table");
    setFlashQid(null);
    setText("");
    setFileName(file.name);
    setFileInfo("");

    if (!isPdf) {
      try {
        const content = await file.text();
        setText(content);
        setFileInfo(file.name.toLowerCase().endsWith(".json") ? "JSON 文件" : "文本文件");
        if (!content.trim()) toast.error("这个文件是空的。");
      } catch (e) {
        toast.error("文件读取失败：" + errorText(e));
      }
      return;
    }

    setFileLoading(true);
    setLoadingName(file.name);
    try {
      const res = await pdfFileToText(file, PDF_MAX_PAGES);
      setText(res.text);
      setFileInfo("PDF · 已提取 " + res.pages + " 页文字");
      if (res.pages < res.totalPages) {
        toast.info("PDF 共 " + res.totalPages + " 页，只读取前 " + res.pages + " 页；需要更多内容可拆分后分批导入。");
      } else {
        toast.success("已读取 PDF 的 " + res.pages + " 页文字");
      }
    } catch (e) {
      setFileInfo("PDF · 读取失败");
      toast.error("PDF 读取失败：" + errorText(e));
    } finally {
      setFileLoading(false);
      setLoadingName("");
    }
  }

  useEffect(() => {
    if (step !== 0) {
      setWindowDrag(false);
      return;
    }
    windowDragDepth.current = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      windowDragDepth.current += 1;
      setWindowDrag(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      windowDragDepth.current = Math.max(0, windowDragDepth.current - 1);
      if (windowDragDepth.current === 0) setWindowDrag(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      windowDragDepth.current = 0;
      setWindowDrag(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) void loadFile(file);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      windowDragDepth.current = 0;
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [step, fileLoading]);

  async function pasteFromClipboard() {
    if (fileLoading) return toast.error("正在读取 PDF，稍等。");
    try {
      const t = await navigator.clipboard.readText();
      if (!t.trim()) return toast.error("剪贴板是空的。");
      setText(t);
      setFileName("");
      setFileInfo("来自剪贴板");
      setPreview(null);
      setBatchId(null);
      setReviewTab("table");
      setFlashQid(null);
      toast.success("已粘贴剪贴板内容");
    } catch {
      toast.error("浏览器没有给剪贴板权限，请手动粘贴到输入框。");
    }
  }

  async function runPreview(source?: string, notifyError = true): Promise<boolean> {
    const input = (source ?? text).trim();
    if (!input) {
      if (notifyError) toast.error("先放入材料。");
      return false;
    }
    setBusy(true);
    try {
      const p = await api.previewImport({ text: input, title: title || undefined, kind: "json" });
      setPreview(p);
      setReviewTab("table");
      setFlashQid(null);
      if (!p.questions.length) {
        if (notifyError) toast.error("没有读到题目，检查 JSON 结构。");
        return false;
      }
      go(2);
      return true;
    } catch (e) {
      setPreview(null);
      if (notifyError) toast.error("预览失败：" + errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function usePasted() {
    if (!pasteBack.trim()) return toast.error("先粘贴 AI 返回的 JSON。");
    setText(pasteBack);
    setFileName("");
    setFileInfo("AI 返回的 JSON");
    setPreview(null);
    setBatchId(null);
    setPasteBack("");
    await runPreview(pasteBack);
  }

  function locateWarning(warning: string) {
    if (!preview) return;
    const target = findWarningQuestion(warning, preview.questions, preview.sections);
    if (!target) return;
    setReviewTab("paper");
    setFlashQid(target.id);
    window.setTimeout(() => {
      document.getElementById("paper-q-" + target.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 90);
  }

  async function confirmImport() {
    if (!preview || !preview.questions.length) return;
    setBusy(true);
    try {
      const id = await api.confirmImport({ text, title: title || preview.title });
      setBatchId(id);
      setImported(preview.questions.length);
      await qc.invalidateQueries();
      go(3);
      toast.success("已导入 " + preview.questions.length + " 道题");
    } catch (e) {
      toast.error("导入失败：" + errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!batchId) return;
    setBusy(true);
    try {
      await api.undoImport(batchId);
      await qc.invalidateQueries();
      toast.success("已撤销本次导入");
      setBatchId(null);
      setConfirmUndo(false);
      setImported(0);
      resetMaterial();
      setStep(0);
      setReached(0);
    } catch (e) {
      toast.error("撤销失败：" + errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      {windowDrag ? (
        <div className="import-drop-overlay">
          <Upload size={30} />
          <strong>松开导入</strong>
          <span>PDF / Markdown / TXT / JSON</span>
        </div>
      ) : null}
      <div className="page-head">
        <div>
          <h1>导入题目</h1>
          <div className="sub">整卷先清洗成 JSON，再预览校验、确认导入；每一步都能回退。</div>
        </div>
        <div className="acts">
          <Button variant="ghost" size="sm" onClick={() => nav("/bank")}>查看题库</Button>
        </div>
      </div>

      <div className="import-steps" role="tablist" aria-label="导入步骤">
        {STEPS.map((s, i) => (
          <button
            key={s.title}
            type="button"
            role="tab"
            aria-selected={step === i}
            className="import-step"
            data-state={step === i ? "on" : i < step ? "done" : "todo"}
            disabled={i > reached}
            onClick={() => setStep(i)}
          >
            <span className="no">{i < step ? <Check size={15} /> : i + 1}</span>
            <span className="txt">
              <strong>{s.title}</strong>
              <small>{s.desc}</small>
            </span>
          </button>
        ))}
      </div>

      {step === 0 ? (
        <div className="panel panel-pad import-panel">
          <div className="panel-head import-head">
            <div>
              <div className="panel-title">放入材料</div>
              <div className="panel-sub">PDF、Markdown、TXT 或已清洗的 JSON；也可以直接粘贴。</div>
            </div>
            <div className="import-file-actions">
              <label className={"btn btn-soft btn-sm import-file-label" + (fileLoading ? " is-disabled" : "")}>
                {fileLoading ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                {fileLoading ? "读取中" : "选择文件"}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.md,.markdown,.txt,.json"
                  hidden
                  disabled={fileLoading}
                  onChange={(e) => {
                    void loadFile(e.target.files?.[0]);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
              <Button size="sm" variant="ghost" disabled={fileLoading} onClick={() => void pasteFromClipboard()}>
                <ClipboardCopy size={14} /> 粘贴
              </Button>
              <Button size="sm" variant="soft" disabled={fileLoading} onClick={copyMaterialPrompt}>
                <Copy size={14} /> 复制清洗提示词
              </Button>
              <Button size="sm" variant="ghost" disabled={fileLoading} onClick={() => setPromptPreviewOpen(true)}>
                <FileText size={14} /> 预览提示词
              </Button>
              {text || fileName ? (
                <Button size="sm" variant="ghost" disabled={fileLoading} onClick={resetMaterial}>
                  清空
                </Button>
              ) : null}
            </div>
          </div>

          <label className="field import-extra">
            <span>额外要求（可选）</span>
            <input
              className="input"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="例如：听力原文放进 answer.reference；每题 2 分"
            />
          </label>

          <div
            className={"import-drop" + (dragging ? " is-over" : "")}
            data-on={dragging}
            onDragEnter={(e) => {
              e.preventDefault();
              if (fileLoading) return;
              dragDepth.current += 1;
              setDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!fileLoading) setDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dragDepth.current = 0;
              windowDragDepth.current = 0;
              setDragging(false);
              setWindowDrag(false);
              if (!fileLoading) void loadFile(e.dataTransfer.files?.[0]);
            }}
          >
            {fileLoading ? (
              <div className="import-file-loading">
                <Loader2 size={22} className="spin" />
                <strong>正在读取文件</strong>
                <span>{loadingName}</span>
                <small>提取前 {PDF_MAX_PAGES} 页文字。</small>
              </div>
            ) : (
              <>
                <textarea
                  className="textarea import-editor"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setPreview(null);
                    setBatchId(null);
                    setReviewTab("table");
                    setFlashQid(null);
                  }}
                  placeholder="把试卷原文、Markdown、TXT 或已清洗的 JSON 粘贴到这里，也可以把 PDF 拖进来…"
                  spellCheck={false}
                />
                <div className="import-drop-foot">
                  <span className="import-file-name">
                    <FileText size={14} /> {fileName || fileInfo || "未选择文件"}
                    {fileName && fileInfo ? <span className="import-file-kind">{fileInfo}</span> : null}
                  </span>
                  <span className="import-count">{text.trim() ? text.trim().length.toLocaleString() : 0} 字符</span>
                </div>
              </>
            )}
          </div>

          {materialCheck.kind === "json" ? (
            <div className="import-check" data-state="ok">
              <CheckCircle2 size={16} />
              <div className="import-check-text">
                <strong>识别到规范 JSON · {materialCheck.count} 题</strong>
                <span>{materialCheck.title ? materialCheck.title + "，可直接预览并校验。" : "结构完整，可直接预览并校验。"}</span>
              </div>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void runPreview()}>
                {busy ? <Loader2 size={15} className="spin" /> : <ChevronRight size={15} />}
                预览并校验
              </Button>
            </div>
          ) : materialCheck.kind === "raw" ? (
            <div className="import-check" data-state="raw">
              <AlertTriangle size={16} />
              <div className="import-check-text">
                <strong>{materialCheck.jsonish ? "JSON 还没写完" : "原始材料不是 JSON"}</strong>
                <span>{materialCheck.reason} 复制提示词交给任意 AI，把返回的 JSON 粘回来。</span>
              </div>
            </div>
          ) : null}

          <div className="import-actions">
            <span className="import-tip">
              {fileLoading ? "正在提取 PDF 文字…" : "PDF 只读取文字；扫描件先 OCR，或交给外部 AI 处理。"}
            </span>
            <span className="spacer" />
            <Button variant="primary" disabled={!text.trim() || busy || fileLoading} onClick={() => go(1)}>
              下一步 <ChevronRight size={15} />
            </Button>
          </div>
        </div>
      ) : null}
      {step === 1 ? (
        <div className="import-generate">
          <section className="panel panel-pad import-card">
            <div className="import-card-head">
              <span className="import-badge"><FileJson size={16} /></span>
              <div>
                <div className="panel-title">直接改 JSON 模板</div>
                <div className="panel-sub">熟悉字段时从骨架起笔，比从零写更快。</div>
              </div>
            </div>
            <div className="import-meta">
              <span><strong>1</strong> 份试卷</span>
              <span><strong>2</strong> 个分区</span>
              <span><strong>3</strong> 种题型示例</span>
            </div>
            <pre className="import-json">{JSON_TEMPLATE}</pre>
            <div className="import-card-actions">
              <Button variant="soft" onClick={() => void copyText(JSON_TEMPLATE, "已复制 JSON 模板")}>
                <Copy size={15} /> 复制 JSON 模板
              </Button>
            </div>
          </section>

          <section className="panel panel-pad import-card import-card-wide">
            <div className="import-card-head">
              <span className="import-badge"><Wand2 size={16} /></span>
              <div>
                <div className="panel-title">在 AI 里生成后粘回</div>
                <div className="panel-sub">只认最外层一对花括号；代码围栏和前后说明会被忽略。</div>
              </div>
            </div>
            <textarea
              className="textarea import-editor import-editor-short"
              value={pasteBack}
              onChange={(e) => setPasteBack(e.target.value)}
              placeholder="把 AI 返回的 JSON 粘贴到这里…"
              spellCheck={false}
            />
            <div className="import-actions">
              <span className="import-tip">校验会检查题型、题号、答案与引用。</span>
              <span className="spacer" />
              <Button variant="primary" disabled={busy || !pasteBack.trim()} onClick={() => void usePasted()}>
                {busy ? <Loader2 size={15} className="spin" /> : <ChevronRight size={15} />}
                校验并预览
              </Button>
            </div>
          </section>

          <div className="import-actions import-actions-plain">
            <Button variant="ghost" onClick={() => go(0)}><ChevronLeft size={15} /> 上一步</Button>
            {materialCheck.kind !== "json" ? (
              <span className="import-tip">当前材料还不是规范 JSON，先回上一步清洗，或把 AI 返回的 JSON 粘到上面的框里。</span>
            ) : null}
            <span className="spacer" />
            <Button
              variant="soft"
              onClick={() => void runPreview()}
              disabled={!text.trim() || busy || materialCheck.kind !== "json"}
              title={materialCheck.kind !== "json" ? "当前材料不是规范 JSON" : undefined}
            >
              用已有 JSON 预览
            </Button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="import-review">
          <section className="panel panel-pad">
            <div className="panel-head import-head">
              <div>
                <div className="panel-title">校验结果</div>
                <div className="panel-sub">
                  {preview ? preview.title + " · " + preview.question_count + " 题" : "还没有可预览的内容"}
                </div>
              </div>
              <div className="import-title-field">
                <span>导入后标题</span>
                <input
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={preview?.title ?? "沿用 JSON 里的 set.title"}
                />
              </div>
            </div>

            {preview ? (
              <>
                <div className="import-org">
                  <div className="import-org-item">
                    <Folder size={14} />
                    <span className="import-org-label">文件夹</span>
                    {preview.folder ? (
                      <span className="import-org-value">{preview.folder}</span>
                    ) : (
                      <span className="import-org-empty">未归类</span>
                    )}
                  </div>
                  <div className="import-org-item import-org-tags">
                    <Tag size={14} />
                    <span className="import-org-label">试卷标签</span>
                    {preview.set_tags?.length ? (
                      <span className="import-tag-list">
                        {preview.set_tags.map((t, i) => (
                          <span className="import-tag" key={t + "-" + i}>{t}</span>
                        ))}
                      </span>
                    ) : (
                      <span className="import-org-empty">未打标</span>
                    )}
                  </div>
                </div>

                <div className="stat-row import-stats">
                  <div className="stat"><strong>{preview.question_count}</strong><span>题目</span></div>
                  <div className="stat"><strong>{preview.sections?.length ?? "—"}</strong><span>分区</span></div>
                  <div className="stat"><strong>{preview.materials?.length ?? "—"}</strong><span>材料</span></div>
                  <div className="stat"><strong>{totalPoints}</strong><span>总分</span></div>
                  <div className="stat"><strong>{preview.warnings.length}</strong><span>警告</span></div>
                </div>

                {dist.length ? (
                  <div className="import-dist">
                    {dist.map(([t, n]) => (
                      <span className="import-dist-chip" key={t}>
                        {qtypeLabel(t)} <strong>{n}</strong>
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="import-actions">
                  <div className="seg" role="tablist" aria-label="预览方式">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={reviewTab === "table"}
                      data-on={reviewTab === "table"}
                      onClick={() => setReviewTab("table")}
                    >
                      校验表格
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={reviewTab === "paper"}
                      data-on={reviewTab === "paper"}
                      onClick={() => setReviewTab("paper")}
                    >
                      原卷预览
                    </button>
                  </div>
                  <span className="spacer" />
                  <span className="import-tip">
                    {reviewTab === "paper" ? "按分区、材料和题号还原排版；警告可定位到题。" : "快速核对题型、答案、标签与分值。"}
                  </span>
                </div>

                <div className="import-warns">
                  {preview.warnings.length ? (
                    preview.warnings.map((w, i) => {
                      const target = findWarningQuestion(w, preview.questions, preview.sections);
                      return (
                        <div className="import-warn" key={i}>
                          <AlertTriangle size={14} />
                          <span className="grow">{w}</span>
                          {target ? (
                            <Button size="sm" variant="ghost" onClick={() => locateWarning(w)}>
                              <Crosshair size={13} /> 定位
                            </Button>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <div className="import-ok"><CheckCircle2 size={15} /> 结构完整，没有发现需要修正的地方。</div>
                  )}
                </div>

                {reviewTab === "paper" ? (
                  paperGroups.length ? (
                    <div className="paper-preview">
                      <PaperDoc
                        groups={paperGroups}
                        materials={materialMap}
                        title={preview.title}
                        eyebrow="原卷预览"
                        meta={[preview.question_count + " 题", paperGroups.length + " 个分区", totalPoints + " 分"]}
                        flashId={flashQid}
                      />
                    </div>
                  ) : (
                    <div className="empty">
                      <FileJson size={22} />
                      <div>没有可还原的分区或题目。切回校验表格检查 JSON。</div>
                    </div>
                  )
                ) : (
                  <>
                    {preview.sections && preview.sections.length ? (
                      <div className="import-sections">
                        {preview.sections.map((s) => (
                          <div className="import-section-row" key={s.id}>
                            <span className="import-section-title">{s.title}</span>
                            <span className="import-section-meta">
                              {preview.questions.filter((q) => q.section_id === s.id).length} 题
                              {" · "}
                              {sectionKindLabel(s.kind)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="import-table-wrap">
                      <table className="import-table">
                        <thead>
                          <tr>
                            <th className="col-no">题号</th>
                            <th className="col-type">题型</th>
                            <th>题干</th>
                            <th className="col-answer">答案</th>
                            <th className="col-tags">标签</th>
                            <th className="col-points">分值</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.questions.map((q) => (
                            <tr key={q.id}>
                              <td className="col-no"><span className="q-no">{q.number}</span></td>
                              <td className="col-type"><span className="import-type">{qtypeLabel(q.qtype)}</span></td>
                              <td className="col-stem">
                                {q.stem
                                  ? <span dangerouslySetInnerHTML={{ __html: richStemHtml(q.stem) }} />
                                  : <span className="muted">（空题干）</span>}
                              </td>
                              <td className="col-answer mono-num">
                                <span dangerouslySetInnerHTML={{ __html: richInlineHtml(answerText(q)) }} />
                              </td>
                              <td className="col-tags">
                                {q.tags?.length ? (
                                  <div className="import-qtags" title={q.tags.join(" / ")}>
                                    {q.tags.slice(0, 3).map((t, i) => (
                                      <span className="import-qtag" key={t + "-" + i}>{t}</span>
                                    ))}
                                    {q.tags.length > 3 ? (
                                      <span className="import-qtag import-qtag-more">+{q.tags.length - 3}</span>
                                    ) : null}
                                  </div>
                                ) : (
                                  <span className="import-org-empty">—</span>
                                )}
                              </td>
                              <td className="col-points">{q.points}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {preview.questions.length === 0 ? (
                      <div className="empty">
                        <FileJson size={22} />
                        <div>没有读到题目。确认 JSON 的 questions 是非空数组，每道题都有 stem 和 qtype。</div>
                      </div>
                    ) : null}
                  </>
                )}
              </>
            ) : (
              <div className="empty">
                <FileJson size={22} />
                <div>还没有预览。回到上一步放入 JSON，或点下面重新校验。</div>
              </div>
            )}

            <div className="import-actions">
              <Button variant="ghost" onClick={() => go(1)}><ChevronLeft size={15} /> 上一步</Button>
              <Button variant="ghost" onClick={() => void runPreview()} disabled={busy || !text.trim()}>
                {busy ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />} 重新校验
              </Button>
              <span className="spacer" />
              <Button variant="primary" onClick={() => void confirmImport()} disabled={busy || !preview}>
                {busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />} 确认导入 {preview?.question_count ?? 0} 题
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      {step === 3 ? (
        <section className="panel panel-pad import-success">
          <div className="import-success-icon"><CheckCircle2 size={30} /></div>
          <h2>已导入 {imported} 道题</h2>
          <div className="import-success-sub">
            批次 #{batchId ?? "—"}，可以在题库里撤销这次写入。
          </div>
          <div className="import-success-actions">
            {confirmUndo ? (
              <>
                <span className="import-tip">撤销会删除这次导入的整份试卷，确定吗？</span>
                <Button variant="danger" disabled={busy} onClick={() => void undo()}>
                  {busy ? <Loader2 size={15} className="spin" /> : null} 确认撤销
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirmUndo(false)}>取消</Button>
              </>
            ) : (
              <>
                <Button variant="primary" onClick={() => nav("/bank")}>去题库看看</Button>
                <Button variant="soft" onClick={() => { resetMaterial(); setStep(0); setReached(0); }}>再导入一份</Button>
                <Button variant="ghost" onClick={() => setConfirmUndo(true)}>
                  <RotateCcw size={15} /> 撤销本次导入
                </Button>
              </>
            )}
          </div>
        </section>
      ) : null}

      <Modal
        open={promptPreviewOpen}
        onClose={() => setPromptPreviewOpen(false)}
        title="清洗提示词预览"
        width={900}
      >
        <div className="import-prompt-hint">
          共 {SPEC_LINES} 行规范；把下面的提示词和材料一起交给任意 AI，拿回 JSON 后粘到第一步。
        </div>
        <pre className="import-prompt">{prompt}</pre>
        <div className="import-actions import-actions-plain">
          <span className="spacer" />
          <Button variant="ghost" onClick={() => setPromptPreviewOpen(false)}>关闭</Button>
        </div>
      </Modal>
    </main>
  );
}
