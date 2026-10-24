import { Fragment } from "react";
import type { ReactNode } from "react";
import { richInlineHtml, richMaterialHtml, richStemHtml, richTextHtml } from "../lib/richText";
import type { Material, Question, Section } from "../lib/types";
import "../styles/paper.css";

export type PaperGroup = {
  id: string | number;
  title: string;
  meta?: string;
  section?: Section | null;
  questions: Question[];
  supplementary?: boolean;
};

export type PaperQuestionProps = {
  q: Question;
  current?: boolean;
  flash?: boolean;
  selected?: boolean;
  onSelect?: (q: Question) => void;
  onToggle?: (q: Question) => void;
  action?: ReactNode;
  answer?: ReactNode;
  footer?: ReactNode;
  showAnswer?: boolean;
  className?: string;
};

export type PaperSectionProps = {
  group: PaperGroup;
  materials: Map<number, Material>;
  currentId?: number | null;
  flashId?: number | null;
  selectedIds?: ReadonlySet<number>;
  showAnswer?: boolean;
  renderQuestion?: (q: Question, group: PaperGroup) => ReactNode;
  onSelect?: (q: Question) => void;
  onToggle?: (q: Question) => void;
  renderMergedAnswer?: (q: Question, group: PaperGroup) => ReactNode;
  className?: string;
};

export type PaperDocProps = {
  groups: PaperGroup[];
  materials: Map<number, Material>;
  title?: string;
  eyebrow?: string;
  meta?: string[];
  showAnswer?: boolean;
  renderQuestion?: (q: Question, group: PaperGroup) => ReactNode;
  currentId?: number | null;
  flashId?: number | null;
  selectedIds?: ReadonlySet<number>;
  onSelect?: (q: Question) => void;
  onToggle?: (q: Question) => void;
  renderMergedAnswer?: (q: Question, group: PaperGroup) => ReactNode;
  className?: string;
  headerExtra?: ReactNode;
};

