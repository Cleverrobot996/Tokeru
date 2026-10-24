import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, RotateCcw, Save, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import type { AttemptQuestion } from "../lib/types";
import { Button, Chip, Markdown } from "../components/ui";
import { answerText, qtypeLabel } from "../lib/labels";

type Filter = "all" | "wrong" | "unanswered" | "pending";

export default function ResultPage() {
  const { attemptId } = useParams();
  const id = Number(attemptId);
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["attempt", id], queryFn: () => api.getAttempt(id) });
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [grading, setGrading] = useState(false);

  const groups = useMemo(() => {
    if (!q.data) return [];
    return q.data.sections
      .map((s) => ({ section: s, questions: q.data!.questions.filter((x) => x.section_id === s.id) }))
      .filter((g) => g.questions.length > 0);
  }, [q.data]);

  if (q.isLoading) return <main className="page"><div className="empty">载入结果…</div></main>;
  if (!q.data) return <main className="page"><div className="empty">结果不存在。</div></main>;

  const a = q.data;
  const wrong = a.questions.filter((x) => x.is_correct === 0);
  const unanswered = a.questions.filter((x) => !x.answer_raw?.trim());
  const pending = a.questions.filter((x) => x.graded_by === "pending" || (x.is_correct === null && Boolean(x.answer_raw?.trim())));
  const isPending = (x: AttemptQuestion) => x.graded_by === "pending" || (x.is_correct === null && Boolean(x.answer_raw?.trim()));
  const visible = (list: AttemptQuestion[]) =>
    list.filter(
      (x) =>
        filter === "all" ||
        (filter === "wrong" && x.is_correct === 0) ||
        (filter === "unanswered" && !x.answer_raw?.trim()) ||
        (filter === "pending" && isPending(x)),
    );

  function toggle(qid: number) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(qid)) n.delete(qid);
      else n.add(qid);
      return n;
    });
  }

  async function collect() {
    if (!picked.size) return;
    setSaving(true);
    try {
      await api.collectMistakes(Array.from(picked), "result");
      toast.success(`已加入错题本：${picked.size} 题`);
      setPicked(new Set());
    } catch (e) {
      toast.error(`加入失败：${e}`);
    } finally {
      setSaving(false);
    }
  }

  async function aiGrade() {
    setGrading(true);
    try {
      const r = await api.aiGradeAttempt(id, true);
      toast.success(r.graded ? `AI 已判 ${r.graded} 题${r.missing.length ? `，${r.missing.length} 题未返回` : ""}` : "没有需要判的主观题。");
      await qc.invalidateQueries({ queryKey: ["attempt", id] });
      await qc.invalidateQueries({ queryKey: ["records"] });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setGrading(false);
    }
  }

  async function grade(questionId: number, score: number) {
    await api.selfGrade(id, questionId, score);
    await qc.invalidateQueries({ queryKey: ["attempt", id] });
  }

  /* 再做一次 = 拿同一批题新建一条练习，而不是回到旧记录继续改。 */
  async function again() {
    try {
      const payload =
        a.set_id && a.mode === "exam"
          ? { setId: a.set_id, mode: "exam" }
          : { questionIds: a.questions.map((x) => x.id), mode: a.mode, title: a.title };
      const next = await api.createAttempt(payload);
      nav("/exam/" + next);
    } catch (e) {
      toast.error("新建练习失败：" + e);
    }
  }

  const right = a.questions.filter((x) => x.is_correct === 1).length;

  return (
    <main className="page">
      <Button variant="ghost" size="sm" style={{ paddingLeft: 0, marginBottom: 8 }} onClick={() => nav("/records")}>
        <ArrowLeft size={15} /> 练习记录
      </Button>

      <div className="page-head">
        <div>
          <h1>练习结果</h1>
          <div className="sub">{a.title} · {a.finished_at ? `交卷 ${a.finished_at}` : "进行中"} · 共 {a.question_count} 题</div>
        </div>
        <div className="acts">
          <Button onClick={() => nav("/records")}>全部记录</Button>
          {pending.length ? (
            <Button onClick={aiGrade} disabled={grading}>
              <Sparkles size={15} /> {grading ? "AI 判卷中…" : `AI 判卷 ${pending.length}`}
            </Button>
          ) : null}
          <Button variant="primary" onClick={again}><RotateCcw size={15} /> 再做一次</Button>
        </div>
      </div>

      <div className="result-hero">
        <div className="score-wrap">
          <span className="score-big">{a.total_score.toFixed(1)}</span>
          <span className="score-max">/ {a.max_score} 分</span>
        </div>
        <div className="stat-row" style={{ marginTop: 0 }}>
          <div className="stat"><b style={{ color: "var(--ok)" }}>{right}</b><span>答对</span></div>
          <div className="stat"><b style={{ color: "var(--bad)" }}>{wrong.length}</b><span>答错</span></div>
          <div className="stat"><b>{unanswered.length}</b><span>未答</span></div>
          <div className="stat"><b style={{ color: "var(--warn)" }}>{pending.length}</b><span>待自评</span></div>
        </div>
      </div>

      <div className="result-layout">
        <aside className="result-overview">
          <div className="panel panel-pad">
            <div className="panel-head" style={{ marginBottom: 8 }}>
              <div>
                <div className="panel-title">题号总览</div>
                <div className="panel-sub">颜色 = 答题情况，点题号跳转</div>
              </div>
            </div>
            <div className="legend-row">
              <span className="small"><i className="dot dot-ok" />答对</span>
              <span className="small"><i className="dot dot-bad" />答错</span>
              <span className="small"><i className="dot dot-warn" />待自评</span>
              <span className="small"><i className="dot dot-plain" />未答</span>
            </div>
            {groups.map((g) => (
              <div key={g.section.id} className="sheet-group">
                <h4>{g.section.title}</h4>
                <div className="num-grid">
                  {g.questions.map((x) => {
                    const st = x.is_correct === 1 ? "correct" : x.is_correct === 0 ? "wrong" : isPending(x) ? "pending" : "";
                    return (
                      <a
                        key={x.id}
                        href={`#rq-${x.id}`}
                        className={`num ${st}`}
                        onClick={(e) => {
                          e.preventDefault();
                          document.getElementById(`rq-${x.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }}
                      >
                        {x.label}
                      </a>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section>
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <div className="seg">
              {([
                ["all", `全部 ${a.question_count}`],
                ["wrong", `错题 ${wrong.length}`],
                ["unanswered", `未答 ${unanswered.length}`],
                ["pending", `待自评 ${pending.length}`],
              ] as [Filter, string][]).map(([k, label]) => (
                <button key={k} data-on={filter === k} onClick={() => setFilter(k)}>{label}</button>
              ))}
            </div>
            <div className="grow" />
            <span className="small muted">勾选题目可批量收进错题本</span>
          </div>

          {groups.map((g) => {
            const list = visible(g.questions);
            if (!list.length) return null;
            return (
              <section key={g.section.id} style={{ marginBottom: 22 }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>{g.section.title} · {list.length} 题</div>
                {list.map((x) => (
                  <ResultCard
                    key={x.id}
                    q={x}
                    picked={picked.has(x.id)}
                    onPick={() => toggle(x.id)}
                    onGrade={(s) => grade(x.id, s)}
                    onGoSettings={() => nav("/settings")}
                  />
                ))}
              </section>
            );
          })}

          {groups.every((g) => visible(g.questions).length === 0) ? <div className="empty">这个筛选下没有题目。</div> : null}
          <div style={{ height: picked.size ? 74 : 0 }} />
        </section>
      </div>

      {picked.size ? (
        <div className="sticky-actions">
          <span className="small" style={{ fontWeight: 600 }}>已选 {picked.size} 题</span>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>清空</Button>
          <div className="grow" />
          <Button variant="primary" onClick={collect} disabled={saving}><Save size={15} /> {saving ? "写入中…" : "加入错题本"}</Button>
        </div>
      ) : null}
    </main>
  );
}

function ResultCard({
  q,
  picked,
  onPick,
  onGrade,
  onGoSettings,
}: {
  q: AttemptQuestion;
  picked: boolean;
  onPick: () => void;
  onGrade: (score: number) => void;
  onGoSettings: () => void;
}) {
  const [ai, setAi] = useState<{ content: string; reasoning: string } | null>(null);
  const [aiErr, setAiErr] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const correct = answerText(q.answer);
  const state = q.graded_by === "ai"
    ? "AI 已判"
    : q.is_correct === 1 ? "正确" : q.is_correct === 0 ? "错误" : q.graded_by === "pending" ? "待自评" : "未答";
  const tone = q.graded_by === "ai"
    ? (q.is_correct === 1 ? "ok" : "warn")
    : q.is_correct === 1 ? "ok" : q.is_correct === 0 ? "bad" : q.graded_by === "pending" ? "warn" : "default";

  async function explain(mode: string, followup = "") {
    setAiBusy(true);
    setAiErr("");
    try {
      const r = await api.aiExplain({ questionId: q.id, mode, customPrompt: "", followup, thinking: false });
      setAi(r);
    } catch (e) {
      setAiErr(String(e));
    } finally {
      setAiBusy(false);
    }
  }

  const noAi = /未配置|未设置|api\s*key|配置/i.test(aiErr);
  const wrong = state === "错误" || state === "未答";
  const subjective = q.qtype === "writing" || q.qtype === "short_answer";
  const dictationLike = q.qtype === "dictation" || q.qtype === "fill_blank" || q.qtype === "cloze";
  const rubricItems = Object.entries(q.answer?.rubric ?? {}) as [string, string[]][];
  const rubricAsk = rubricItems.length
    ? "按下面的检查清单逐项给我的答案打勾或打叉，指出最该改的一处，最后给出建议分数：" +
      rubricItems.map(([k, list]) => k + "：" + list.join("、")).join("；")
    : "按 内容 / 结构 / 语言 三个维度逐项检查我的答案，指出最该改的一处，最后给出建议分数。";

  return (
    <article
      id={`rq-${q.id}`}
      className={`result-card st-${q.is_correct === 1 ? "correct" : q.is_correct === 0 ? "wrong" : q.graded_by === "pending" ? "pending" : "plain"}`}
      style={{ scrollMarginTop: 84 }}
    >
      <div className="q-head">
        <span className="q-no">{q.label}</span>
        <Chip>{qtypeLabel(q.qtype)}</Chip>
        <Chip tone={tone as "ok" | "bad" | "warn" | "default"}>{state}</Chip>
        <span className="small muted" style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{(q.score ?? 0)} / {q.points} 分</span>
        <label className="check small" style={{ marginLeft: 10 }}>
          <input type="checkbox" className="checkbox" checked={picked} onChange={onPick} /> 收错题
        </label>
      </div>

      <div className="q-stem" dangerouslySetInnerHTML={{ __html: stemHtml(q.stem) }} />

      {q.options?.length ? (
        <div className="opts" style={{ margin: "10px 0" }}>
          {q.options.map((o) => {
            const right = Array.isArray(q.answer.correct) ? q.answer.correct.includes(o.key) : q.answer.correct === o.key;
            const mine = q.answer_raw?.split(/[,，\s]+/).includes(o.key);
            return (
              <div className={`opt ${right ? "correct" : mine ? "wrong" : ""}`} key={o.key}>
                <b>{o.key}</b>
                <span>{o.text}</span>
                {right ? <span style={{ marginLeft: "auto", display: "flex" }}><CheckCircle2 size={14} /></span> : mine ? <span style={{ marginLeft: "auto", display: "flex" }}><XCircle size={14} /></span> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className={`answer-compare${(correct ?? "").length > 380 || (q.answer_raw ?? "").length > 380 ? " long" : ""}`}>
        <div className="answer-box">
          <div className="label">你的答案</div>
          <div className="value answer-value">{q.answer_raw?.trim() || "未作答"}</div>
        </div>
        <div className="answer-box correct">
          <div className="label">正确答案</div>
          <div className="value answer-value">{correct}</div>
        </div>
      </div>

      {q.comment ? (
        <div className="ai-grade-comment">
          <Sparkles size={13} />
          <span>{q.comment}</span>
        </div>
      ) : null}

      {q.graded_by === "pending" && q.qtype !== "dictation" ? (
        <div className="hstack" style={{ gap: 8, marginBottom: 8 }}>
          <span className="small muted">自评（满分 {q.points}）</span>
          <select className="select" style={{ maxWidth: 120 }} value={q.score ?? 0} onChange={(e) => onGrade(Number(e.target.value))}>
            {Array.from({ length: q.points + 1 }, (_, i) => <option key={i} value={i}>{i} 分</option>)}
          </select>
        </div>
      ) : null}

      <div className="ai-panel no-print">
        <div className="ai-head">
          <Sparkles size={15} style={{ color: "var(--accent)" }} />
          <b style={{ fontSize: 12.5 }}>AI 讲解</b>
          <span className="small muted" style={{ marginLeft: 4 }}>按需展开</span>
        </div>

        <div className="ai-presets">
          <button className="ai-chip" type="button" onClick={() => explain("brief")} disabled={aiBusy}>一句话点破</button>
          <button className="ai-chip" type="button" onClick={() => explain("full")} disabled={aiBusy}>完整解析</button>
          {wrong ? (
            <button className="ai-chip" type="button" onClick={() => explain("followup", "只讲我这题错在哪、正确思路该怎么走，不要重复整段解析。")} disabled={aiBusy}>讲清错因</button>
          ) : null}
          {subjective ? (
            <button className="ai-chip" type="button" onClick={() => explain("followup", rubricAsk)} disabled={aiBusy}>按清单自评</button>
          ) : null}
          {dictationLike ? (
            <button className="ai-chip" type="button" onClick={() => explain("followup", "把正确答案里最容易听错或写错的 3 处挑出来，讲清连读、拼写与词形变化。")} disabled={aiBusy}>易错点</button>
          ) : null}
        </div>

        {rubricItems.length ? (
          <ul className="ai-rubric">
            {rubricItems.map(([k, list]) => (
              <li key={k}><b>{k}</b><span>{list.join("、")}</span></li>
            ))}
          </ul>
        ) : null}

        {q.explanation ? (
          <details className="ai-seed">
            <summary>题目解析</summary>
            <div>{q.explanation}</div>
          </details>
        ) : null}
        {aiBusy ? <div className="small muted" style={{ marginTop: 10 }}>思考中…</div> : null}
        {aiErr ? (
          <div className="small muted" style={{ marginTop: 10, lineHeight: 1.7 }}>
            {noAi ? "还没配置 AI 服务。" : `讲解失败：${aiErr}`}
            <button className="link-inline" onClick={onGoSettings}>去设置</button>
          </div>
        ) : null}
        {ai ? (
          <div style={{ marginTop: 10 }}>
            <Markdown>{ai.content}</Markdown>
            {ai.reasoning ? <details className="reasoning"><summary>思考过程</summary><div style={{ whiteSpace: "pre-wrap" }}>{ai.reasoning}</div></details> : null}
            <FollowUp q={q} onResult={(r) => setAi(r)} onError={(m) => setAiErr(m)} />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function FollowUp({ q, onResult, onError }: { q: AttemptQuestion; onResult: (r: { content: string; reasoning: string }) => void; onError: (m: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await api.aiExplain({ questionId: q.id, mode: "followup", customPrompt: "", followup: text, thinking: false });
      onResult(r);
      setText("");
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hstack" style={{ gap: 6, marginTop: 10 }}>
      <input
        className="input"
        placeholder="追问：为什么 B 不对？"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") send();
        }}
      />
      <Button size="sm" variant="primary" onClick={send} disabled={busy || !text.trim()}>追问</Button>
    </div>
  );
}

function stemHtml(text: string) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/_{2,}/g, '<span class="blank"></span>');
}