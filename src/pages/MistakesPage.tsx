import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, NotebookPen, Play, Search } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { Button, Chip, Empty } from "../components/ui";
import { answerText, qtypeLabel } from "../lib/labels";

export default function MistakesPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["mistakes"], queryFn: api.listMistakes });
  const [status, setStatus] = useState<"learning" | "mastered" | "all">("learning");
  const [setTitle, setSetTitle] = useState("");
  const [kw, setKw] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<Set<number>>(new Set());

  const rows = useMemo(() => {
    const k = kw.trim().toLowerCase();
    return (q.data ?? []).filter(
      (m) =>
        (status === "all" || m.status === status) &&
        (!setTitle || m.set_title === setTitle) &&
        (!k || m.question.stem.toLowerCase().includes(k)),
    );
  }, [q.data, status, setTitle, kw]);
  const sets = Array.from(new Set((q.data ?? []).map((m) => m.set_title)));

  function toggle(id: number) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function master(id: number) {
    await api.setMistakeStatus(id, "mastered");
    await qc.invalidateQueries({ queryKey: ["mistakes"] });
    toast.success("已标为已掌握");
  }

  async function review() {
    const ids = rows.filter((m) => picked.has(m.id)).map((m) => m.question_id);
    if (!ids.length) {
      toast.error("先勾选要复习的题");
      return;
    }
    const id = await api.createAttempt({ questionIds: ids, mode: "review", title: `错题复习 · ${ids.length} 题` });
    nav(`/exam/${id}`);
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>错题本</h1>
          <div className="sub">{rows.length} 题待复习 · 勾选后可以组一套复习练习</div>
        </div>
        <div className="acts">
          <Button onClick={() => nav("/bank")}>去选题</Button>
          <Button variant="primary" onClick={review} disabled={!picked.size}><Play size={15} /> 复习 {picked.size || ""}</Button>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 18 }}>
        <div className="seg">
          {([["learning", "待复习"], ["mastered", "已掌握"], ["all", "全部"]] as ["learning" | "mastered" | "all", string][]).map(([k, label]) => (
            <button key={k} data-on={status === k} onClick={() => setStatus(k)}>{label}</button>
          ))}
        </div>
        <select className="select" style={{ width: 200 }} value={setTitle} onChange={(e) => setSetTitle(e.target.value)}>
          <option value="">全部试卷</option>
          {sets.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ position: "relative", width: 220 }}>
          <Search size={15} style={{ position: "absolute", left: 12, top: 12, color: "var(--text-3)" }} />
          <input className="input" style={{ paddingLeft: 34 }} value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜题干" />
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty>
          <NotebookPen size={22} />
          <div style={{ marginTop: 8 }}>{q.data?.length ? "没有符合筛选条件的错题。" : "错题本还是空的。"}</div>
          <div className="small muted" style={{ marginTop: 6 }}>练习记录里可以批量把错题写进来。</div>
        </Empty>
      ) : (
        <div className="list">
          {rows.map((m) => {
            const expanded = open.has(m.id);
            return (
              <div key={m.id} className="tile" data-selected={picked.has(m.id)} style={{ gap: 10 }}>
                <div className="hstack" style={{ gap: 10, flexWrap: "wrap" }}>
                  <input type="checkbox" className="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} aria-label="选择这道错题" />
                  <span className="q-no">{m.question.number}</span>
                  <Chip>{qtypeLabel(m.question.qtype)}</Chip>
                  <span style={{ fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "0 1 auto", maxWidth: 560 }}>
                    {m.question.stem}
                  </span>
                  <div className="grow" />
                  <Chip>{m.set_title}</Chip>
                  <Chip tone="warn">错 {m.wrong_count} 次</Chip>
                  {m.due_at ? <Chip>下次 {m.due_at}</Chip> : null}
                  <Button size="sm" variant="ghost" onClick={() => setOpen((p) => { const n = new Set(p); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}>
                    <ChevronDown size={14} style={{ transform: expanded ? "rotate(180deg)" : undefined }} /> {expanded ? "收起" : "详情"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => master(m.id)}><CheckCircle2 size={14} /> 已掌握</Button>
                </div>
                {expanded ? (
                  <div className="vstack" style={{ gap: 8, paddingLeft: 30 }}>
                    <div className="answer-box correct">
                      <div className="label">正确答案</div>
                      <div className="value">{answerText(m.question.answer)}</div>
                    </div>
                    {m.question.explanation ? <div className="small" style={{ color: "var(--text-2)", lineHeight: 1.85 }}>{m.question.explanation}</div> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}