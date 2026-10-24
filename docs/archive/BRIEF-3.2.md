# Tokeru 3.2 重构简报（本轮唯一事实来源）

产物目录：`C:\Users\19646\Desktop\学习与效率工具\折腾\dsh_zone_common\Tokeru`
技术栈：Tauri 2 + React 19 + TS + Rust + SQLite。浏览器开发模式 `http://127.0.0.1:1420`（Vite 已在跑，**不要重启/占用 1420**），mock 数据在 `src/lib/mock.ts`；桌面端稍后由 Lead 统一构建。

## 一、用户本轮要求（m01756，必须逐条落实）
1. 便携版启动失败要修（Lead 负责）。
2. 试卷集卡片尺寸固定，侧栏收起/展开时不能动态拉伸卡片（改为固定尺寸 + 固定列宽，页面变宽只增加留白/列数）。
3. 试卷名可在卡片上直接改。
4. 题库区彻底重构：**不再有题型分类**，只有「按标签」和「按试卷」两种归类筛选。
   - 只选标签时，结果同时显示「试卷」和「题目」；只选试卷时也同时显示两者；用户可切换「两者 / 仅试卷 / 仅题目」。
   - 标签可以是学科名、题型名、来源等，**多选**；试卷也可**多选**。
   - 题目按试卷分组展示，不按题型分组。
   - 试卷卡片的「答案速查」改为「速查与整理」：进入后可自由给试卷/题目打标签、改题型，方便大模型灵活导入的材料先落地再整理（导入仍严格校验字段，见导入规范）。
5. 给试卷集加文件夹：可新建/改名/删除文件夹，试卷可移动到文件夹（含「未归类」）。
6. 导入支持 AI 自动打标与归类：JSON 的 `set.tags`、`set.folder`、每题 `tags`。
7. 全部完成后 Lead 用 `1717916773_9867.pdf` + `Unit 2同步测试.md` 做全流程测试（含 AI 导入）。

## 二、已就绪的共享能力（Lead 已改完，直接调用）
### 数据形状（`src/lib/types.ts`）
```ts
interface SetSummary { id; title; subtitle; year; duration_minutes; source; audio_file; description;
  question_count; section_count; total_points; last_attempt_at: string|null;
  tags: string[]; folder_id: number|null; }
interface TagInfo { name: string; set_count: number; question_count: number; }
interface Folder { id; name; parent_id; sort; set_count; question_count; children? }
interface BankFilters { set_id?; set_ids?: number[]; section_id?; qtype?; tag?; tags?: string[];
  q?; sort?: "added_desc"|"added_asc"|"number_asc"|"number_desc"; limit?; offset?; }
interface ImportPreview { title; set_tags?: string[]; folder?: string|null; question_count; questions; warnings; sections?; materials?; }
```
### `src/lib/api.ts` 新增
- `api.listTags(): Promise<TagInfo[]>`
- `api.renameSet(setId, title): Promise<SetSummary>`
- `api.updateSetTags(setId, tags: string[]): Promise<SetSummary>`
- `api.assignFolder({ folderId, setId })`（传 null 表示未归类）
- 已有：listSets / getSet / listBank / listFolders / createFolder / renameFolder / deleteFolder / updateQuestion(qid, qtype?, tags?) / createAttempt({questionIds,mode,title})。
### 后端已支持
`sets.tags_json`、`sets.folder_id` 迁移；`list_tags` 聚合试卷+题目标签；`rename_set`、`update_set_tags`；`list_bank` 支持 `set_ids` 与多标签（全部命中）；导入解析 `set.tags`/`set.folder`/题目 tags，并自动建文件夹。
### mock 已支持
同样命令与字段（单个演示试卷，tag 已内置「英语/真题」等），刷新浏览器即可。
### 路由
`#/bank`、`#/sets/:id/answers`（→ 改名「速查与整理」）、`#/sets/:id/exam`、`#/exam/:attemptId`、`#/attempts/:id`、`#/records`、`#/mistakes`、`#/import`、`#/settings`。

