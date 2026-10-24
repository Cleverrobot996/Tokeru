import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Folder,
  Inbox,
  Layers,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  ShoppingBasket,
  Tags,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { qtypeLabel } from "../lib/labels";
import type { Folder as FolderItem, Material, Question, SetSummary, TagGroup } from "../lib/types";
import { PaperDoc, PaperQuestion, shortNo, shortSection, type PaperGroup } from "../components/PaperView";
import { TagBoard } from "../components/TagBoard";
import { TagChips } from "../components/TagChips";
import { Button, Chip, Modal } from "../components/ui";

/* 题库：标签 / 试卷 / 文件夹筛选 + 固定 368x200 试卷卡 + 按试卷分组的题目卡 + 选题篮。 */

type Display = "both" | "sets" | "questions";
type SortKey = "number_asc" | "number_desc" | "added_asc" | "added_desc";
type FolderSel = "all" | "unfiled" | number;
type Density = "brief" | "detail";

type DetailBundle = {
  set: SetSummary;
  questions: Question[];
  groups: PaperGroup[];
  materials: Map<number, Material>;
  meta: string[];
  eyebrow: string;
  picked: number;
  allOn: boolean;
  loading: boolean;
  error: unknown;
};

const BASKET_KEY = "tokero:bank-basket";

function errorText(e: unknown) {
  if (e instanceof Error) return e.message;
  if (typeof e === "string" && e.trim()) return e;
  return "操作没有完成，请重试。";
}

function shortSource(source: string) {
  const text = (source ?? "").trim();
  const first = text.split("；")[0].trim() || text;
  return first.length > 26 ? first.slice(0, 26) + "…" : first;
}