export type MaterialBlockProps = {
  material: Material;
  className?: string;
  questionIds?: number[];
  active?: boolean;
  /** 用来把材料里的空位对应到题目与答案；不传时只显示编号和空位。 */
  questions?: Question[];
  /** 交卷后为 true：行内空位回填答案。 */
  showAnswer?: boolean;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function PaperDoc({
  groups,
  materials,
  title,
  eyebrow,
  meta,
  showAnswer = false,
  renderQuestion,
  currentId = null,
  flashId = null,
  selectedIds,
  onSelect,
  onToggle,
  renderMergedAnswer,
  className,
  headerExtra,
}: PaperDocProps) {
  const hasHead = Boolean(title || eyebrow || (meta && meta.length) || headerExtra);
  return (
    <article className={cx("paper-sheet", className)}>
      {hasHead ? (
        <header className="paper-mast">
          {eyebrow ? <div className="paper-mast-eyebrow">{eyebrow}</div> : null}
          {title ? <h2>{title}</h2> : null}
          {meta && meta.length ? (
            <div className="paper-mast-meta">
              {meta.map((item, index) => (
                <span key={index}>{item}</span>
              ))}
            </div>
          ) : null}
          {headerExtra ? <div className="paper-mast-extra">{headerExtra}</div> : null}
        </header>
      ) : null}
      {groups.length === 0 ? <div className="empty">这份试卷还没有题目。</div> : null}
      {groups.map((group) => (
        <PaperSection
          key={group.id}
          group={group}
          materials={materials}
          showAnswer={showAnswer}
          renderQuestion={renderQuestion}
          currentId={currentId}
          flashId={flashId}
          selectedIds={selectedIds}
          onSelect={onSelect}
          onToggle={onToggle}
          renderMergedAnswer={renderMergedAnswer}
        />
      ))}
    </article>
  );
}

export function PaperSection({
  group,
  materials,
  currentId = null,
  flashId = null,
  selectedIds,
  showAnswer = false,
  renderQuestion,
  onSelect,
  onToggle,
  renderMergedAnswer,
  className,
}: PaperSectionProps) {
  const sectionMaterial =
    group.section && group.section.material_id != null ? materials.get(group.section.material_id) : undefined;
  const cloze = group.questions.find((q) => q.qtype === "cloze" && q.options.length > 0);
  const materialQuestion = group.questions.find((q) => q.material_id != null && materials.has(q.material_id));
  const sharedMaterial =
    sectionMaterial ?? (materialQuestion ? materials.get(materialQuestion.material_id as number) : undefined);
  const blankDriven = Boolean(sharedMaterial) && group.questions.length > 0 && group.questions.every((q) => {
    if (q.qtype !== "cloze" && q.qtype !== "fill_blank" && q.qtype !== "dictation") return false;
    if (q.material_id == null) return Boolean(sectionMaterial && sectionMaterial.id === sharedMaterial?.id);
    return q.material_id === sharedMaterial?.id;
  });
  const active = currentId != null && group.questions.some((q) => q.id === currentId);
  const inlineBlanks = sharedMaterial ? scanBlanks(sharedMaterial.content).length > 0 : false;
  const blocks: ReactNode[] = [];
  let cluster: ReactNode[] = [];
  let lastMaterial = sharedMaterial ? sharedMaterial.id : sectionMaterial ? sectionMaterial.id : null;

  const flushCluster = () => {
    if (!cluster.length) return;
    blocks.push(
      <div className="paper-cluster" key={"cluster-" + group.id + "-" + blocks.length}>
        {cluster}
      </div>,
    );
    cluster = [];
  };

  const renderOne = (q: Question): ReactNode => {
    if (renderQuestion) {
      return (
        <Fragment key={q.id}>
          {renderQuestion(q, group)}
        </Fragment>
      );
    }
    return (
      <PaperQuestion
        key={q.id}
        q={q}
        current={currentId === q.id}
        flash={flashId === q.id}
        selected={selectedIds ? selectedIds.has(q.id) : false}
        showAnswer={showAnswer}
        onSelect={onSelect}
        onToggle={onToggle}
      />
    );
  };

  for (const q of group.questions) {
    if (q.material_id != null && q.material_id !== lastMaterial) {
      const material = materials.get(q.material_id);
      if (material) {
        flushCluster();
        blocks.push(
          <MaterialBlock
            key={"material-" + material.id}
            material={material}
            questions={group.questions}
            showAnswer={showAnswer}
          />,
        );
        lastMaterial = material.id;
      }
    }
    if (isMaterialRelated(q, group)) {
      cluster.push(renderOne(q));
    } else {
      flushCluster();
      blocks.push(renderOne(q));
    }
  }
  flushCluster();

  return (
    <section className={cx("paper-sec", className)}>
      <header className="paper-sec-head">
        <h2>{group.title}</h2>
        {group.meta ? <span className="paper-sec-meta">{group.meta}</span> : null}
      </header>
      {group.section && group.section.instructions ? <p className="paper-instr">{group.section.instructions}</p> : null}
      {group.supplementary ? <p className="paper-instr">以下题目不属于本卷，作为补充练习单独作答。</p> : null}
      {sharedMaterial ? (
        <MaterialBlock
          material={sharedMaterial}
          questionIds={group.questions.map((q) => q.id)}
          active={active || (flashId != null && group.questions.some((q) => q.id === flashId))}
          questions={group.questions}
          showAnswer={showAnswer}
        />
      ) : null}
      {cloze ? (
        <div className="paper-bank">
          <div className="paper-bank-title">词库</div>
          <div className="paper-bank-grid">
            {cloze.options.map((option) => (
              <span key={option.key}>
                <b>{option.key}</b>
                {option.text}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {blankDriven ? (
        <>
          {showAnswer ? (
            <PaperAnswerKey
              questions={group.questions}
              renderAnswer={renderMergedAnswer ? (q) => renderMergedAnswer(q, group) : undefined}
            />
          ) : null}
          {!showAnswer && !inlineBlanks ? <PaperAnswerArea questions={group.questions} /> : null}
        </>
      ) : (
        blocks
      )}
    </section>
  );
}

/* ---------- 材料内空位 ---------- */

// 新材料支持 {{blank:31}} / {{blank:31|兜底文本}}；旧材料里的 (31) ______ 同样识别。
const BLANK_SOURCE = String.raw`\{\{\s*blank\s*:\s*([^}|]+?)\s*(?:\|\s*([^}]*?)\s*)?\}\}|\((\d+)\)\s*_{2,}`;

type BlankHit = { start: number; end: number; label: string; fallback: string };

function scanBlanks(text: string): BlankHit[] {
  const re = new RegExp(BLANK_SOURCE, "g");
  const hits: BlankHit[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    hits.push({
      start: match.index,
      end: match.index + match[0].length,
      label: String(match[1] ?? match[3] ?? "").trim(),
      fallback: String(match[2] ?? "").trim(),
    });
  }
  return hits;
}

function blankKey(value: string) {
  return value
    .trim()
    .replace(/^[（(]+/, "")
    .replace(/[)）]+$/, "")
    .replace(/^q/i, "")
    .trim();
}

function blankQuestionMap(questions: Question[]) {
  const map = new Map<string, Question>();
  for (const question of questions) {
    map.set(blankKey(String(question.number)), question);
    map.set(blankKey(shortNo(question)), question);
    if (question.label) map.set(blankKey(question.label), question);
  }
  return map;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 空位答案：优先正确项；完形把选项字母补成「字母 / 文本」，没有答案时再用行内兜底。 */
function blankAnswer(q: Question | undefined, fallback?: string) {
  const correct = q?.answer?.correct;
  let value = Array.isArray(correct)
    ? correct.filter(Boolean).map(String).join(" / ")
    : correct != null
      ? String(correct).trim()
      : "";
  if (q && q.qtype === "cloze" && value) {
    const keys = value.split(" / ").map((key) => key.trim()).filter(Boolean);
    const texts = keys
      .map((key) => q.options.find((option) => option.key.toUpperCase() === key.toUpperCase())?.text)
      .filter(Boolean);
    if (texts.length) value = keys.join(" / ") + " / " + texts.join(" / ");
  }
  if (!value && q?.answer?.reference) value = q.answer.reference;
  if (!value && fallback) value = fallback;
  return value;
}

function inlineBlankHtml(label: string, answer: string, showAnswer: boolean, inlineLine: boolean) {
  const number = escapeHtml(label);
  const line = inlineLine
    ? '<span class="blank" style="display:inline-block;min-width:64px;height:1em;margin:0 2px;border-bottom:1px solid var(--text-3);vertical-align:-0.15em"></span>'
    : '<span class="blank"></span>';
  const value = showAnswer
    ? ' <span class="paper-answer-key-value">' + escapeHtml(answer || "—") + "</span>"
    : line;
  return '<span class="paper-inline-blank"><span class="paper-inline-blank-no">(' + number + ")</span>" + value + "</span>";
}

function inlineBlankNode(label: string, answer: string, showAnswer: boolean, qid?: number) {
  return (
    <span className="paper-inline-blank" data-blank={label} data-q={qid}>
      <span className="paper-inline-blank-no">({label})</span>
      {showAnswer ? (
        <>
          {" "}
          <span className="paper-answer-key-value">{answer || "—"}</span>
        </>
      ) : (
        <span
          className="blank"
          style={{
            display: "inline-block",
            minWidth: 64,
            height: "1em",
            margin: "0 2px",
            borderBottom: "1px solid var(--text-3)",
            verticalAlign: "-0.15em",
          }}
        />
      )}
    </span>
  );
}

function materialTextNodes(content: string, questions: Question[], showAnswer: boolean) {
  const hits = scanBlanks(content);
  if (!hits.length) return content;
  const map = blankQuestionMap(questions);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  hits.forEach((hit, index) => {
    if (hit.start > cursor) nodes.push(content.slice(cursor, hit.start));
    const question = map.get(blankKey(hit.label));
    nodes.push(
      <Fragment key={"blank-" + index + "-" + hit.label}>
        {inlineBlankNode(hit.label, blankAnswer(question, hit.fallback), showAnswer, question?.id)}
      </Fragment>,
    );
    cursor = hit.end;
  });
  if (cursor < content.length) nodes.push(content.slice(cursor));
  return nodes;
}

function materialHtml(content: string, questions: Question[], showAnswer: boolean) {
  const hits = scanBlanks(content);
  if (!hits.length) return richTextHtml(content, true);
  const map = blankQuestionMap(questions);
  let html = "";
  let cursor = 0;
  for (const hit of hits) {
    html += richTextHtml(content.slice(cursor, hit.start), true);
    const question = map.get(blankKey(hit.label));
    html += inlineBlankHtml(hit.label, blankAnswer(question, hit.fallback), showAnswer, true);
    cursor = hit.end;
  }
  return html + richTextHtml(content.slice(cursor), true);
}

function stemHtml(text: string, q: Question, showAnswer: boolean) {
  const hits = scanBlanks(text);
  if (!hits.length) return richStemHtml(text, true);
  const map = blankQuestionMap([q]);
  const fills: string[] = [];
  let marked = "";
  let cursor = 0;
  for (const hit of hits) {
    marked += text.slice(cursor, hit.start);
    const question = map.get(blankKey(hit.label));
    fills.push(inlineBlankHtml(hit.label, blankAnswer(question, hit.fallback), showAnswer, false));
    marked += "\uE000" + (fills.length - 1) + "\uE001";
    cursor = hit.end;
  }
  marked += text.slice(cursor);
  let html = richStemHtml(marked, true);
  fills.forEach((fill, index) => {
    html = html.split("\uE000" + index + "\uE001").join(fill);
  });
  return html;
}

/** 没有行内空位的材料题组，交卷前也要给出可书写的答题区。 */
function PaperAnswerArea({ questions }: { questions: Question[] }) {
  return (
    <div className="paper-answer-area paper-answer-key">
      <div className="paper-answer-key-title">作答区</div>
      {questions.map((q) => {
        const lines = q.qtype === "dictation" ? 4 : q.qtype === "short_answer" || q.qtype === "writing" ? 2 : 1;
        return (
          <div className="paper-answer-key-row" key={q.id}>
            <span className="paper-answer-key-no">{shortNo(q)}</span>
            <div className="paper-answer-key-body">
              {Array.from({ length: lines }, (_, index) => (
                <span
                  key={index}
                  className="paper-answer-line"
                  style={{
                    display: "block",
                    height: "1.55em",
                    borderBottom: "1px dashed var(--line)",
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MaterialBlock({
  material,
  className,
  questionIds,
  active = false,
  questions = [],
  showAnswer = false,
}: MaterialBlockProps) {
  const richMaterial = richMaterialHtml(material.content);
  const hasMedia = Boolean(richMaterial);
  const richMaterialHtmlWithBlanks = hasMedia ? materialHtml(material.content, questions, showAnswer) : null;
  return (
    <div className={cx("paper-material", active && "is-active", className)}>
      {questionIds
        ? questionIds.map((id) => <span key={id} id={"paper-q-" + id} className="paper-anchor" aria-hidden="true" />)
        : null}
      {material.title ? <div className="paper-material-title">{material.title}</div> : null}
      {hasMedia ? (
        <div
          className="paper-material-body"
          dangerouslySetInnerHTML={{ __html: richMaterialHtmlWithBlanks ?? "" }}
        />
      ) : (
        <div className="paper-material-body">{materialTextNodes(material.content, questions, showAnswer)}</div>
      )}
    </div>
  );
}

function answerValue(q: Question) {
  const correct = q.answer ? q.answer.correct : undefined;
  if (Array.isArray(correct)) return correct.filter(Boolean).join(" / ");
  if (correct) return String(correct);
  if (q.answer && q.answer.reference) return q.answer.reference;
  return "见参考答案";
}

/** 材料题组（完形、听写、填空）的答案附注：只列题号与答案，不重复原题。 */
export function PaperAnswerKey({
  questions,
  renderAnswer,
}: {
  questions: Question[];
  renderAnswer?: (q: Question) => ReactNode;
}) {
  return (
    <div className="paper-answer-key">
      <div className="paper-answer-key-title">答案与解析</div>
      {questions.map((q) => (
        <div className="paper-answer-key-row" key={q.id}>
          <span className="paper-answer-key-no">{shortNo(q)}</span>
          <div className="paper-answer-key-body">
            {renderAnswer ? (
              renderAnswer(q)
            ) : (
              <>
                <div className="paper-answer-key-value" dangerouslySetInnerHTML={{ __html: richTextHtml(answerValue(q), true) }} />
                {q.explanation ? <div className="paper-answer-key-note" dangerouslySetInnerHTML={{ __html: richTextHtml(q.explanation, true) }} /> : null}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function stemWithoutOwnNo(stem: string, own: string) {
  const trimmed = (stem || "").replace(/^\s+/, "");
  const escaped = own.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = new RegExp("^" + escaped + "\\s*[.、．)）]\\s*");
  return prefix.test(trimmed) ? trimmed.replace(prefix, "") : stem;
}

export function PaperQuestion({
  q,
  current = false,
  flash = false,
  selected = false,
  onSelect,
  onToggle,
  action,
  answer,
  footer,
  showAnswer = false,
  className,
}: PaperQuestionProps) {
  const options = q.qtype === "cloze" ? [] : q.options;
  const stem = stemWithoutOwnNo(q.stem, shortNo(q));
  const clickable = Boolean(onSelect || onToggle);
  const activate = () => {
    if (onToggle) {
      onToggle(q);
      return;
    }
    if (onSelect) onSelect(q);
  };
  return (
    <article
      className={cx(
        "paper-q",
        current && "is-current",
        flash && "is-flash",
        selected && "is-selected",
        clickable && "is-clickable",
        className,
      )}
      id={"paper-q-" + q.id}
      data-paper-q={q.id}
      onClick={clickable ? activate : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activate();
              }
            }
          : undefined
      }
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      <div className="paper-q-head">
        <span className="paper-q-no">{shortNo(q)}</span>
        {q.points !== 1 ? <span className="paper-q-points">{q.points} 分</span> : null}
        {action ? <div className="paper-q-action">{action}</div> : null}
      </div>
      <div className="paper-q-stem" dangerouslySetInnerHTML={{ __html: stemHtml(stem, q, showAnswer) }} />
      {options.length ? (
        <div className="paper-opts">
          {options.map((option) => (
            <div className="paper-opt" key={option.key}>
              <b>{option.key}</b>
              <span dangerouslySetInnerHTML={{ __html: richInlineHtml(option.text) }} />
            </div>
          ))}
        </div>
      ) : null}
      {showAnswer && answer ? <div className="paper-answer">{answer}</div> : null}
      {footer ? <div className="paper-q-foot">{footer}</div> : null}
    </article>
  );
}

export function shortNo(q: Question) {
  const label = (q.label || "")
    .trim()
    .replace(/^[（(]+/, "")
    .replace(/[)）]+$/, "")
    .trim();
  if (label && label.length <= 4 && !/[一-龥]/.test(label)) return label;
  return String(q.number);
}

export function shortSection(title: string) {
  const parts = (title || "")
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : title;
}

function isMaterialRelated(q: Question, group: PaperGroup) {
  if (q.material_id != null) return true;
  if (group.section && group.section.material_id != null) return true;
  if (q.qtype === "cloze" || q.qtype === "fill_blank" || q.qtype === "dictation" || q.qtype === "matching") {
    return true;
  }
  const kind = group.section ? group.section.kind : "";
  return /listen|read|听力|阅读/i.test(kind);
}
