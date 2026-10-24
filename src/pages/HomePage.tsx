import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, FolderOpen, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import clsx from "clsx";
import { api } from "../lib/api";
import type { AttemptMode, AttemptSummary, SetSummary } from "../lib/types";
import { Button, Chip, Empty, Modal } from "../components/ui";

const MODE_LABEL: Record<AttemptMode, string> = {
  exam: "整卷",
  custom: "自选",
  review: "复习",
};

const pad2 = (n: number) => (n < 10 ? "0" + n : String(n));

function num(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function fmtWhen(value: string | null) {
  if (!value) return "—";
  const d = new Date(value.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return value;
  const hm = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  const md = d.getMonth() + 1 + "月" + d.getDate() + "日";
  return d.getFullYear() === new Date().getFullYear() ? md + " " + hm : d.getFullYear() + "年" + md;
}

function fmtSpent(from: string | null, to: string | null) {
  if (!from || !to) return "—";
  const a = new Date(from.replace(" ", "T")).getTime();
  const b = new Date(to.replace(" ", "T")).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return "—";
  const m = Math.round((b - a) / 60000);
  if (m < 1) return "<1 分钟";
  if (m < 60) return m + " 分钟";
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? hours + " 小时 " + rest + " 分" : hours + " 小时";
}

/* Tauri 的失败信息可能是字符串，也可能是 Error，统一成一句话。 */
function errText(e: unknown) {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e.trim()) return e.trim();
  return "未知错误";
}

/* 「全部 / 未归类 / 某个文件夹」三种筛选值。 */
type FolderFilter = "all" | "none" | number;

export default function HomePage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const sets = useQuery({ queryKey: ["sets"], queryFn: () => api.listSets() });
  const folders = useQuery({ queryKey: ["folders"], queryFn: () => api.listFolders() });
  const records = useQuery({ queryKey: ["records"], queryFn: () => api.listRecords() });
  const [folderFilter, setFolderFilter] = useState<FolderFilter>("all");
  const [pendingDelete, setPendingDelete] = useState<SetSummary | null>(null);

  const setList = sets.data ?? [];
  const folderList = folders.data ?? [];
  const all = records.data ?? [];
  const recent = all.slice(0, 6);
  const loading = sets.isLoading || records.isLoading;
  const totalQuestions = setList.reduce((sum, s) => sum + s.question_count, 0);

  const folderNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const f of folderList) map.set(f.id, f.name);
    return map;
  }, [folderList]);

  const folderCounts = useMemo(() => {
    const map = new Map<number, number>();
    let unfiled = 0;
    for (const s of setList) {
      if (s.folder_id == null) unfiled += 1;
      else map.set(s.folder_id, (map.get(s.folder_id) ?? 0) + 1);
    }
    return { map, unfiled };
  }, [setList]);

  const filtered = useMemo(() => {
    if (folderFilter === "all") return setList;
    if (folderFilter === "none") return setList.filter((s) => s.folder_id == null);
    return setList.filter((s) => s.folder_id === folderFilter);
  }, [setList, folderFilter]);

  const lastBySet = useMemo(() => {
    const map = new Map<number, AttemptSummary>();
    for (const r of all) {
      if (r.set_id != null && r.status === "submitted" && !map.has(r.set_id)) map.set(r.set_id, r);
    }
    return map;
  }, [all]);

  const rename = useMutation({
    mutationFn: (v: { id: number; title: string }) => api.renameSet(v.id, v.title),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sets"] }),
  });

  /* 删卷会连带删掉该卷题目与练习记录，先弹确认再动手。 */
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteSet(id),
    onSuccess: async () => {
      setPendingDelete(null);
      toast.success("试卷已删除");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["sets"] }),
        qc.invalidateQueries({ queryKey: ["records"] }),
        qc.invalidateQueries({ queryKey: ["folders"] }),
      ]);
    },
    onError: (e) => toast.error("删除失败：" + errText(e)),
  });

  const handleRename = async (id: number, title: string) => {
    await rename.mutateAsync({ id, title });
  };

  const folderLabel = (id: number | null) => (id == null ? null : folderNames.get(id) ?? null);

  return (
    <main className="page">
      <header className="home-head">
        <span className="home-brand">Tokeru</span>
        <p className="home-stats">
          {loading
            ? "载入中…"
            : setList.length + " 份试卷 · " + totalQuestions + " 道题 · " + all.length + " 次练习"}
        </p>
      </header>

      <section className="home-sec">
        <div className="home-sec-head">
          <h2 className="home-sec-title">试卷集</h2>
          <span className="home-sec-rule" />
          {setList.length > 0 ? (
            <span className="home-sec-meta">
              {filtered.length === setList.length
                ? setList.length + " 份"
                : filtered.length + " / " + setList.length + " 份"}
            </span>
          ) : null}
        </div>

        {setList.length > 0 ? (
          <div className="home-filter" role="group" aria-label="按文件夹筛选">
            <button
              type="button"
              className="chip"
              data-on={folderFilter === "all"}
              aria-pressed={folderFilter === "all"}
              onClick={() => setFolderFilter("all")}
            >
              全部
              <span className="home-filter-count">{setList.length}</span>
            </button>
            <button
              type="button"
              className="chip"
              data-on={folderFilter === "none"}
              aria-pressed={folderFilter === "none"}
              onClick={() => setFolderFilter("none")}
            >
              未归类
              <span className="home-filter-count">{folderCounts.unfiled}</span>
            </button>
            {folderList.map((f) => (
              <button
                key={f.id}
                type="button"
                className="chip"
                data-on={folderFilter === f.id}
                aria-pressed={folderFilter === f.id}
                onClick={() => setFolderFilter(f.id)}
              >
                {f.name}
                <span className="home-filter-count">{folderCounts.map.get(f.id) ?? 0}</span>
              </button>
            ))}
          </div>
        ) : null}

        {sets.isError ? (
          <Empty>试卷载入失败，刷新页面重试。</Empty>
        ) : loading && setList.length === 0 ? (
          <Empty>载入中…</Empty>
        ) : setList.length === 0 ? (
          <Empty>
            还没有试卷，先到{" "}
            <Link className="home-link" to="/import">
              导入
            </Link>{" "}
            添加一份。
          </Empty>
        ) : filtered.length === 0 ? (
          <div className="set-empty">
            <span>这个文件夹还没有试卷。</span>
            <Button variant="ghost" size="sm" onClick={() => setFolderFilter("all")}>
              查看全部
            </Button>
          </div>
        ) : (
          <div className="set-grid">
            {filtered.map((s) => (
              <SetCard
                key={s.id}
                set={s}
                last={lastBySet.get(s.id)}
                folderName={folderLabel(s.folder_id)}
                onRename={handleRename}
                onAskDelete={setPendingDelete}
              />
            ))}
          </div>
        )}
      </section>

      <section className="home-sec">
        <div className="home-sec-head">
          <h2 className="home-sec-title">最近的练习</h2>
          <span className="home-sec-rule" />
          {recent.length > 0 ? (
            <Link className="home-more" to="/records">
              全部记录
            </Link>
          ) : null}
        </div>
        {records.isError ? (
          <Empty>练习记录载入失败，刷新页面重试。</Empty>
        ) : records.isLoading ? (
          <Empty>载入中…</Empty>
        ) : recent.length === 0 ? (
          <Empty>
            还没有练习记录，去{" "}
            <Link className="home-link" to="/bank">
              题库
            </Link>{" "}
            挑一道开始。
          </Empty>
        ) : (
          <div className="recent">
            {recent.map((r) => (
              <div className="recent-row" key={r.id}>
                <span className="recent-when">
                  <Clock3 size={14} aria-hidden="true" />
                  {fmtWhen(r.finished_at ?? r.started_at)}
                </span>
                <span className="recent-main">
                  <span className="recent-title" title={r.title}>
                    {r.title}
                  </span>
                  <Chip>{MODE_LABEL[r.mode]}</Chip>
                </span>
                <span className="recent-metrics">
                  {r.status === "submitted" ? (
                    <span className="recent-score">
                      {num(r.total_score)}
                      <span className="recent-max"> / {num(r.max_score)}</span>
                    </span>
                  ) : (
                    <span className="recent-score is-live">进行中</span>
                  )}
                  <span className="recent-dim">{r.question_count} 题</span>
                  <span className="recent-dim">{fmtSpent(r.started_at, r.finished_at)}</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => nav(r.status === "submitted" ? "/attempts/" + r.id : "/exam/" + r.id)}
                >
                  {r.status === "submitted" ? "看结果" : "继续"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={pendingDelete !== null}
        onClose={() => {
          if (!remove.isPending) setPendingDelete(null);
        }}
        title="删除试卷？"
        width={420}
      >
        <p className="small muted" style={{ marginTop: 0 }}>
          删除试卷会删除该卷题目与练习记录，且无法恢复。
        </p>
        {pendingDelete ? <p style={{ margin: "10px 0 0", fontWeight: 600 }}>{pendingDelete.title}</p> : null}
        <div className="form-actions" style={{ marginTop: 18 }}>
          <Button variant="default" onClick={() => setPendingDelete(null)} disabled={remove.isPending}>
            取消
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (pendingDelete) remove.mutate(pendingDelete.id);
            }}
            disabled={remove.isPending}
          >
            {remove.isPending ? "删除中…" : "删除"}
          </Button>
        </div>
      </Modal>
    </main>
  );
}

function SetCard({
  set,
  last,
  folderName,
  onRename,
  onAskDelete,
}: {
  set: SetSummary;
  last?: AttemptSummary;
  folderName: string | null;
  onRename: (id: number, title: string) => Promise<void>;
  onAskDelete: (set: SetSummary) => void;
}) {
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(set.title);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const doneRef = useRef(true);
  const busyRef = useRef(false);

  const year = set.year == null || String(set.year).trim() === "" ? "试卷" : String(set.year);
  const meta = [set.question_count + " 题", set.section_count + " 个分区", num(set.total_points) + " 分"];
  const tags = set.tags.slice(0, 4);
  const moreTags = set.tags.length - tags.length;

  const startEdit = () => {
    setDraft(set.title);
    doneRef.current = false;
    setEditing(true);
  };

  const finish = () => {
    doneRef.current = true;
    setEditing(false);
  };

  const commit = async (fromBlur = false) => {
    if (doneRef.current || busyRef.current) return;
    const next = draft.trim();
    if (!next) {
      if (fromBlur) {
        setDraft(set.title);
        finish();
        return;
      }
      toast.error("试卷名不能为空。");
      inputRef.current?.focus();
      return;
    }
    if (next === set.title) {
      finish();
      return;
    }
    busyRef.current = true;
    try {
      await onRename(set.id, next);
      finish();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "改名没成功，再试一次。");
      if (!fromBlur) inputRef.current?.focus();
    } finally {
      busyRef.current = false;
    }
  };

  return (
    <article className="set-card">
      <header className="set-card-top">
        <span className={clsx("set-folder", !folderName && "is-none")} title={folderName ? "文件夹：" + folderName : "未归类"}>
          <FolderOpen size={11} aria-hidden="true" />
          <span className="set-folder-name">{folderName ?? "未归类"}</span>
        </span>
        <span className="set-corner">
          {year}
          {set.duration_minutes ? " · " + set.duration_minutes + " 分钟" : ""}
        </span>
      </header>

      {editing ? (
        <div className="set-title-row">
          <input
            ref={inputRef}
            className="set-title-input"
            value={draft}
            aria-label="试卷名"
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setDraft(set.title);
                finish();
              }
            }}
          />
        </div>
      ) : (
        <div className="set-title-row">
          <h3 className="set-title" title={set.title + "（双击改名）"} onDoubleClick={startEdit}>
            {set.title}
          </h3>
          <button type="button" className="set-rename-btn" title="改名" aria-label="改试卷名" onClick={startEdit}>
            <Pencil size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="set-rename-btn"
            title="删除试卷"
            aria-label="删除试卷"
            onClick={() => onAskDelete(set)}
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </div>
      )}

      {set.subtitle ? (
        <p className="set-sub" title={set.subtitle}>
          {set.subtitle}
        </p>
      ) : null}

      <div className="set-meta">
        {meta.map((m) => (
          <span className="set-meta-item" key={m}>
            {m}
          </span>
        ))}
      </div>

      <div className="set-tags">
        {tags.length === 0 ? (
          <span className="chip set-tag is-empty">未打标签</span>
        ) : (
          tags.map((t) => (
            <span className="chip set-tag" key={t} title={t}>
              {t}
            </span>
          ))
        )}
        {moreTags > 0 ? <span className="chip set-tag is-empty">+{moreTags}</span> : null}
      </div>

      <div className="set-foot">
        <span className={clsx("set-score", !last && "is-empty")}>
          {last ? "上次 " + num(last.total_score) + " / " + num(last.max_score) : "尚未练习"}
        </span>
        <div className="set-acts">
          <Button variant="primary" size="sm" onClick={() => nav("/sets/" + set.id + "/exam")}>
            开始练习
          </Button>
          <Button variant="ghost" size="sm" onClick={() => nav("/sets/" + set.id + "/answers")}>
            速查与整理
          </Button>
        </div>
      </div>
    </article>
  );
}