## 三、页面规格

### A. 题库（owner: bank3；文件 `src/pages/BankPage.tsx`、`src/styles/bank.css`）
布局：`.page-fluid` 正常文档流；左筛选栏（约 248px，sticky）＋ 主区 ＋ 右侧选题篮（可收起，可保留 3.1 的实现思路）。
左栏：
1. **标签**：标题「标签」+ 搜索框（可选）；全部标签 chips（名称 + 次数），可多选，选中态明显；「清除」。
2. **试卷**：多选列表（每行 checkbox + 标题 + 题数 + 标签小点）；「全部 / 清空」。
3. **文件夹**：全部 / 未归类 / 自定义文件夹（含 set_count）；新建（行内输入）、改名、删除（二次确认）；点击文件夹只筛该文件夹的试卷与题目。
工具栏（吸顶）：搜索题干/标题；显示模式 `.seg`：两者 / 仅试卷 / 仅题目；排序（题号升/降、添加时间）；右侧「已选 N 题 · 开始练习」。
主区：
- 有试卷时显示「试卷」区：卡片网格固定宽度 **368px、高度 200px（内容超出省略/内部滚动）**，`grid-template-columns: repeat(auto-fill, 368px); justify-content:start`；卡片含：年份/来源角标、标题（可双击或点铅笔内联改名，Enter 保存、Esc 取消，调 `api.renameSet`）、subtitle、题数/分区/总分、标签 chips、文件夹徽标（点开菜单可移动）、底部按钮「开始练习」（`/sets/{id}/exam`）与「速查与整理」（`/sets/{id}/answers`）。改名/移动后 `invalidateQueries`。
- 有题目时显示「题目」区：**按试卷分组**（组头：试卷标题 + N 题 + 全选/取消），题目卡片网格（brief 模式紧凑；详细模式显示更多题干），卡片显示题号、题型中文 chip、分值、题干、该题标签、勾选圈；点卡片=勾选/取消；点题号=跳 `/sets/{setId}/answers?q={questionId}`。
- 过滤逻辑：标签、试卷、文件夹、搜索同时生效（标签在题目上需全部命中；试卷标签命中即可让该试卷出现）；「仅试卷」时不渲染题目区，「仅题目」时不渲染试卷区。
- 空态：没有结果时给一句可执行提示（清空筛选 / 去导入）。
- 右侧选题篮：已选题数/总分、按试卷分组的小 chip、可移除、清空、开始练习（createAttempt custom → `/exam/{id}`）；空态文案简洁。
- 不要有「题型视图」或题型分组；不要目录/文件夹旧的实现。
- 侧栏收起（0px）或展开（108px）时均不得横向滚动；卡片宽度不变。

### B. 首页（owner: home3；文件 `src/pages/HomePage.tsx`、`src/styles/home.css`）
- 试卷集卡片固定尺寸（同上 368×200），不得随窗口拉伸；页面宽度变化只改变列数/留白。
- 卡片支持内联改名（调 api.renameSet），显示标签、文件夹；卡片按钮「开始练习」「速查与整理」。
- 顶部文件夹筛选 chips（全部/未归类/每个文件夹）。
- 保留「最近的练习」列表与顶部轻统计；不做 hero 大文案。
- `home.css` 同时承载 Shell 侧栏样式：**保留现有 `.shell/.rail*` 全部规则与 108/0 收起行为**，只改与卡片/首页相关部分，改完用截图自查两种侧栏状态。

