import "./../styles/tags.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { ArrowRight, Check, Loader2, MoreHorizontal, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import type { TagGroup, TagInfo, TagSuggestion } from "../lib/types";
import { Button, Modal } from "./ui";

/**
 * 标签栏工作台：按标签栏分组展示标签，支持拖放归类、增删改栏和 AI 整理。
 * 数据由外部传入（tags/groups），每次写操作成功后调用 onChanged 让调用方刷新。
 */
export type TagBoardProps = {
  tags: TagInfo[];
  groups: TagGroup[];
  selected?: string[];
  onToggle?: (tag: string) => void;
  onChanged: () => void;
  compact?: boolean;
};

const TAG_COLORS = ["violet", "teal", "amber", "rose", "slate"] as const;
type TagColor = (typeof TAG_COLORS)[number];
const COLOR_LABEL: Record<TagColor, string> = {
  violet: "紫",
  teal: "青",
  amber: "琥珀",
  rose: "玫红",
  slate: "灰",
};

function isTagColor(value: string): value is TagColor {
  return (TAG_COLORS as readonly string[]).includes(value);
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "操作没有完成，请重试。";
}

function tagUsage(tag: TagInfo) {
  return tag.set_count + tag.question_count;
}

function sortTags(tags: TagInfo[]) {
  return [...tags].sort((a, b) => tagUsage(b) - tagUsage(a) || a.name.localeCompare(b.name, "zh"));
}

type GroupDialog = { mode: "create" } | { mode: "rename"; group: TagGroup };
type MoveMenu = { tag: string; x: number; y: number };
const MOVE_MENU_WIDTH = 220;
const DRAG_THRESHOLD = 6;

