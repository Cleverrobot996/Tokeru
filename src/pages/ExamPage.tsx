import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  Clock3,
  Flag,
  Headphones,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Send,
  Type,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { qtypeLabel } from "../lib/labels";
import type { AttemptDetail, AttemptQuestion, Material, Question, Section } from "../lib/types";
import { Button, Modal } from "../components/ui";
import { PaperDoc, PaperQuestion, shortNo, shortSection, type PaperGroup } from "../components/PaperView";
import { PaperSettings } from "../components/PaperSettings";
import { ThemeMenu } from "../components/ThemeMenu";
import { loadPaperStyle, paperCssVars, savePaperStyle, type PaperStyle } from "../lib/paper";

const LAYOUT_KEY = "tokero.exam.layout.v1";
const LEFT_MIN = 176;
const LEFT_MAX = 380;
const RIGHT_MIN = 240;
const RIGHT_MAX = 500;
const PAPER_MIN = 340;
const HANDLE = 6;

type Layout = { left: number; right: number; showLeft: boolean; showRight: boolean };
type SaveState = "idle" | "saving" | "saved" | "error";
type Side = "left" | "right";

const DEFAULT_LAYOUT: Layout = { left: 240, right: 340, showLeft: true, showRight: true };
const DEFAULT_PRESETS = [30, 60, 90, 130];

export default function ExamPage() {
  const nav = useNavigate();
  const { setId, attemptId: directId } = useParams();
  const [attemptId, setAttemptId] = useState<number | null>(directId ? Number(directId) : null);
  const [error, setError] = useState<string | null>(null);
  const creating = useRef(false);

  useEffect(() => {
    if (directId) {
      setAttemptId(Number(directId));
      return;
    }
    if (!setId) {
      setError("缺少试卷编号");
      return;
    }
    if (creating.current) return;
    creating.current = true;
    const sid = Number(setId);
    api
      .resumeAttempt(sid, "exam")
      .then((existing) => (existing ? existing : api.createAttempt({ setId: sid, mode: "exam", timeLimit: 0 })))
      .then((id) => {
        setAttemptId(id);
        nav("/exam/" + id, { replace: true });
      })
      .catch((e) => setError(String(e)));
  }, [setId, directId, nav]);

  if (error) {
    return (
      <div className="exam-fallback">
        <div className="empty">创建整卷失败：{error}</div>
      </div>
    );
  }
  if (!attemptId) {
    return (
      <div className="exam-fallback">
        <div className="empty">正在准备整卷…</div>
      </div>
    );
  }
  return <Workspace attemptId={attemptId} />;
}

