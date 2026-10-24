# Tokeru 3.1 重构施工简报（Lead 维护，所有成员先读这一份）

> 本文件是唯一的事实来源。读完后只看自己负责的文件。有冲突以本文件 + Lead 消息为准。

## 0. 一句话
Tokeru 是一个 Tauri 2 + React 19 + Rust + SQLite 的**本地桌面英语刷题应用**（用户自用，非商业）。
本轮的活儿：**推翻旧 UI 设计，把「选题练习」「考试工作台」「首页」「侧栏」「导入清洗规范」「AI 配置」六块按用户反馈重做**，并保证 `tsc` 通过、视觉自洽、无冗余说明文字。

## 1. 位置与命令（绝对路径）
- 项目根：`C:\Users\19646\Desktop\学习与效率工具\折腾\dsh_zone_common\Tokeru`
- 前端：`src/`；Rust：`src-tauri/src/`；截图工具：`tools/`；文档：`docs/`
- 类型检查（每个人都必须跑）：`cd Tokeru && pnpm exec tsc --noEmit`
- 浏览器预览：Vite dev **已在后台跑**，`http://127.0.0.1:1420/#/bank`（端口 1420，勿占用勿重启，除非它挂了）
  - 浏览器模式自动走 `src/lib/mock.ts` 的假数据（不写 SQLite），所以**改前端不用管 Rust**
- 构建（**只有 Lead 跑**，避免 dist/ 打架）：`pnpm build` / `pnpm tauri build --no-bundle`
- 系统浏览器（截图用）：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- Windows 上跑 cargo 前需：`$env:TEMP=(Get-Location)\.tmp; $env:CARGO_HTTP_CHECK_REVOKE='false'; $env:CARGO_HTTP_MULTIPLEXING='false'`

## 2. 用户最新反馈（原文，必须逐条落实）
1. "这样调试也太慢了，请写一个方便你截图查看与调试的工具" → `qa-shot` 负责
2. "主页我不想要那一句先做题再对答案，我只想要显示试卷集和最近的练习" → `shell-home`
3. "我们的题库界面崩了，题目显示不正常，上面的查看方式的窗口也变形了，我还要求彻底重构选题练习界面，抛弃以前的所有设计，并让它逻辑自洽起来" → `bank-ui`
4. "逻辑不自洽的地方还体现在你内置了那么多种题型，结果导入清洗的提示词规则那么简单" → `ai-import`
5. "不要默认使用deepseekapi" → `ai-import`
6. "我还要求侧边导航栏可收起，否则写题界面太拥挤了，以及导航栏现在依然没有经过ui设计，和主题不统一" → `shell-home`
7. "之前我给你的15图问题反映，有一些问题没有落实，请仔细检查！" → 全体 + `qa-shot` 出核验清单

## 3. 15 图历史清单（未落实的按下面执行）
- ①写作自评清单/解析并入 AI 解释，预置提示词
- ②③④删冗余说明；首页 = 题集 + 题目数量统计
- ⑤选了题目视图的题却还要再选试卷 → **题型视图勾完直接能开始练习，不用再选卷**
- ⑥详细模式 = 整卷视图
- ⑦视图切换放到固定位置（顶部工具条左侧）
- ⑧⑨⑩无样式 UI 太多（原生 select/checkbox/文件框）；文件夹新建/点击会刷新网页
- ⑪题目筛选类型多 → 需要一套详细导入清洗规则；导入页提供「复制提示词清洗题目材料」
- ⑫**删除目录/文件夹功能**，保留排序与简要/详细模式
- ⑬答题卡与试卷原样要区分；从原卷拆出的题不应出现在试卷内
- ⑭三栏铺满窗口不留左右空白；答题进度用颜色表示完成
- ⑮倒计时：一个输入框 + 可删除的预设值 + 可自定义
- 更早（m10311）：**UI 里不许出现「解」字图标**；不翻译成"刷题台"，就叫 Tokeru；彻底清查冗余说明（废话占 UI）