export function TagBoard({ tags, groups, selected = [], onToggle, onChanged, compact = false }: TagBoardProps) {
  const [dragTag, setDragTag] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [movingTag, setMovingTag] = useState<string | null>(null);
  const [groupDialog, setGroupDialog] = useState<GroupDialog | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState<TagColor>("violet");
  const [dialogError, setDialogError] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TagGroup | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [moveMenu, setMoveMenu] = useState<MoveMenu | null>(null);
  const [deleteTagTarget, setDeleteTagTarget] = useState<string | null>(null);
  const [deleteTagError, setDeleteTagError] = useState("");
  const [deletingTag, setDeletingTag] = useState(false);
  const dragRef = useRef<{ tag: string; pointerId: number; startX: number; startY: number; active: boolean } | null>(null);
  const suppressClickRef = useRef(0);
  const moveTagRef = useRef<(tag: string, groupId: number | null) => void>(() => {});

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const orderedGroups = useMemo(
    () => [...groups].sort((a, b) => a.position - b.position || a.id - b.id),
    [groups],
  );

  const knownGroupIds = useMemo(() => new Set(orderedGroups.map((group) => group.id)), [orderedGroups]);

  const bucket = useMemo(() => {
    const map = new Map<number | null, TagInfo[]>();
    for (const tag of tags) {
      const key = tag.group_id != null && knownGroupIds.has(tag.group_id) ? tag.group_id : null;
      const list = map.get(key);
      if (list) list.push(tag);
      else map.set(key, [tag]);
    }
    for (const [key, list] of map) map.set(key, sortTags(list));
    return map;
  }, [tags, knownGroupIds]);

  const ungrouped = bucket.get(null) ?? [];
  const groupByName = useMemo(() => new Map(orderedGroups.map((group) => [group.name, group])), [orderedGroups]);
  const currentGroupName = useMemo(() => new Map(tags.map((tag) => [tag.name, tag.group_name])), [tags]);
  const checkedCount = suggestions.filter((item) => checked.has(item.tag)).length;

  function keyOf(groupId: number | null) {
    return groupId == null ? "ungrouped" : `group-${groupId}`;
  }

  async function moveTag(tag: string, groupId: number | null) {
    const info = tags.find((item) => item.name === tag);
    if (!info || (info.group_id ?? null) === groupId) return;
    setMovingTag(tag);
    try {
      await api.assignTagGroup(tag, groupId);
      onChanged();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setMovingTag(null);
      setDragTag(null);
      setOverKey(null);
    }
  }

  useEffect(() => {
    moveTagRef.current = (tag, groupId) => {
      void moveTag(tag, groupId);
    };
  });

  // 拖动期间在 window 上监听指针移动：标签栏在弹窗里，跨栏拖动时指针会离开源标签，
  // 直接在 window 上跟踪比依赖 pointer capture 更稳。
  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.active) {
        const moved =
          Math.abs(event.clientX - drag.startX) >= DRAG_THRESHOLD ||
          Math.abs(event.clientY - drag.startY) >= DRAG_THRESHOLD;
        if (!moved) return;
        drag.active = true;
        setDragTag(drag.tag);
        setMoveMenu(null);
      }
      event.preventDefault();
      const groupId = groupUnderPoint(event.clientX, event.clientY);
      setOverKey(groupId === undefined ? null : keyOf(groupId));
    }
    function onPointerUp(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const groupId = groupUnderPoint(event.clientX, event.clientY);
      dragRef.current = null;
      setDragTag(null);
      setOverKey(null);
      if (!drag.active) return;
      suppressClickRef.current = Date.now() + 400;
      if (groupId !== undefined) moveTagRef.current(drag.tag, groupId);
    }
    function onPointerCancel(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setDragTag(null);
      setOverKey(null);
    }
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, []);

  /** 指针所在位置对应的标签栏；undefined 表示没落在任何栏上。 */
  function groupUnderPoint(x: number, y: number): number | null | undefined {
    const element = document.elementFromPoint(x, y);
    const holder = element?.closest<HTMLElement>("[data-drop-group]");
    if (!holder) return undefined;
    const raw = holder.dataset.dropGroup;
    if (raw == null || raw === "null") return null;
    const id = Number(raw);
    return Number.isFinite(id) ? id : undefined;
  }

  function beginDrag(event: ReactPointerEvent<HTMLSpanElement>, tag: string) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as Element | null)?.closest("button")) return;
    if (movingTag) return;
    dragRef.current = {
      tag,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  }

  function openMoveMenu(tag: string, x: number, y: number) {
    const height = 48 + (orderedGroups.length + 1) * 34;
    setMoveMenu({
      tag,
      x: Math.max(8, Math.min(x, window.innerWidth - MOVE_MENU_WIDTH - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }

  function openMoveMenuFromButton(event: ReactMouseEvent<HTMLButtonElement>, tag: string) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openMoveMenu(tag, rect.right - MOVE_MENU_WIDTH, rect.bottom + 6);
  }

  function pickMove(groupId: number | null) {
    const tag = moveMenu?.tag;
    setMoveMenu(null);
    if (tag) void moveTag(tag, groupId);
  }

  async function confirmDeleteTag() {
    if (!deleteTagTarget) return;
    setDeletingTag(true);
    setDeleteTagError("");
    try {
      await api.deleteTag(deleteTagTarget);
      toast.success("已删除标签");
      setDeleteTagTarget(null);
      onChanged();
    } catch (error) {
      setDeleteTagError(errorText(error));
      toast.error(errorText(error));
    } finally {
      setDeletingTag(false);
    }
  }

  useEffect(() => {
    if (!moveMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".tag-move-menu")) return;
      setMoveMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoveMenu(null);
    };
    const onScroll = () => setMoveMenu(null);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [moveMenu]);

  function openCreate() {
    setDraftName("");
    setDraftColor("violet");
    setDialogError("");
    setGroupDialog({ mode: "create" });
  }

  function openRename(group: TagGroup) {
    setDraftName(group.name);
    setDraftColor(isTagColor(group.color) ? group.color : "violet");
    setDialogError("");
    setGroupDialog({ mode: "rename", group });
  }

  async function submitGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!groupDialog) return;
    const name = draftName.trim();
    if (!name) {
      setDialogError("标签栏名称不能为空。");
      return;
    }
    const conflict = orderedGroups.some(
      (group) => group.name === name && (groupDialog.mode === "create" || group.id !== groupDialog.group.id),
    );
    if (conflict) {
      setDialogError(`已经有「${name}」这一栏了。`);
      return;
    }
    setSavingGroup(true);
    setDialogError("");
    try {
      if (groupDialog.mode === "create") {
        await api.createTagGroup(name, draftColor);
        toast.success("标签栏已新建");
      } else {
        await api.renameTagGroup(groupDialog.group.id, name, draftColor);
        toast.success("标签栏已更新");
      }
      setGroupDialog(null);
      onChanged();
    } catch (error) {
      setDialogError(errorText(error));
    } finally {
      setSavingGroup(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api.deleteTagGroup(deleteTarget.id);
      toast.success(`已删除「${deleteTarget.name}」`);
      setDeleteTarget(null);
      onChanged();
    } catch (error) {
      setDeleteError(errorText(error));
    } finally {
      setDeleting(false);
    }
  }

  async function loadSuggestions() {
    setAiBusy(true);
    setAiError("");
    try {
      const next = await api.aiOrganizeTags();
      setSuggestions(next);
      setChecked(new Set(next.filter((item) => item.group.trim()).map((item) => item.tag)));
    } catch (error) {
      setSuggestions([]);
      setChecked(new Set());
      setAiError(errorText(error));
      toast.error(errorText(error));
    } finally {
      setAiBusy(false);
    }
  }

  function openAi() {
    setAiOpen(true);
    setSuggestions([]);
    setChecked(new Set());
    setAiError("");
    void loadSuggestions();
  }

  async function applySuggestions() {
    const items = suggestions.filter((item) => checked.has(item.tag));
    if (items.length === 0) return;
    setAiBusy(true);
    setAiError("");
    try {
      await api.applyTagSuggestions(items);
      toast.success(`已归类 ${items.length} 个标签`);
      setAiOpen(false);
      onChanged();
    } catch (error) {
      setAiError(errorText(error));
      toast.error(errorText(error));
    } finally {
      setAiBusy(false);
    }
  }

  function toggleChecked(tag: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  function renderChip(tag: TagInfo) {
    const active = selectedSet.has(tag.name);
    const color = isTagColor(tag.group_color) ? tag.group_color : undefined;
    const dragging = dragTag === tag.name;
    return (
      <span
        key={tag.name}
        className={clsx("tag-chip", "is-draggable")}
        data-color={color}
        data-selected={active ? "true" : "false"}
        data-dragging={dragging ? "true" : "false"}
        data-moving={movingTag === tag.name ? "true" : "false"}
        role="button"
        tabIndex={0}
        aria-pressed={onToggle ? active : undefined}
        title={tag.name + " · 试卷 " + tag.set_count + " · 题目 " + tag.question_count + "｜拖到标签栏可归类，⋯ 可移动，× 可删除"}
        style={{ touchAction: "none", userSelect: "none" }}
        onClick={() => {
          if (Date.now() < suppressClickRef.current) return;
          onToggle?.(tag.name);
        }}
        onKeyDown={(event: ReactKeyboardEvent<HTMLSpanElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle?.(tag.name);
          }
        }}
        onPointerDown={(event) => beginDrag(event, tag.name)}
        onContextMenu={(event) => {
          event.preventDefault();
          openMoveMenu(tag.name, event.clientX, event.clientY);
        }}
      >
        <span className="tag-chip-name">{tag.name}</span>
        <button
          type="button"
          className="tag-chip-x"
          title="移动到其他标签栏"
          aria-label={"移动标签 " + tag.name}
          onClick={(event) => openMoveMenuFromButton(event, tag.name)}
        >
          <MoreHorizontal size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="tag-chip-x"
          title="删除标签"
          aria-label={"删除标签 " + tag.name}
          onClick={(event) => {
            event.stopPropagation();
            setMoveMenu(null);
            setDeleteTagError("");
            setDeleteTagTarget(tag.name);
          }}
        >
          <X size={11} aria-hidden="true" />
        </button>
      </span>
    );
  }

  function renderGroup(group: TagGroup) {
    const list = bucket.get(group.id) ?? [];
    const color = isTagColor(group.color) ? group.color : undefined;
    const key = keyOf(group.id);
    return (
      <section
        key={group.id}
        className="tag-group"
        data-color={color}
        data-drop-group={String(group.id)}
        data-drag-over={overKey === key ? "true" : undefined}
      >
        <header className="tag-group-head">
          <span className="tag-group-dot" aria-hidden="true" />
          <h4 className="tag-group-name">{group.name}</h4>
          <span className="tag-group-num" title="标签数量">
            {list.length}
          </span>
          <div className="tag-group-acts">
            <button type="button" className="tag-icon" title={`重命名「${group.name}」`} aria-label={`重命名 ${group.name}`} onClick={() => openRename(group)}>
              <Pencil size={14} />
            </button>
            <button
              type="button"
              className="tag-icon is-danger"
              title={`删除「${group.name}」`}
              aria-label={`删除 ${group.name}`}
              onClick={() => {
                setDeleteError("");
                setDeleteTarget(group);
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </header>
        {list.length > 0 ? (
          <div className="tag-group-chips">{list.map(renderChip)}</div>
        ) : (
          <div className="tag-group-empty">把标签拖到这里</div>
        )}
      </section>
    );
  }

  const moveCurrent = moveMenu ? tags.find((tag) => tag.name === moveMenu.tag)?.group_id ?? null : null;

  return (
    <section className="tag-board" data-compact={compact ? "true" : "false"} data-dragging={dragTag ? "true" : "false"}>
      <header className="tag-board-head">
        <div className="tag-board-meta">
          <span className="tag-board-title">标签栏</span>
          <span className="tag-board-sub">
            {tags.length} 个标签 · {ungrouped.length} 个未归类
          </span>
        </div>
        <div className="tag-board-acts">
          <Button size="sm" variant="soft" onClick={openAi} disabled={aiBusy || tags.length === 0}>
            {aiBusy ? <Loader2 size={14} className="tag-spin" /> : <Sparkles size={14} />}
            AI 整理
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} />
            新建栏
          </Button>
        </div>
      </header>

      {tags.length === 0 ? <div className="tag-board-empty">还没有标签。先给试卷或题目打标签，再回来归类。</div> : null}

      <div className="tag-groups">
        {orderedGroups.map(renderGroup)}
        <section
          className="tag-group is-ungrouped"
          data-color="slate"
          data-drop-group="null"
          data-drag-over={overKey === "ungrouped" ? "true" : undefined}
        >
          <header className="tag-group-head">
            <span className="tag-group-dot" aria-hidden="true" />
            <h4 className="tag-group-name">未归类</h4>
            <span className="tag-group-num" title="标签数量">
              {ungrouped.length}
            </span>
          </header>
          {ungrouped.length > 0 ? (
            <div className="tag-group-chips">{ungrouped.map(renderChip)}</div>
          ) : (
            <div className="tag-group-empty">把标签拖到这里可移出标签栏</div>
          )}
        </section>
      </div>

      <Modal
        open={groupDialog != null}
        onClose={() => setGroupDialog(null)}
        title={groupDialog?.mode === "rename" ? "重命名标签栏" : "新建标签栏"}
        width={420}
      >
        <form onSubmit={submitGroup}>
          <div className="field">
            <label htmlFor="tag-group-name">名称</label>
            <input
              id="tag-group-name"
              className="input"
              value={draftName}
              autoFocus
              maxLength={20}
              placeholder="例如：主题、来源"
              onChange={(event) => setDraftName(event.target.value)}
            />
          </div>
          <div className="field tag-color-field">
            <label>颜色</label>
            <div className="tag-swatches" role="group" aria-label="标签栏颜色">
              {TAG_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="swatch tag-swatch"
                  data-color={color}
                  data-on={draftColor === color ? "true" : "false"}
                  aria-label={COLOR_LABEL[color]}
                  aria-pressed={draftColor === color}
                  title={COLOR_LABEL[color]}
                  onClick={() => setDraftColor(color)}
                />
              ))}
            </div>
          </div>
          {dialogError ? (
            <div className="tag-alert" role="alert">
              {dialogError}
            </div>
          ) : null}
          <div className="tag-modal-foot">
            <Button type="button" variant="ghost" onClick={() => setGroupDialog(null)}>
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={savingGroup}>
              {savingGroup ? "保存中…" : groupDialog?.mode === "rename" ? "保存" : "新建"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={deleteTarget != null} onClose={() => setDeleteTarget(null)} title="删除标签栏" width={440}>
        <p className="tag-dialog-text">
          删除「{deleteTarget?.name}」后，这一栏里的标签会变成未归类，标签本身不会被删除。
        </p>
        {deleteError ? (
          <div className="tag-alert" role="alert">
            {deleteError}
          </div>
        ) : null}
        <div className="tag-modal-foot">
          <Button type="button" variant="ghost" onClick={() => setDeleteTarget(null)}>
            取消
          </Button>
          <Button type="button" variant="danger" disabled={deleting} onClick={() => void confirmDelete()}>
            {deleting ? "删除中…" : "删除"}
          </Button>
        </div>
      </Modal>

      <Modal
        open={deleteTagTarget != null}
        onClose={() => {
          if (!deletingTag) setDeleteTagTarget(null);
        }}
        title="删除标签"
        width={440}
      >
        <p className="tag-dialog-text">
          确定删除「{deleteTagTarget}」？它会从所有试卷和题目上移除，且不可恢复。
        </p>
        {deleteTagError ? (
          <div className="tag-alert" role="alert">
            {deleteTagError}
          </div>
        ) : null}
        <div className="tag-modal-foot">
          <Button type="button" variant="ghost" onClick={() => setDeleteTagTarget(null)} disabled={deletingTag}>
            取消
          </Button>
          <Button type="button" variant="danger" disabled={deletingTag} onClick={() => void confirmDeleteTag()}>
            {deletingTag ? "删除中…" : "删除标签"}
          </Button>
        </div>
      </Modal>

      <Modal
        open={aiOpen}
        onClose={() => {
          if (aiBusy) return;
          setAiOpen(false);
        }}
        title="AI 整理标签"
        width={620}
      >
        {suggestions.length > 0 ? (
          <div className="tag-ai-summary">
            共 {suggestions.length} 条建议，已选 {checkedCount} 条
          </div>
        ) : null}
        {aiBusy && suggestions.length === 0 ? (
          <div className="tag-ai-loading">
            <Loader2 size={16} className="tag-spin" />
            正在整理标签…
          </div>
        ) : null}
        {aiError ? (
          <div className="tag-ai-error">
            <div className="tag-alert" role="alert">
              {aiError}
            </div>
            <Button size="sm" variant="soft" onClick={() => void loadSuggestions()} disabled={aiBusy}>
              重试
            </Button>
          </div>
        ) : null}
        {suggestions.length > 0 ? (
          <div className="tag-ai-list">
            {suggestions.map((item) => {
              const group = groupByName.get(item.group.trim());
              const color = group && isTagColor(group.color) ? group.color : undefined;
              const current = (currentGroupName.get(item.tag) ?? "").trim();
              return (
                <label key={item.tag} className="tag-ai-row" data-checked={checked.has(item.tag) ? "true" : "false"}>
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={checked.has(item.tag)}
                    onChange={() => toggleChecked(item.tag)}
                  />
                  <span className="tag-ai-tag" title={item.tag}>
                    {item.tag}
                  </span>
                  <ArrowRight size={13} className="tag-ai-arrow" aria-hidden="true" />
                  {item.group.trim() ? (
                    <span className="tag-ai-group" data-color={color}>
                      {item.group.trim()}
                    </span>
                  ) : (
                    <span className="tag-ai-none">未归类</span>
                  )}
                  {current === item.group.trim() ? <span className="tag-ai-same">当前</span> : null}
                </label>
              );
            })}
          </div>
        ) : null}
        <div className="tag-modal-foot">
          <Button type="button" variant="ghost" onClick={() => setAiOpen(false)} disabled={aiBusy}>
            取消
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => void applySuggestions()}
            disabled={aiBusy || checkedCount === 0}
          >
            {aiBusy ? "处理中…" : `应用 ${checkedCount} 条`}
          </Button>
        </div>
      </Modal>

      {moveMenu
        ? createPortal(
            <div
              className="popover tag-move-menu"
              role="menu"
              aria-label={"移动标签 " + moveMenu.tag}
              style={{
                position: "fixed",
                top: moveMenu.y,
                left: moveMenu.x,
                width: MOVE_MENU_WIDTH,
                zIndex: 110,
              }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="small muted" style={{ padding: "2px 10px 6px" }}>
                移动到标签栏
              </div>
              {orderedGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className="popover-item"
                  role="menuitemradio"
                  aria-checked={moveCurrent === group.id}
                  onClick={() => pickMove(group.id)}
                >
                  <span className="grow truncate">{group.name}</span>
                  {moveCurrent === group.id ? <Check size={13} aria-hidden="true" /> : null}
                </button>
              ))}
              <button
                type="button"
                className="popover-item"
                role="menuitemradio"
                aria-checked={moveCurrent === null}
                onClick={() => pickMove(null)}
              >
                <span className="grow truncate">未归类</span>
                {moveCurrent === null ? <Check size={13} aria-hidden="true" /> : null}
              </button>
              {orderedGroups.length === 0 ? (
                <div className="small muted" style={{ padding: "6px 10px" }}>
                  还没有自定义标签栏
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