function Workspace({ attemptId }: { attemptId: number }) {
  const nav = useNavigate();
  const marksKey = "tokero.exam.marks." + attemptId;
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const answersRef = useRef<Record<number, string>>({});
  const pending = useRef(new Map<number, string>());
  const saveTimer = useRef<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [audioSrc, setAudioSrc] = useState("");
  const [audioBroken, setAudioBroken] = useState(false);
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [marks, setMarks] = useState<Set<number>>(() => loadMarks(marksKey));
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [paperFlash, setPaperFlash] = useState<number | null>(null);
  const [sheetFlash, setSheetFlash] = useState<number | null>(null);
  const paperFlashTimer = useRef<number | null>(null);
  const sheetFlashTimer = useRef<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const autoSubmitted = useRef(false);
  const [presets, setPresets] = useState<number[]>(DEFAULT_PRESETS);
  const [timerOpen, setTimerOpen] = useState(false);
  const [customMin, setCustomMin] = useState("");
  const [paperStyle, setPaperStyle] = useState<PaperStyle>(() => loadPaperStyle());
  const [paperOpen, setPaperOpen] = useState(false);
  const timerWrap = useRef<HTMLDivElement | null>(null);
  const paperWrap = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const paperScrollRef = useRef<HTMLDivElement | null>(null);
  const spyTarget = useRef<number | null>(null);

  const groups = useMemo<PaperGroup[]>(() => {
    if (!attempt) return [];
    const paperSetId = attempt.set_id ?? attempt.questions[0]?.set_id ?? null;
    const sectionById = new Map<number, Section>();
    for (const s of attempt.sections) sectionById.set(s.id, s);
    const buckets = new Map<number, PaperGroup>();
    const main: PaperGroup[] = [];
    const extra: AttemptQuestion[] = [];
    for (const q of attempt.questions) {
      const sec = sectionById.get(q.section_id);
      const foreign = paperSetId != null && q.set_id !== paperSetId;
      if (foreign || !sec) {
        extra.push(q);
        continue;
      }
      let g = buckets.get(sec.id);
      if (!g) {
        g = { id: "sec-" + sec.id, title: sec.title, meta: "", section: sec, questions: [], supplementary: false };
        buckets.set(sec.id, g);
        main.push(g);
      }
      g.questions.push(q);
    }
    const order = (a: Question, b: Question) => a.position - b.position || a.number - b.number;
    main.sort((a, b) => (a.section ? a.section.position : 0) - (b.section ? b.section.position : 0));
    for (const g of main) {
      g.questions.sort(order);
      g.meta = g.questions.length + " 题 · " + pointsOf(g.questions) + " 分";
    }
    if (extra.length) {
      extra.sort(order);
      main.push({
        id: "supp",
        title: "补充练习",
        meta: extra.length + " 题 · 不属于本卷",
        section: null,
        questions: extra,
        supplementary: true,
      });
    }
    return main;
  }, [attempt]);

  const materialMap = useMemo(() => {
    const map = new Map<number, Material>();
    for (const m of attempt?.materials ?? []) map.set(m.id, m);
    return map;
  }, [attempt]);

  const total = attempt ? attempt.questions.length : 0;
  const answered = useMemo(() => {
    let n = 0;
    for (const q of attempt?.questions ?? []) if ((answers[q.id] ?? "").trim()) n += 1;
    return n;
  }, [attempt, answers]);
  const markedCount = marks.size;
  const unanswered = Math.max(0, total - answered);
  const paperPoints = useMemo(
    () => groups.filter((g) => !g.supplementary).reduce((sum, g) => sum + pointsOf(g.questions), 0),
    [groups],
  );

  const flushSaves = useCallback(
    async (silent = false): Promise<boolean> => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (!pending.current.size) return true;
      const batch = Array.from(pending.current.entries());
      pending.current.clear();
      if (!silent) setSaveState("saving");
      try {
        await Promise.all(batch.map(([qid, raw]) => api.saveAnswer(attemptId, qid, raw)));
        if (!silent) {
          setSaveState("saved");
          window.setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1800);
        }
        return true;
      } catch {
        for (const [qid, raw] of batch) if (!pending.current.has(qid)) pending.current.set(qid, raw);
        if (!silent) {
          setSaveState("error");
          toast.error("答案保存失败，请检查桌面服务");
        }
        return false;
      }
    },
    [attemptId],
  );

  const doSubmit = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    const saved = await flushSaves(true);
    if (!saved) {
      submittingRef.current = false;
      setSubmitting(false);
      toast.error("还有答案未保存，已取消交卷");
      return;
    }
    try {
      await api.submitAttempt(attemptId);
      toast.success("已交卷");
      nav("/attempts/" + attemptId, { replace: true });
    } catch (e) {
      submittingRef.current = false;
      setSubmitting(false);
      toast.error("交卷失败：" + String(e));
    }
  }, [attemptId, flushSaves, nav]);

  useEffect(() => {
    let alive = true;
    setAttempt(null);
    setLoadError(null);
    setAudioSrc("");
    setAudioBroken(false);
    api
      .getAttempt(attemptId)
      .then((a) => {
        if (!alive) return;
        const init: Record<number, string> = {};
        for (const q of a.questions) init[q.id] = q.answer_raw ?? "";
        answersRef.current = init;
        pending.current.clear();
        setAnswers(init);
        setAttempt(a);
        setRemaining(a.time_limit > 0 ? a.time_limit * 60 : null);
        const ordered = [...a.questions].sort((x, y) => x.number - y.number);
        setCurrentId(ordered[0] ? ordered[0].id : null);
      })
      .catch((e) => {
        if (alive) setLoadError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [attemptId]);

  useEffect(() => {
    const file = attempt?.set?.audio_file;
    if (!file) return;
    let alive = true;
    api
      .assetUrl(file)
      .then((url) => {
        if (alive) setAudioSrc(url);
      })
      .catch(() => {
        if (alive) setAudioBroken(true);
      });
    return () => {
      alive = false;
    };
  }, [attempt?.set?.audio_file]);

  useEffect(() => {
    let alive = true;
    api
      .getSettings()
      .then((s) => {
        if (!alive) return;
        const list = Array.isArray(s.timer_presets)
          ? s.timer_presets.filter((m) => Number.isFinite(m) && m > 0 && m <= 600)
          : DEFAULT_PRESETS;
        setPresets(Array.from(new Set(list)).sort((a, b) => a - b).slice(0, 8));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
      } catch {
        undefined;
      }
    }, 160);
    return () => window.clearTimeout(t);
  }, [layout]);

  useEffect(() => {
    try {
      localStorage.setItem(marksKey, JSON.stringify(Array.from(marks)));
    } catch {
      undefined;
    }
  }, [marks, marksKey]);

  useEffect(() => {
    const root = paperScrollRef.current;
    if (!root || !attempt) return;
    let frame = 0;
    const compute = () => {
      frame = 0;
      if (spyTarget.current != null) return;
      const cards = root.querySelectorAll<HTMLElement>("[data-paper-q]");
      if (!cards.length) return;
      const list = Array.from(cards);
      const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 6;
      const line = root.getBoundingClientRect().top + Math.min(170, root.clientHeight * 0.32);
      let best: HTMLElement | null = null;
      if (atBottom) best = list[list.length - 1];
      else
        for (const card of list) {
          const top = card.getBoundingClientRect().top;
          if (top <= line) best = card;
          else if (!best) {
            best = card;
            break;
          }
        }
      if (!best) return;
      const id = Number(best.getAttribute("data-paper-q"));
      if (Number.isFinite(id)) setCurrentId((prev) => (prev === id ? prev : id));
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(compute);
    };
    const onScrollEnd = () => {
      const held = spyTarget.current;
      spyTarget.current = null;
      if (held != null) setCurrentId((prev) => (prev === held ? prev : held));
    };
    const release = () => {
      spyTarget.current = null;
    };
    compute();
    root.addEventListener("scroll", onScroll, { passive: true });
    root.addEventListener("scrollend", onScrollEnd);
    root.addEventListener("wheel", release, { passive: true });
    root.addEventListener("pointerdown", release);
    root.addEventListener("touchstart", release, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      root.removeEventListener("scroll", onScroll);
      root.removeEventListener("scrollend", onScrollEnd);
      root.removeEventListener("wheel", release);
      root.removeEventListener("pointerdown", release);
      root.removeEventListener("touchstart", release);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [attempt]);

  const counting = remaining != null && remaining > 0;
  useEffect(() => {
    if (!counting) return;
    const t = window.setInterval(() => {
      setRemaining((v) => (v == null ? v : Math.max(0, v - 1)));
    }, 1000);
    return () => window.clearInterval(t);
  }, [counting]);

  useEffect(() => {
    if (remaining == null || remaining > 0) return;
    if (autoSubmitted.current) return;
    autoSubmitted.current = true;
    toast.message("倒计时结束，自动交卷");
    void doSubmit();
  }, [remaining, doSubmit]);

  useEffect(() => {
    if (!paperOpen) return;
    const onDown = (e: PointerEvent) => {
      if (paperWrap.current && !paperWrap.current.contains(e.target as Node)) setPaperOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPaperOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [paperOpen]);

  useEffect(() => {
    if (!timerOpen) return;
    const onDown = (e: PointerEvent) => {
      if (timerWrap.current && !timerWrap.current.contains(e.target as Node)) setTimerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTimerOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [timerOpen]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (pending.current.size) {
        const batch = Array.from(pending.current.entries());
        pending.current.clear();
        for (const [qid, raw] of batch) void api.saveAnswer(attemptId, qid, raw).catch(() => undefined);
      }
    };
  }, [attemptId]);

  useEffect(() => {
    const onResize = () => {
      const cw = bodyRef.current?.clientWidth ?? window.innerWidth;
      setLayout((p) => {
        let l = clamp(p.left, LEFT_MIN, LEFT_MAX);
        let r = clamp(p.right, RIGHT_MIN, RIGHT_MAX);
        const avail = Math.max(0, cw - PAPER_MIN - 2 * HANDLE);
        let excess = (p.showLeft ? l : 0) + (p.showRight ? r : 0) - avail;
        if (excess > 0 && p.showRight) {
          const cut = Math.min(excess, r - RIGHT_MIN);
          r -= cut;
          excess -= cut;
        }
        if (excess > 0 && p.showLeft) {
          const cut = Math.min(excess, l - LEFT_MIN);
          l -= cut;
        }
        return l === p.left && r === p.right ? p : { ...p, left: l, right: r };
      });
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function update(qid: number, raw: string) {
    const next = { ...answersRef.current, [qid]: raw };
    answersRef.current = next;
    setAnswers(next);
    pending.current.set(qid, raw);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void flushSaves();
    }, 300);
  }

  function isDone(qid: number) {
    return (answers[qid] ?? "").trim().length > 0;
  }

  function answeredIn(g: PaperGroup) {
    return g.questions.filter((q) => isDone(q.id)).length;
  }

  function persistPresets(next: number[]) {
    setPresets(next);
    void api.saveSettings({ timer_presets: next }).catch(() => toast.error("计时预设保存失败"));
  }

  function applyTimer(minutes: number, remember = false) {
    const m = Math.round(minutes);
    if (!Number.isFinite(m) || m < 0 || m > 600) {
      toast.error("请输入 1-600 分钟");
      return;
    }
    autoSubmitted.current = false;
    setRemaining(m > 0 ? m * 60 : null);
    setTimerOpen(false);
    setCustomMin("");
    if (m > 0) toast.success("倒计时 " + m + " 分钟");
    else toast.message("已取消倒计时");
    if (remember && m > 0) {
      const next = Array.from(new Set([...presets, m])).sort((a, b) => a - b).slice(0, 8);
      persistPresets(next);
    }
  }

  function removePreset(m: number) {
    persistPresets(presets.filter((x) => x !== m));
  }

  function applyCustom(e: FormEvent) {
    e.preventDefault();
    const m = Number(customMin);
    if (!Number.isFinite(m) || m < 1 || m > 600) {
      toast.error("请输入 1-600 之间的分钟数");
      return;
    }
    applyTimer(m, true);
  }

  function toggleMark(qid: number) {
    setMarks((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid);
      else next.add(qid);
      return next;
    });
  }

  function flashPaper(id: number) {
    if (paperFlashTimer.current) window.clearTimeout(paperFlashTimer.current);
    setPaperFlash(null);
    window.requestAnimationFrame(() => {
      setPaperFlash(id);
      paperFlashTimer.current = window.setTimeout(() => setPaperFlash(null), 1200);
    });
  }

  function flashSheet(id: number) {
    if (sheetFlashTimer.current) window.clearTimeout(sheetFlashTimer.current);
    setSheetFlash(null);
    window.requestAnimationFrame(() => {
      setSheetFlash(id);
      sheetFlashTimer.current = window.setTimeout(() => setSheetFlash(null), 1200);
    });
  }

  function jumpToPaper(id: number) {
    setCurrentId(id);
    spyTarget.current = id;
    const el = document.getElementById("paper-q-" + id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    flashPaper(id);
  }

  function selectPaper(id: number) {
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) return;
    setCurrentId(id);
    const row = document.getElementById("sheet-row-" + id);
    if (row) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    flashSheet(id);
  }

  function togglePanel(side: Side) {
    setLayout((p) => (side === "left" ? { ...p, showLeft: !p.showLeft } : { ...p, showRight: !p.showRight }));
  }

  function nudge(side: Side, e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 32 : 8);
    setLayout((p) => {
      if (side === "left") return { ...p, left: clamp(p.left + step, LEFT_MIN, LEFT_MAX) };
      return { ...p, right: clamp(p.right - step, RIGHT_MIN, RIGHT_MAX) };
    });
  }

  function startDrag(side: Side, e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = side === "left" ? layout.left : layout.right;
    const cw = bodyRef.current?.clientWidth ?? window.innerWidth;
    const other = side === "left" ? (layout.showRight ? layout.right : 0) : layout.showLeft ? layout.left : 0;
    const min = side === "left" ? LEFT_MIN : RIGHT_MIN;
    const hardMax = side === "left" ? LEFT_MAX : RIGHT_MAX;
    const max = Math.max(min, Math.min(hardMax, cw - other - PAPER_MIN - 2 * HANDLE));
    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      undefined;
    }
    document.body.classList.add("exam-dragging");
    const move = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      const raw = side === "left" ? startW + delta : startW - delta;
      const width = Math.round(clamp(raw, min, max));
      setLayout((p) => (side === "left" ? { ...p, left: width } : { ...p, right: width }));
    };
    const finish = () => {
      document.body.classList.remove("exam-dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      try {
        target.releasePointerCapture(e.pointerId);
      } catch {
        undefined;
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  function goBack() {
    if (window.history.length > 1) nav(-1);
    else nav("/");
  }

  if (loadError) {
    return (
      <div className="exam-fallback">
        <div className="empty">载入试卷失败：{loadError}</div>
        <Button variant="soft" onClick={() => nav("/")}>
          返回首页
        </Button>
      </div>
    );
  }
  if (!attempt) {
    return (
      <div className="exam-fallback">
        <div className="empty">正在载入试卷…</div>
      </div>
    );
  }

  const gridCols: string[] = [];
  if (layout.showLeft) gridCols.push(layout.left + "px", HANDLE + "px");
  gridCols.push("minmax(0, 1fr)");
  if (layout.showRight) gridCols.push(HANDLE + "px", layout.right + "px");

  const timerText = remaining == null ? "不限时" : fmtClock(remaining);
  const timerWarn = remaining != null && remaining <= 300;
  const saveLabel =
    saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : saveState === "error" ? "保存失败" : "自动保存";

  const timerPopover = (
    <div className="exam-timer-pop" role="dialog" aria-label="倒计时设置">
      <div className="exam-pop-head">
        <span>倒计时</span>
        <span className="exam-pop-hint">{remaining == null ? "不限时" : "剩余 " + fmtClock(remaining)}</span>
      </div>
      <div className="timer-presets">
        {presets.map((m) => (
          <span className="timer-preset" key={m}>
            <button type="button" className="timer-preset-main" onClick={() => applyTimer(m)}>
              {m} 分钟
            </button>
            <button
              type="button"
              className="timer-preset-x"
              onClick={() => removePreset(m)}
              aria-label={"删除预设 " + m + " 分钟"}
              title="删除预设"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        {presets.length === 0 ? <span className="exam-pop-hint">预设已清空，可在下方自定义</span> : null}
      </div>
      <form className="timer-custom" onSubmit={applyCustom}>
        <input
          className="input"
          type="number"
          min={1}
          max={600}
          step={1}
          placeholder="自定义分钟"
          value={customMin}
          onChange={(e) => setCustomMin(e.target.value)}
        />
        <Button type="submit" size="sm" variant="soft">
          确定
        </Button>
      </form>
      <div className="timer-links">
        <button type="button" className="timer-link" onClick={() => applyTimer(0)}>
          不限时
        </button>
        <button type="button" className="timer-link" onClick={() => setTimerOpen(false)}>
          关闭
        </button>
      </div>
    </div>
  );

  return (
    <div className="exam-wrap" style={{ height: "100dvh" }}>
      <header className="page-head exam-head">
        <div className="exam-head-main">
          <Button variant="ghost" className="icon-btn exam-back" onClick={goBack} aria-label="返回">
            <ChevronLeft size={18} />
          </Button>
          <div className="exam-head-text">
            <h1 title={attempt.title}>{attempt.title}</h1>
          </div>
        </div>
        <div className="acts">
          <span className="chip chip-accent exam-answered" title={"已答 " + answered + " / " + total}>
            已答 {answered}/{total}
          </span>
          <button
            type="button"
            className="icon-btn exam-toggle"
            aria-pressed={layout.showLeft}
            title={layout.showLeft ? "收起答题进度" : "展开答题进度"}
            onClick={() => togglePanel("left")}
          >
            {layout.showLeft ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </button>
          <button
            type="button"
            className="icon-btn exam-toggle"
            aria-pressed={layout.showRight}
            title={layout.showRight ? "收起答题卡" : "展开答题卡"}
            onClick={() => togglePanel("right")}
          >
            {layout.showRight ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
          </button>
          <div className="paper-wrap" ref={paperWrap}>
            <button
              type="button"
              className="exam-timer"
              data-open={paperOpen ? "true" : "false"}
              aria-haspopup="dialog"
              aria-expanded={paperOpen}
              onClick={() => setPaperOpen((v) => !v)}
              title="试卷字体与排版"
            >
              <Type size={14} />
              排版
            </button>
            {paperOpen ? (
              <div className="paper-settings-pop" role="dialog" aria-label="试卷排版设置">
                <div className="exam-pop-head">
                  <b>试卷排版</b>
                  <button type="button" className="icon-btn" onClick={() => setPaperOpen(false)} aria-label="关闭">
                    <X size={15} />
                  </button>
                </div>
                <PaperSettings
                  style={paperStyle}
                  onChange={(next) => {
                    setPaperStyle(next);
                    savePaperStyle(next);
                  }}
                  compact
                />
              </div>
            ) : null}
          </div>
          <ThemeMenu compact />
          <div className="timer-wrap" ref={timerWrap}>
            <button
              type="button"
              className={"exam-timer" + (timerWarn ? " is-warn" : "")}
              data-open={timerOpen ? "true" : "false"}
              aria-haspopup="dialog"
              aria-expanded={timerOpen}
              onClick={() => setTimerOpen((v) => !v)}
              title="设置倒计时"
            >
              <Clock3 size={14} />
              {timerText}
            </button>
            {timerOpen ? timerPopover : null}
          </div>
          <Button variant="primary" size="sm" onClick={() => setConfirmOpen(true)} disabled={submitting}>
            <Send size={14} /> {submitting ? "交卷中…" : "交卷"}
          </Button>
        </div>
      </header>

      <div className="exam-body" ref={bodyRef} style={{ gridTemplateColumns: gridCols.join(" ") }}>
        {layout.showLeft ? (
          <aside className="col-progress">
            <div className="exam-side-head">
              <div>
                <div className="exam-side-eyebrow">答题进度</div>
                <div className="exam-side-sub">
                  已答 {answered} / {total} · 标记 {markedCount}
                </div>
              </div>
            </div>
            <div className="progress-track">
              <span style={{ width: (total ? (answered / total) * 100 : 0) + "%" }} />
            </div>
            <div className="exam-side-body">
              {groups.map((g) => (
                <div className="prog-group" key={g.id}>
                  <div className="prog-group-head" title={g.title}>
                    <span>{shortSection(g.title)}</span>
                    <span>
                      {answeredIn(g)}/{g.questions.length}
                    </span>
                  </div>
                  <div className="prog-grid">
                    {g.questions.map((q) => (
                      <button
                        key={q.id}
                        type="button"
                        className={
                          "prog-num" +
                          (isDone(q.id) ? " is-done" : "") +
                          (marks.has(q.id) ? " is-marked" : "") +
                          (currentId === q.id ? " is-current" : "")
                        }
                        onClick={() => jumpToPaper(q.id)}
                        title={shortNo(q) + " · " + qtypeLabel(q.qtype)}
                      >
                        {shortNo(q)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="prog-legend">
              <span>
                <i data-k="todo" />
                未答
              </span>
              <span>
                <i data-k="done" />
                已答
              </span>
              <span>
                <i data-k="mark" />
                标记
              </span>
            </div>
          </aside>
        ) : null}

        {layout.showLeft ? (
          <div
            className="exam-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整答题进度栏宽度"
            tabIndex={0}
            onPointerDown={(e) => startDrag("left", e)}
            onDoubleClick={() => setLayout((p) => ({ ...p, left: DEFAULT_LAYOUT.left }))}
            onKeyDown={(e) => nudge("left", e)}
          />
        ) : null}

        <section className="col-paper">
          {audioSrc || audioBroken ? (
            <div className="paper-audio">
              <span className="paper-audio-label">
                <Headphones size={15} /> 听力音频
              </span>
              {audioBroken ? (
                <span className="exam-pop-hint">浏览器预览不含音频文件，桌面版可播放</span>
              ) : (
                <audio controls preload="metadata" src={audioSrc} onError={() => setAudioBroken(true)} />
              )}
            </div>
          ) : null}
          <div className="paper-scroll" ref={paperScrollRef} style={paperCssVars(paperStyle)}>
            <PaperDoc
              groups={groups}
              materials={materialMap}
              title={attempt.title}
              eyebrow={attempt.set?.subtitle || "整卷练习"}
              meta={[
                total + " 题",
                "满分 " + paperPoints,
                ...(attempt.set?.duration_minutes ? ["建议 " + attempt.set.duration_minutes + " 分钟"] : []),
              ]}
              showAnswer={false}
              renderQuestion={(q) => (
                <PaperQuestion
                  q={q}
                  current={currentId === q.id}
                  flash={paperFlash === q.id}
                  onSelect={(item) => selectPaper(item.id)}
                />
              )}
            />
          </div>
        </section>

        {layout.showRight ? (
          <div
            className="exam-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整答题卡宽度"
            tabIndex={0}
            onPointerDown={(e) => startDrag("right", e)}
            onDoubleClick={() => setLayout((p) => ({ ...p, right: DEFAULT_LAYOUT.right }))}
            onKeyDown={(e) => nudge("right", e)}
          />
        ) : null}

        {layout.showRight ? (
          <aside className="col-sheet">
            <div className="exam-side-head">
              <div>
                <div className="exam-side-eyebrow">答题卡</div>
                <div className="exam-side-sub">
                  已答 {answered} / {total} · 标记 {markedCount}
                </div>
              </div>
              <span className="sheet-save" data-state={saveState} role="status">
                {saveLabel}
              </span>
            </div>
            <div className="exam-side-body">
              {groups.map((g) => (
                <div className="sheet-group" key={g.id}>
                  <div className="sheet-group-head" title={g.title}>
                    <span>{shortSection(g.title)}</span>
                    <span className="sheet-group-count">
                      {answeredIn(g)}/{g.questions.length}
                    </span>
                  </div>
                  {g.questions.map((q) => (
                    <SheetRow
                      key={q.id}
                      q={q}
                      value={answers[q.id] ?? ""}
                      current={currentId === q.id}
                      marked={marks.has(q.id)}
                      flash={sheetFlash === q.id}
                      onChange={(v) => update(q.id, v)}
                      onFocus={() => setCurrentId(q.id)}
                      onJump={() => jumpToPaper(q.id)}
                      onMark={() => toggleMark(q.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </aside>
        ) : null}
      </div>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="确认交卷" width={420}>
        <p className="exam-confirm-text">
          已答 {answered} / {total} 题{unanswered > 0 ? "，还有 " + unanswered + " 题未答" : "，全部作答完成"}。
        </p>
        <p className="small muted">交卷后答案会立即显示，不能再修改。</p>
        <div className="exam-confirm-actions">
          <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
            继续作答
          </Button>
          <Button
            variant="primary"
            disabled={submitting}
            onClick={() => {
              setConfirmOpen(false);
              void doSubmit();
            }}
          >
            {submitting ? "交卷中…" : "确认交卷"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/* 答题卡里的长答案框：随内容长高，窄窗口下也能一眼看到答完没有。 */
function AutoArea({
  value,
  onChange,
  onFocus,
  placeholder,
  minRows,
}: {
  value: string;
  onChange: (v: string) => void;
  onFocus: () => void;
  placeholder: string;
  minRows: number;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.max(el.scrollHeight, minRows * 20 + 16) + "px";
  }, [value, minRows]);
  return (
    <textarea
      ref={ref}
      className="sheet-area"
      rows={minRows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
      placeholder={placeholder}
    />
  );
}

function SheetRow({
  q,
  value,
  current,
  marked,
  flash,
  onChange,
  onFocus,
  onJump,
  onMark,
}: {
  q: Question;
  value: string;
  current: boolean;
  marked: boolean;
  flash: boolean;
  onChange: (v: string) => void;
  onFocus: () => void;
  onJump: () => void;
  onMark: () => void;
}) {
  const done = value.trim().length > 0;
  const multi = q.qtype === "choice_multi";
  const letters =
    q.options && q.options.length
      ? q.options.map((o) => o.key)
      : q.qtype === "true_false"
        ? ["T", "F"]
        : ["A", "B", "C", "D"];
  const chosen = new Set(value.split(/[,， ]+/).filter(Boolean));
  let control: ReactNode;
  if (q.qtype === "choice_single" || q.qtype === "choice_multi" || q.qtype === "true_false" || q.qtype === "matching") {
    control = (
      <div className="sheet-opts">
        {letters.map((k) => {
          const on = multi ? chosen.has(k) : value.trim() === k;
          return (
            <button
              key={k}
              type="button"
              className="sheet-opt"
              data-on={on ? "true" : "false"}
              aria-pressed={on}
              onFocus={onFocus}
              onClick={() => {
                if (multi) {
                  const next = new Set(chosen);
                  if (next.has(k)) next.delete(k);
                  else next.add(k);
                  onChange(letters.filter((x) => next.has(x)).join(","));
                } else {
                  onChange(value.trim() === k ? "" : k);
                }
              }}
            >
              {k}
            </button>
          );
        })}
      </div>
    );
  } else if (q.qtype === "short_answer" || q.qtype === "dictation" || q.qtype === "writing") {
    control = (
      <AutoArea
        minRows={q.qtype === "writing" ? 8 : q.qtype === "dictation" ? 5 : 3}
        value={value}
        onChange={onChange}
        onFocus={onFocus}
        placeholder={q.qtype === "writing" ? "写正文…" : q.qtype === "dictation" ? "写下听写内容…" : "填写答案…"}
      />
    );
  } else {
    control = (
      <input
        className="sheet-line"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        placeholder={q.qtype === "cloze" ? "填字母" : "填写答案"}
      />
    );
  }
  return (
    <div
      className={"sheet-row" + (current ? " is-current" : "") + (flash ? " is-flash" : "")}
      id={"sheet-row-" + q.id}
      data-sheet-q={q.id}
    >
      <button
        type="button"
        className={"sheet-no" + (done ? " is-done" : "") + (marked ? " is-marked" : "")}
        onClick={onJump}
        title={"第 " + shortNo(q) + " 题 · " + qtypeLabel(q.qtype)}
        aria-label={"跳到第 " + shortNo(q) + " 题"}
      >
        {shortNo(q)}
      </button>
      <div className="sheet-ctl">{control}</div>
      <button
        type="button"
        className="sheet-flag"
        aria-pressed={marked}
        onClick={onMark}
        title={marked ? "取消标记" : "标记本题"}
      >
        <Flag size={12} />
      </button>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function pointsOf(qs: Question[]) {
  let sum = 0;
  for (const q of qs) sum += q.points;
  return sum;
}

function fmtClock(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mm = String(m).padStart(2, "0");
  const rr = String(ss).padStart(2, "0");
  return h > 0 ? h + ":" + mm + ":" + rr : mm + ":" + rr;
}

function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<Layout>;
    return {
      left: clamp(Number(parsed.left) || DEFAULT_LAYOUT.left, LEFT_MIN, LEFT_MAX),
      right: clamp(Number(parsed.right) || DEFAULT_LAYOUT.right, RIGHT_MIN, RIGHT_MAX),
      showLeft: parsed.showLeft !== false,
      showRight: parsed.showRight !== false,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function loadMarks(key: string): Set<number> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const set = new Set<number>();
    for (const v of parsed) {
      const n = Number(v);
      if (Number.isFinite(n)) set.add(n);
    }
    return set;
  } catch {
    return new Set();
  }
}
