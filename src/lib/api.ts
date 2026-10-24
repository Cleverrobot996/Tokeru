import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { mockCommand } from "./mock";
import type {
  AiConfigInput,
  AiResult,
  AiTestResult,
  AppSettings,
  AttemptDetail,
  AttemptSummary,
  BankFilters,
  BankResult,
  ClassifyItem,
  Folder,
  GradeAttemptResult,
  ImportPreview,
  McpStatus,
  Mistake,
  Question,
  SetDetail,
  ScoreItem,
  ScorePlanResult,
  SetSummary,
  TagGroup,
  TagInfo,
  TagSuggestion,
} from "./types";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function cmd<T>(name: string, args: Record<string, any> = {}): Promise<T> {
  if (isTauri) return invoke<T>(name, args);
  return mockCommand<T>(name, args);
}

export const api = {
  listSets: () => cmd<SetSummary[]>("list_sets"),
  getSet: (setId?: number) => cmd<SetDetail>("get_set", { setId: setId ?? null }),
  listBank: (filters: BankFilters) => cmd<BankResult>("list_bank", { filters }),
  listTags: () => cmd<TagInfo[]>("list_tags"),
  deleteTag: (tag: string) => cmd<null>("delete_tag", { tag }),
  listTagGroups: () => cmd<TagGroup[]>("list_tag_groups"),
  createTagGroup: (name: string, color?: string | null) => cmd<number>("create_tag_group", { name, color: color ?? null }),
  renameTagGroup: (groupId: number, name: string, color?: string | null) =>
    cmd<null>("rename_tag_group", { groupId, name, color: color ?? null }),
  deleteTagGroup: (groupId: number) => cmd<null>("delete_tag_group", { groupId }),
  assignTagGroup: (tag: string, groupId: number | null) => cmd<null>("assign_tag_group", { tag, groupId }),
  assignTagsGroup: (tags: string[], groupId: number | null) => cmd<null>("assign_tags_group", { tags, groupId }),
  aiOrganizeTags: () => cmd<TagSuggestion[]>("ai_organize_tags"),
  applyTagSuggestions: (items: TagSuggestion[]) => cmd<null>("apply_tag_suggestions", { items }),
  renameSet: (setId: number, title: string) => cmd<SetSummary>("rename_set", { setId, title }),
  updateSetTags: (setId: number, tags: string[]) => cmd<SetSummary>("update_set_tags", { setId, tags }),
  deleteSet: (setId: number) => cmd<null>("delete_set", { setId }),
  createAttempt: (p: { setId?: number | null; questionIds?: number[]; mode?: string; title?: string; timeLimit?: number }) =>
    cmd<number>("create_attempt", p),
  resumeAttempt: (setId: number, mode = "exam") => cmd<number | null>("resume_attempt", { setId, mode }),
  getAttempt: (attemptId: number) => cmd<AttemptDetail>("get_attempt", { attemptId }),
  saveAnswer: (attemptId: number, questionId: number, raw: string) => cmd<null>("save_answer", { attemptId, questionId, raw }),
  submitAttempt: (attemptId: number) => cmd<number>("submit_attempt", { attemptId }),
  selfGrade: (attemptId: number, questionId: number, score: number) => cmd<null>("self_grade", { attemptId, questionId, score }),
  listRecords: (from?: string, to?: string) => cmd<AttemptSummary[]>("list_records", { from: from ?? null, to: to ?? null }),
  deleteAttempt: (attemptId: number) => cmd<null>("delete_attempt", { attemptId }),
  listMistakes: () => cmd<Mistake[]>("list_mistakes"),
  collectMistakes: (questionIds: number[], origin = "manual") => cmd<null>("collect_mistakes", { questionIds, origin }),
  setMistakeStatus: (mistakeId: number, status: string) => cmd<null>("set_mistake_status", { mistakeId, status }),
  getSettings: () => cmd<AppSettings>("get_settings"),
  saveSettings: (settings: Record<string, any>) => cmd<AppSettings>("save_settings", { settings }),
  aiTest: (config: AiConfigInput, kind: "chat" | "vision" = "chat") => cmd<AiTestResult>("ai_test", { config, kind }),
  aiModels: (config: AiConfigInput, kind: "chat" | "vision" = "chat") =>
    cmd<string[]>("ai_models", { config, kind }),
  aiComplete: (system: string, user: string, config?: AiConfigInput, scene?: string) =>
    cmd<AiResult>("ai_complete", { system, user, config: config ?? null, scene: scene ?? null }),
  aiExplain: (p: { questionId: number; mode: string; customPrompt?: string; followup?: string; thinking?: boolean }) =>
    cmd<AiResult>("ai_explain", p),
  aiVisionSegment: (pages: string[], questions: { label: string; stem: string }[]) =>
    cmd<AiResult>("ai_vision_segment", { pages, questions }),
  aiVisionOcr: (pages: string[]) => cmd<AiResult>("ai_vision_ocr", { pages }),
  mcpStatus: () => cmd<McpStatus>("mcp_status"),
  mcpConfigure: (p: { enabled: boolean; port?: number; readonly?: boolean; regenerate?: boolean }) =>
    cmd<McpStatus>("mcp_configure", p),
  mcpRegenerateToken: () => cmd<McpStatus>("mcp_regenerate_token"),
  aiPlanScores: (setId: number, total: number, instructions?: string) =>
    cmd<ScorePlanResult>("ai_plan_scores", { setId, total, instructions: instructions ?? null }),
  applyScorePlan: (setId: number, items: ScoreItem[]) => cmd<SetSummary>("apply_score_plan", { setId, items }),
  aiGradeAttempt: (attemptId: number, onlyPending = true) =>
    cmd<GradeAttemptResult>("ai_grade_attempt", { attemptId, onlyPending }),
  aiClassify: (questionIds: number[], instruction = "") => cmd<ClassifyItem[]>("ai_classify", { questionIds, instruction }),
  previewImport: (p: { text?: string; path?: string; title?: string; kind?: string }) => cmd<ImportPreview>("preview_import", p),
  confirmImport: (p: { text: string; title?: string }) => cmd<number>("confirm_import", p),
  undoImport: (batchId: number) => cmd<null>("undo_import", { batchId }),
  backupNow: () => cmd<string>("backup_now"),
  listBackups: () => cmd<string[]>("list_backups"),
  restoreBackup: (path: string) => cmd<null>("restore_backup", { path }),
  listFolders: () => cmd<Folder[]>("list_folders"),
  createFolder: (name: string, parentId?: number | null) => cmd<number>("create_folder", { name, parentId: parentId ?? null }),
  renameFolder: (folderId: number, name: string) => cmd<null>("rename_folder", { folderId, name }),
  deleteFolder: (folderId: number) => cmd<null>("delete_folder", { folderId }),
  assignFolder: (p: { folderId?: number | null; setId?: number | null; questionIds?: number[] }) => cmd<null>("assign_folder", p),
  updateQuestion: (questionId: number, qtype?: string, tags?: string[], stem?: string) => cmd<null>("update_question", { questionId, qtype, tags, stem }),
  listSystemFonts: () => (isTauri ? cmd<string[]>("list_system_fonts") : Promise.resolve<string[]>([])),
  mediaUrl: (file?: string | null, dir: "media" | "backups" = "media") => {
    if (!file) return "";
    if (!isTauri) return `/media/${file}`;
    return convertFileSrc(file.startsWith(dir) ? file : `${dir}/${file}`);
  },
  assetUrl: async (file?: string | null) => {
    if (!file) return "";
    if (!isTauri) return `/media/${file}`;
    const p = await cmd<string>("media_path", { file });
    return convertFileSrc(p);
  },
};