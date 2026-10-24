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
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Sparkles,
  Tag,
  Upload,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { buildPrompt, IMPORT_SPEC, JSON_TEMPLATE } from "../lib/importPrompt";
import type { ImportPreview, Question } from "../lib/types";
import { PaperDoc } from "../components/PaperView";
import type { PaperGroup } from "../components/PaperView";
import { Button, Modal } from "../components/ui";
import { imageFileToPages, pdfFileToPages, pdfFileToText } from "../lib/pdf";
import type { PageImage } from "../lib/pdf";
import { visionCleanPipeline } from "../lib/visionImport";
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
const MAX_AI_MATERIAL = 120000;
const MAX_AI_MATERIAL_LABEL = "12 万";

const AI_CLEAN_SYSTEM = [
  "你是 Tokeru 题库的导入清洗助手。只输出一个 JSON 对象，不要 Markdown 代码围栏，不要输出说明文字，不要输出思考过程。",
  "必须严格符合下面的 Tokeru 导入规范；字段名、qtype、answer.kind 与 materials/sections 的引用都不能改。",
  "",
  IMPORT_SPEC,
].join("\n");

const AI_REVISE_SYSTEM = [
  "你是 Tokeru 题库的导入 JSON 修订助手。只返回一个完整 JSON 对象，不要 Markdown 代码围栏，不要说明文字，不要思考过程。",
  "保留未要求修改的字段与内容：字段名、题号、qtype、answer.kind、options、materials/sections 的 key 引用都不能顺手改掉。",
  "只按用户这次的要求修改；修改后的 JSON 必须仍符合下面的 Tokeru 导入规范。",
  "",
  IMPORT_SPEC,
].join("\n");