## 4. 设计系统（先看 `src/styles/app.css`，用现成的，别自造）
### 令牌（CSS 变量，全部已定义，深浅色 + 5 套主题色都有覆盖）
- 背景/表面：`--bg --bg-tint --surface --surface-2 --surface-3 --glass`
- 文字：`--text --text-2 --text-3`；线：`--line --line-strong`
- 主色：`--accent --accent-strong --accent-soft --accent-contrast`；语义：`--ok/--ok-soft --warn/--warn-soft --bad/--bad-soft`
- 圆角：`--radius-group 22px --radius-card 16px --radius-control 12px --radius-chip 999px --radius-dialog 28px`
- 阴影：`--shadow-sm --shadow-md`；动效：`--ease`
- 字体：`--font-ui`（界面）、`--font-reading`（题干/标题，衬线）
### 现成类（禁止重复实现）
`.btn/.btn-primary/.btn-soft/.btn-ghost/.btn-sm/.btn-danger/.icon-btn`、`.chip/.chip-accent/.chip-ok/.chip-warn/.chip-bad`、
`.panel/.panel-pad/.panel-head/.panel-title/.panel-sub/.hr`、`.field/.input/.select/.textarea/.form-grid/.form-actions/.check/.checkbox/.switch`、
`.popover/.popover-item/.swatches/.swatch`、`.q-card/.q-head/.q-no/.q-stem/.opts/.opt/.material`、`.num-grid/.num(.done/.current/.correct/.wrong/.pending)`、
`.list/.list-row/.empty/.section-title/.split-head/.eyebrow/.muted/.small/.mono`、
**本轮新增（Lead 已加在 app.css）**：`.seg`（分段控件，button[data-on="true"]）、`.toolbar`（吸顶工具条 + `.spacer`）、`.pill-count`、`.page-fluid`（满宽页）、`.hstack/.vstack/.grow/.scroll-y/.mono-num`、`.tile`[data-selected]。
### 硬规则
- 只用 CSS 变量上色，**不许写死颜色**（`#fff`/rgba 也不行，用 `color-mix(in srgb, var(--x) 12%, transparent)`）。
- 不用 UI 组件库（不装依赖），按钮一律 `<Button>`（来自 `src/components/ui.tsx`）或 `.btn`。
- 原生 `<select>` 一律配 `.select`，输入框配 `.input`，多行配 `.textarea`（⑧⑨⑩）。
- 中文文案。**删掉解释性废话**：不要"在右侧答题卡填写答案"这类提示，除非是必要操作说明。
- 每个交互元素要有 hover/focus/active 反馈；焦点可见（:focus-visible outline）。
- 布局要能容纳 1600×1000 与 1280×800，最小 1024 宽；**页面级不要出现横向滚动条**。
- 「解」字不要出现在图标或文案里（用 Lightbulb/Sparkles 图标代替）。

## 5. 本轮信息架构（Lead 已定，照做）
### 5.1 首页 `/`（shell-home）
- 顶部：轻量标题（不要 hero 大字、不要"先做题，再对答案"）。
- 区块一「试卷集」：`listSets` 的每份试卷一张卡（封面=年份大字，标题，题数/分区/分值/时长，最近一次成绩），操作：开始练习 / 答案速查。
- 区块二「最近的练习」：`listRecords` 最近 6 条（时间、模式、得分/满分、题数、用时），操作：看结果；空态引导去题库。
- 不要统计大数字墙；最多在头部一行小字：`N 份试卷 · M 道题 · X 次练习`。
### 5.2 题库 `/bank` = 选题练习（bank-ui，彻底重写）
- 顶部 `.toolbar`：左 = `.seg` 视图切换【试卷视图 / 题型视图】；中 = 搜索框（题干/解析）、排序（题号↑↓/分值/题型）、`.seg` 简要/详细模式；右 = 已选计数 + 开始练习。
- **试卷视图**：左侧窄列试卷列表（可多份，点击切换）+ 主区按分区（PART）分组；每个分区头有：分区名、题数、分值、全选/取消；分区内是题目卡网格（简要=题号+题型标签+截断题干+分值；详细=完整题干+选项/空格）。`material` 属于分区的，在分区头下方折叠展示（可展开原文）。
- **题型视图**：按 9 种题型分组，每组头显示题型中文名、题数、全选；题目卡额外显示来源试卷与题号（溯源）。勾选大题=选中该组全部小题。
- **右侧选题篮**（sticky，独立滚动，可收起）：已选 `N 题 · M 分`，按分区/题型分组列出已选题号（点×移除），底部【开始练习】【清空】。
  - 开始练习 → `api.createAttempt({ questionIds, mode: "custom", title: "自选练习 · N 题" })` → `#/exam/{id}`。**不要弹窗让用户再选试卷**（⑤）。
  - 整卷练习：试卷头有【整卷练习】按钮（`createAttempt({ setId, mode: "exam" })`）。