function clipStem(text: string, max = 160) {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

export default function BankPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const pageRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const cancelRenameRef = useRef(false);
  const renameBusyRef = useRef(false);

  const [query, setQuery] = useState("");
  const [display, setDisplay] = useState<Display>("both");
  const [sort, setSort] = useState<SortKey>("number_asc");
  const [selTags, setSelTags] = useState<string[]>([]);
  const [tagQuery, setTagQuery] = useState("");
  const [selSets, setSelSets] = useState<number[]>([]);
  const [folderSel, setFolderSel] = useState<FolderSel>("all");
  const [density, setDensity] = useState<Density>("brief");
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [basketOpen, setBasketOpen] = useState(() => {
    try {
      return localStorage.getItem(BASKET_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [menu, setMenu] = useState<{ setId: number; x: number; y: number } | null>(null);
  const [folderCreating, setFolderCreating] = useState(false);
  const [folderDraft, setFolderDraft] = useState("");
  const [folderRenaming, setFolderRenaming] = useState<number | null>(null);
  const [folderDeleting, setFolderDeleting] = useState<number | null>(null);
  const [tagBoardOpen, setTagBoardOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SetSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const setsQ = useQuery({ queryKey: ["sets"], queryFn: api.listSets });
  const tagsQ = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const tagGroupsQ = useQuery({ queryKey: ["tagGroups"], queryFn: api.listTagGroups });
  const foldersQ = useQuery({ queryKey: ["folders"], queryFn: api.listFolders });
  const bankQ = useQuery({
    queryKey: ["bank", "all"],
    queryFn: () => api.listBank({ limit: 2000 }),
  });

  const sets: SetSummary[] = useMemo(() => setsQ.data ?? [], [setsQ.data]);
  const tags = useMemo(() => tagsQ.data ?? [], [tagsQ.data]);
  const tagGroups: TagGroup[] = useMemo(() => tagGroupsQ.data ?? [], [tagGroupsQ.data]);
  const folders: FolderItem[] = useMemo(() => foldersQ.data ?? [], [foldersQ.data]);
  const questions: Question[] = useMemo(() => bankQ.data?.questions ?? [], [bankQ.data]);

  const loading = setsQ.isPending || bankQ.isPending;
  const loadError = setsQ.error ?? tagsQ.error ?? foldersQ.error ?? bankQ.error;

  const setMap = useMemo(() => new Map(sets.map((s) => [s.id, s] as const)), [sets]);
  const folderMap = useMemo(() => new Map(folders.map((f) => [f.id, f] as const)), [folders]);
  const questionMap = useMemo(() => new Map(questions.map((q) => [q.id, q] as const)), [questions]);
  const tagMap = useMemo(() => new Map(tags.map((t) => [t.name, t] as const)), [tags]);

  const tagSet = useMemo(() => new Set(selTags), [selTags]);
  const setSet = useMemo(() => new Set(selSets), [selSets]);
  const needle = query.trim().toLowerCase();

  // 标签被删除后，已选列表里不能留下一个不存在的标签。
  useEffect(() => {
    if (!tagsQ.data) return;
    const known = new Set(tagsQ.data.map((t) => t.name));
    setSelTags((prev) => {
      const next = prev.filter((name) => known.has(name));
      return next.length === prev.length ? prev : next;
    });
  }, [tagsQ.data]);

  const folderSetMatches = useCallback(
    (s: SetSummary) => {
      if (folderSel === "all") return true;
      if (folderSel === "unfiled") return s.folder_id == null;
      return s.folder_id === folderSel;
    },
    [folderSel],
  );

  const folderQuestionMatches = useCallback(
    (q: Question) => {
      if (folderSel === "all") return true;
      const f = setMap.get(q.set_id)?.folder_id ?? null;
      if (folderSel === "unfiled") return f == null;
      return f === folderSel;
    },
    [folderSel, setMap],
  );

  /**
   * 标签筛选按「标签栏」分组：同栏内多个标签 OR，不同栏之间 AND，没选标签的栏不参与限制。
   * 题目标签与所属试卷的标签都算命中（卷级标签如「真题」能覆盖整卷题目）。
   */
  const tagBarOf = useCallback(
    (name: string) => {
      const t = tagMap.get(name);
      if (!t || t.group_id == null) return "ungrouped";
      return "group-" + t.group_id;
    },
    [tagMap],
  );
  const selectedByBar = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const name of selTags) {
      const key = tagBarOf(name);
      const set = map.get(key);
      if (set) set.add(name);
      else map.set(key, new Set([name]));
    }
    return map;
  }, [selTags, tagBarOf]);
  const tagLabel = useCallback(
    (name: string) => {
      const group = tagMap.get(name)?.group_name;
      return group ? group + "：" + name : name;
    },
    [tagMap],
  );
  const matchesTag = useCallback(
    (q: Question, name: string) => q.tags.includes(name) || !!setMap.get(q.set_id)?.tags.includes(name),
    [setMap],
  );
  const matchesTagBars = useCallback(
    (q: Question, exceptBar?: string) => {
      for (const [bar, names] of selectedByBar) {
        if (bar === exceptBar) continue;
        let hit = false;
        for (const name of names) {
          if (matchesTag(q, name)) {
            hit = true;
            break;
          }
        }
        if (!hit) return false;
      }
      return true;
    },
    [selectedByBar, matchesTag],
  );
  /** 搜索、试卷选择、文件夹这些基础条件，和标签栏正交。 */
  const baseQuestionMatches = useCallback(
    (q: Question) => {
      if (setSet.size > 0 && !setSet.has(q.set_id)) return false;
      if (!folderQuestionMatches(q)) return false;
      if (needle) {
        const hay = (q.stem + " " + (q.label ?? "") + " " + q.tags.join(" ")).toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    },
    [setSet, folderQuestionMatches, needle],
  );

  const visibleQuestions = useMemo(
    () => questions.filter((q) => baseQuestionMatches(q) && matchesTagBars(q)),
    [questions, baseQuestionMatches, matchesTagBars],
  );

  /** 命中的题目所属试卷也要出现在试卷区，否则「筛出 1 份 / 20 道」和空白试卷区会打架。 */
  const visibleQuestionSetIds = useMemo(
    () => new Set(visibleQuestions.map((q) => q.set_id)),
    [visibleQuestions],
  );

  const visibleSets = useMemo(
    () =>
      sets.filter((s) => {
        if (!folderSetMatches(s)) return false;
        if (setSet.size > 0 && !setSet.has(s.id)) return false;
        if (selTags.length > 0 && !visibleQuestionSetIds.has(s.id)) return false;
        if (needle) {
          const hay = (s.title + " " + s.subtitle + " " + s.source + " " + (s.year ?? "")).toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      }),
    [sets, folderSetMatches, setSet, selTags.length, needle, visibleQuestionSetIds],
  );

  const questionCmp = useCallback(
    (a: Question, b: Question) => {
      if (sort === "added_asc") return a.id - b.id;
      if (sort === "added_desc") return b.id - a.id;
      if (sort === "number_desc") return b.number - a.number;
      return a.number - b.number;
    },
    [sort],
  );
  /** 原卷顺序：分区内保持试卷自己的题序，不跟着工具条排序变。 */
  const paperCmp = useCallback(
    (a: Question, b: Question) => a.position - b.position || a.number - b.number || a.id - b.id,
    [],
  );

  const groups = useMemo(() => {
    const bySet = new Map<number, Question[]>();
    for (const q of visibleQuestions) {
      const list = bySet.get(q.set_id);
      if (list) list.push(q);
      else bySet.set(q.set_id, [q]);
    }
    const order: number[] = [];
    for (const s of sets) if (bySet.has(s.id)) order.push(s.id);
    for (const id of bySet.keys()) if (!order.includes(id)) order.push(id);
    return order.map((id) => {
      const list = (bySet.get(id) ?? []).slice().sort(questionCmp);
      return {
        id,
        title: setMap.get(id)?.title ?? "试卷 " + id,
        questions: list,
      };
    });
  }, [visibleQuestions, sets, setMap, questionCmp]);

  const needDetail = display !== "sets" && density === "detail";
  /** 原卷要跟着题目筛选走：即使标题搜索没命中试卷，只要有题命中，也铺开它所属的试卷。 */
  const detailCandidates = useMemo(() => {
    const withQuestion = new Set(visibleQuestions.map((q) => q.set_id));
    return sets.filter((s) => withQuestion.has(s.id));
  }, [sets, visibleQuestions]);
  const detailSets = useMemo(() => detailCandidates.slice(0, 6), [detailCandidates]);
  const detailQueries = useQueries({
    queries: detailSets.map((s) => ({
      queryKey: ["set", s.id],
      queryFn: () => api.getSet(s.id),
      enabled: needDetail,
    })),
  });

  const detailBundles = useMemo<DetailBundle[]>(() => {
    return detailSets.map((s, index) => {
      const query = detailQueries[index];
      const setQuestions = visibleQuestions
        .filter((q) => q.set_id === s.id)
        .slice()
        .sort(paperCmp);
      const picked = setQuestions.filter((q) => selected.has(q.id)).length;
      const meta = [
        s.question_count + " 题",
        s.section_count + " 分区",
        s.total_points + " 分",
        s.duration_minutes ? s.duration_minutes + " 分钟" : "",
        picked > 0 ? "已选 " + picked : "",
      ].filter(Boolean);
      const eyebrow = ["原卷", s.year == null ? "" : String(s.year), s.source ? shortSource(s.source) : ""]
        .filter(Boolean)
        .join(" · ");
      const base: DetailBundle = {
        set: s,
        questions: setQuestions,
        groups: [],
        materials: new Map<number, Material>(),
        meta,
        eyebrow,
        picked,
        allOn: setQuestions.length > 0 && picked === setQuestions.length,
        loading: !query?.data && !query?.error,
        error: query?.error ?? null,
      };
      if (!query?.data) return base;

      const detail = query.data;
      const sections = detail.sections.slice().sort((a, b) => a.position - b.position || a.id - b.id);
      const bySection = new Map<number, Question[]>();
      for (const q of setQuestions) {
        const list = bySection.get(q.section_id);
        if (list) list.push(q);
        else bySection.set(q.section_id, [q]);
      }
      const groups: PaperGroup[] = [];
      for (const section of sections) {
        const list = bySection.get(section.id) ?? [];
        if (list.length === 0) continue;
        const points = list.reduce((sum, q) => sum + q.points, 0);
        groups.push({
          id: section.id,
          title: section.title,
          meta: list.length + " 题 · " + points + " 分",
          section,
          questions: list,
        });
      }
      const known = new Set(sections.map((section) => section.id));
      const rest = setQuestions.filter((q) => !known.has(q.section_id));
      if (rest.length > 0) {
        const points = rest.reduce((sum, q) => sum + q.points, 0);
        groups.push({
          id: "other-" + s.id,
          title: "其他题目",
          meta: rest.length + " 题 · " + points + " 分",
          questions: rest,
          supplementary: true,
        });
      }

      return {
        ...base,
        groups,
        materials: new Map(detail.materials.map((m) => [m.id, m] as const)),
      };
    });
  }, [detailSets, detailQueries, visibleQuestions, selected, paperCmp]);

  const selectedQuestions = useMemo(() => {
    const list: Question[] = [];
    for (const id of selected) {
      const q = questionMap.get(id);
      if (q) list.push(q);
    }
    return list;
  }, [selected, questionMap]);

  const selectedPoints = useMemo(
    () => selectedQuestions.reduce((sum, q) => sum + q.points, 0),
    [selectedQuestions],
  );

  const basketGroups = useMemo(() => {
    const bySet = new Map<number, Question[]>();
    for (const q of selectedQuestions) {
      const list = bySet.get(q.set_id);
      if (list) list.push(q);
      else bySet.set(q.set_id, [q]);
    }
    const rank = new Map(sets.map((s, i) => [s.id, i] as const));
    return Array.from(bySet.entries())
      .sort((a, b) => (rank.get(a[0]) ?? 9999) - (rank.get(b[0]) ?? 9999) || a[0] - b[0])
      .map(([setId, qs]) => ({
        id: setId,
        title: setMap.get(setId)?.title ?? "试卷 " + setId,
        questions: qs.slice().sort((a, b) => a.number - b.number),
      }));
  }, [selectedQuestions, sets, setMap]);

  const shownTags = useMemo(() => {
    const n = tagQuery.trim().toLowerCase();
    if (!n) return tags;
    return tags.filter((t) => t.name.toLowerCase().includes(n));
  }, [tags, tagQuery]);

  const tagBars = useMemo(() => {
    const ordered = tagGroups.slice().sort((a, b) => a.position - b.position || a.id - b.id);
    // 固定先展示学科/题型/难度三栏；即使空栏也保留，方便一眼看出该维度还没打标。
    const fixed = [
      { name: "学科", color: "violet" },
      { name: "题型", color: "teal" },
      { name: "难度", color: "amber" },
    ];
    if (ordered.length === 0) {
      const bars = fixed.map((slot) => ({
        key: "fixed-" + slot.name,
        name: slot.name,
        color: slot.color,
        tags: [] as typeof shownTags,
      }));
      if (shownTags.length > 0) {
        bars.push({ key: "ungrouped", name: "未归类", color: "slate", tags: shownTags });
      }
      return bars;
    }
    const byName = new Map(ordered.map((group) => [group.name, group] as const));
    const bars = fixed.map((slot) => {
      const group = byName.get(slot.name);
      return {
        key: group ? "group-" + group.id : "fixed-" + slot.name,
        name: slot.name,
        color: group?.color ?? slot.color,
        tags: group ? shownTags.filter((t) => t.group_id === group.id) : [],
      };
    });
    const fixedNames = new Set(fixed.map((slot) => slot.name));
    for (const group of ordered) {
      if (fixedNames.has(group.name)) continue;
      bars.push({
        key: "group-" + group.id,
        name: group.name,
        color: group.color,
        tags: shownTags.filter((t) => t.group_id === group.id),
      });
    }
    const known = new Set(ordered.map((group) => group.id));
    const ungrouped = shownTags.filter((t) => t.group_id == null || !known.has(t.group_id));
    if (ungrouped.length > 0) {
      bars.push({ key: "ungrouped", name: "未归类", color: "slate", tags: ungrouped });
    }
    return bars;
  }, [tagGroups, shownTags]);

  /** 每个标签在当前其他栏筛选下还能命中的题数；为 0 且未选中的标签置灰。 */
  const tagFacet = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tags) counts.set(t.name, 0);
    for (const q of questions) {
      if (!baseQuestionMatches(q)) continue;
      const names = new Set(q.tags);
      for (const name of setMap.get(q.set_id)?.tags ?? []) names.add(name);
      for (const name of names) {
        if (!counts.has(name)) continue;
        if (!matchesTagBars(q, tagBarOf(name))) continue;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return counts;
  }, [questions, tags, baseQuestionMatches, matchesTagBars, tagBarOf, setMap]);

  const folderSets = useMemo(() => sets.filter(folderSetMatches), [sets, folderSetMatches]);
  const unfiledCount = useMemo(() => sets.filter((s) => s.folder_id == null).length, [sets]);
  const activeFolderName =
    folderSel === "all"
      ? "全部试卷"
      : folderSel === "unfiled"
        ? "未归类"
        : folderMap.get(folderSel)?.name ?? "文件夹";

  const filtersActive =
    query.trim().length > 0 || selTags.length > 0 || selSets.length > 0 || folderSel !== "all";
  const showSets = display !== "questions" && visibleSets.length > 0;
  const showQuestions = display !== "sets" && visibleQuestions.length > 0;
  const bankEmpty = sets.length === 0 && questions.length === 0;

  const folderNameFor = (id: number | null) =>
    id == null ? "未归类" : folderMap.get(id)?.name ?? "未归类";

  const toggleTag = useCallback((name: string) => {
    setSelTags((prev) => (prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]));
  }, []);

  const toggleSet = useCallback((id: number) => {
    setSelSets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const toggleQuestion = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleGroup = useCallback(
    (list: Question[]) => {
      const ids = list.map((q) => q.id);
      const allOn = ids.every((id) => selected.has(id));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) {
          if (allOn) next.delete(id);
          else next.add(id);
        }
        return next;
      });
    },
    [selected],
  );

  const addGroup = useCallback((list: Question[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const q of list) next.add(q.id);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setQuery("");
    setSelTags([]);
    setSelSets([]);
    setFolderSel("all");
  }, []);

  const onTagsChanged = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["tags"] });
    void qc.invalidateQueries({ queryKey: ["tagGroups"] });
    void qc.invalidateQueries({ queryKey: ["sets"] });
    void qc.invalidateQueries({ queryKey: ["bank", "all"] });
  }, [qc]);

  const chooseFolder = useCallback(
    (next: FolderSel) => {
      setFolderSel(next);
      setFolderDeleting(null);
      setFolderRenaming(null);
      setFolderCreating(false);
      setFolderDraft("");
      if (next === "all") return;
      setSelSets((prev) =>
        prev.filter((id) => {
          const s = setMap.get(id);
          if (!s) return false;
          if (next === "unfiled") return s.folder_id == null;
          return s.folder_id === next;
        }),
      );
    },
    [setMap],
  );

  const startPractice = useCallback(async () => {
    if (busy || selectedQuestions.length === 0) return;
    setBusy(true);
    try {
      const attemptId = await api.createAttempt({
        questionIds: selectedQuestions.map((q) => q.id),
        mode: "custom",
        title: "自选练习 · " + selectedQuestions.length + " 题",
      });
      nav("/exam/" + attemptId);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [busy, selectedQuestions, nav]);

  const confirmDeleteSet = useCallback(async () => {
    const target = deleteTarget;
    if (!target || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await api.deleteSet(target.id);
      qc.removeQueries({ queryKey: ["set", target.id] });
      setSelected((prev) => {
        const next = new Set(prev);
        for (const q of questions) if (q.set_id === target.id) next.delete(q.id);
        return next;
      });
      setSelSets((prev) => prev.filter((id) => id !== target.id));
      setDeleteTarget(null);
      toast.success("已删除试卷");
      void qc.invalidateQueries({ queryKey: ["sets"] });
      void qc.invalidateQueries({ queryKey: ["bank", "all"] });
      void qc.invalidateQueries({ queryKey: ["tags"] });
      void qc.invalidateQueries({ queryKey: ["tagGroups"] });
      void qc.invalidateQueries({ queryKey: ["folders"] });
      void qc.invalidateQueries({ queryKey: ["records"] });
      void qc.invalidateQueries({ queryKey: ["mistakes"] });
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteTarget, deleteBusy, questions, qc]);

  const beginRename = useCallback((s: SetSummary) => {
    cancelRenameRef.current = false;
    setEditingId(s.id);
    setTitleDraft(s.title);
  }, []);

  const saveRename = useCallback(
    async (setId: number) => {
      const title = titleDraft.trim();
      setEditingId(null);
      if (!title || renameBusyRef.current) return;
      const current = setMap.get(setId)?.title;
      if (current === title) return;
      renameBusyRef.current = true;
      try {
        await api.renameSet(setId, title);
        await qc.invalidateQueries({ queryKey: ["sets"] });
        await qc.invalidateQueries({ queryKey: ["folders"] });
        toast.success("试卷名已更新");
      } catch (e) {
        toast.error(errorText(e));
      } finally {
        renameBusyRef.current = false;
      }
    },
    [titleDraft, setMap, qc],
  );

  const openSetMenu = (event: ReactMouseEvent<HTMLButtonElement>, s: SetSummary) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 226;
    const height = Math.min(420, 150 + folders.length * 32);
    const x = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const y = Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - height - 12));
    setMenu((prev) => (prev?.setId === s.id ? null : { setId: s.id, x, y }));
  };

  const moveSet = useCallback(
    async (setId: number, folderId: number | null) => {
      try {
        await api.assignFolder({ setId, folderId });
        setMenu(null);
        await qc.invalidateQueries({ queryKey: ["folders"] });
        await qc.invalidateQueries({ queryKey: ["sets"] });
        toast.success(
          folderId == null ? "已移到未归类" : "已移到「" + folderNameFor(folderId) + "」",
        );
      } catch (e) {
        toast.error(errorText(e));
      }
    },
    [qc, folderNameFor],
  );

  const createFolderNow = useCallback(async () => {
    const name = folderDraft.trim();
    if (!name) {
      setFolderCreating(false);
      return;
    }
    try {
      await api.createFolder(name);
      setFolderCreating(false);
      setFolderDraft("");
      await qc.invalidateQueries({ queryKey: ["folders"] });
      toast.success("文件夹已新建");
    } catch (e) {
      toast.error(errorText(e));
    }
  }, [folderDraft, qc]);

  const saveFolderRename = useCallback(
    async (folderId: number) => {
      const name = folderDraft.trim();
      setFolderRenaming(null);
      if (!name) return;
      try {
        await api.renameFolder(folderId, name);
        await qc.invalidateQueries({ queryKey: ["folders"] });
        await qc.invalidateQueries({ queryKey: ["sets"] });
        toast.success("文件夹已改名");
      } catch (e) {
        toast.error(errorText(e));
      }
    },
    [folderDraft, qc],
  );

  const removeFolder = useCallback(
    async (folder: FolderItem) => {
      try {
        await api.deleteFolder(folder.id);
        setFolderDeleting(null);
        if (folderSel === folder.id) setFolderSel("all");
        await qc.invalidateQueries({ queryKey: ["folders"] });
        await qc.invalidateQueries({ queryKey: ["sets"] });
        toast.success("已删除「" + folder.name + "」");
      } catch (e) {
        toast.error(errorText(e));
      }
    },
    [folderSel, qc],
  );

  // 顶栏 + 工具条的实际高度决定吸顶偏移；工具条折行时跟着变。
  useEffect(() => {
    const page = pageRef.current;
    const bar = toolbarRef.current;
    if (!page || !bar) return;
    const topbar = document.querySelector<HTMLElement>(".topbar");
    const sync = () => {
      const top = topbar?.offsetHeight ?? 71;
      page.style.setProperty("--bk-top", top + "px");
      page.style.setProperty("--bk-stick", top + bar.offsetHeight + 12 + "px");
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(bar);
    if (topbar) ro.observe(topbar);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(BASKET_KEY, basketOpen ? "1" : "0");
    } catch {
      /* 隐私模式下只在本页生效 */
    }
  }, [basketOpen]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    const onScroll = () => setMenu(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [menu]);

  const reloadAll = () => {
    void setsQ.refetch();
    void tagsQ.refetch();
    void tagGroupsQ.refetch();
    void foldersQ.refetch();
    void bankQ.refetch();
  };

  const onQuestionKey = (e: ReactKeyboardEvent<HTMLDivElement>, id: number) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggleQuestion(id);
    }
  };

  /** PaperView 的题号只是 span；在容器捕获点击，去速查定位这道题。 */
  const onPaperClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".paper-q-no")) return;
    const article = target.closest<HTMLElement>(".paper-q");
    const id = article?.dataset.paperQ;
    if (!id) return;
    const q = questionMap.get(Number(id));
    if (!q) return;
    e.preventDefault();
    e.stopPropagation();
    nav("/sets/" + q.set_id + "/answers?q=" + q.id);
  };

  const renderPaperQuestion = (q: Question) => {
    const on = selected.has(q.id);
    return (
      <PaperQuestion
        key={q.id}
        q={q}
        selected={on}
        onToggle={() => toggleQuestion(q.id)}
        action={
          <span className="bk-pick" data-on={on} aria-hidden="true">
            {on ? <Check size={12} strokeWidth={3} /> : null}
          </span>
        }
        footer={q.tags.length > 0 ? <TagChips tags={q.tags} tagMap={tagMap} mode="grouped" max={5} /> : null}
      />
    );
  };

  const renderSetCard = (s: SetSummary) => {
    const editing = editingId === s.id;
    const folderName = folderNameFor(s.folder_id);
    return (
      <article className="bk-set-card" key={s.id} aria-label={s.title}>
        <div className="bk-set-top">
          <span className="bk-year" title="年份">{s.year ?? "未标"}</span>
          <span className="bk-source" title={s.source || "来源未标注"}>{shortSource(s.source) || "来源未标注"}</span>
          <button
            type="button"
            className="bk-folder-badge"
            onClick={(e) => openSetMenu(e, s)}
            aria-haspopup="menu"
            aria-expanded={menu?.setId === s.id}
            title={"试卷操作 · 当前文件夹 " + folderName}
          >
            <Folder size={11} aria-hidden="true" />
            <span>{folderName}</span>
            <ChevronDown size={10} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="bk-more"
            onClick={(e) => openSetMenu(e, s)}
            aria-haspopup="menu"
            aria-expanded={menu?.setId === s.id}
            aria-label={"更多操作 " + s.title}
            title="更多操作"
          >
            <MoreHorizontal size={15} aria-hidden="true" />
          </button>
        </div>

        <div className="bk-set-title-row">
          {editing ? (
            <input
              className="bk-title-input"
              autoFocus
              value={titleDraft}
              maxLength={120}
              aria-label="试卷标题"
              onChange={(e) => setTitleDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void saveRename(s.id);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRenameRef.current = true;
                  setEditingId(null);
                }
              }}
              onBlur={() => {
                if (cancelRenameRef.current) {
                  cancelRenameRef.current = false;
                  setEditingId(null);
                  return;
                }
                void saveRename(s.id);
              }}
            />
          ) : (
            <>
              <h3 className="bk-set-title" onDoubleClick={() => beginRename(s)} title="双击可直接改名">
                {s.title}
              </h3>
              <button
                type="button"
                className="bk-pencil"
                onClick={() => beginRename(s)}
                title="重命名试卷"
                aria-label={"重命名 " + s.title}
              >
                <Pencil size={12} aria-hidden="true" />
              </button>
            </>
          )}
        </div>

        <div className="bk-set-sub" title={s.subtitle || "没有副标题"}>{s.subtitle || "没有副标题"}</div>

        <div className="bk-set-meta">
          <span><b>{s.question_count}</b> 题</span>
          <span className="bk-sep" aria-hidden="true" />
          <span><b>{s.section_count}</b> 分区</span>
          <span className="bk-sep" aria-hidden="true" />
          <span><b>{s.total_points}</b> 分</span>
          {s.duration_minutes ? (
            <>
              <span className="bk-sep" aria-hidden="true" />
              <span><b>{s.duration_minutes}</b> 分钟</span>
            </>
          ) : null}
        </div>

        <div className="bk-set-tags">
          {s.tags.slice(0, 4).map((t) => (
            <span className="bk-tag-mini" key={t}>{t}</span>
          ))}
          {s.tags.length > 4 ? <span className="bk-tag-more">+{s.tags.length - 4}</span> : null}
          {s.tags.length === 0 ? <span className="bk-tag-more">还没有标签</span> : null}
        </div>

        <div className="bk-set-foot">
          <Button size="sm" variant="primary" onClick={() => nav("/sets/" + s.id + "/exam")}>
            <Play size={13} aria-hidden="true" />
            开始练习
          </Button>
          <Button size="sm" onClick={() => nav("/sets/" + s.id + "/answers")}>
            <ListChecks size={13} aria-hidden="true" />
            速查与整理
          </Button>
        </div>
      </article>
    );
  };

  const currentMenuSet = menu ? setMap.get(menu.setId) : undefined;

  return (
    <div className="page-fluid bank-page" ref={pageRef}>
      <header className="page-head">
        <div>
          <h1>题库</h1>
          <div className="sub">
            {loading
              ? "正在读取题库…"
              : sets.length + " 份试卷 · " + questions.length + " 道题" + (filtersActive ? " · 筛出 " + visibleSets.length + " 份 / " + visibleQuestions.length + " 道" : "")}
            {selected.size > 0 ? " · 已选 " + selected.size + " 题" : ""}
          </div>
        </div>
        <div className="acts">
          <Button variant="soft" size="sm" onClick={() => nav("/import")}>
            <Upload size={14} aria-hidden="true" />
            导入题目
          </Button>
        </div>
      </header>

      <div className="toolbar bk-toolbar" ref={toolbarRef}>
        <label className="bk-search">
          <Search size={15} aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索题干或试卷标题"
            aria-label="搜索题干或试卷标题"
          />
          {query ? (
            <button type="button" className="bk-search-clear" onClick={() => setQuery("")} aria-label="清除搜索">
              <X size={13} aria-hidden="true" />
            </button>
          ) : null}
        </label>

        <div className="seg" role="group" aria-label="显示模式">
          <button type="button" data-on={display === "both"} onClick={() => setDisplay("both")}>试卷+题目</button>
          <button type="button" data-on={display === "sets"} onClick={() => setDisplay("sets")}>仅试卷</button>
          <button type="button" data-on={display === "questions"} onClick={() => setDisplay("questions")}>仅题目</button>
        </div>

        <select
          className="select bk-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="题目排序"
        >
          <option value="number_asc">题号升序</option>
          <option value="number_desc">题号降序</option>
          <option value="added_desc">添加时间 新→旧</option>
          <option value="added_asc">添加时间 旧→新</option>
        </select>

        <div className="spacer" />

        <span className="bk-picked">已选 <b>{selected.size}</b> 题</span>
        <Button variant="primary" size="sm" onClick={startPractice} disabled={selected.size === 0 || busy}>
          {busy ? <Loader2 size={14} className="bk-spin" aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
          开始练习
        </Button>
      </div>

      {filtersActive ? (
        <div className="bk-active">
          <span className="bk-active-label">筛选</span>
          {folderSel !== "all" ? (
            <button type="button" className="bk-fchip" onClick={() => chooseFolder("all")} title="取消文件夹筛选">
              文件夹 · {activeFolderName}
              <X size={11} aria-hidden="true" />
            </button>
          ) : null}
          {selSets.map((id) => (
            <button type="button" className="bk-fchip" key={id} onClick={() => toggleSet(id)} title={setMap.get(id)?.title}>
              试卷 · {setMap.get(id)?.title ?? id}
              <X size={11} aria-hidden="true" />
            </button>
          ))}
          {selTags.map((t) => (
            <button type="button" className="bk-fchip" key={t} onClick={() => toggleTag(t)} title={"取消标签 " + tagLabel(t)}>
              {tagLabel(t)}
              <X size={11} aria-hidden="true" />
            </button>
          ))}
          {query.trim() ? (
            <button type="button" className="bk-fchip" onClick={() => setQuery("")} title="清除搜索">
              搜索 · {query.trim()}
              <X size={11} aria-hidden="true" />
            </button>
          ) : null}
          <button type="button" className="bk-link bk-active-clear" onClick={clearFilters}>清空筛选</button>
        </div>
      ) : null}

      {loadError ? (
        <div className="bk-error">
          <div>
            <b>题库读取失败</b>
            <div className="small muted">{errorText(loadError)}</div>
          </div>
          <Button size="sm" onClick={reloadAll}>重新加载</Button>
        </div>
      ) : null}

      <div className="bk-layout" data-basket={basketOpen ? "open" : "closed"}>
        <aside className="bk-side" aria-label="题库筛选">
          <section className="panel bk-filter">
            <div className="bk-filter-head">
              <h3>
                标签
                <span className="bk-filter-n">{selTags.length > 0 ? selTags.length + " 已选" : tags.length}</span>
              </h3>
              <div className="bk-head-acts">
                <button type="button" className="bk-link" onClick={() => setTagBoardOpen(true)}>
                  <Tags size={12} aria-hidden="true" />
                  管理标签
                </button>
                {selTags.length > 0 ? <button type="button" className="bk-link" onClick={() => setSelTags([])}>清除</button> : null}
              </div>
            </div>
            <input
              className="input bk-mini"
              value={tagQuery}
              onChange={(e) => setTagQuery(e.target.value)}
              placeholder="筛选标签"
              aria-label="筛选标签"
            />
            <div className="bk-tag-bars">
              {tagBars.map((bar) => (
                <div className="bk-tag-bar" key={bar.key}>
                  <div className="bk-tag-bar-head">
                    <span className="bk-tag-dot" data-color={bar.color} aria-hidden="true" />
                    <span className="bk-tag-bar-name">{bar.name}</span>
                    <span className="bk-tag-bar-n">{bar.tags.length}</span>
                  </div>
                  <div className="bk-tags">
                    {bar.tags.length === 0 ? <div className="bk-tag-empty">暂无标签</div> : null}
                    {bar.tags.map((t) => {
                      const on = tagSet.has(t.name);
                      const count = tagFacet.get(t.name) ?? 0;
                      const dim = !on && count === 0;
                      return (
                        <button
                          type="button"
                          key={t.name}
                          className="bk-tag"
                          data-on={on}
                          aria-pressed={on}
                          aria-disabled={dim || undefined}
                          onClick={() => {
                            if (!dim) toggleTag(t.name);
                          }}
                          title={
                            dim
                              ? "与当前其他栏的筛选没有共同题目"
                              : t.set_count + " 份试卷 · " + t.question_count + " 道题"
                          }
                          style={dim ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
                        >
                          <span className="bk-tag-name">{t.name}</span>
                          <span className="bk-tag-n">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {shownTags.length === 0 ? <div className="bk-mini-empty">没有匹配的标签</div> : null}
            </div>
          </section>

          <section className="panel bk-filter">
            <div className="bk-filter-head">
              <h3>
                试卷
                <span className="bk-filter-n">{sets.length}</span>
              </h3>
              <div className="bk-head-acts">
                <button
                  type="button"
                  className="bk-link"
                  onClick={() => setSelSets(folderSets.map((s) => s.id))}
                  disabled={folderSets.length === 0}
                >
                  全部
                </button>
                <button type="button" className="bk-link" onClick={() => setSelSets([])} disabled={selSets.length === 0}>清空</button>
              </div>
            </div>
            <div className="bk-set-rows">
              {folderSets.map((s) => {
                const on = setSet.has(s.id);
                return (
                  <button
                    type="button"
                    key={s.id}
                    className="bk-set-row"
                    data-on={on}
                    aria-pressed={on}
                    onClick={() => toggleSet(s.id)}
                  >
                    <span className="bk-check" aria-hidden="true">{on ? <Check size={10} strokeWidth={3} /> : null}</span>
                    <span className="bk-set-row-main">
                      <span className="bk-set-row-title">{s.title}</span>
                      <span className="bk-set-row-meta">{s.question_count} 题</span>
                    </span>
                    <span className="bk-dots" aria-hidden="true">
                      {s.tags.slice(0, 3).map((t, i) => <span className="bk-dot" key={t + i} />)}
                    </span>
                  </button>
                );
              })}
              {folderSets.length === 0 ? <div className="bk-mini-empty">这个文件夹还没有试卷</div> : null}
            </div>
          </section>

          <section className="panel bk-filter">
            <div className="bk-filter-head">
              <h3>
                文件夹
                <span className="bk-filter-n">{folders.length}</span>
              </h3>
              <button
                type="button"
                className="bk-link"
                onClick={() => {
                  setFolderCreating(true);
                  setFolderRenaming(null);
                  setFolderDeleting(null);
                  setFolderDraft("");
                }}
                disabled={folderCreating}
              >
                <Plus size={12} aria-hidden="true" />
                新建
              </button>
            </div>

            <div className="bk-folders">
              <div className="bk-folder-row" data-on={folderSel === "all"}>
                <button type="button" className="bk-folder-main" onClick={() => chooseFolder("all")}>
                  <Layers size={13} aria-hidden="true" />
                  <span className="truncate">全部试卷</span>
                  <span className="bk-count">{sets.length}</span>
                </button>
              </div>
              <div className="bk-folder-row" data-on={folderSel === "unfiled"}>
                <button type="button" className="bk-folder-main" onClick={() => chooseFolder("unfiled")}>
                  <Inbox size={13} aria-hidden="true" />
                  <span className="truncate">未归类</span>
                  <span className="bk-count">{unfiledCount}</span>
                </button>
              </div>
              <div className="bk-hr" aria-hidden="true" />

              {folders.map((f) => {
                if (folderDeleting === f.id) {
                  return (
                    <div className="bk-folder-confirm" key={f.id}>
                      <div>删除「{f.name}」？里面的试卷会移到未归类。</div>
                      <div className="bk-folder-confirm-acts">
                        <Button size="sm" variant="danger" onClick={() => void removeFolder(f)}>删除</Button>
                        <Button size="sm" variant="ghost" onClick={() => setFolderDeleting(null)}>取消</Button>
                      </div>
                    </div>
                  );
                }
                if (folderRenaming === f.id) {
                  return (
                    <div className="bk-folder-edit" key={f.id}>
                      <input
                        className="input bk-mini"
                        autoFocus
                        value={folderDraft}
                        aria-label="文件夹名称"
                        onChange={(e) => setFolderDraft(e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void saveFolderRename(f.id);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setFolderRenaming(null);
                          }
                        }}
                        onBlur={() => {
                          if (folderRenaming === f.id) setFolderRenaming(null);
                        }}
                      />
                    </div>
                  );
                }
                return (
                  <div className="bk-folder-row" key={f.id} data-on={folderSel === f.id}>
                    <button type="button" className="bk-folder-main" onClick={() => chooseFolder(f.id)}>
                      <Folder size={13} aria-hidden="true" />
                      <span className="truncate">{f.name}</span>
                      <span className="bk-count">{f.set_count}</span>
                    </button>
                    <span className="bk-folder-acts">
                      <button
                        type="button"
                        title="重命名文件夹"
                        aria-label={"重命名 " + f.name}
                        onClick={() => {
                          setFolderRenaming(f.id);
                          setFolderDraft(f.name);
                          setFolderDeleting(null);
                        }}
                      >
                        <Pencil size={11} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        title="删除文件夹"
                        aria-label={"删除 " + f.name}
                        onClick={() => {
                          setFolderDeleting(f.id);
                          setFolderRenaming(null);
                        }}
                      >
                        <Trash2 size={11} aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                );
              })}

              {folderCreating ? (
                <div className="bk-folder-edit">
                  <input
                    className="input bk-mini"
                    autoFocus
                    value={folderDraft}
                    placeholder="文件夹名，回车创建"
                    aria-label="新文件夹名称"
                    onChange={(e) => setFolderDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void createFolderNow();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setFolderCreating(false);
                        setFolderDraft("");
                      }
                    }}
                    onBlur={() => {
                      if (folderCreating) {
                        setFolderCreating(false);
                        setFolderDraft("");
                      }
                    }}
                  />
                </div>
              ) : null}

              {folders.length === 0 && !folderCreating ? (
                <div className="bk-mini-empty">还没有文件夹，点「新建」开始。</div>
              ) : null}
            </div>
          </section>
        </aside>

        <main className="bk-main">
          {loading ? (
            <div className="bk-loading">
              <Loader2 size={16} className="bk-spin" aria-hidden="true" />
              正在读取题库…
            </div>
          ) : loadError ? null : !showSets && !showQuestions ? (
            <div className="empty bk-empty">
              <div className="bk-empty-icon" aria-hidden="true"><BookOpen size={22} /></div>
              <h3>{bankEmpty ? "题库还是空的" : "没有符合条件的结果"}</h3>
              <p className="small muted">{bankEmpty ? "从导入开始，把第一份试卷放进来。" : "换个标签、清空试卷选择，或者取消文件夹筛选。"}</p>
              <div className="bk-empty-acts">
                {!bankEmpty ? <Button size="sm" onClick={clearFilters}>清空筛选</Button> : null}
                <Button size="sm" variant={bankEmpty ? "primary" : "soft"} onClick={() => nav("/import")}>
                  <Upload size={14} aria-hidden="true" />
                  去导入
                </Button>
              </div>
            </div>
          ) : (
            <>
              {showSets ? (
                <section className="bk-section" aria-label="试卷">
                  <div className="bk-sec-head">
                    <div className="bk-sec-title">
                      <h2>试卷</h2>
                      <span className="bk-sec-count">{visibleSets.length} 份</span>
                    </div>
                    {selSets.length > 0 ? (
                      <div className="bk-sec-acts">
                        <Chip tone="accent">已选 {selSets.length} 份</Chip>
                        <button type="button" className="bk-link" onClick={() => setSelSets([])}>清空</button>
                      </div>
                    ) : null}
                  </div>
                  <div className="bk-sets-grid">{visibleSets.map(renderSetCard)}</div>
                </section>
              ) : null}

              {showQuestions ? (
                <section className="bk-section" aria-label="题目">
                  <div className="bk-sec-head">
                    <div className="bk-sec-title">
                      <h2>题目</h2>
                      <span className="bk-sec-count">{visibleQuestions.length} 道 · {selected.size} 已选</span>
                    </div>
                    <div className="bk-sec-acts">
                      <div className="seg bk-density" role="group" aria-label="题干显示方式">
                        <button type="button" data-on={density === "brief"} onClick={() => setDensity("brief")}>简要</button>
                        <button type="button" data-on={density === "detail"} onClick={() => setDensity("detail")}>详细</button>
                      </div>
                    </div>
                  </div>

                  {density === "detail" ? (
                    <div className="bk-papers">
                      {detailBundles.map((b) => {
                        const sections = b.groups.filter((g) => !g.supplementary);
                        return (
                          <div className="bk-paper-block" key={b.set.id}>
                            {b.loading ? (
                              <div className="bk-paper-loading">
                                <Loader2 size={15} className="bk-spin" aria-hidden="true" />
                                正在展开「{b.set.title}」原卷…
                              </div>
                            ) : b.error ? (
                              <div className="bk-paper-error">
                                <AlertTriangle size={15} aria-hidden="true" />
                                原卷读取失败：{errorText(b.error)}
                              </div>
                            ) : b.groups.length === 0 ? (
                              <div className="bk-paper-loading">该卷没有符合当前筛选的题目。</div>
                            ) : (
                              <div className="bk-paper" onClickCapture={onPaperClick}>
                                <PaperDoc
                                  title={b.set.title}
                                  eyebrow={b.eyebrow}
                                  meta={b.meta}
                                  groups={b.groups}
                                  materials={b.materials}
                                  renderQuestion={renderPaperQuestion}
                                  headerExtra={
                                    <div className="bk-paper-acts" onClick={(e) => e.stopPropagation()}>
                                      <Button size="sm" variant="soft" onClick={() => toggleGroup(b.questions)}>
                                        {b.allOn ? "取消全选本卷" : "全选本卷"}
                                      </Button>
                                      {sections.length > 1 ? (
                                        <label className="bk-paper-secsel">
                                          <span>分区全选</span>
                                          <select
                                            className="input bk-paper-select"
                                            defaultValue=""
                                            onChange={(e) => {
                                              const id = Number(e.target.value);
                                              const group = sections.find((g) => Number(g.id) === id);
                                              e.currentTarget.value = "";
                                              if (group) addGroup(group.questions);
                                            }}
                                          >
                                            <option value="">选择分区…</option>
                                            {sections.map((g) => (
                                              <option key={g.id} value={String(g.id)}>
                                                {shortSection(g.title)} · {g.questions.length} 题
                                              </option>
                                            ))}
                                          </select>
                                        </label>
                                      ) : null}
                                      <button
                                        type="button"
                                        className="bk-link"
                                        onClick={() => nav("/sets/" + b.set.id + "/answers")}
                                      >
                                        速查与整理
                                      </button>
                                    </div>
                                  }
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {detailCandidates.length > detailSets.length ? (
                        <div className="bk-detail-note">
                          当前筛选命中 {detailCandidates.length} 份试卷，原卷最多铺 {detailSets.length} 份；用左侧或上方筛选缩小范围。
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    groups.map((g) => {
                      const ids = g.questions.map((q) => q.id);
                      const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
                      const picked = ids.filter((id) => selected.has(id)).length;
                      return (
                        <div className="bk-qset" key={g.id}>
                          <div className="bk-qset-head">
                            <div className="bk-qset-title">
                              <BookOpen size={14} aria-hidden="true" />
                              <h3 title={g.title}>{g.title}</h3>
                              <span className="bk-sec-count">{g.questions.length} 题</span>
                              {picked > 0 ? <span className="chip chip-accent">{picked} 已选</span> : null}
                            </div>
                            <div className="bk-qset-acts">
                              <button type="button" className="bk-link" onClick={() => nav("/sets/" + g.id + "/answers")}>速查与整理</button>
                              <button type="button" className="bk-link" onClick={() => toggleGroup(g.questions)}>{allOn ? "取消全选" : "全选"}</button>
                            </div>
                          </div>

                          <div className="bk-brief-list">
                            {g.questions.map((q) => {
                              const on = selected.has(q.id);
                              return (
                                <div
                                  key={q.id}
                                  className="bk-brow"
                                  data-on={on}
                                  role="checkbox"
                                  aria-checked={on}
                                  tabIndex={0}
                                  onClick={() => toggleQuestion(q.id)}
                                  onKeyDown={(e) => onQuestionKey(e, q.id)}
                                >
                                  <button
                                    type="button"
                                    className="bk-brow-no"
                                    title="到速查与整理查看这道题"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      nav("/sets/" + q.set_id + "/answers?q=" + q.id);
                                    }}
                                  >
                                    {shortNo(q)}
                                  </button>
                                  <Chip tone="accent">{qtypeLabel(q.qtype)}</Chip>
                                  <div className="bk-brow-main">
                                    <div className="bk-brow-stem" title={q.stem}>{clipStem(q.stem)}</div>
                                    <TagChips tags={q.tags} tagMap={tagMap} mode="plain" max={4} className="bk-brow-tags" />
                                  </div>
                                  <span className="bk-brow-points">{q.points} 分</span>
                                  <span className="bk-brow-check" aria-hidden="true">{on ? <Check size={12} strokeWidth={3} /> : null}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  )}
                </section>
              ) : null}
            </>
          )}
        </main>

        {basketOpen ? (
          <aside className="bk-basket" aria-label="选题篮">
            <div className="bk-basket-head">
              <ShoppingBasket size={15} aria-hidden="true" />
              <span className="bk-basket-title">选题篮</span>
              <span className="pill-count">{selected.size}</span>
              <button type="button" className="bk-basket-toggle" onClick={() => setBasketOpen(false)} title="收起选题篮" aria-label="收起选题篮">
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </div>
            <div className="bk-basket-stats">
              <span><b>{selected.size}</b> 题</span>
              <span><b>{selectedPoints}</b> 分</span>
            </div>

            {selectedQuestions.length === 0 ? (
              <div className="bk-basket-empty">
                <Inbox size={22} aria-hidden="true" />
                <div>还没有选题</div>
                <div className="small">点题目卡上的圆圈即可加入。</div>
              </div>
            ) : (
              <div className="bk-basket-body">
                {basketGroups.map((g) => (
                  <div className="bk-basket-group" key={g.id}>
                    <div className="bk-basket-set">
                      <span className="truncate" title={g.title}>{g.title}</span>
                      <span className="bk-basket-n">{g.questions.length}</span>
                    </div>
                    <div className="bk-basket-chips">
                      {g.questions.map((q) => (
                        <button
                          type="button"
                          className="bk-bchip"
                          key={q.id}
                          onClick={() => toggleQuestion(q.id)}
                          title={"移除第 " + shortNo(q) + " 题"}
                        >
                          {shortNo(q)}
                          <X size={10} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="bk-basket-foot">
              <Button variant="primary" onClick={startPractice} disabled={selected.size === 0 || busy}>
                {busy ? <Loader2 size={15} className="bk-spin" aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
                开始练习
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>清空</Button>
            </div>
          </aside>
        ) : (
          <aside className="bk-basket bk-basket-mini" aria-label="选题篮（已收起）">
            <button type="button" className="bk-basket-toggle" onClick={() => setBasketOpen(true)} title="展开选题篮" aria-label="展开选题篮">
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <ShoppingBasket size={18} aria-hidden="true" />
            <span className="pill-count">{selected.size}</span>
          </aside>
        )}
      </div>

      {menu && currentMenuSet ? (
        <div
          className="bk-menu panel"
          ref={menuRef}
          role="menu"
          aria-label="移动试卷到文件夹"
          style={{ top: menu.y, left: menu.x }}
        >
          <div className="bk-menu-label">移动到文件夹</div>
          <button type="button" className="bk-menu-item" role="menuitem" onClick={() => void moveSet(menu.setId, null)}>
            <Inbox size={14} aria-hidden="true" />
            <span>未归类</span>
            {currentMenuSet.folder_id == null ? <Check size={13} className="bk-menu-check" aria-label="当前文件夹" /> : null}
          </button>
          {folders.map((f) => (
            <button
              type="button"
              className="bk-menu-item"
              role="menuitem"
              key={f.id}
              onClick={() => void moveSet(menu.setId, f.id)}
            >
              <Folder size={14} aria-hidden="true" />
              <span className="truncate">{f.name}</span>
              {currentMenuSet.folder_id === f.id ? <Check size={13} className="bk-menu-check" aria-label="当前文件夹" /> : null}
            </button>
          ))}
          {folders.length === 0 ? <div className="bk-menu-empty">还没有自定义文件夹</div> : null}
          <div className="bk-menu-sep" role="separator" />
          <button
            type="button"
            className="bk-menu-item bk-menu-danger"
            role="menuitem"
            onClick={() => {
              setDeleteTarget(currentMenuSet);
              setMenu(null);
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
            <span>删除试卷</span>
          </button>
        </div>
      ) : null}

      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleteBusy) setDeleteTarget(null);
        }}
        title="删除试卷"
        width={440}
      >
        {deleteTarget ? (
          <div className="bk-del">
            <div className="bk-del-warn">
              <AlertTriangle size={18} aria-hidden="true" />
              <div>
                <b>确定删除「{deleteTarget.title}」？</b>
                <p className="small muted">
                  会同时删除该卷的 {deleteTarget.section_count} 个分区、{deleteTarget.question_count} 道题目、材料、练习记录与错题关联，且不可恢复。
                </p>
              </div>
            </div>
            <div className="bk-del-acts">
              <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>取消</Button>
              <Button size="sm" variant="danger" onClick={() => void confirmDeleteSet()} disabled={deleteBusy}>
                {deleteBusy ? <Loader2 size={14} className="bk-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
                删除试卷
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={tagBoardOpen}
        onClose={() => setTagBoardOpen(false)}
        title="管理标签"
        width={920}
      >
        <div className="bk-tagmodal">
          <TagBoard tags={tags} groups={tagGroups} selected={selTags} onToggle={toggleTag} onChanged={onTagsChanged} compact />
        </div>
      </Modal>
    </div>
  );
}