type ReviseEntry = { text: string; preview: ImportPreview; note: string };

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
    return t.length > 40 ? t.slice(0, 40) + "…" : t;
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
  const [revisions, setRevisions] = useState<ReviseEntry[]>([]);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseText, setReviseText] = useState("");
  const [revising, setRevising] = useState(false);
  const [reviseError, setReviseError] = useState("");
  const [busy, setBusy] = useState(false);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [imported, setImported] = useState(0);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [fileInfo, setFileInfo] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [loadingName, setLoadingName] = useState("");
  const [cleaning, setCleaning] = useState(false);
  const [cleanError, setCleanError] = useState("");
  const [sourcePages, setSourcePages] = useState<PageImage[]>([]);
  const [visionBusy, setVisionBusy] = useState(false);
  const [visionStatus, setVisionStatus] = useState("");
  const [visionError, setVisionError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

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
    setCleanError("");
    setSourcePages([]);
    setVisionError("");
    setVisionStatus("");
    setVisionBusy(false);
    setPreview(null);
    setBatchId(null);
    setDragging(false);
    setReviewTab("table");
    setFlashQid(null);
    setRevisions([]);
    setReviseOpen(false);
    setReviseText("");
    setReviseError("");
  }

  function copyMaterialPrompt() {
    void copyText(prompt, "已复制清洗提示词，交给任意 AI 后再把 JSON 贴回来");
  }

  async function loadFile(file?: File) {
    if (!file || fileLoading) return;
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name);
    if (!isPdf && !isImage && !/\.(json|md|markdown|txt)$/i.test(file.name)) {
      toast.error("只支持 PDF / 图片 / JSON / Markdown / TXT 文件。");
      return;
    }
    if ((isPdf || isImage) && file.size > MAX_PDF_FILE) {
      toast.error((isPdf ? "PDF" : "图片") + "超过 100 MB，先拆分或压缩后再导入。");
      return;
    }
    if (!isPdf && !isImage && file.size > MAX_TEXT_FILE) {
      toast.error("文件超过 8 MB，先精简后再导入。");
      return;
    }
    setCleanError("");
    setSourcePages([]);
    setVisionError("");
    setVisionStatus("");
    setPreview(null);
    setBatchId(null);
    setRevisions([]);
    setReviseOpen(false);
    setReviseError("");
    setReviewTab("table");
    setFlashQid(null);

    if (!isPdf && !isImage) {
      try {
        const content = await file.text();
        setText(content);
        setFileName(file.name);
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
      if (isImage) {
        const pages = await imageFileToPages(file);
        setSourcePages(pages);
        setText("");
        setFileName(file.name);
        setFileInfo("图片 · " + pages.length + " 页");
        toast.success("已载入图片，可用视觉识别读取题目");
        return;
      }

      const [pagesResult, textResult] = await Promise.allSettled([
        pdfFileToPages(file),
        pdfFileToText(file, PDF_MAX_PAGES),
      ]);
      const pages = pagesResult.status === "fulfilled" ? pagesResult.value : [];
      setSourcePages(pages);
      setFileName(file.name);
      if (pagesResult.status === "rejected") {
        toast.info("页面渲染失败，仍可只用文字导入。");
      }

      if (textResult.status === "fulfilled") {
        const res = textResult.value;
        setText(res.text);
        setFileInfo("PDF · " + pages.length + " 页页面 · 已提取文字");
        if (res.pages < res.totalPages) {
          toast.info("PDF 共 " + res.totalPages + " 页，只读取前 " + res.pages + " 页；需要更多内容可拆分后分批导入。");
        } else {
          toast.success("已读取 PDF 的 " + res.pages + " 页");
        }
      } else {
        setText("");
        if (pages.length > 0) {
          setFileInfo("PDF · " + pages.length + " 页 · 扫描件，用视觉识别");
          toast.info("没有提取到文字，可用视觉识别读取题目。");
        } else {
          throw textResult.reason;
        }
      }
    } catch (e) {
      const msg = errorText(e);
      toast.error(msg.includes("扫描件") ? msg : "PDF 读取失败：" + msg);
    } finally {
      setFileLoading(false);
      setLoadingName("");
    }
  }

  async function runVisionClean() {
    if (visionBusy || cleaning || fileLoading) return;
    if (!sourcePages.length) return toast.error("先选择 PDF 或图片。");
    setVisionBusy(true);
    setVisionError("");
    setVisionStatus("正在准备页面…");
    const loading = toast.loading("视觉模型正在识别试卷…");
    try {
      const result = await visionCleanPipeline({
        pages: sourcePages,
        title: title || undefined,
        extra: extra || undefined,
        onProgress: (label, done, total) => {
          setVisionStatus(total > 1 ? label + "（" + done + "/" + total + "）" : label);
        },
      });
      setText(result.json);
      setFileName(fileName);
      setFileInfo("视觉识别结果 · " + result.figures + " 张题图");
      setPreview(result.preview);
      setCleanError("");
      setBatchId(null);
      setRevisions([]);
      setReviseOpen(false);
      setReviseError("");
      setReviewTab("table");
      setFlashQid(null);
      toast.success(
        "视觉识别完成：" + result.preview.questions.length + " 题" + (result.figures ? "，" + result.figures + " 张题图" : ""),
        { id: loading },
      );
      go(2);
    } catch (e) {
      const message = "视觉识别失败：" + errorText(e);
      setVisionError(message);
      toast.error(message, { id: loading });
    } finally {
      setVisionBusy(false);
      setVisionStatus("");
    }
  }

  async function pasteFromClipboard() {
    if (fileLoading) return toast.error("正在读取 PDF，稍等。");
    try {
      const t = await navigator.clipboard.readText();
      if (!t.trim()) return toast.error("剪贴板是空的。");
      setText(t);
      setFileName("");
      setFileInfo("来自剪贴板");
      setCleanError("");
      setSourcePages([]);
      setVisionError("");
      setVisionStatus("");
      setPreview(null);
      setBatchId(null);
      setRevisions([]);
      setReviseOpen(false);
      setReviseError("");
      setReviewTab("table");
      setFlashQid(null);
      toast.success("已粘贴剪贴板内容");
    } catch {
      toast.error("浏览器没有给剪贴板权限，请手动粘贴到输入框。");
    }
  }

  async function cleanWithAi() {
    const material = text.trim();
    if (!material) return toast.error("先放入材料。");
    if (cleaning) return;
    const clipped = material.length > MAX_AI_MATERIAL;
    const payload = clipped ? material.slice(0, MAX_AI_MATERIAL) : material;
    setCleaning(true);
    setCleanError("");
    const loading = toast.loading("AI 正在清洗材料…");
    if (clipped) toast.info(`材料超过 ${MAX_AI_MATERIAL_LABEL}字符，本次只发送前 ${MAX_AI_MATERIAL_LABEL}字符。`);
    try {
      const user = [
        "把下面的材料清洗成 Tokeru 可导入的 JSON。",
        title ? "导入后标题：" + title + "。" : "",
        extra ? "额外要求：" + extra + "。" : "",
        clipped ? `注意：原始材料超过 ${MAX_AI_MATERIAL_LABEL}字符，已截取前 ${MAX_AI_MATERIAL_LABEL}字符。` : "",
        "材料开始：",
        payload,
        "材料结束。",
      ].filter(Boolean).join("\n");
      const result = await api.aiComplete(AI_CLEAN_SYSTEM, user);
      const stripped = stripCodeFence(result.content);
      const json = outermostJson(stripped);
      if (!json) throw new Error("AI 没有返回 JSON 对象，请重试或复制提示词手动清洗。");
      setText(json);
      setFileName("");
      setFileInfo("AI 清洗结果");
      setPreview(null);
      setBatchId(null);
      setRevisions([]);
      setReviseOpen(false);
      setReviseError("");
      const ok = await runPreview(json, false);
      if (ok) {
        toast.success("AI 清洗完成，已识别到规范 JSON", { id: loading });
      } else {
        const msg = "AI 清洗完成，但 JSON 未通过校验；已把结果放进材料框，可修改后重试。";
        setCleanError(msg);
        toast.error(msg, { id: loading });
      }
    } catch (e) {
      const msg = "AI 清洗失败：" + errorText(e);
      setCleanError(msg);
      toast.error(msg, { id: loading });
    } finally {
      setCleaning(false);
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
      setCleanError("");
      setRevisions([]);
      setReviseOpen(false);
      setReviseError("");
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
    setCleanError("");
    setSourcePages([]);
    setVisionError("");
    setVisionStatus("");
    setPreview(null);
    setBatchId(null);
    setRevisions([]);
    setReviseOpen(false);
    setReviseError("");
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

  async function reviseWithAi() {
    if (!preview || revising) return;
    const instruction = reviseText.trim();
    if (!instruction) return toast.error("先写一条修改要求。");
    const currentText = text.trim();
    if (!currentText) return toast.error("当前没有可修改的 JSON。");
    const currentPreview = preview;
    setRevising(true);
    setReviseError("");
    const loading = toast.loading("AI 正在修改 JSON…");
    try {
      const notes = revisions.slice(-4).map((r, i) => i + 1 + ". " + r.note).join("\n");
      const user = [
        "当前 Tokeru 导入 JSON：",
        currentText,
        notes ? "之前几轮的修改要求（只作为上下文，不要重复执行）：\n" + notes : "",
        "这次只需要按下面的要求修改，其他内容原样保留：",
        instruction,
        "请返回修改后的完整 JSON。",
      ].filter(Boolean).join("\n\n");
      const result = await api.aiComplete(AI_REVISE_SYSTEM, user);
      const json = outermostJson(stripCodeFence(result.content));
      if (!json) throw new Error("AI 没有返回 JSON 对象，请重试。");
      const next = await api.previewImport({ text: json, title: title || currentPreview.title, kind: "json" });
      if (!next.questions.length) throw new Error("修改后的 JSON 没有题目，检查 AI 返回内容。");
      setRevisions((prev) => [...prev, { text: currentText, preview: currentPreview, note: instruction }]);
      setText(json);
      setPreview(next);
      setFileInfo("AI 修改结果");
      setCleanError("");
      setReviewTab("table");
      setFlashQid(null);
      setReviseOpen(false);
      setReviseText("");
      toast.success("已应用修改，共 " + next.question_count + " 题；可回退上一版", { id: loading });
    } catch (e) {
      const msg = "AI 修改失败：" + errorText(e);
      setReviseError(msg);
      toast.error(msg, { id: loading });
    } finally {
      setRevising(false);
    }
  }

  function undoRevision() {
    if (revising) return;
    const last = revisions[revisions.length - 1];
    if (!last) return;
    setRevisions((prev) => prev.slice(0, -1));
    setText(last.text);
    setPreview(last.preview);
    setFileInfo("AI 修改前的版本");
    setCleanError("");
    setReviewTab("table");
    setFlashQid(null);
    setReviseOpen(false);
    setReviseError("");
    toast.success("已回退到上一版");
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
              <div className="panel-sub">PDF、图片、Markdown、TXT 或 JSON 都行；扫描件可直接走视觉识别。</div>
            </div>
            <div className="import-file-actions">
              <label className={"btn btn-soft btn-sm import-file-label" + (fileLoading ? " is-disabled" : "")}>
                {fileLoading ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                {fileLoading ? "读取中" : "选择文件"}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.md,.markdown,.txt,.json"
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

          <div
            className={"import-drop" + (dragging ? " is-over" : "")}
            data-on={dragging}
            onDragEnter={(e) => {
              e.preventDefault();
              if (fileLoading || cleaning || visionBusy) return;
              dragDepth.current += 1;
              setDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!fileLoading && !cleaning && !visionBusy) setDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              if (!fileLoading && !cleaning && !visionBusy) void loadFile(e.dataTransfer.files?.[0]);
            }}
          >
            {fileLoading ? (
              <div className="import-file-loading">
                <Loader2 size={22} className="spin" />
                <strong>正在读取文件</strong>
                <span>{loadingName}</span>
                <small>同时渲染页面并提取文字，最多前 {PDF_MAX_PAGES} 页。</small>
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
                    setCleanError("");
                    setRevisions([]);
                    setReviseOpen(false);
                    setReviseError("");
                    setReviewTab("table");
                    setFlashQid(null);
                  }}
                  placeholder="把试卷原文、Markdown、TXT 或已清洗的 JSON 粘贴到这里，也可以把 PDF 或图片拖进来…"
                  spellCheck={false}
                  disabled={cleaning}
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

          {sourcePages.length > 0 ? (
            <div>
              <div className="import-check" data-state="ok">
                <ImageIcon size={16} />
                <div className="import-check-text">
                  <strong>已载入 {sourcePages.length} 页页面</strong>
                  <span>
                    {text.trim()
                      ? "已同时提取文字；视觉识别会重新读图并按规范整理。"
                      : "没有可提取文字（扫描件或图片），用视觉识别读取题目。"}
                  </span>
                </div>
                <div className="import-check-actions">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={visionBusy || cleaning || fileLoading}
                    onClick={() => void runVisionClean()}
                  >
                    {visionBusy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                    {visionBusy ? "识别中…" : "视觉识别并清洗"}
                  </Button>
                  <Button
                    size="sm"
                    variant="soft"
                    disabled={visionBusy || cleaning || fileLoading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={15} /> 重新上传 / 替换
                  </Button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "10px 0 2px" }}>
                {sourcePages.map((page) => (
                  <img
                    key={page.page}
                    src={page.dataUrl}
                    alt={"第 " + page.page + " 页"}
                    loading="lazy"
                    decoding="async"
                    style={{
                      width: 88,
                      height: 116,
                      objectFit: "contain",
                      flex: "0 0 auto",
                      borderRadius: 8,
                      border: "1px solid var(--line)",
                      background: "var(--surface-2)",
                    }}
                  />
                ))}
              </div>
              {visionBusy && visionStatus ? <div className="import-tip">{visionStatus}</div> : null}
              {visionError ? (
                <div className="import-clean-error">
                  <AlertTriangle size={14} />
                  <span>{visionError}</span>
                  <Button
                    size="sm"
                    variant="soft"
                    disabled={visionBusy || cleaning || fileLoading}
                    onClick={() => void runVisionClean()}
                  >
                    {visionBusy ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />} 重试
                  </Button>
                  <Button size="sm" variant="ghost" onClick={copyMaterialPrompt}>
                    <Copy size={14} /> 复制提示词
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {materialCheck.kind === "json" ? (
            <div className="import-check" data-state="ok">
              <CheckCircle2 size={16} />
              <div className="import-check-text">
                <strong>识别到规范 JSON · {materialCheck.count} 题</strong>
                <span>{materialCheck.title ? materialCheck.title + "，可直接预览并校验。" : "结构完整，可直接预览并校验。"}</span>
              </div>
              <Button size="sm" variant="primary" disabled={busy || cleaning} onClick={() => void runPreview()}>
                {busy ? <Loader2 size={15} className="spin" /> : <ChevronRight size={15} />}
                预览并校验
              </Button>
            </div>
          ) : materialCheck.kind === "raw" ? (
            <div className="import-check" data-state="raw">
              <AlertTriangle size={16} />
              <div className="import-check-text">
                <strong>{materialCheck.jsonish ? "还不是可导入的 JSON" : "这是原始材料，还不是 JSON"}</strong>
                <span>{materialCheck.reason} 可以直接交给 AI 清洗，或换成已清洗的 JSON。</span>
              </div>
              <div className="import-check-actions">
                <Button size="sm" variant="primary" disabled={cleaning || fileLoading} onClick={() => void cleanWithAi()}>
                  {cleaning ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                  {cleaning ? "清洗中…" : "应用内 AI 清洗"}
                </Button>
                <Button size="sm" variant="soft" disabled={cleaning || fileLoading} onClick={() => fileInputRef.current?.click()}>
                  <Upload size={15} /> 重新上传 / 替换
                </Button>
              </div>
            </div>
          ) : null}

          {cleanError ? (
            <div className="import-clean-error">
              <AlertTriangle size={14} />
              <span>{cleanError}</span>
              <Button size="sm" variant="soft" disabled={cleaning || fileLoading} onClick={() => void cleanWithAi()}>
                {cleaning ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} 重试
              </Button>
              <Button size="sm" variant="ghost" onClick={copyMaterialPrompt}>
                <Copy size={14} /> 复制提示词
              </Button>
            </div>
          ) : null}

          <div className="import-actions">
            <span className="import-tip">
              {fileLoading ? "正在渲染页面并提取文字…" : "支持 PDF / 图片 / JSON / .md / .txt；PDF 单份不超过 100 MB，最多读取前 50 页。"}
            </span>
            <span className="spacer" />
            <Button variant="primary" disabled={!text.trim() || busy || cleaning || fileLoading} onClick={() => go(1)}>
              下一步 <ChevronRight size={15} />
            </Button>
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="import-generate">
          <section className="panel panel-pad import-card">
            <div className="import-card-head">
              <span className="import-badge"><Sparkles size={16} /></span>
              <div>
                <div className="panel-title">复制提示词，交给任意 AI</div>
                <div className="panel-sub">规范覆盖 9 种题型，AI 照着填就能直接导入。</div>
              </div>
            </div>
            <div className="import-meta">
              <span><strong>{SPEC_LINES}</strong> 行规范</span>
              <span><strong>9</strong> 种题型</span>
              <span><strong>JSON</strong> 严格输出</span>
            </div>
            <label className="field">
              <span>额外要求（可选）</span>
              <input
                className="input"
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                placeholder="例如：听力原文放进 answer.reference；每题 2 分"
              />
            </label>
            <div className="import-card-actions">
              <Button variant="primary" onClick={() => void copyText(prompt, "已复制提示词，粘到 AI 对话框即可")}>
                <Copy size={15} /> 复制提示词
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPromptPreviewOpen(true)}>
                预览提示词
              </Button>
            </div>
            <div className="import-prompt-hint">提示词里已带完整规范和 JSON 骨架，末尾自动附上本次材料。</div>
          </section>

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
                              <td className="col-stem">{q.stem || <span className="muted">（空题干）</span>}</td>
                              <td className="col-answer mono-num">{answerText(q)}</td>
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
              <Button
                variant="soft"
                disabled={busy || !preview}
                onClick={() => { setReviseError(""); setReviseOpen(true); }}
              >
                <Wand2 size={15} /> 让 AI 继续修改
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
          <Button variant="primary" onClick={() => void copyMaterialPrompt()}>
            <ClipboardCopy size={15} /> 复制提示词
          </Button>
        </div>
      </Modal>

      <Modal
        open={reviseOpen}
        onClose={() => { if (!revising) setReviseOpen(false); }}
        title="让 AI 继续修改"
        width={780}
      >
        <div className="field">
          <label htmlFor="import-revise">修改要求</label>
          <textarea
            id="import-revise"
            className="textarea import-editor-short"
            value={reviseText}
            onChange={(e) => setReviseText(e.target.value)}
            placeholder="例如：把第 3 题的参考答案补一句说明；第 5 题改成多选题。"
          />
        </div>
        <div className="import-prompt-hint">
          AI 会拿到当前完整 JSON 和最近几轮要求，只返回修改后的完整 JSON；未要求改动的字段保持原样。
        </div>
        {revisions.length ? (
          <div className="import-tip">已保留 {revisions.length} 个可回退版本。</div>
        ) : null}
        {reviseError ? (
          <div className="import-clean-error">
            <AlertTriangle size={15} />
            <span>{reviseError}</span>
          </div>
        ) : null}
        <div className="import-actions import-actions-plain">
          <Button variant="ghost" disabled={revising} onClick={() => setReviseOpen(false)}>取消</Button>
          <span className="spacer" />
          {revisions.length ? (
            <Button variant="soft" disabled={revising} onClick={undoRevision}>
              <RotateCcw size={15} /> 回退上一版
            </Button>
          ) : null}
          <Button
            variant="primary"
            disabled={revising || !reviseText.trim()}
            onClick={() => void reviseWithAi()}
          >
            {revising ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} />} 交给 AI 修改
          </Button>
        </div>
      </Modal>
    </main>
  );
}

