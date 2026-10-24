import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookmarkPlus,
  Check,
  CheckSquare,
  ChevronDown,
  Columns3,
  Folder as FolderIcon,
  ImagePlus,
  ListChecks,
  ListFilter,
  Loader2,
  Minus,
  Play,
  Plus,
  Printer,
  Rows3,
  ScanSearch,
  Sparkles,
  Square,
  Tag,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import AutoFigures from "../components/AutoFigures";
import { PaperDoc, PaperQuestion, shortNo } from "../components/PaperView";
import type { PaperGroup } from "../components/PaperView";
import { TagChips } from "../components/TagChips";
import { Modal } from "../components/ui";
import type { Folder, Material, QType, Question, ScorePlanResult, Section, TagInfo } from "../lib/types";
import { QTYPE_LABEL, acceptText, answerText, qtypeLabel } from "../lib/labels";
import { loadPaperStyle, paperCssVars, type PaperStyle } from "../lib/paper";
import { richStemHtml } from "../lib/richText";

const SUBJECTIVE = new Set(["short_answer", "writing", "dictation"]);
const EMPTY_TAGS: string[] = [];
const MODE_KEY = "tokeru.answers.mode";

const SECTION_NAME: Record<string, string> = {
  dictation: "听写",
  talk: "讲座",
  conversation: "会话",
  language: "语言运用",
  cloze: "完形",
  reading: "阅读",
  short_answer: "简答",
  writing: "写作",
};

const KIND_LABEL: Record<string, string> = {
  dictation: "听写",
  listening: "听力",
  choice: "语言运用",
  cloze: "完形",
  reading: "阅读",
  short_answer: "简答",
  writing: "写作",
};

type ViewMode = "detailed" | "brief";
type TagMap = Map<string, TagInfo>;

interface FolderOption {
  id: number;
  name: string;
  depth: number;
  setCount: number;
}

interface AnswerInfo {
  correct: string;
  accept: string;
  referenceExtra: string;
  subjective: boolean;
  label: string;
  keys: Set<string>;
}

function errText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** 把图片压到适合题干显示的尺寸，避免一张原图把 JSON 撑到几 MB。 */
async function imageToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const maxWidth = 1400;
  const scale = Math.min(1, maxWidth / bitmap.width);
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
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.86);
}

function sectionLabel(section: Section) {
  return SECTION_NAME[section.key] ?? KIND_LABEL[section.kind] ?? (section.title.replace(/^PART\s+[IVXLCDM]+/i, "").trim() || section.title);
}

function flattenFolders(list: Folder[], parent: number | null = null, depth = 0, out: FolderOption[] = []): FolderOption[] {
  const children = list
    .filter((folder) => (folder.parent_id ?? null) === parent)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.id - b.id);
  for (const folder of children) {
    out.push({ id: folder.id, name: folder.name, depth, setCount: folder.set_count ?? 0 });
    flattenFolders(list, folder.id, depth + 1, out);
  }
  return out;
}

function answerInfo(q: Question): AnswerInfo {
  const correct = answerText(q.answer);
  const accept = acceptText(q.answer);
  const extra = accept && accept !== correct ? accept : "";
  const keys = new Set(
    Array.isArray(q.answer.correct) ? q.answer.correct : q.answer.correct ? [q.answer.correct] : [],
  );
  const hasAccept = Boolean(q.answer.accept?.length || q.answer.accepted?.length);
  const subjective = SUBJECTIVE.has(q.qtype) || (keys.size === 0 && !hasAccept && Boolean(q.answer.reference));
  const referenceExtra = q.answer.reference && !subjective && q.answer.reference !== correct ? q.answer.reference : "";
  return {
    correct,
    accept: extra,
    referenceExtra,
    subjective,
    label: subjective ? "参考文本" : "正确答案",
    keys,
  };
}