### C. 速查与整理（owner: organize；文件 `src/pages/AnswersPage.tsx`、`src/styles/organize.css`）
- 页标题「速查与整理」；顶部：set 标题、标签编辑器（chips + 输入回车添加、点 × 删除，保存调 `api.updateSetTags`）、文件夹下拉（`api.assignFolder`）、打印、整卷练习、返回题库。
- 按分区展示材料与题目；每题显示题干、选项、正确答案/也可接受/参考文本、解析。
- 每题可编辑：标签 chips（回车加、× 删，保存调 `api.updateQuestion(qid, undefined, tags)`）+ 题型下拉（9 种中文，保存调 `api.updateQuestion(qid, qtype, undefined)`）。
- 支持 `?q={questionId}` 深链：加载后滚动到该题并高亮 1.5s（用 `.focus-flash`）。
- 不要展示「解」单字图标；「解析」文案可用。
- 样式必须使用 `organize.css` + 现有 CSS 变量；不写死颜色。

### D. 导入（owner: import3；文件 `src/pages/ImportPage.tsx`、`src/lib/importPrompt.ts`、`src/styles/import.css`）
- `importPrompt.ts` 的规范增加：`set.tags`（数组：学科、考试、主题）、`set.folder`（字符串，可空）、每题 `tags`（数组：题型、知识点、难度等），说明 AI 可**自行打标与归类**，但题目字段（qtype/answer 等）仍必须严格符合规范；给出好/坏示例与标签命名建议（中文、2–6 字、同一概念复用同一标签）。
- 保持现有「复制提示词 / 复制 JSON 模板」按钮与四步流程。
- 预览区增加：试卷标签 chips、目标文件夹、每题标签（可只显示前几个）；校验统计不破坏现有布局。
- 确认导入/撤销后 `qc.invalidateQueries()`（已实现，保持）。
- 不要求新增后端命令。

## 四、硬性设计规则
- 中文 UI；不出现「刷题台」「先做题，再对答案」「英语题库」；不出现「解」单字图标。
- 只用 CSS 变量上色（accent/ok/warn/bad/surface/text 系列），禁止写死 hex；圆角用 `--radius-*`。
- 不新增依赖、不升级依赖；不引入 UI 库；图标继续用 lucide-react。
- 复用共享类：`.btn`（含 data-variant）、`.chip`、`.seg`、`.tile`、`.page-head`、`.panel`、`.toolbar`、`.pill-count`、`.muted`、`.small`、`.scroll-y`。
- 固定尺寸卡片：不要用 flex-grow/百分比宽度；Hover 只改变阴影/边框，不做尺寸动画。
- 响应式：1600 / 1280 / 1024 均不得横向滚动；侧栏展开 248（？）——**当前侧栏只有 108px 与 0px 两种状态**，按此测试。
- 改完必须 `cd Tokeru && pnpm exec tsc --noEmit` = 0；截图自查（见下）；完成后 send_message 给 lead 汇报（改了什么、截图路径、tsc 结果、遗留）。

## 五、截图与自测（不开新服务）
```bash
cd Tokeru
node tools/shot.mjs --route "#/bank" --out tools/shots/bank3-1600.png --w 1600 --h 1000 --wait 900 --diag
node tools/shot.mjs --route "#/bank" --out tools/shots/bank3-1280.png --w 1280 --h 900 --wait 900 --diag --dark
```
- 用 read_image 自查；确认 diag 的 hScroll=no、nativeControls=0、inlineColors=0、consoleErrors=0。
- 侧栏收起测试：先点 `.rail-toggle`，再 `--eval "new Promise(r=>setTimeout(()=>r('wait'),600))"` 后截图。

## 六、文件归属（只改自己的文件，禁止越界）
| owner | 文件 |
|---|---|
| bank3 | `src/pages/BankPage.tsx`, `src/styles/bank.css` |
| home3 | `src/pages/HomePage.tsx`, `src/styles/home.css` |
| organize | `src/pages/AnswersPage.tsx`, `src/styles/organize.css`（已建并在 main.tsx 引入） |
| import3 | `src/pages/ImportPage.tsx`, `src/lib/importPrompt.ts`, `src/styles/import.css` |
| lead | 其他所有文件（含 app.css、Shell.tsx、Rust、mock、types、api） |
需要改共享文件时先在消息里说明，不要直接改。