- **删除**：目录/文件夹全部 UI 与逻辑（不调用 listFolders/createFolder 等）。
- 单击题目卡 = 勾选/取消（卡片高亮 `[data-selected]`）；点「题号」= 跳 `#/sets/{setId}/answers?q={id}` 溯源。
### 5.3 考试/练习工作台（exam-ui，重构）
- 满宽三栏，**无左右空白**：左「答题进度」、中「试卷原样」、右「答题卡」。三栏之间**可拖拽分隔条**改宽度（拖动时禁止选中文本），左右两栏**可收起**（收起后工具条上有展开按钮，状态存 localStorage）。
- 顶栏：返回、试卷标题 + 已答进度、计时（点击弹出：预设 chips（可删）+ 自定义输入框 + 不限时，⑮）、交卷主按钮。
- 左栏进度：按分区列出题号，颜色区分 未答/已答/已标记（`--text-3` / `--accent` / `--warn`），当前题描边高亮（⑭）。
- 中栏试卷原样：按分区呈现，含材料原文、听力音频条；题目卡显示题干/选项；**不显示答案与解析**。
- 右栏答题卡：**只放题号 + 输入控件**（选择=4 个字母按钮、填空=输入框、听写/写作=textarea），不重复题干（⑬）。
- 联动：点中栏题目卡 → 右栏对应控件高亮并 scrollIntoView；点右栏题号 → 中栏滚到该题并短暂高亮（m5784）。
- 自动保存答案（`api.saveAnswer`，防抖 300ms），交卷前 flush。
- 从原卷拆出的补充题（若 attempt 里有不属于该 set 的题）单独一个「补充练习」分区，不混进试卷原样（⑬）。
### 5.4 导入 `/import`（ai-import）
- 四步：① 选择/粘贴材料 → ② 生成 JSON（一键复制提示词）→ ③ 预览校验（题目表 + 警告明细 + 题型分布）→ ④ 确认导入（可撤销）。
- 内置一份**完整的清洗规范**（`src/lib/importPrompt.ts`），覆盖 9 种题型：每种给出字段要求、`answer` 结构、`material`/分区组织方式、正例反例、JSON Schema 说明。文案要能让用户直接贴给任意 AI 用。
- 提供两个复制按钮：「复制提示词（含规范）」「复制 JSON 模板」。
### 5.5 设置 `/settings`（ai-import）
- AI 区**不预置任何厂商**：默认 model/base_url 留空，placeholder 给示例；提供「常用端点」快捷选择（OpenAI / DeepSeek / 硅基流动 / 本地 Ollama / 自定义 / 不用 AI），**默认 = 不用 AI**。
- 保留：Key 只写不回显、清除 Key、思考模式、测试连接、自定义提示词。
- 计时预设：改成 chip 编辑器（+ 添加 / × 删除 / 拖不拖都行），不再是逗号字符串（⑮）。
- 备份/恢复、外观（主题色、明暗）保留，视觉统一。

## 6. 文件归属（**只改自己的文件**，越界会被 Lead 回滚）
| 所有者 | 文件 |
|---|---|
| lead | `src/styles/app.css`、`src/styles/tokens.css`、`src/main.tsx`、`src/App.tsx`、`src/components/ui.tsx`、`src/pages/{ResultPage,RecordsPage,MistakesPage,AnswersPage}.tsx`、`docs/BRIEF.md` |
| bank-ui | `src/pages/BankPage.tsx`、`src/styles/bank.css` |
| exam-ui | `src/pages/ExamPage.tsx`、`src/styles/exam.css` |
| shell-home | `src/components/Shell.tsx`、`src/pages/HomePage.tsx`、`src/styles/home.css` |
| ai-import | `src/pages/SettingsPage.tsx`、`src/pages/ImportPage.tsx`、`src/lib/importPrompt.ts`(新建)、`src/lib/{types,api,mock}.ts`、`src-tauri/src/{ai.rs,commands.rs,db.rs}`、`src/styles/import.css` |
| qa-shot | `tools/**`、`docs/qa/**` |
需要跨文件的公共能力（新组件、新令牌）→ **发消息给 lead**，不要自己改别人的文件。

## 7. 验证方法（不验证等于没做）
- 类型：`pnpm exec tsc --noEmit` 必须 0 错误。
- 视觉：用 `node tools/shot.mjs --route /bank --out tools/shots/bank.png`（qa-shot 完成后可用；刚开始可先用下面命令自测）
  ```bash
  "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu --hide-scrollbars \
    --window-size=1600,1000 --virtual-time-budget=4000 --screenshot="$(pwd)/tools/shots/x.png" "http://127.0.0.1:1420/#/bank"
  ```
- 自查项：1600×1000 与 1280×800 两档截图；无横向滚动；深色模式（`document.documentElement.dataset.theme='dark'`）；无「解」字；按钮 hover 有反馈；控制台无报错。

## 8. 协作协议
- 领到任务 → `team_task_get` → `team_task_update(action=claim)` → 干完 `send_message(target="lead")`：改了什么文件、如何验证、截图路径、遗留问题。
- 用 `todo_write` 维护自己的步骤清单。
- 不要跑 `pnpm build`/`tauri build`（Lead 统一跑）。不要装新依赖。
- 不要 server 抢端口；不要动 `node_modules`；不要删别人的文件。
- 遇到必须改别人文件才能继续 → 立刻发消息给 lead，不要擅自改。