/** 简要模式的一行题干：去标签、保留空位。 */
function plainStem(html: string) {
  const blanked = (html || "").replace(
    /<span[^>]*class="[^"]*blank[^"]*"[^>]*>[\s\S]*?<\/span>/gi,
    " ______ ",
  );
  return blanked
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function questionElement(id: number, mode: ViewMode): HTMLElement | null {
  if (mode === "brief") return document.getElementById("org-q-" + id);
  return document.getElementById("paper-qa-" + id) ?? document.getElementById("paper-q-" + id);
}

export default function AnswersPage() {
  const { setId } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const sid = Number(setId);
  const deepQid = Number(params.get("q") ?? 0) || 0;

  const setQ = useQuery({ queryKey: ["set", sid], queryFn: () => api.getSet(sid), enabled: Number.isFinite(sid) });
  const foldersQ = useQuery({ queryKey: ["folders"], queryFn: () => api.listFolders() });
  const tagsQ = useQuery({ queryKey: ["tags"], queryFn: () => api.listTags() });

  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      return window.localStorage.getItem(MODE_KEY) === "brief" ? "brief" : "detailed";
    } catch {
      return "detailed";
    }
  });
  const [setTagsOverride, setSetTagsOverride] = useState<string[] | null>(null);
  const [setSaving, setSetSaving] = useState(false);
  const [folderValue, setFolderValue] = useState("");
  const [folderBusy, setFolderBusy] = useState(false);
  const [activeSection, setActiveSection] = useState<number | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());
  const [savingMap, setSavingMap] = useState<Record<number, string | undefined>>({});
  const [collecting, setCollecting] = useState(false);
  const [autoFiguresOpen, setAutoFiguresOpen] = useState(false);
  const [scorePlanOpen, setScorePlanOpen] = useState(false);
  const [paperStyle, setPaperStyle] = useState<PaperStyle>(() => loadPaperStyle());
  const scrolledRef = useRef("");
  const focusTimer = useRef<number | null>(null);

  const setTags = setTagsOverride ?? setQ.data?.tags ?? EMPTY_TAGS;

  const tagMap = useMemo<TagMap>(() => {
    const map: TagMap = new Map();
    for (const tag of tagsQ.data ?? []) map.set(tag.name, tag);
    return map;
  }, [tagsQ.data]);

  const groups = useMemo(() => {
    const data = setQ.data;
    if (!data) return [];
    const bySection = new Map<number, Question[]>();
    for (const q of data.questions) {
      if (q.archived) continue;
      const list = bySection.get(q.section_id) ?? [];
      list.push(q);
      bySection.set(q.section_id, list);
    }
    return [...data.sections]
      .sort((a, b) => a.position - b.position)
      .map((section) => {
        const questions = (bySection.get(section.id) ?? []).sort((a, b) => a.position - b.position);
        return {
          section,
          questions,
          points: questions.reduce((sum, q) => sum + q.points, 0),
        };
      })
      .filter((group) => group.questions.length > 0);
  }, [setQ.data]);

  const allQuestions = useMemo(() => groups.flatMap((group) => group.questions), [groups]);

  const materialMap = useMemo(() => {
    const map = new Map<number, Material>();
    for (const material of setQ.data?.materials ?? []) map.set(material.id, material);
    return map;
  }, [setQ.data]);

  const paperGroups = useMemo<PaperGroup[]>(
    () =>
      groups.map((group) => ({
        id: group.section.id,
        title: group.section.title,
        meta: group.questions.length + " 题 · " + group.points + " 分",
        section: group.section,
        questions: group.questions,
      })),
    [groups],
  );

  const folderList = useMemo(() => flattenFolders(foldersQ.data ?? []), [foldersQ.data]);
  const currentFolder = folderList.find((folder) => String(folder.id) === folderValue);
  const focusQuestion = useMemo(
    () => (deepQid && setQ.data ? setQ.data.questions.find((q) => q.id === deepQid) : undefined),
    [deepQid, setQ.data],
  );
  const totalSelected = selectedIds.size;

  useEffect(() => {
    setSetTagsOverride(null);
    setSelectedIds(new Set());
    setExpandedIds(new Set());
    scrolledRef.current = "";
  }, [sid]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* 浏览器禁用 localStorage 时只保留本次会话状态 */
    }
  }, [mode]);

  useEffect(() => {
    const syncPaperStyle = () => setPaperStyle(loadPaperStyle());
    const onVisible = () => {
      if (document.visibilityState === "visible") syncPaperStyle();
    };
    window.addEventListener("storage", syncPaperStyle);
    window.addEventListener("focus", syncPaperStyle);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", syncPaperStyle);
      window.removeEventListener("focus", syncPaperStyle);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!folderBusy) setFolderValue(setQ.data?.folder_id != null ? String(setQ.data.folder_id) : "");
  }, [setQ.data?.folder_id, folderBusy]);

  useEffect(() => {
    if (!deepQid) {
      scrolledRef.current = "";
      setFlashId(null);
      if (focusTimer.current) {
        window.clearTimeout(focusTimer.current);
        focusTimer.current = null;
      }
      return;
    }
    if (!setQ.data) return;
    if (mode === "brief") {
      setExpandedIds((prev) => {
        if (prev.has(deepQid)) return prev;
        const next = new Set(prev);
        next.add(deepQid);
        return next;
      });
    }
    if (focusQuestion) setActiveSection(focusQuestion.section_id);
    const key = mode + "-" + deepQid;
    if (scrolledRef.current === key) return;
    let cancelled = false;
    let timer = 0;
    const attempt = (tries: number) => {
      if (cancelled) return;
      const element = questionElement(deepQid, mode);
      if (!element) {
        if (tries < 6) timer = window.setTimeout(() => attempt(tries + 1), 60);
        return;
      }
      scrolledRef.current = key;
      setFlashId(deepQid);
      if (focusTimer.current) window.clearTimeout(focusTimer.current);
      focusTimer.current = window.setTimeout(() => setFlashId(null), 1500);
      element.scrollIntoView({ block: "center" });
    };
    timer = window.setTimeout(() => attempt(0), 30);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [deepQid, setQ.data, mode, focusQuestion]);

  useEffect(() => {
    return () => {
      if (focusTimer.current) window.clearTimeout(focusTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!groups.length) return;
    let raf = 0;
    const compute = () => {
      raf = 0;
      let current = groups[0].section.id;
      const nodes =
        mode === "brief"
          ? document.querySelectorAll<HTMLElement>(".org-brief .org-brief-sec")
          : document.querySelectorAll<HTMLElement>(".org-paper .paper-sec");
      groups.forEach((group, index) => {
        const element = nodes[index];
        if (element && element.getBoundingClientRect().top <= 166) current = group.section.id;
      });
      setActiveSection((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(compute);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    compute();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [groups, mode]);

  function markSaving(qid: number, kind: string | null) {
    setSavingMap((prev) => {
      const next = { ...prev };
      if (kind) next[qid] = kind;
      else delete next[qid];
      return next;
    });
  }

  async function refreshQuestionViews() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["set", sid] }),
      qc.invalidateQueries({ queryKey: ["bank"] }),
      qc.invalidateQueries({ queryKey: ["sets"] }),
      qc.invalidateQueries({ queryKey: ["tags"] }),
      qc.invalidateQueries({ queryKey: ["folders"] }),
    ]);
  }

  async function handleScoreApplied() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["set", sid] }),
      qc.invalidateQueries({ queryKey: ["sets"] }),
      qc.invalidateQueries({ queryKey: ["records"] }),
    ]);
  }

  async function saveSetTags(next: string[]) {
    const prevOverride = setTagsOverride;
    setSetTagsOverride(next);
    setSetSaving(true);
    try {
      await api.updateSetTags(sid, next);
      await refreshQuestionViews();
      toast.success("试卷标签已保存");
    } catch (e) {
      setSetTagsOverride(prevOverride);
      toast.error("试卷标签保存失败：" + errText(e));
      throw e;
    } finally {
      setSetSaving(false);
    }
  }

  async function saveFolder(next: string) {
    const prev = folderValue;
    setFolderValue(next);
    setFolderBusy(true);
    try {
      await api.assignFolder({ setId: sid, folderId: next ? Number(next) : null });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["set", sid] }),
        qc.invalidateQueries({ queryKey: ["sets"] }),
        qc.invalidateQueries({ queryKey: ["folders"] }),
      ]);
      const folder = folderList.find((item) => String(item.id) === next);
      toast.success(folder ? "已归入「" + folder.name + "」" : "已移出文件夹");
    } catch (e) {
      setFolderValue(prev);
      toast.error("文件夹保存失败：" + errText(e));
    } finally {
      setFolderBusy(false);
    }
  }

  async function saveQuestionTags(q: Question, tags: string[]) {
    markSaving(q.id, "tags");
    try {
      await api.updateQuestion(q.id, undefined, tags);
      await refreshQuestionViews();
      toast.success("第 " + shortNo(q) + " 题 · 标签已保存");
    } catch (e) {
      toast.error("标签保存失败：" + errText(e));
      throw e;
    } finally {
      markSaving(q.id, null);
    }
  }

  async function saveQuestionType(q: Question, qtype: QType) {
    markSaving(q.id, "qtype");
    try {
      await api.updateQuestion(q.id, qtype, undefined);
      await refreshQuestionViews();
      toast.success("第 " + shortNo(q) + " 题 · 题型已改为" + qtypeLabel(qtype));
    } catch (e) {
      toast.error("题型保存失败：" + errText(e));
      throw e;
    } finally {
      markSaving(q.id, null);
    }
  }

  async function saveQuestionStem(q: Question, stem: string) {
    markSaving(q.id, "stem");
    try {
      await api.updateQuestion(q.id, undefined, undefined, stem);
      await refreshQuestionViews();
      toast.success("第 " + shortNo(q) + " 题 · 题图已保存");
    } catch (e) {
      toast.error("题图保存失败：" + errText(e));
      throw e;
    } finally {
      markSaving(q.id, null);
    }
  }

  async function collectQuestion(q: Question) {
    markSaving(q.id, "collect");
    try {
      await api.collectMistakes([q.id], "answers");
      void qc.invalidateQueries({ queryKey: ["mistakes"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      toast.success("第 " + shortNo(q) + " 题已加入错题本");
    } catch (e) {
      toast.error("加入错题本失败：" + errText(e));
      throw e;
    } finally {
      markSaving(q.id, null);
    }
  }

  async function collectSelected() {
    const ids = allQuestions.filter((q) => selectedIds.has(q.id)).map((q) => q.id);
    if (!ids.length) return;
    setCollecting(true);
    try {
      await api.collectMistakes(ids, "answers");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["mistakes"] }),
        qc.invalidateQueries({ queryKey: ["stats"] }),
      ]);
      setSelectedIds(new Set());
      toast.success("已把 " + ids.length + " 道题写入错题本");
    } catch (e) {
      toast.error("批量写入错题本失败：" + errText(e));
    } finally {
      setCollecting(false);
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSectionSelect(sectionId: number) {
    const questions = groups.find((group) => group.section.id === sectionId)?.questions ?? [];
    const all = questions.length > 0 && questions.every((q) => selectedIds.has(q.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const q of questions) {
        if (all) next.delete(q.id);
        else next.add(q.id);
      }
      return next;
    });
  }

  function focusQuestionRow(q: Question) {
    const key = mode + "-" + q.id;
    scrolledRef.current = key;
    setActiveSection(q.section_id);
    setFlashId(q.id);
    if (mode === "brief") {
      setExpandedIds((prev) => {
        if (prev.has(q.id)) return prev;
        const next = new Set(prev);
        next.add(q.id);
        return next;
      });
    }
    if (focusTimer.current) window.clearTimeout(focusTimer.current);
    focusTimer.current = window.setTimeout(() => setFlashId(null), 1500);
    const nextParams = new URLSearchParams(params);
    nextParams.set("q", String(q.id));
    setParams(nextParams, { replace: true });
    window.setTimeout(() => {
      const element = questionElement(q.id, mode);
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 40);
  }

  function jumpToSection(sectionId: number) {
    setActiveSection(sectionId);
    const index = groups.findIndex((group) => group.section.id === sectionId);
    if (index < 0) return;
    const nodes =
      mode === "brief"
        ? document.querySelectorAll<HTMLElement>(".org-brief .org-brief-sec")
        : document.querySelectorAll<HTMLElement>(".org-paper .paper-sec");
    const element = nodes[index];
    if (!element) return;
    const offset = window.innerWidth <= 920 ? 118 : 142;
    window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - offset, behavior: "smooth" });
  }

  function clearFocus() {
    scrolledRef.current = "";
    setFlashId(null);
    if (focusTimer.current) {
      window.clearTimeout(focusTimer.current);
      focusTimer.current = null;
    }
    const next = new URLSearchParams(params);
    next.delete("q");
    setParams(next, { replace: true });
  }

  function switchMode(next: ViewMode) {
    if (next === mode) return;
    setMode(next);
    scrolledRef.current = "";
  }

  if (setQ.isLoading) {
    return (
      <main className="page org-page">
        <div className="empty">正在载入试卷…</div>
      </main>
    );
  }

  if (setQ.isError) {
    return (
      <main className="page org-page">
        <div className="empty">
          <div>试卷载入失败：{errText(setQ.error)}</div>
          <button type="button" className="btn btn-primary btn-sm org-error-act" onClick={() => nav("/bank")}>
            返回题库
          </button>
        </div>
      </main>
    );
  }

  if (!setQ.data) {
    return (
      <main className="page org-page">
        <div className="empty">
          <div>没有找到这份试卷。</div>
          <button type="button" className="btn btn-primary btn-sm org-error-act" onClick={() => nav("/bank")}>
            返回题库
          </button>
        </div>
      </main>
    );
  }

  const data = setQ.data;
  const folderHint = folderBusy
    ? "正在保存文件夹…"
    : currentFolder
      ? "已归入「" + currentFolder.name + "」，该文件夹共 " + currentFolder.setCount + " 份试卷。"
      : folderValue
        ? "已归入所选文件夹。"
        : "未归入文件夹；可在题库左侧按文件夹筛选。";

  return (
    <main className="page org-page">
      <div className="org-crumb no-print">
        <button type="button" className="org-back" onClick={() => nav("/bank")}>
          <ArrowLeft size={14} /> 返回题库
        </button>
        <span className="org-crumb-sep">/</span>
        <span className="org-crumb-here">速查与整理</span>
        <span className="org-crumb-set" title={data.title}>
          {data.title}
        </span>
      </div>

      <div className="page-head org-page-head">
        <div>
          <h1>速查与整理</h1>
          <div className="sub">
            共 {data.question_count} 题 · {groups.length} 个分区 · {data.total_points} 分
            {data.duration_minutes ? " · 建议 " + data.duration_minutes + " 分钟" : ""}
          </div>
        </div>
        <div className="acts no-print">
          <div className="org-viewtoggle" role="group" aria-label="显示方式">
            <button
              type="button"
              className={"org-viewtoggle-btn" + (mode === "detailed" ? " is-on" : "")}
              aria-pressed={mode === "detailed"}
              onClick={() => switchMode("detailed")}
              title="按原卷排版查看，答案附在每题下方"
            >
              <Columns3 size={14} /> 详细
            </button>
            <button
              type="button"
              className={"org-viewtoggle-btn" + (mode === "brief" ? " is-on" : "")}
              aria-pressed={mode === "brief"}
              onClick={() => switchMode("brief")}
              title="只列题号与题干，点开再看答案"
            >
              <Rows3 size={14} /> 简要
            </button>
          </div>
          <button type="button" className="btn" onClick={() => setAutoFiguresOpen(true)} disabled={!data.questions.length}>
            <ScanSearch size={15} /> 自动分图
          </button>
          <button type="button" className="btn" onClick={() => window.print()}>
            <Printer size={15} /> 打印
          </button>
          <button type="button" className="btn btn-primary" onClick={() => nav("/sets/" + data.id + "/exam")}>
            <Play size={15} /> 整卷练习
          </button>
        </div>
      </div>

      <section className="org-overview panel" aria-labelledby="org-ov-title">
        <div className="org-ov-main">
          <div className="eyebrow">当前试卷</div>
          <h2 className="org-ov-title" id="org-ov-title">
            {data.title}
          </h2>
          {data.subtitle ? <div className="org-ov-sub">{data.subtitle}</div> : null}
          {data.description ? <p className="org-ov-desc">{data.description}</p> : null}
          <div className="org-stats">
            <div className="org-stat">
              <b>{data.question_count}</b>
              <span>题目</span>
            </div>
            <div className="org-stat">
              <b>{groups.length}</b>
              <span>分区</span>
            </div>
            <div className="org-stat">
              <b>{data.total_points}</b>
              <span>满分</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm org-score-open"
                style={{ marginLeft: 2, padding: "0 7px", fontSize: 11.5, whiteSpace: "nowrap" }}
                onClick={() => setScorePlanOpen(true)}
                title="按目标总分让 AI 重新分配每题分值"
                aria-haspopup="dialog"
              >
                <Sparkles size={12} /> 重新分配
              </button>
            </div>
            <div className="org-stat">
              <b>{data.duration_minutes ?? "—"}</b>
              <span>建议分钟</span>
            </div>
          </div>
        </div>
        <div className="org-ov-side">
          <div className="org-ov-field">
            <div className="org-ov-label">试卷标签</div>
            <TagEditor tags={setTags} onSave={saveSetTags} busy={setSaving} large tagMap={tagMap} />
            <div className="org-ov-hint">回车添加，点 × 删除；保存后可在题库按标签筛选。</div>
          </div>
          <div className="org-ov-field">
            <label className="org-ov-label" htmlFor="org-folder-select">
              文件夹
            </label>
            <div className="org-folder-wrap">
              <FolderIcon size={15} className="org-folder-ico" aria-hidden="true" />
              <select
                id="org-folder-select"
                className="org-folder-select"
                value={folderValue}
                onChange={(e) => void saveFolder(e.target.value)}
                disabled={folderBusy || foldersQ.isLoading}
              >
                <option value="">未归类</option>
                {folderList.map((folder) => (
                  <option value={folder.id} key={folder.id}>
                    {"— ".repeat(folder.depth) + folder.name + "（" + folder.setCount + "）"}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="org-folder-arrow" aria-hidden="true" />
            </div>
            <div className="org-ov-hint">{folderHint}</div>
          </div>
        </div>
      </section>

      <div className="org-workspace">
        <aside className="org-selectrail no-print" aria-label="勾选题号">
          <div className="org-rail-head">
            <span className="org-rail-title">
              <ListChecks size={14} aria-hidden="true" /> 勾选题号
            </span>
            <span className="org-rail-count">
              {totalSelected}/{allQuestions.length}
            </span>
          </div>
          <div className="org-rail-body">
            {groups.map((group, index) => {
              const allSelected = group.questions.length > 0 && group.questions.every((q) => selectedIds.has(q.id));
              return (
                <div className="org-rail-group" key={group.section.id}>
                  <div className="org-rail-gtitle">
                    <span className="org-rail-gno">{String(index + 1).padStart(2, "0")}</span>
                    <span className="org-rail-gname" title={group.section.title}>
                      {sectionLabel(group.section)}
                    </span>
                    <button
                      type="button"
                      className="org-rail-all"
                      onClick={() => toggleSectionSelect(group.section.id)}
                      title={allSelected ? "取消本区勾选" : "勾选本区"}
                    >
                      {allSelected ? "取消" : "全选"}
                    </button>
                  </div>
                  <div className="org-rail-nums">
                    {group.questions.map((q) => {
                      const on = selectedIds.has(q.id);
                      return (
                        <button
                          type="button"
                          className={"org-rail-num" + (on ? " is-on" : "")}
                          key={q.id}
                          aria-pressed={on}
                          aria-label={"第 " + shortNo(q) + " 题" + (on ? "，已勾选" : "")}
                          title={"勾选第 " + shortNo(q) + " 题"}
                          onClick={() => toggleSelect(q.id)}
                        >
                          {shortNo(q)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="org-rail-foot">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setSelectedIds(new Set())}
              disabled={!totalSelected || collecting}
            >
              <Minus size={13} /> 清空
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void collectSelected()}
              disabled={!totalSelected || collecting}
            >
              <BookmarkPlus size={13} /> {collecting ? "写入中…" : "写错题本" + (totalSelected ? "（" + totalSelected + "）" : "")}
            </button>
          </div>
        </aside>

        <div className="org-content">
          <nav className="org-index no-print" aria-label="分区速览">
            <div className="org-index-inner">
              <div className="org-index-list">
                {groups.map((group, index) => {
                  const isOn = activeSection === group.section.id;
                  return (
                    <button
                      type="button"
                      className={"org-index-btn" + (isOn ? " is-on" : "")}
                      key={group.section.id}
                      onClick={() => jumpToSection(group.section.id)}
                      aria-current={isOn ? "true" : undefined}
                    >
                      <span className="org-index-no">{String(index + 1).padStart(2, "0")}</span>
                      <span className="org-index-name">{sectionLabel(group.section)}</span>
                      <span className="org-index-count">{group.questions.length}</span>
                    </button>
                  );
                })}
              </div>
              <div className="org-index-side">
                {focusQuestion ? (
                  <>
                    <span className="org-focus-dot" aria-hidden="true" />
                    <span>已定位第 {shortNo(focusQuestion)} 题</span>
                    <button type="button" className="org-link" onClick={clearFocus}>
                      清除
                    </button>
                  </>
                ) : (
                  <span>{mode === "detailed" ? "原卷与答案" : "题目速览"}</span>
                )}
              </div>
            </div>
          </nav>

          {mode === "detailed" ? (
            <section className="org-paper" aria-label="原卷与答案" style={paperCssVars(paperStyle)}>
              <PaperDoc
                groups={paperGroups}
                materials={materialMap}
                showAnswer
                currentId={deepQid || null}
                flashId={flashId}
                selectedIds={selectedIds}
                renderQuestion={(q) => (
                  <PaperQuestion
                    q={q}
                    current={deepQid === q.id}
                    flash={flashId === q.id}
                    selected={selectedIds.has(q.id)}
                    showAnswer
                    answer={<AnswerNote q={q} />}
                    action={
                      <div className="org-q-tools no-print">
                        <SelectButton
                          selected={selectedIds.has(q.id)}
                          onToggle={() => toggleSelect(q.id)}
                          label="勾选题目"
                        />
                        <label className="org-type-wrap" title="修改题型">
                          <ListFilter size={12} className="org-type-ico" aria-hidden="true" />
                          <QTypeSelect
                            q={q}
                            disabled={Boolean(savingMap[q.id])}
                            onSave={(qtype) => saveQuestionType(q, qtype)}
                          />
                          <ChevronDown size={12} className="org-type-arrow" aria-hidden="true" />
                        </label>
                      </div>
                    }
                    footer={
                      <QuestionFooter
                        q={q}
                        tagMap={tagMap}
                        saving={savingMap[q.id]}
                        onSaveTags={(tags) => saveQuestionTags(q, tags)}
                        onAddImage={(stem) => saveQuestionStem(q, stem)}
                        onCollect={() => collectQuestion(q)}
                      />
                    }
                  />
                )}
                renderMergedAnswer={(q) => (
                  <MergedAnswer
                    q={q}
                    flash={flashId === q.id}
                    selected={selectedIds.has(q.id)}
                    tagMap={tagMap}
                    saving={savingMap[q.id]}
                    onToggleSelect={() => toggleSelect(q.id)}
                    onSaveTags={(tags) => saveQuestionTags(q, tags)}
                    onSaveType={(qtype) => saveQuestionType(q, qtype)}
                    onAddImage={(stem) => saveQuestionStem(q, stem)}
                    onCollect={() => collectQuestion(q)}
                  />
                )}
              />
            </section>
          ) : (
            <div className="org-brief">
              {groups.map((group, index) => (
                <section className="org-brief-sec" id={"org-sec-" + group.section.id} key={group.section.id}>
                  <header className="org-brief-head">
                    <span className="org-brief-no">{String(index + 1).padStart(2, "0")}</span>
                    <div className="org-brief-titlewrap">
                      <h2>{group.section.title}</h2>
                      {group.section.instructions ? <p>{group.section.instructions}</p> : null}
                    </div>
                    <div className="org-brief-meta">
                      <span className="pill-count">{group.questions.length} 题</span>
                      <span>{group.points} 分</span>
                      {group.section.duration_minutes ? <span>{group.section.duration_minutes} 分钟</span> : null}
                    </div>
                  </header>
                  <div className="org-brief-list">
                    {group.questions.map((q) => (
                      <BriefRow
                        key={q.id}
                        q={q}
                        tagMap={tagMap}
                        expanded={expandedIds.has(q.id)}
                        selected={selectedIds.has(q.id)}
                        flash={flashId === q.id}
                        saving={savingMap[q.id]}
                        onToggleExpand={() => {
                          setExpandedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(q.id)) next.delete(q.id);
                            else next.add(q.id);
                            return next;
                          });
                        }}
                        onFocus={() => focusQuestionRow(q)}
                        onToggleSelect={() => toggleSelect(q.id)}
                        onSaveTags={(tags) => saveQuestionTags(q, tags)}
                        onSaveType={(qtype) => saveQuestionType(q, qtype)}
                        onAddImage={(stem) => saveQuestionStem(q, stem)}
                        onCollect={() => collectQuestion(q)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          <footer className="org-footer">
            <span>{data.title}</span>
            <span>
              共 {data.question_count} 题 · 答案与解析仅供参考
              {mode === "detailed" ? " · 原卷模式" : " · 简要模式"}
            </span>
          </footer>
        </div>
      </div>

      <ScorePlanDialog
        open={scorePlanOpen}
        onClose={() => setScorePlanOpen(false)}
        setId={data.id}
        currentTotal={data.total_points}
        onApplied={handleScoreApplied}
      />

      <AutoFigures
        open={autoFiguresOpen}
        onClose={() => setAutoFiguresOpen(false)}
        questions={data.questions}
        onApplied={refreshQuestionViews}
      />
    </main>
  );
}

function SelectButton({ selected, onToggle, label }: { selected: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      className={"org-check" + (selected ? " is-on" : "")}
      onClick={onToggle}
      aria-pressed={selected}
      aria-label={label}
      title={selected ? "取消勾选" : "勾选"}
    >
      {selected ? <CheckSquare size={15} /> : <Square size={15} />}
    </button>
  );
}

function QTypeSelect({ q, disabled, onSave }: { q: Question; disabled: boolean; onSave: (qtype: QType) => Promise<void> }) {
  const [value, setValue] = useState<QType>(q.qtype);

  useEffect(() => {
    setValue(q.qtype);
  }, [q.qtype]);

  async function change(next: QType) {
    const prev = value;
    setValue(next);
    try {
      await onSave(next);
    } catch {
      setValue(prev);
    }
  }

  return (
    <select
      className="org-type-select"
      value={value}
      disabled={disabled}
      onChange={(e) => void change(e.target.value as QType)}
      aria-label="修改题型"
    >
      {(Object.keys(QTYPE_LABEL) as QType[]).map((qtype) => (
        <option value={qtype} key={qtype}>
          {QTYPE_LABEL[qtype]}
        </option>
      ))}
    </select>
  );
}

function ImageButton({
  stem,
  disabled,
  onAdd,
}: {
  stem: string;
  disabled: boolean;
  onAdd: (stem: string) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <button
        type="button"
        className="org-q-image"
        onClick={() => fileRef.current?.click()}
        disabled={disabled}
        aria-label="添加题图"
        title="添加题图（截图或图片会压到合适尺寸后存进本题）"
      >
        <ImagePlus size={15} />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="org-q-file"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          void (async () => {
            try {
              const dataUrl = await imageToDataUrl(file);
              const figure = '<figure class="q-figure"><img src="' + dataUrl + '" alt="题图" /></figure>';
              const base = stem.trimEnd();
              await onAdd(base + (base ? "\n" : "") + figure);
            } catch (e) {
              toast.error("题图处理失败：" + errText(e));
            }
          })();
        }}
      />
    </>
  );
}

function CollectButton({ disabled, onCollect }: { disabled: boolean; onCollect: () => Promise<void> }) {
  const [collected, setCollected] = useState(false);
  return (
    <button
      type="button"
      className={"org-q-collect" + (collected ? " is-on" : "")}
      onClick={() => {
        void (async () => {
          try {
            await onCollect();
            setCollected(true);
          } catch {
            /* 错误提示已在上层处理 */
          }
        })();
      }}
      disabled={disabled}
      aria-pressed={collected}
      aria-label={collected ? "已加入错题本" : "加入错题本"}
      title={collected ? "已加入错题本" : "加入错题本"}
    >
      {collected ? <Check size={15} /> : <BookmarkPlus size={15} />}
    </button>
  );
}

function TagEditor({
  tags,
  onSave,
  busy,
  compact,
  large,
  tagMap,
  autoClose = true,
}: {
  tags: string[];
  onSave: (next: string[]) => Promise<void>;
  busy?: boolean;
  compact?: boolean;
  large?: boolean;
  tagMap?: TagMap;
  autoClose?: boolean;
}) {
  const [draft, setDraft] = useState<string[]>(tags);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(tags);
  }, [tags]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const disabled = Boolean(busy) || saving;

  async function persist(next: string[]): Promise<boolean> {
    const prev = draft;
    setDraft(next);
    setSaving(true);
    try {
      await onSave(next);
      return true;
    } catch {
      setDraft(prev);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function addTag() {
    const value = text.trim().replace(/\s+/g, " ");
    if (!value) {
      setOpen(false);
      return;
    }
    if (value.length > 24) {
      toast.error("标签最多 24 个字符");
      return;
    }
    if (draft.includes(value)) {
      toast.message("这个标签已经存在");
      setText("");
      return;
    }
    if (await persist([...draft, value])) {
      setText("");
      if (autoClose) setOpen(false);
    }
  }

  function removeTag(tag: string) {
    if (disabled) return;
    void persist(draft.filter((item) => item !== tag));
  }

  return (
    <span className={"org-tags" + (compact ? " is-compact" : "") + (large ? " is-large" : "")}>
      {draft.map((tag) => (
        <span className="org-tag" key={tag} data-color={tagMap?.get(tag)?.group_color || undefined}>
          <span className="org-tag-text">{tag}</span>
          <button
            type="button"
            className="org-tag-x no-print"
            onClick={() => removeTag(tag)}
            disabled={disabled}
            aria-label={"删除标签 " + tag}
            title={"删除标签 " + tag}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      {open ? (
        <span className="org-tag-editor">
          <input
            ref={inputRef}
            className="org-tag-input"
            value={text}
            maxLength={24}
            placeholder={compact ? "新标签" : "输入标签，回车添加"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addTag();
              } else if (e.key === "Escape") {
                setOpen(false);
                setText("");
              }
            }}
            aria-label="新标签名称"
          />
          <button type="button" className="org-tag-confirm" onClick={() => void addTag()} disabled={disabled} aria-label="确认添加标签">
            <Check size={12} />
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="org-tag-add no-print"
          onClick={() => setOpen(true)}
          disabled={disabled}
          aria-label="添加标签"
        >
          <Plus size={11} />
          <span>{large ? "添加标签" : "标签"}</span>
        </button>
      )}
      {saving || busy ? (
        <span className="org-tag-state" role="status">
          保存中…
        </span>
      ) : null}
    </span>
  );
}

function TagStrip({
  q,
  tagMap,
  saving,
  onSaveTags,
  compact,
}: {
  q: Question;
  tagMap: TagMap;
  saving?: string;
  onSaveTags: (tags: string[]) => Promise<void>;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const busy = saving === "tags";
  return (
    <div className={"org-tagstrip" + (compact ? " is-compact" : "")}>
      {editing ? (
        <div className="org-tagstrip-edit">
          <TagEditor tags={q.tags} onSave={onSaveTags} busy={busy} compact tagMap={tagMap} autoClose={false} />
          <button type="button" className="org-tagstrip-done no-print" onClick={() => setEditing(false)}>
            完成
          </button>
        </div>
      ) : (
        <>
          <TagChips tags={q.tags} tagMap={tagMap} mode={compact ? "plain" : "grouped"} max={compact ? 2 : 6} />
          <button
            type="button"
            className="org-tagstrip-editbtn no-print"
            onClick={() => setEditing(true)}
            aria-label="编辑题目标签"
            title="编辑题目标签"
          >
            <Tag size={11} />
            <span>标签</span>
          </button>
        </>
      )}
      {busy ? (
        <span className="org-tag-state" role="status">
          保存中…
        </span>
      ) : null}
    </div>
  );
}

function QuestionFooter({
  q,
  tagMap,
  saving,
  onSaveTags,
  onAddImage,
  onCollect,
}: {
  q: Question;
  tagMap: TagMap;
  saving?: string;
  onSaveTags: (tags: string[]) => Promise<void>;
  onAddImage: (stem: string) => Promise<void>;
  onCollect: () => Promise<void>;
}) {
  return (
    <>
      <TagStrip q={q} tagMap={tagMap} saving={saving} onSaveTags={onSaveTags} />
      <span className="org-q-foot-actions no-print">
        <ImageButton stem={q.stem} disabled={Boolean(saving)} onAdd={onAddImage} />
        <CollectButton disabled={Boolean(saving)} onCollect={onCollect} />
      </span>
    </>
  );
}

function AnswerNote({ q }: { q: Question }) {
  const info = answerInfo(q);
  const longRef = info.subjective && info.correct.length > 260;
  return (
    <div className="org-ansnote">
      <div className="org-ansnote-head">
        <span>{info.label}</span>
        <span className="org-ansnote-type">{qtypeLabel(q.qtype)}</span>
      </div>
      {longRef ? (
        <details className="org-ansnote-ref">
          <summary>展开参考文本</summary>
          <div className="org-ansnote-value">{info.correct}</div>
        </details>
      ) : (
        <div className={info.subjective ? "org-ansnote-value is-ref" : "org-ansnote-value"}>{info.correct}</div>
      )}
      {info.accept ? (
        <div className="org-ansnote-accept">
          <span>也可接受</span>
          <span>{info.accept}</span>
        </div>
      ) : null}
      {info.referenceExtra ? (
        <details className="org-ansnote-ref">
          <summary>参考文本</summary>
          <div className="org-ansnote-value">{info.referenceExtra}</div>
        </details>
      ) : null}
      {q.explanation ? (
        <div className="org-ansnote-explain">
          <span className="org-ansnote-explain-label">解析</span>
          <span>{q.explanation}</span>
        </div>
      ) : null}
    </div>
  );
}

function ScorePlanDialog({
  open,
  onClose,
  setId,
  currentTotal,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  setId: number;
  currentTotal: number;
  onApplied: () => Promise<void>;
}) {
  const [total, setTotal] = useState(String(currentTotal > 0 ? currentTotal : 100));
  const [instructions, setInstructions] = useState("");
  const [plan, setPlan] = useState<ScorePlanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setTotal(String(currentTotal > 0 ? currentTotal : 100));
    setInstructions("");
    setPlan(null);
    setBusy(false);
    setApplying(false);
    setError("");
  }, [open, currentTotal]);

  const locked = busy || applying;

  function changeTotal(value: string) {
    setTotal(value);
    setPlan(null);
    setError("");
  }

  function changeInstructions(value: string) {
    setInstructions(value);
    setPlan(null);
    setError("");
  }

  async function generate() {
    if (!total.trim()) {
      setError("请填写目标总分。");
      return;
    }
    const target = Number(total);
    if (!Number.isInteger(target) || target < 1 || target > 10000) {
      setError("目标总分需要是 1 到 10000 之间的整数。");
      return;
    }
    setBusy(true);
    setError("");
    setPlan(null);
    try {
      const result = await api.aiPlanScores(setId, target, instructions.trim() || undefined);
      setPlan(result);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!plan) return;
    setApplying(true);
    setError("");
    try {
      const summary = await api.applyScorePlan(setId, plan.items);
      await onApplied();
      toast.success("分值已更新，共 " + summary.total_points + " 分");
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setApplying(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!locked) onClose();
      }}
      title="重新分配分值"
      width={720}
    >
      <div style={{ display: "grid", gap: 14 }}>
        <p className="small muted" style={{ margin: 0, lineHeight: 1.75 }}>
          让 AI 按目标总分重排每题分值。确认应用后会改写这份试卷的题目分值，并按新分值重算进行中的练习。
        </p>

        <div className="field">
          <label htmlFor="org-score-total">目标总分</label>
          <input
            id="org-score-total"
            className="input"
            type="number"
            min={1}
            max={10000}
            step={1}
            value={total}
            disabled={locked}
            onChange={(e) => changeTotal(e.target.value)}
          />
          <div className="small muted">可填 1–10000；AI 会按题型和题量分配，所有题分值之和等于目标总分。</div>
        </div>

        <div className="field">
          <label htmlFor="org-score-instr">分配要求（可选）</label>
          <textarea
            id="org-score-instr"
            className="textarea"
            rows={3}
            style={{ minHeight: 78 }}
            placeholder="例如：选择题每题 5 分，解答题按步骤给分。"
            value={instructions}
            disabled={locked}
            onChange={(e) => changeInstructions(e.target.value)}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={() => void generate()} disabled={locked}>
            {busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
            {busy ? "分配中…" : "AI 分配"}
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={locked}>
            取消
          </button>
          {plan ? (
            <span className="small muted">
              目标 {plan.total} 分 · 已分配 {plan.allocated} 分 · 模型 {plan.model || "—"}
            </span>
          ) : null}
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              border: "1px solid color-mix(in srgb, var(--bad) 30%, var(--line))",
              background: "color-mix(in srgb, var(--bad) 8%, var(--surface))",
              color: "var(--bad)",
              borderRadius: 10,
              padding: "9px 12px",
              fontSize: 12.5,
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
            }}
          >
            {error}
          </div>
        ) : null}

        {plan ? (
          <div>
            {plan.note ? (
              <div className="small muted" style={{ lineHeight: 1.7 }}>
                {plan.note}
              </div>
            ) : null}
            <div
              style={{
                maxHeight: 280,
                overflow: "auto",
                border: "1px solid var(--line)",
                borderRadius: 10,
                marginTop: 8,
              }}
            >
              {plan.items.map((item) => (
                <div
                  key={item.number}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "58px 64px minmax(0, 1fr)",
                    gap: 10,
                    alignItems: "baseline",
                    padding: "8px 12px",
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <span className="small muted">第 {item.number} 题</span>
                  <b style={{ fontVariantNumeric: "tabular-nums" }}>{item.points} 分</b>
                  <span className="small muted">{item.reason || "—"}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
              <button type="button" className="btn btn-primary" onClick={() => void apply()} disabled={locked}>
                {applying ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
                {applying ? "应用中…" : "应用分值"}
              </button>
              <span className="small muted">应用后会改写题目分值，并按新分值重算进行中的练习。</span>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function AnswerPanel({ q }: { q: Question }) {
  const info = answerInfo(q);
  return (
    <div className={"org-qa" + (!q.explanation ? " is-solo" : "")}>
      <section className={"org-answer" + (info.subjective ? " is-ref" : "")} aria-label={info.label}>
        <div className="org-ans-head">
          <span className="org-ans-label">{info.label}</span>
          {!info.subjective ? <span className="org-ans-hint">{qtypeLabel(q.qtype)}</span> : null}
        </div>
        <div className={info.subjective ? "org-ref" : "org-ans-value"}>{info.correct}</div>
        {info.accept ? (
          <div className="org-accept">
            <span className="org-accept-k">也可接受</span>
            <span className="org-accept-v">{info.accept}</span>
          </div>
        ) : null}
        {info.referenceExtra ? (
          <details className="org-ref-extra">
            <summary>参考文本</summary>
            <div>{info.referenceExtra}</div>
          </details>
        ) : null}
      </section>
      {q.explanation ? (
        <section className="org-explain" aria-label="解析">
          <div className="org-ans-head">
            <span className="org-ans-label">解析</span>
          </div>
          <div className="org-explain-body">{q.explanation}</div>
        </section>
      ) : null}
    </div>
  );
}

function MergedAnswer({
  q,
  flash,
  selected,
  tagMap,
  saving,
  onToggleSelect,
  onSaveTags,
  onSaveType,
  onAddImage,
  onCollect,
}: {
  q: Question;
  flash: boolean;
  selected: boolean;
  tagMap: TagMap;
  saving?: string;
  onToggleSelect: () => void;
  onSaveTags: (tags: string[]) => Promise<void>;
  onSaveType: (qtype: QType) => Promise<void>;
  onAddImage: (stem: string) => Promise<void>;
  onCollect: () => Promise<void>;
}) {
  const info = answerInfo(q);
  const longRef = info.subjective && info.correct.length > 260;
  return (
    <div className={"org-merged" + (flash ? " focus-flash" : "")} id={"paper-qa-" + q.id}>
      <div className="org-merged-answer">
        <span className="org-merged-label">{info.label}</span>
        {longRef ? (
          <details className="org-merged-ref">
            <summary>展开{info.label}</summary>
            <div className="org-merged-value is-ref">{info.correct}</div>
          </details>
        ) : (
          <span className={info.subjective ? "org-merged-value is-ref" : "org-merged-value"}>{info.correct}</span>
        )}
        {info.accept ? (
          <span className="org-merged-accept">
            <span>也可接受</span>
            {info.accept}
          </span>
        ) : null}
        {info.referenceExtra ? (
          <details className="org-merged-ref">
            <summary>参考文本</summary>
            <div className="org-merged-value">{info.referenceExtra}</div>
          </details>
        ) : null}
        {q.explanation ? (
          <div className="org-merged-explain">
            <span>解析</span>
            <span>{q.explanation}</span>
          </div>
        ) : null}
      </div>
      <div className="org-merged-tools no-print">
        <SelectButton selected={selected} onToggle={onToggleSelect} label="勾选题目" />
        <label className="org-type-wrap" title="修改题型">
          <ListFilter size={12} className="org-type-ico" aria-hidden="true" />
          <QTypeSelect q={q} disabled={Boolean(saving)} onSave={onSaveType} />
          <ChevronDown size={12} className="org-type-arrow" aria-hidden="true" />
        </label>
        <TagStrip q={q} tagMap={tagMap} saving={saving} onSaveTags={onSaveTags} compact />
        <ImageButton stem={q.stem} disabled={Boolean(saving)} onAdd={onAddImage} />
        <CollectButton disabled={Boolean(saving)} onCollect={onCollect} />
      </div>
    </div>
  );
}

function BriefRow({
  q,
  tagMap,
  expanded,
  selected,
  flash,
  saving,
  onToggleExpand,
  onFocus,
  onToggleSelect,
  onSaveTags,
  onSaveType,
  onAddImage,
  onCollect,
}: {
  q: Question;
  tagMap: TagMap;
  expanded: boolean;
  selected: boolean;
  flash: boolean;
  saving?: string;
  onToggleExpand: () => void;
  onFocus: () => void;
  onToggleSelect: () => void;
  onSaveTags: (tags: string[]) => Promise<void>;
  onSaveType: (qtype: QType) => Promise<void>;
  onAddImage: (stem: string) => Promise<void>;
  onCollect: () => Promise<void>;
}) {
  const info = answerInfo(q);
  const showOptions = q.options.length > 0 && q.qtype !== "cloze";
  const stemLine = plainStem(q.stem) || "（查看材料与完整题干）";
  return (
    <article
      className={"org-brow" + (expanded ? " is-open" : "") + (flash ? " focus-flash" : "")}
      id={"org-q-" + q.id}
    >
      <div className="org-brow-main" onClick={onToggleExpand}>
        <button
          type="button"
          className={"org-check" + (selected ? " is-on" : "")}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          aria-pressed={selected}
          aria-label={selected ? "取消勾选第 " + shortNo(q) + " 题" : "勾选第 " + shortNo(q) + " 题"}
          title={selected ? "取消勾选" : "勾选"}
        >
          {selected ? <CheckSquare size={15} /> : <Square size={15} />}
        </button>
        <button
          type="button"
          className="org-brow-no"
          onClick={(e) => {
            e.stopPropagation();
            onFocus();
          }}
          title="定位并高亮本题"
          aria-label={"定位第 " + shortNo(q) + " 题"}
        >
          {shortNo(q)}
        </button>
        <span className="org-brow-kind">{qtypeLabel(q.qtype)}</span>
        <span className="org-brow-stem" title={stemLine}>
          {stemLine}
        </span>
        <span className="org-brow-tags">
          <TagChips tags={q.tags} tagMap={tagMap} mode="plain" max={3} />
        </span>
        <span className="org-brow-points">{q.points} 分</span>
        <button
          type="button"
          className="org-brow-chev"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          aria-expanded={expanded}
          aria-label={expanded ? "收起本题" : "展开本题"}
        >
          <ChevronDown size={15} />
        </button>
      </div>
      {expanded ? (
        <div className="org-brow-detail">
          <div className="org-brow-fullstem" dangerouslySetInnerHTML={{ __html: richStemHtml(q.stem) }} />
          {showOptions ? (
            <div className="org-opts">
              {q.options.map((option) => {
                const isCorrect = info.keys.has(option.key);
                return (
                  <div className={"org-opt" + (isCorrect ? " is-correct" : "")} key={option.key}>
                    <span className="org-opt-k">{option.key}</span>
                    <span className="org-opt-t">{option.text}</span>
                    {isCorrect ? <Check size={14} className="org-opt-check" aria-hidden="true" /> : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          <AnswerPanel q={q} />
          <div className="org-brow-tools no-print">
            <label className="org-type-wrap" title="修改题型">
              <ListFilter size={12} className="org-type-ico" aria-hidden="true" />
              <QTypeSelect q={q} disabled={Boolean(saving)} onSave={onSaveType} />
              <ChevronDown size={12} className="org-type-arrow" aria-hidden="true" />
            </label>
            <ImageButton stem={q.stem} disabled={Boolean(saving)} onAdd={onAddImage} />
            <CollectButton disabled={Boolean(saving)} onCollect={onCollect} />
          </div>
          <TagStrip q={q} tagMap={tagMap} saving={saving} onSaveTags={onSaveTags} />
        </div>
      ) : null}
    </article>
  );
}
