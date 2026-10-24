import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckSquare, ChevronRight, Clock3, Play, Square, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { Button, Chip, Empty } from "../components/ui";
import { dayTitle, elapsed, fmtDay, fmtTime, modeLabel, scoreText } from "../lib/labels";

type Preset = "all" | "7" | "30" | "custom";

export default function RecordsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["records"], queryFn: () => api.listRecords() });
  const [preset, setPreset] = useState<Preset>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const bounds = useMemo(() => {
    if (preset === "custom") return { from, to };
    if (preset === "all") return { from: "", to: "" };
    const days = Number(preset);
    const end = new Date();
    const start = new Date(end.getTime() - (days - 1) * 86400000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return { from: fmt(start), to: fmt(end) };
  }, [preset, from, to]);

  const rows = useMemo(() => {
    return (q.data ?? [])
      .filter((r) => {
        const d = fmtDay(r.finished_at ?? r.started_at);
        return (!bounds.from || d >= bounds.from) && (!bounds.to || d <= bounds.to);
      })
      .sort((a, b) => (b.finished_at ?? b.started_at).localeCompare(a.finished_at ?? a.started_at));
  }, [q.data, bounds]);

  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) {
      const d = fmtDay(r.finished_at ?? r.started_at);
      const arr = m.get(d) ?? [];
      arr.push(r);
      m.set(d, arr);
    }
    return Array.from(m.entries());
  }, [rows]);

  function toggle(id: number) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function removeOne(id: number) {
    if (!window.confirm("删除这条练习记录？题目和错题本不受影响。")) return;
    await api.deleteAttempt(id);
    toast.success("记录已删除");
    setPicked((p) => { const n = new Set(p); n.delete(id); return n; });
    await qc.invalidateQueries({ queryKey: ["records"] });
  }

  async function removePicked() {
    const ids = Array.from(picked);
    if (!ids.length) return;
    if (!window.confirm(`删除选中的 ${ids.length} 条练习记录？题目和错题本不受影响。`)) return;
    setBusy(true);
    try {
      for (const id of ids) await api.deleteAttempt(id);
      toast.success(`已删除 ${ids.length} 条记录`);
      setPicked(new Set());
      await qc.invalidateQueries({ queryKey: ["records"] });
    } catch (e) {
      toast.error(`删除失败：${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function collectWrong() {
    const ids = Array.from(picked);
    if (!ids.length) return;
    setBusy(true);
    try {
      const wrong: number[] = [];
      for (const id of ids) {
        const d = await api.getAttempt(id);
        for (const qq of d.questions) {
          const full = typeof qq.points === "number" && qq.points > 0 ? qq.points : 1;
          if (qq.score != null && qq.score < full && qq.answer_raw) wrong.push(qq.id);
          else if (qq.is_correct === 0) wrong.push(qq.id);
        }
      }
      if (!wrong.length) {
        toast.message("选中的记录里没有可收录的错题");
      } else {
        await api.collectMistakes(Array.from(new Set(wrong)), "records");
        toast.success(`已写入错题本：${new Set(wrong).size} 题`);
      }
      setPicked(new Set());
      await qc.invalidateQueries({ queryKey: ["mistakes"] });
    } catch (e) {
      toast.error(`写入失败：${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>练习记录</h1>
          <div className="sub">{rows.length} 次练习 · 按日期归档，可挑出来写进错题本</div>
        </div>
        <div className="acts">
          <Button onClick={() => nav("/bank")}>去选题</Button>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 20 }}>
        <CalendarDays size={16} className="muted" />
        {([["all", "全部"], ["7", "近 7 天"], ["30", "近 30 天"], ["custom", "自定"]] as [Preset, string][]).map(([k, label]) => (
          <Button key={k} size="sm" variant={preset === k ? "soft" : "ghost"} onClick={() => setPreset(k)}>{label}</Button>
        ))}
        {preset === "custom" ? (
          <>
            <input type="date" className="input" style={{ width: 160 }} value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="muted small">至</span>
            <input type="date" className="input" style={{ width: 160 }} value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        ) : null}
        <div className="spacer" />
        <Button size="sm" variant="ghost" onClick={() => setPicked(picked.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))}>
          {picked.size === rows.length && rows.length > 0 ? <X size={14} /> : <CheckSquare size={14} />}
          {picked.size === rows.length && rows.length > 0 ? "取消全选" : "全选"}
        </Button>
      </div>

      {rows.length === 0 ? (
        <Empty>
          这段时间还没有练习记录。
          <div style={{ marginTop: 12 }}><Link to="/bank" style={{ color: "var(--accent)" }}>去题库开始一次练习</Link></div>
        </Empty>
      ) : (
        groups.map(([day, list]) => (
          <section className="date-group" key={day}>
            <h3>{dayTitle(day)} · {list.length} 次</h3>
            <div className="list">
              {list.map((r) => {
                const done = r.status === "submitted";
                const on = picked.has(r.id);
                return (
                  <div
                    key={r.id}
                    className="list-row"
                    style={on ? { borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent-soft) 46%, var(--surface))" } : undefined}
                  >
                    <button
                      type="button"
                      aria-label={on ? "取消选择" : "选择"}
                      onClick={() => toggle(r.id)}
                      style={{ border: 0, background: "transparent", padding: 0, color: on ? "var(--accent-strong)" : "var(--text-3)", display: "grid", placeItems: "center" }}
                    >
                      {on ? <CheckSquare size={18} /> : <Square size={18} />}
                    </button>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="hstack" style={{ flexWrap: "wrap", gap: 8 }}>
                        <b style={{ fontWeight: 650 }}>{r.title}</b>
                        <Chip tone="accent">{modeLabel(r.mode)}</Chip>
                        {done ? null : <Chip tone="warn">进行中</Chip>}
                      </div>
                      <div className="small muted" style={{ marginTop: 3 }}>
                        {fmtTime(r.finished_at ?? r.started_at)} · 已答 {r.answered_count}/{r.question_count} · 用时 {elapsed(r.started_at, r.finished_at)}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", minWidth: 96, whiteSpace: "nowrap" }}>
                      <span className="score-big" style={{ fontSize: 24 }}>{scoreText(r.total_score, r.max_score)}</span>
                      <span className="small muted" style={{ marginLeft: 3 }}>分</span>
                    </div>
                    {done ? (
                      <Button size="sm" onClick={() => nav(`/attempts/${r.id}`)}>看结果 <ChevronRight size={14} /></Button>
                    ) : (
                      <Button size="sm" variant="primary" onClick={() => nav(`/exam/${r.id}`)}><Play size={14} /> 继续</Button>
                    )}
                    <Button size="sm" variant="ghost" aria-label="删除记录" title="删除记录" onClick={() => removeOne(r.id)}><Trash2 size={14} /></Button>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      {picked.size > 0 ? (
        <div className="sticky-actions">
          <Clock3 size={16} className="muted" />
          <span className="small">已选 <b>{picked.size}</b> 条</span>
          <div className="spacer" />
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>取消</Button>
          <Button size="sm" onClick={collectWrong} disabled={busy}>把错误题目写入错题本</Button>
          <Button size="sm" variant="danger" onClick={removePicked} disabled={busy}><Trash2 size={14} /> 删除所选</Button>
        </div>
      ) : null}
    </main>
  );
}
