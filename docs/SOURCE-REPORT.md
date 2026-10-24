# Tokeru 源码报告（3.4.1）

> 本报告基于 3.4.1 源码，生成日期 2026-10-23；3.4.1 只改安装器 preinstall 钩子、手动清理脚本和版本号，应用代码与 3.4.0 相同。3.3 的结论保留，3.4 的改动集中在第 13 节，涉及命令数/页面/表结构处已同步改正文；安装修复见 `RELEASE-3.4.1.md`。
> 路径均相对 `Tokeru/`。报告以 `docs/SOURCE-MAP.md` 为入口，但关键结论都用 read/grep 抽查过源码；与源码不一致处集中列在第 12 节。

## 0. 阅读方式

- 先看第 1、3、5 节建立骨架：技术栈 → 启动 → 命令边界。
- 要改前端，先看第 6 节路由与第 4.3 节类型映射；要改数据，先看第 4 节。
- 三条核心流程在第 7 节，写到函数名；排障时按流程逐段对照。
- 验证证据与“未验证”的边界在第 10 节，不要把“实现了”当成“验收通过”。

## 1. 技术栈与运行形态

| 层 | 选型 | 事实位置 |
| --- | --- | --- |
| 桌面壳 | Tauri 2（Rust，Windows 为主） | `src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` |
| 前端 | React 19 + TypeScript 5.9 + Vite 7 + React Router 7（HashRouter） | `package.json`、`src/main.tsx`、`src/App.tsx` |
| 数据请求 | TanStack Query（retry 1、窗口聚焦不重取、staleTime 10s） | `src/main.tsx` |
| 样式 | 手写 CSS，按页面拆分；无 Tailwind | `src/styles/*.css` |
| 数据库 | SQLite（rusqlite 0.32 bundled，WAL，外键） | `src-tauri/src/db.rs` |
| 并发模型 | 单连接 `Mutex<Connection>`，所有命令串行拿锁 | `src-tauri/src/db.rs` 的 `Db` |
| PDF | pdfjs-dist 6.4.299，仅前端渲染成 JPEG 页面图 | `src/lib/pdf.ts` |
| AI | OpenAI 兼容 `/chat/completions`，文本 + 视觉 | `src-tauri/src/ai.rs` |
| 打包 | Vite 产物 + Tauri NSIS；另有便携目录/zip | `package.json`、`tauri.conf.json`、`src-tauri/nsis/installer-hooks.nsh` |

运行形态是**单机单进程**：前端只通过 `invoke` 调 Rust，Rust 直连 SQLite，没有 HTTP 服务端。浏览器开发模式（`pnpm dev`）完全不碰 Rust，由 `src/lib/mock.ts` 在 localStorage 里模拟全部命令。

## 2. 目录结构与核心文件职责

### 2.1 顶层

```text
Tokeru/
├─ src/                  React 前端（页面、组件、lib、styles）
├─ src-tauri/            Rust 桌面壳（src/、nsis/、tauri.conf.json、Cargo.toml）
├─ data/seed/            内置题库 JSON（TEM4 2016）
├─ data/media/           听力 mp3
├─ tools/                截图/巡检脚本，不参与打包
├─ docs/                 版本说明、QA、源码地图/报告
├─ dist-portable/        便携包产物（Tokeru/ 目录 + 3.2.0/3.3.0/3.4.0 zip）
└─ package.json / vite.config.ts / README.md
```

### 2.2 前端核心文件

| 文件 | 行数量级 | 职责 | 关键导出/组件 |
| --- | --- | --- | --- |
| `src/main.tsx` | 30 | QueryClient、ThemeProvider、HashRouter、CSS 入口、恢复自定义字体 | — |
| `src/App.tsx` | 31 | 路由表，Shell 包全部页面，`*` 回落首页 | — |
| `src/components/Shell.tsx` | 263 | 侧栏（默认 108px，可收 0）、顶栏、主题弹层、Outlet | Shell |
| `src/components/PaperView.tsx` | 408 | 共享原卷渲染：分区/材料簇/题目/答案条；考试、题库、速查共用 | PaperDoc、PaperSection、MaterialBlock、PaperQuestion、PaperAnswerKey |
| `src/components/PaperSettings.tsx` | 346 | 试卷排版弹窗；设置页与考试页共用 | PaperSettings |
| `src/components/AutoFigures.tsx` | 369 | 自动分图：选页 → 视觉识别 → 解析 → 裁剪 → 写题干 | AutoFigures、parseFigures |
| `src/components/TagChips.tsx` | 101 | 标签展示，分组/裸名两种模式 | TagChips |
| `src/components/TagBoard.tsx` | 535 | 标签栏管理：拖放归类、新建/改名/删除、AI 整理预览 | TagBoard |
| `src/components/ui.tsx` | 114 | Button/Chip/Field/Modal/Switch/Markdown/Empty | — |
| `src/pages/HomePage.tsx` | 417 | 试卷集卡片 + 文件夹筛选 + 最近练习 + 改名 | HomePage |
| `src/pages/BankPage.tsx` | 1588 | 题库：标签三栏/试卷/文件夹、详细原卷/简要列表、删除试卷、选题篮 | BankPage |
| `src/pages/ExamPage.tsx` | 1200 | 三栏考试工作台、原卷中栏、自动保存、计时、拖栏 | ExamPage、Workspace |
| `src/pages/AnswersPage.tsx` | 1551 | 速查与整理、详细/简要、题号深链、单题编辑、打印、自动分图 | AnswersPage |
| `src/pages/ResultPage.tsx` | 402 | 交卷结果、对照、自评、AI 讲解、批量收错题 | ResultPage |
| `src/pages/RecordsPage.tsx` | 213 | 记录筛选/日期分组/批量错题/删除 | RecordsPage |
| `src/pages/MistakesPage.tsx` | 128 | 错题本三态、复习组卷 | MistakesPage |
| `src/pages/ImportPage.tsx` | 895 | 拖入/粘贴材料 → AI 清洗 → 预览 → 导入/撤销 | ImportPage |
| `src/pages/SettingsPage.tsx` | 472 | AI/视觉/测试连接/外观/计时/排版/备份 | SettingsPage |
| `src/lib/api.ts` | 92 | invoke 封装；浏览器走 mock；媒体 URL | api、isTauri |
| `src/lib/mock.ts` | 1104 | 浏览器假数据，localStorage 持久化 | mockCommand |
| `src/lib/types.ts` | 253 | 前端共享类型 | — |
| `src/lib/pdf.ts` | 163 | PDF/图片 → 页面 JPEG、cropPage、PDF 抽文字 | — |
| `src/lib/importPrompt.ts` | 936 | 9 题型清洗规范（v1.1）+ JSON 模板 + buildPrompt | IMPORT_SPEC、buildPrompt |
| `src/lib/paper.ts` | 157 | 排版预设/localStorage/自定义字体 | — |
| `src/lib/richText.ts` | 35 | 题干填空/图片的安全 HTML | richStemHtml |
| `src/lib/theme.tsx` | 60 | 明暗 + 主题色写 dataset | ThemeProvider |
| `src/lib/labels.ts` | 85 | 题型/模式/时间的展示文案 | — |

### 2.3 Rust 核心文件

| 文件 | 行数量级 | 职责 | 关键项 |
| --- | --- | --- | --- |
| `src-tauri/src/main.rs` | 201 | 启动、数据目录回退、建窗、命令注册；release 为 Windows GUI 子系统 | setup_app、run |
| `src-tauri/src/commands.rs` | 1355 | 全部 46 个 Tauri 命令、导入解析、标签栏、AI 测试、删除试卷、备份/恢复 | #[tauri::command] |
| `src-tauri/src/db.rs` | 327 | 打开库、建表/迁移、seed、标签栏播种、settings 读写 | Db、init_schema、seed_if_empty |
| `src-tauri/src/repo.rs` | 420 | SQL 查询与行映射；标签栏查询/归类 | list_bank、get_attempt_detail、list_mistakes、list_tag_groups |
| `src-tauri/src/models.rs` | 267 | Rust serde 结构 | SetSummary、Question、AttemptDetail、TagGroup、AiTestResult |
| `src-tauri/src/grading.rs` | 69 | 客观题归一化与判分 | grade_one |
| `src-tauri/src/ai.rs` | 149 | 通用 chat 调用 + 文本解释 + 视觉分图 | post_chat、complete、explain、vision_segment |
| `src-tauri/src/fonts.rs` | — | Windows GDI 字体枚举 | list_system_fonts |
| `src-tauri/nsis/installer-hooks.nsh` | — | NSIS preinstall 杀旧进程/删旧 exe/中文失败提示 | NSIS_HOOK_PREINSTALL |
| `src-tauri/tauri.conf.json` | — | 版本、窗口、资源、NSIS、WebView2 策略 | — |

## 3. 启动链路与数据目录

### 3.1 顺序

1. `main.rs::run()` 创建 Tauri Builder，注册 `tauri_plugin_opener`、`tauri_plugin_dialog`。
2. `.setup()` 调 `setup_app`；失败则 `write_startup_log`（exe 旁 `tokero-startup-error.log`）+ Windows `MessageBoxW`，随后 `std::process::exit(1)`。
3. `setup_app` 解析数据目录候选，逐个 `db::Db::open(dir)`，第一个成功者生效。
4. `Db::open` 创建 `media/`、`backups/`、`tokero.db`，执行 `init_schema`（WAL + 外键 + 表/索引 + 迁移 ALTER）。
5. 定位听力文件，调 `db::seed_if_empty`；**只有 questions 表为空**才导入 seed。
6. `app.manage(db)` 把 Db 放进 Tauri state。
7. 创建 WebView2 窗口：标题 Tokeru，1440×920，最小 1080×700，`data_directory = <data_dir>/webview/<pid>`；创建失败时退回 `%TEMP%/Tokeru/webview/<pid>`。
8. 前端 `main.tsx`：QueryClientProvider → ThemeProvider → HashRouter → App。
9. `App.tsx` 用 Shell 包路由；`*` 回落 HomePage。

### 3.2 数据目录回退（重要）

`setup_app` 的逻辑不是“依次追加候选”，而是：

- 若设置了 `TOKERU_DATA_DIR`：**只尝试这一个目录**；失败就直接报“所有数据目录都不可用”，不会继续回退。
- 未设置时，候选链为：
  1. Tauri `app.path().app_data_dir()`（Windows 通常是 `%APPDATA%\com.tokero.app`）
  2. `%LOCALAPPDATA%\com.tokero.app`
  3. exe 同目录 `data/`
  4. `%TEMP%\Tokeru\data`

注意 Windows 上 `%APPDATA%` 与 `%LOCALAPPDATA%` 是两个位置；README 只写了前者。代码会用 `used_index > 0` 打一行 stderr，说明发生了回退。

### 3.3 种子与听力

- seed 文件：`data/seed/tem4_2016.json`（83,938 B，1 份试卷、8 个分区、6 份材料、67 题、130 分钟）。
- `seed_if_empty` 先 `SELECT COUNT(*) FROM questions`，非空直接返回；空库时在一个事务里插 set → materials → sections → questions，最后把听力复制到 `<data_dir>/media/`。
- 听力源查找：打包资源 `resource_dir/media/tem4-2016.mp3` → 便携 exe 旁 `data/media/tem4-2016.mp3` → 开发目录 `CARGO_MANIFEST_DIR/../data/media/tem4-2016.mp3`。
- seed 失败只 `eprintln!("内置题库初始化跳过...")`，不阻断启动。

### 3.4 前端启动细节

- QueryClient：`retry: 1`、`refetchOnWindowFocus: false`、`staleTime: 10_000`。
- CSS 按顺序导入：`app.css`、`home.css`、`bank.css`、`exam.css`、`import.css`、`organize.css`；`paper.css` 由 `PaperView.tsx` 导入，`tags.css` 由 `TagBoard/TagChips` 导入（组件级样式）。
- 启动时 `restoreCustomFont()` 把 localStorage 里的自定义字体重新注册。
- 主题/主题色保存在 localStorage：`tokero.theme`、`tokero.accent`，写到 `document.documentElement.dataset`。

## 4. SQLite 表结构与类型对应

### 4.1 表（`db.rs::init_schema`）

| 表 | 作用 | 主要列 |
| --- | --- | --- |
| `sets` | 试卷 | `id,title,subtitle,year,duration_minutes,source,audio_file,description,tags_json,created_at` + 迁移列 `folder_id` |
| `folders` | 文件夹（自关联树） | `id,name,parent_id,sort,created_at` |
| `sections` | 分区 | `id,set_id,key,title,subtitle,kind,position,audio_file,material_id` |
| `materials` | 阅读/听力材料 | `id,set_id,key,title,content` |
| `questions` | 题目 | `id,set_id,section_id,material_id,number,label,qtype,stem,options_json,answer_json,explanation,points,position,source,tags_json,archived,folder_id,created_at` |
| `attempts` | 一次练习 | `id,set_id,title,mode,status,started_at,finished_at,time_limit,total_score,max_score,question_ids_json,paper_answers_json` |
| `answers` | 作答 | `id,attempt_id,question_id,raw,is_correct,score,max_score,graded_by,updated_at`，唯一 `(attempt_id,question_id)` |
| `mistakes` | 错题本 | `id,question_id UNIQUE,origin,wrong_count,correct_streak,last_wrong_at,last_correct_at,status,due_at,note` |
| `ai_runs` | AI 调用记录（预留） | `id,question_id,mode,model,custom_prompt,prompt_summary,response_html,reasoning_html,created_at` |
| `settings` | 键值设置 | `key PRIMARY KEY,value` |
| `import_batches` | 导入批次 | `id,set_id,title,created_at` |
| `tag_groups` | 标签栏（3.4） | `id,name UNIQUE,color,position,created_at`；种子：学科/题型/难度 |
| `tag_assignments` | 标签→栏映射（3.4） | `tag PRIMARY KEY,group_id REFERENCES tag_groups ON DELETE SET NULL` |

外键/级联：

- `sections.set_id`、`materials.set_id`、`questions.set_id` → `sets` `ON DELETE CASCADE`。
- `questions.section_id` → `sections` `ON DELETE CASCADE`。
- `attempts.set_id` → `sets` `ON DELETE SET NULL`。
- `answers.attempt_id`、`answers.question_id`、`mistakes.question_id`、`import_batches.set_id` → `ON DELETE CASCADE`。
- `sets.folder_id`、`questions.folder_id` → `folders` `ON DELETE SET NULL`。
- `tag_assignments.group_id` → `tag_groups` `ON DELETE SET NULL`：删除栏后标签回到未归类。
- 索引：`idx_questions_set`、`idx_answers_attempt`、`idx_attempts_status`。
- 迁移：`sets.folder_id`、`sets.tags_json`、`questions.folder_id`、`mistakes.origin`、`ai_runs.reasoning_html` 通过容错 `ALTER TABLE` 补齐。

### 4.2 存储事实与坑

- 题干图片是 **data URL 直接塞进 stem**：`<figure class="q-figure"><img src="data:image/jpeg;base64,..."></figure>`；单题题干上限 8 MB（`update_question` 校验）。
- 时间统一存文本：`db::now()` 为 `YYYY-MM-DD HH:MM:SS`，`today_plus(days)` 为日期 `YYYY-MM-DD`。
- `attempts.paper_answers_json` 只在 `create_attempt` 写 `'{}'`，**没有读取点**，是遗留字段；不要把它当作纸面答案存储。
- `ai_runs` 表只在建表/恢复备份中出现，**没有任何 INSERT**；AI 调用结果不落库、无缓存（`AiResult.cached` 恒为 false）。
- `import_batches` 只用于撤销当次导入；恢复备份后历史批次不会恢复（备份脚本不导出该表）。
- 标签栏播种只做一次：`settings["tag_groups_seeded"]` 存在就跳过；旧标签按学科/题型/难度词典归类，其余留空（未归类）。
- WAL 模式 + 单连接意味着所有 DB 命令串行；AI 命令会在拿完配置后释放锁再发网络请求。

### 4.3 前端类型 vs Rust models

以下差异是“TS 更宽”，不会立刻报错，但改字段时容易误判：

| 类型 | TS（`src/lib/types.ts`） | Rust（`models.rs`） | 影响 |
| --- | --- | --- | --- |
| `SetSummary.year` | `number \| string \| null` | `String` | 前端要兼容旧数据/空串 |
| `Section` | 多 `instructions/duration_minutes/question_count` | 只有 `subtitle/kind/position/audio_file/material_id` | TS 字段不会由 Rust 返回；分区说明实际读 `subtitle` |
| `Material` | 多 `kind/position` | 无 | 同上，前端不要依赖 |
| `BankFilters` | 有 `offset`，缺 `archived/folder_id`（部分） | 无 `offset`；有 `archived/folder_id/set_ids/tags/limit` | 前端传 offset 无效；分页目前靠 limit |
| `AttemptQuestion` | 多 `time_spent?` | `#[serde(flatten)] question + answer_raw/is_correct/score/graded_by` | 每题耗时未持久化 |
| `ImportPreview` | 多 `raw/set_tags/folder/sections/materials?` | 预览结构固定 | 预览字段以 Rust 返回为准 |
| `Question.answer` | `AnswerSpec` 联合 | `serde_json::Value` | 由题目类型决定形态 |

核心结构：Question、SetDetail、AttemptDetail、Mistake、AppSettings、AiResult、Folder、TagInfo、TagGroup、AiTestResult、AiConfigInput、ClassifyItem、ImportPreview 两边基本一一对应；AttemptQuestion 用 flatten 把题目字段摊平，前端直接读 `q.stem` 等。

3.4 新增字段：`AppSettings.vision_model/vision_base_url`；`TagInfo.group_id/group_name/group_color`；`TagSuggestion` 与 `AiTestResult` 前端均为 camelCase（Rust 用 `#[serde(rename_all="camelCase")]`）。`AiConfigInput` 只在测试/清洗时临时传，不写 settings。

## 5. Tauri 命令表与双轨调用

### 5.1 命令分组（共 46 个，注册在 `main.rs::run` 的 `generate_handler!`）

**题库/首页/维护（15）**

| 命令 | 关键参数 | 行为 |
| --- | --- | --- |
| `list_sets` | — | `repo::list_set_summaries`，全部试卷（3.3 已修掉只返 1 份的问题） |
| `get_set` | `set_id?: i64` | 整卷详情：sections/materials/questions |
| `list_bank` | `filters: BankFilters` | 动态筛选 + 计数 + 题列表；默认 `limit=500`，clamp 1..2000 |
| `list_tags` | — | 合并 set/question 标签计数 |
| `rename_set` | `set_id,title` | 空名报错 |
| `update_set_tags` | `set_id,tags` | 清洗后写 `tags_json` |
| `delete_set` | `set_id` | 事务删 answers→attempts→import_batches→sets；分区/材料/题/错题级联；0 行报“试卷不存在” |
| `list_folders` | — | 父子树 + set/question 计数 |
| `create_folder` | `name,parent_id?` | `sort=MAX+1` |
| `rename_folder` | `folder_id,name` | 改名 |
| `delete_folder` | `folder_id` | 删除；子项 parent 置空 |
| `assign_folder` | `folder_id?,set_id?,question_ids?` | 把试卷或题目移入/移出文件夹 |
| `update_question` | `question_id,qtype?,tags?,stem?` | 局部更新；题干 >8MB 拒绝 |
| `list_system_fonts` | — | Windows GDI 枚举 |
| `media_path` | `file` | 返回 `<data_dir>/media/file` |

**练习（6）**

| 命令 | 行为 |
| --- | --- |
| `create_attempt` | 由 `question_ids` 或 `set_id` 建 in_progress；空题报“至少选一道题”；`max_score=SUM(points)` |
| `resume_attempt` | 查同 set 最近一条 in_progress，避免进页面就新建 |
| `get_attempt` | 详情 + 题目 + 已作答 + 分区/材料/set |
| `save_answer` | UPSERT `answers(raw,updated_at)`，判分字段暂空 |
| `submit_attempt` | 逐题 `grade_one`，UPSERT 判分，attempts 置 submitted 并算总分 |
| `self_grade` | 主观题分数 clamp 到 0..points，重算 total_score |

**记录/错题（5）**

| 命令 | 行为 |
| --- | --- |
| `list_records` | 只列 `status='submitted'`，可按日期过滤，按完成/开始时间倒序，最多 300 |
| `delete_attempt` | 先删 answers 再删 attempt |
| `list_mistakes` | JOIN 题面/试卷/分区，按 `due_at` 升序 |
| `collect_mistakes` | 逐题 `repo::add_mistake`，已存在则不动 |
| `set_mistake_status` | mastered → streak=max(2)；其他 → streak=0 |

**设置/备份（4）**

| 命令 | 行为 |
| --- | --- |
| `get_settings` | 读键值并返回 AppSettings（含 `has_api_key`，不回显 Key） |
| `save_settings` | 由 JSON 映射写库；`clearKey` 清 Key；空 apiKey 不覆盖 |
| `backup_now` | `VACUUM INTO backups/tokero-YYYYmmdd-HHMMSS.db` |
| `restore_backup` | ATTACH 备份 → 删主库业务表 → INSERT SELECT → DETACH |

**标签栏（6）**

| 命令 | 行为 |
| --- | --- |
| `list_tag_groups` | 全部标签栏（按 position），含空栏 |
| `create_tag_group` | 名称+颜色，position=MAX+1；重名报错 |
| `rename_tag_group` | 改名/改色 |
| `delete_tag_group` | 删栏；`tag_assignments.group_id` 置空，标签回未归类 |
| `assign_tag_group` | 单个标签移入/移出（group_id=null） |
| `assign_tags_group` | 批量归类，AI 整理应用时用 |

**AI（7）**

| 命令 | 行为 |
| --- | --- |
| `ai_test` | 用表单未保存配置（或回退已保存）发一条“回复 OK”测试；返回 `ok/model/elapsed_ms/message`；不依赖题目 |
| `ai_complete` | 通用 system+user 调用，供导入清洗、标签整理复用 |
| `ai_explain` | 取题/配置，校验地址、模型、非本地 Key，调 `ai::explain` |
| `ai_vision_segment` | 校验页数/题目/配置，调 `ai::vision_segment`，返回原始文本 |
| `ai_organize_tags` | 把现有标签栏与标签发给 AI，返回 `TagSuggestion[]`，只预览不写库 |
| `apply_tag_suggestions` | 应用勾选的建议，写 `tag_assignments` |
| `ai_classify` | **本地规则桩**：不调用 AI，原题型/原标签返回，`duplicate_group=null` |

**导入（3）**

| 命令 | 行为 |
| --- | --- |
| `preview_import` | 解析 JSON/文本 → ParsedImport，返回 id 为序号的预览 + warnings |
| `confirm_import` | 事务写 set/materials/sections/questions + `import_batches`，返回 batch_id |
| `undo_import` | 按 batch_id 删 set（级联）再删批次；找不到报“可能已经撤销” |

### 5.2 api.ts / mock.ts 双轨

`src/lib/api.ts`：

- `isTauri = "__TAURI_INTERNALS__" in window`；`cmd(name,args)` 在 Tauri 里 `invoke`，否则 `mockCommand`。
- `api.*` 命名与 46 个命令对应；参数用 camelCase，Tauri 自动转 snake_case（例如 `setId` → `set_id`）。
- `listSystemFonts()` 在浏览器直接返回 `[]`；`mediaUrl()` 浏览器返回 `/media/file`；`assetUrl()` 先调 `media_path` 再 `convertFileSrc`。

`src/lib/mock.ts`：

- 从 `data/seed/tem4_2016.json` 构造初始数据；`STORE_KEY="tokero.mock.v1"`，`MOCK_VERSION=6`，结构变化会重置旧 localStorage。
- 覆盖 44 个 case；`list_system_fonts`、`media_path` 由 api 层直接处理，所以合计对应 46 个命令。
- 浏览器预览全部写 localStorage，不写 SQLite；备份/恢复、真实导入、真实 AI 都是简化实现（`confirm_import` 直接返回 1，`undo_import` 返回 null，`backup_now` 返回“浏览器预览模式不支持备份。”）。
- 因此：**mock 能验证页面流，不能验证持久化、导入撤销、AI 准确性**。

### 5.3 命令层面的注意点

- `list_bank` 没有 offset；前端要“加载更多”只能改 limit/游标，不能靠 offset。
- 标签筛选在 SQL 取 5000 条后于内存 retain，再截断 limit；大数据量下不是真正分页。
- `create_attempt` 在 `question_ids` 为空且 `set_id` 存在时取整卷题目；两者都空报错。
- `resume_attempt` 只按 set_id 找 in_progress；自选题/错题复习没有同样的恢复逻辑，需要显式传 attempt id。
- `ai_classify` 虽在“AI”分组，实际是纯本地占位，前端不要把它当 AI 分类能力。

## 6. 前端路由与页面交互

### 6.1 路由表（HashRouter）

| 路由 | 页面 | 主要数据 | 交互要点 |
| --- | --- | --- | --- |
| `/` | HomePage | `list_sets`、`list_records`、`list_folders` | 368×200 试卷卡；文件夹 chips；开始练习 → `/sets/:id/exam`；答案速查 → `/sets/:id/answers`；双击/铅笔改名；最近 6 条记录 |
| `/sets/:setId/exam` | ExamPage | `resume_attempt` / `create_attempt` | 进页面优先恢复 in_progress；否则新建整卷 |
| `/exam/:attemptId` | ExamPage | `get_attempt`、`save_answer`、`submit_attempt` | 三栏工作台；交卷后跳结果 |
| `/sets/:setId/answers` | AnswersPage | `get_set`、`list_folders` | 速查与整理；详细原卷/简要列表切换；`?q=<questionId>` 深链滚动+高亮；自动分图；打印 |
| `/bank` | BankPage | `list_sets/list_tags/list_tag_groups/list_folders/list_bank` | 标签三栏/试卷/文件夹；详细原卷/简要列表；删除试卷；选题篮；开始自选练习 |
| `/attempts/:attemptId` | ResultPage | `get_attempt` | 分数、题号总览、答案对照、自评、AI、收错题、再来一次 |
| `/records` | RecordsPage | `list_records` | 前端按全部/7 天/30 天/自定义过滤；日期分组；批量错题/删除 |
| `/mistakes` | MistakesPage | `list_mistakes` | 待复习/已掌握/全部；按试卷/关键词过滤；复习组卷 |
| `/import` | ImportPage | `preview_import/confirm_import/undo_import/ai_complete` | 四步：材料（拖入/粘贴）→ 提示词 → 预览 → 导入/撤销；非规范材料可应用内 AI 清洗 |
| `/settings` | SettingsPage | `get_settings/save_settings/ai_test/backup_now` | AI 端点/Key/模型/视觉/思考；测试连接/测试视觉；主题；计时预设；排版；备份 |

### 6.2 Shell 与全局

- 侧栏默认 108px（`.shell` 用 `--rail-w`），点击 `.rail-toggle` 收成 0；状态存 `localStorage: tokero:rail-collapsed`，收起后顶栏出现展开按钮。
- 顶栏只在考试路由显示“考试工作台”，其他页面不重复页面名（各页自己有 H1）。
- 主题弹层：浅色/深色/跟随系统 + 5 个主题色；写 `dataset.theme/accent`。
- 全局 Toaster 在右下角。

### 6.3 几条容易忽略的交互

- BankPage 的“试卷视图/题型视图”实际控制 `display = both | sets | questions`，不是按题型分组；题型视图过滤掉分区/材料，让题目卡平铺。详细模式用 `PaperDoc` 原卷，简要模式是紧凑列表 + 裸标签。
- 题库左侧标签按 `TagGroup` 固定显示学科/题型/难度（空栏也显示“暂无标签”），自定义栏按 position；未归类只在非空时显示。标签可拖到栏上。
- 选题篮固定右侧，可选题目、显示题数/总分；开始练习时把当前选中 id 传给 `create_attempt({questionIds, mode:"custom"})`。
- 试卷卡「更多」→「删除试卷」有确认弹窗，明确会删除该卷的练习记录与错题；删除后 `list_sets` 刷新。
- ExamPage 保存是 300ms 防抖；交卷前会 `flushSaves(true)`，未保存成功会取消交卷。
- 考试页中栏是 `PaperDoc`：材料题组（同一 material 的 cloze/fill_blank/dictation）只渲染一次材料/词库，不逐题出卡；右栏答题卡仍逐题给输入。
- 考试页布局（栏宽/显隐）存 `tokero.exam.layout.v1`，标记存 `tokero.exam.marks.<attemptId>`。
- 计时预设来自 settings（默认 30/60/90/130），`0` 表示不限时；倒计时归零自动交卷。
- AnswersPage 的详细/简要存 `sessionStorage["tokeru.answers.mode"]`；详细模式用 `PaperDoc` + `.paper-answer-key`，简要模式点击行才展开详情；支持单题改题型/标签/增删题图。

## 7. 三条核心流程

### 7.1 导入 → 预览 → 确认 → 题库 → 选题 → 考试 → 交卷 → 结果

1. **放材料**：ImportPage 第一步支持拖入/选择 PDF/MD/TXT/JSON 或直接粘贴 Markdown；PDF 由 `pdf.ts::pdfFileToText` 抽文字（最多 20 页）；文件 ≤8 MB；空材料提示“先放入材料。”。
2. **判断规范**：`inspectMaterial(text)` 本地检查是否有题号、分区、答案或完整 JSON；规范 JSON 直接进预览，非规范时显示“重新上传 / 应用内 AI 清洗 / 复制提示词”三种选择。
3. **复制提示词**：材料窗口旁常驻“复制提示词”，`buildPrompt({material,title,extra})`（`src/lib/importPrompt.ts`）拼出 9 题型规范 + 任务 + JSON 模板 + 材料，可交给外部模型；返回的 JSON 可再粘回。
4. **应用内清洗**：`cleanWithAi` 调 `api.aiComplete(system,user)`（system 为 importPrompt 的规范，user 为材料），去掉代码围栏后交给 `runPreview`；未配置 AI 时提示先去设置。
5. **进预览**：`runPreview` 调 `api.previewImport({text,title,kind:"json"})`。
6. **Rust 解析**：`commands::preview_import` → `parse_import`。
   - 取文本第一个 `{` 到最后一个 `}` 解析；失败提示代码块围栏/尾逗号/单引号/注释等常见原因。
   - set 字段：title/year（number|string）/duration_minutes（>0）/audio_file/tags/folder。
   - materials：key 空则 `mN`；重复改名并 warning。
   - sections：key 空则 `part-N`；material 不存在 warning；`instructions` 优先于 `subtitle`；kind 默认 mixed；无 sections 自动“全部题目”+warning。
   - questions：题型走 `import_qtype`（9 种，未知回落 fill_blank + warning）；题号去重顺延；`import_answer` 按题型生成 `{kind:"choice",correct}`、`{kind:"text",accept}`、`{kind:"reference",reference,rubric?}`。
   - 返回 ImportPreview：questions（id 为序号）、sections、materials、warnings，`set_id=0`。
7. **预览校验**：页面显示结构、题型分布、警告、标签、目标文件夹；没有题目提示检查 JSON。
8. **确认导入**：`api.confirmImport` → `commands::confirm_import` → 再解析一次 → `insert_import` 事务：
   - 按 folder 名查/建文件夹；插 sets（source 默认 import，写 tags/folder_id）；
   - 插 materials、sections、questions（按 key/section 关联）；
   - 写 `import_batches`，commit 返回 batch_id。
9. **前端刷新**：`qc.invalidateQueries()`，提示“已导入 N 道题”；可在第 4 步撤销（`undo_import` 删 set 级联 + 批次）。
10. **题库筛选**：BankPage 一次性 `listBank({limit:2000})`，前端做关键词/标签/文件夹/试卷/题型过滤；分组按 set 与 section。
11. **选题**：点题目卡进右侧选题篮，`startPractice` → `api.createAttempt({setId?, questionIds, mode:"custom", title})` → `nav("/exam/"+id)`。
12. **考试**：ExamPage 若走 `/exam/:attemptId` 直接加载；若走 `/sets/:setId/exam`，先 `resumeAttempt`，没有才 `createAttempt({setId, mode:"exam", timeLimit:0})`。`get_attempt` 填题目、分区、材料、已有作答；每次修改 `update` → 300ms 防抖 `save_answer`。
13. **交卷**：`submit_attempt` 拿 AttemptDetail，逐题 `grading::grade_one`，UPSERT `answers(is_correct,score,max_score,graded_by)`，更新 attempts 为 submitted、`finished_at`、`total_score`，前端跳 `/attempts/:id`。
14. **结果**：ResultPage 读 `get_attempt`，按全部/错题/未答/待自评过滤；主观题 `selfGrade`；勾选收错题 `collectMistakes`；AI 讲解 `aiExplain`；再来一次按 set/mode 或原题 id 新建 attempt。

关键函数：ImportPage.runPreview/confirmImport、commands::parse_import/insert_import、BankPage.startPractice、ExamPage.doSubmit/flushSaves、commands::submit_attempt、grading::grade_one、ResultPage。

### 7.2 自动分图（AnswersPage → AutoFigures → PDF → 视觉 → 写题干）

1. **入口**：AnswersPage 顶部“自动分图”打开 `<AutoFigures open questions={data.questions} onApplied={refreshQuestionViews}>`。
2. **选文件/渲染**：`AutoFigures.chooseFiles` → `pdf.ts::filesToPages`。PDF 用 pdfjs-dist 渲染，图片用 `createImageBitmap`；最多 16 页，页面最长边 1400px，白底 JPEG（质量 0.84）。pdf.ts 在模块加载时显式设置 `GlobalWorkerOptions.workerSrc`，否则 pdf.js 6 找不到 worker。
3. **勾页并识别**：用户选页后 `identify()` 把选中的 data URL 和题目清单 `{label: label||number, stem}` 传给 `api.aiVisionSegment`。
4. **命令校验**：`commands::ai_vision_segment`：pages 非空、≤20 页、questions 非空；`vision_base_url || base_url`、`vision_model || model`；本地端点（127.0.0.1/localhost/0.0.0.0/[::1]）免 Key，非本地缺 Key 报错。
5. **请求**：`ai::vision_segment` 校验 base/model、每页必须以 `data:image/` 开头；system 提示“只找图，不提取文字”，user 内容为文本 + 每页 `PAGE n` + `image_url`；要求返回 `{"figures":[{"question":"1","page":1,"bbox":[x,y,w,h],"caption":"..."}]}`；bbox 是相对该页的 0..1 归一化 `[x,y,w,h]`；`temperature:0`、`max_tokens:3000`；最多取前 200 题、题干截 400 字符。
6. **返回原始文本**：Rust 只解析 `choices[0].message.content/reasoning_content` 并返回 AiResult，**不在后端解析 figures**。
7. **前端宽松解析**：`AutoFigures.parseFigures` 去代码围栏、取第一个 `{` 到最后一个 `}`，接受数组或 `.figures/.items/.data`；bbox 支持数组、`{x1,y1,x2,y2}`、`{x,y,w,h}`；小于 0.4% 宽/高的框跳过；坐标 clamp 0..1。
8. **匹配题目**：`targetMap` 用 label/number/清洗后的 label 建索引；匹配不到时取 label 末段数字对 `q.number`，仍失败则该行标“没有匹配到题目，已跳过。”。
9. **裁剪与写入**：`cropPage(page,bbox)` 外扩 1.2% 后 canvas 裁剪；裁剪小于 6px 报“模型给出的图形范围太小，已跳过。”；用户勾选后 `apply` 把 `<figure class="q-figure"><img src="..." alt="题图" /></figure>` 追加到当前 stem，逐题 `api.updateQuestion(qid, undefined, undefined, current+figure)`；成功后 `onApplied()` 刷新页面并 toast“已写入 N 张题图”。

限制：前端 16 页、后端 20 页；只找图不识别文字/表格；真实视觉模型未做准确率验收；PDF 矢量公式的框质量取决于模型；题干总大小 8 MB。

### 7.3 安装器与构建

1. **版本号三处**：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`，当前均为 3.4.0。
2. **前端构建**：`pnpm exec tsc --noEmit` → `pnpm build`（`tsc -b && vite build`），产物 `dist/`。
3. **Rust/壳构建**：`pnpm tauri build --no-bundle` 出便携 exe；`pnpm tauri build --bundles nsis` 出安装包。
4. **资源**：`tauri.conf.json` 把 `../data/media/tem4-2016.mp3` 映射到安装包 `media/tem4-2016.mp3`；icon、NSIS hook 一并配置。
5. **NSIS preinstall**（`installer-hooks.nsh`）：
   - `taskkill /F /IM tokero.exe` 杀运行中的旧版；
   - `Sleep 800` 后循环 `Delete "$INSTDIR\tokero.exe"`，最多 12 次 × 500ms；
   - 仍失败弹中文 MessageBox（提示先退出 Tokeru/便携版再“重试”），然后 `Abort`；
   - 成功 `DetailPrint` 后继续安装。
6. **WebView2**：`webviewInstallMode: skip`，不再联网下载 Runtime；Windows 10/11 自带，缺失时需用户自装。
7. **安装/便携**：
   - 安装包：`src-tauri/target/release/bundle/nsis/Tokeru_<version>_x64-setup.exe`；
   - 便携 exe：`src-tauri/target/release/tokero.exe`；
   - 便携目录/zip：`dist-portable/Tokeru/`、`dist-portable/Tokeru_3.4.0_x64_portable.zip`。
8. **已知构建坑**：
   - `--bundles nsis` 会 patch `release/tokero.exe`（写入 bundle 标记），hash 会变；要干净的便携 exe，最后 `rm release/tokero.exe` 再 `--no-bundle`。
   - 打包前关闭运行中的 Tokeru，否则 Windows 可能报 `os error 5`；3.4 安装器已能处理覆盖安装。
   - 安装包未签名，Windows 可能提示未知发布者。
   - **中文路径启动坑**：从 `dsh_zone_common` 这类中文路径用 `cmd //c start`/`Start-Process` 启动 setup 时进程可能根本不创建；把 setup 复制到 ASCII 路径（如 `%LOCALAPPDATA%\Temp\TokeruSetup34.exe`）再 `/S` 即可。

3.4 交付哈希（RELEASE-3.4 记录，本报告未重新计算）：setup 71,214,339 B / SHA-256 `0cf46648d7381eb4cc8005da1968c327fdca129aa6de032faf4270787146f3e6`；干净便携 exe 16,060,928 B / `13a6e95db9b47754a4c59c5de1d9012b851d30f64f3cc8e18ea613d4c6dc9397`；portable zip 73,208,774 B / `83f7ebebcf9a9ba4802bc7332fb35619e40dcd11bdd101d2f03c3129f66c3e85`。安装后 exe 被 NSIS patch，hash 为 `01C2EECC...`，版本/大小一致。

## 8. AI 抽象与配置

### 8.1 设置键（settings 表）

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `model` | 空 | 文本模型名 |
| `base_url` | 空 | OpenAI 兼容地址（不含 `/chat/completions`） |
| `api_key` | 空 | Key，明文存 SQLite；兼容旧键 `deepseek_api_key` |
| `thinking` | `"0"` | DeepSeek 思考开关；仅 DeepSeek 端点发送 |
| `custom_prompt` | 空 | 追加到 system 的用户要求 |
| `vision_model` | 空 | 多模态模型；空则沿用 model |
| `vision_base_url` | 空 | 视觉地址；空则沿用 base_url |
| `timer_presets` | `[30,60,90,130]` | 考试计时预设（JSON 数组） |
| `default_timer` | `0` | 默认计时分钟，0=不限时 |
| `accent` | `violet` | 主题色 |
| `theme` | `system` | 明暗模式 |

`get_settings` 返回 `has_api_key`，不返回 Key 本身；`save_settings` 支持 `clearKey=true` 清空，空 apiKey 不覆盖已有值。Key 是明文落库，不是系统凭据库。

### 8.2 文本解释 ai::explain

- 输入：Question + mode + 自定义要求 + 可选追问 + key/base/model/thinking。
- mode：`brief` 一句话点破；`writing` 内容/结构/语言自评清单；其他走完整解释。
- 请求：POST `{base}/chat/completions`，Bearer 非空 Key；DeepSeek 地址额外加 `thinking:{type}`；`temperature` 0.3/0.4。
- 解析：`choices[0].message.content` 与 `reasoning_content`，二者都空报“模型没有返回内容。”；非 2xx 截前 300 字符返回。
- 失败链路：未配置地址/模型 → “未配置 AI 服务…”；非本地且无 Key → “还没有配置 API Key…”。

### 8.3 视觉分图 ai::vision_segment

- 输入：页面 data URL 数组 + VisionQuestion 列表（label/stem）。
- 配置回退：`vision_base_url || base_url`、`vision_model || model`；本地端点免 Key。
- 请求：system“试卷排版分析器”，user 文本 + 每页 `PAGE n` + `image_url`；返回原始 JSON 文本；`temperature 0`、`max_tokens 3000`。
- 解析：只取 content/reasoning；content 空报“视觉模型没有返回内容…”。
- 不做：后端不解析/不校验 figures；不重试；不落 ai_runs。

### 8.4 连接测试 ai_test

- 输入：`AiConfigInput { baseUrl, model, apiKey?, thinking? }` + `kind: "chat"|"vision"`。
- 配置解析：`resolve_ai_config` 优先用传入值，空字符串回退到已保存 settings；Key 只在内存里拼 Bearer，不写日志、不回显。
- 校验：base/model 为空报“请先填写 API 地址和模型名。”；非本地端点且 Key 为空报“还没有填写 API Key。”。
- 行为：发一条最小 chat 请求（system 要求只回复 OK），返回 `{ok:true, model:实际模型, elapsed_ms, message:回复前 80 字}`；失败返回 `ok:false` 和真实错误。
- 与旧测试的区别：旧版 `test()` 调 `ai_explain(questionId:1)`，只用已保存配置且绑定题目；新版不依赖题目、不要求先保存。设置页“测试连接/测试视觉模型”都走它。

### 8.5 通用补全 ai_complete 与标签整理

- `ai_complete(system,user,config?)`：通用 OpenAI 兼容调用，`max_tokens=8192`；用于导入清洗（system=importPrompt 规范）和标签整理。
- `ai_organize_tags`：读 `tag_groups` 与现有标签，要求模型只返回“tag → 现有栏名”的 JSON 建议；返回 `TagSuggestion[]`，不直接写库。
- `apply_tag_suggestions`：前端勾选后批量写 `tag_assignments`；栏名不存在则跳过/报错，不会自动建栏。
- 设计约束：AI 不应凭空发明新栏；用户要新增栏必须在 `TagBoard` 手动建，然后重新整理。

### 8.6 ai_classify

`commands::ai_classify` 是**本地规则桩**：遍历前 200 题，`proposed_type=qtype`、`proposed_tags=tags`、`duplicate_group=None`，reason 为“本地规则：保持原题型…”。它不读 Key、不发网络请求，不能当作 AI 整理/去重能力。

### 8.7 风险

- `reqwest::Client::new()` 没有显式超时、重试、取消；网络卡住时命令会一直等（前端只能等 Promise）。
- AI 响应不写 ai_runs，刷新后没有历史；`cached` 字段恒 false。
- Key 明文；设置页只做遮罩，导出数据库会带出 Key。
- 视觉模型返回的 bbox/题号完全依赖前端宽松解析，错误匹配只会跳过，不会提示具体原因。

## 9. 判分、错题本、撤销与备份

### 9.1 判分 grading::grade_one

| 题型 | 规则 |
| --- | --- |
| 空作答 | 主观题（short_answer/writing/dictation）→ `graded_by=pending`；其他 → `unanswered` |
| 选择类（choice_single/choice_multi/true_false/matching） | 取 `answer.correct` 数组（每项大写）；输入按 `,`/`，`/空白切分并大写；数量相同且全部包含才算对 |
| 填空/完形（fill_blank/cloze） | 优先 `accept/accepted`，否则 `correct`；`norm` 后任一相等即对 |
| 其他 | pending，等 self_grade |

`norm`：转小写、非字母数字替换为空格、压缩空白。判分是“全对/全错”，多选没有部分分；填空只做大小写/标点/空白归一化，不做拼写纠错。

### 9.2 主观题

`self_grade(attempt_id, question_id, score)`：clamp 到 `0..points`；`is_correct = score>=max_score`；`graded_by='self'`；随后重算 `attempts.total_score = SUM(answers.score)`。结果页可逐题自评。

### 9.3 错题本

- `collect_mistakes` 逐题调 `repo::add_mistake`：**只有不存在才 INSERT**，已存在不增加 `wrong_count`、不更新 `last_wrong_at`、不重置 `due_at`。
- 新错题：`wrong_count=1`、`correct_streak=0`、`status='learning'`、`due_at=today+1`。
- `set_mistake_status`：mastered → `correct_streak=max(2)`；其他 → 0；没有真正的间隔重复调度。
- 因此“错 N 次”只在第一次收录时是 1，后续重复错不会累加；这是当前实现的事实，不是 UI 计数问题。

### 9.4 导入撤销

- `confirm_import` 在事务里写 `import_batches`，返回 batch_id。
- `undo_import` → `remove_import`：按 batch_id 找 set_id，`DELETE FROM sets`（级联删 sections/materials/questions），再删批次；找不到报“找不到这次导入记录，可能已经撤销。”。
- 只撤销整批；没有“撤销单题/单分区”。

### 9.5 备份/恢复

- `backup_now`：`VACUUM INTO <data_dir>/backups/tokero-YYYYmmdd-HHMMSS.db`。
- `restore_backup(path)`：`ATTACH` 备份库，删除主库 settings/sets/sections/materials/questions/folders/attempts/answers/mistakes/ai_runs，再 `INSERT INTO main.* SELECT * FROM bak.*`，最后 DETACH。
- 不恢复 `import_batches`；恢复后旧批次不能撤销（记录已随 sets 级联删除/未导入）。
- 恢复是整库替换，正在运行的查询会看到切换后的数据；没有版本校验。

### 9.6 练习记录与删除

- `list_records` 只列已交卷；RecordsPage 在前端按日期预置过滤并分组，底部批量“写错题/删除”。
- `delete_attempt` 先删 answers 再删 attempts；题目/错题本不受影响。
- `delete_set` 是 3.4 新增：事务内删该卷 answers → attempts → import_batches → sets；sections/materials/questions/mistakes 由外键级联清理；删卷后错题本中该卷题目也会消失。
- `resume_attempt` 只恢复 in_progress 的整卷；自选/复习需要带 attempt id 才能继续。

## 10. 验证与限制

### 10.1 有证据的

| 项 | 证据 | 说明 |
| --- | --- | --- |
| 3.4 前端类型/构建 | 3.4 收尾：`pnpm exec tsc --noEmit` exit 0；`pnpm build` exit 0（1936 modules，JS 1.285 MB / pdf.worker 1.264 MB / CSS 137 KB） | 本报告落盘前已执行 |
| 3.4 Rust | `cargo check` exit 0（仅 1 个旧 warning：models.rs BankFilters.tag 未读）；`cargo test` exit 0（5 passed） | 单机环境 |
| 3.4 NSIS 安装 | RELEASE-3.4：从 ASCII 路径 `/S` 静默安装成功，装到 `%LOCALAPPDATA%\Tokeru`，DisplayVersion 3.4.0；覆盖运行中旧版时 hook 杀掉旧进程并继续安装 | 未点击窗口；未做干净机矩阵 |
| 3.4 安装版启动 | 安装目录 exe + `TOKERU_DATA_DIR` 指向测试库，CDP 9335 smoke，截图 `tools/shots/installed34-home.png`；首页 2 卷/86 题/1 练习；PE Subsystem=2，无控制台 | 控制台无错误 |
| 自动分图链路 | 3.3 mock 视觉端点 127.0.0.1:18080，图片页 + PDF 两条 E2E，截图为证；3.4 未回归 | 只证明解析→裁剪→写题干，不证明模型准确率 |
| 3.4 AI 测试 | 真实 DeepSeek Key（临时文件，未入库/未截图）→ 设置页“测试连接”成功 toast “连接测试通过：deepseek-flash · 568 ms”，截图 `tools/shots/ai-test-34.png` | Key 用完即删；测试库已清理 |
| 3.4 AI 清洗/标签 | 真实 AI 把 `2024-math-ii.md` 清洗成 19 题/4 分区/150 分/0 警告并导入；AI 标签整理返回 35 条建议、应用 16 条；截图 `ai-import-wait-34.png`、`tag-ai-preview-34.png`、`math-imported-34.png` | 真实模型输出，非确定性；样例分数与题号已人工核对 |
| 3.4 删除/标签栏 | 真实 UI 删除测试卷成功；自定义标签栏“来源”新建/拖放/删除成功；文件夹“临时测试”清理成功；截图 `delete-set-34.png`、`tag-drag-34.png`、`folder-clean-34.png` | 测试库操作，用户真实库未动 |
| Rust 单测 | `commands.rs` 尾部 4 个导入测试（parses_full_document/normalizes_bad_input/rejects_plain_text/writes_and_undoes_import）；`fonts.rs` 1 个字体枚举测试 | 本次 `cargo test` 5 passed |
| 内置题库 | `data/seed/tem4_2016.json` 实测 8 sections / 67 questions / 6 materials | 文件本身与文档一致 |
| 浏览器全流程 | `src/lib/mock.ts` 覆盖 44 个 case | 不代表桌面 SQLite 行为 |

### 10.2 未验证/明确限制

- **真实视觉模型未验收**：没有真实多模态 Key 的自动化结果；PDF 矢量公式的框准确率未知。
- **详细模式材料题组无逐题选择圈**：合并后的 cloze/fill_blank/dictation 只能用全选/分区全选或切简要模式逐题选；这是有意的原卷取舍，但不是所有人都能立刻发现。
- **速查/题库 1024px 宽度**：左侧题号栏会变成横向条，内部横向滚动；窄屏体验未做专门适配。
- **AI 清洗/标签整理非确定性**：同材料两次结果可能不同；标签整理只会在现有栏内归类，不会新建栏。
- **真实 Key 测试是手动的**：没有自动化回归；测试 Key 不落库、不截图，收尾需删除临时文件与测试库。
- **前端没有单测**：`src/` 下无 `*.test.*`；`pnpm test` 按 README 会 “No test files found”。
- **没有并发/压力测试**：单连接 Mutex + AI 网络请求会阻塞锁外时间；大题库 list_bank 取 5000 条后内存过滤。
- **安装包未签名**；WebView2 需系统自装；没有自动更新。
- **无迁移回归测试**：`ALTER TABLE` 容错执行，旧库升级只做加法；未验证降级。
- **AI 请求无超时/重试/取消**；失败只返回字符串给前端 toast。
- **AI 调用不落库**：ai_runs 空表；cached 恒 false。
- **错题计数不累加**：重复 collect 不更新 wrong_count/due。
- **恢复备份不恢复导入批次**：恢复后不能撤销历史导入。
- **paper_answers_json 未使用**：遗留字段。
- **数据目录回退**：设置 TOKERU_DATA_DIR 时没有回退链，目录不可写会直接启动失败（与 README 的“依次尝试”表述有出入）。

## 11. 接手者改动检查清单

**加一个 Tauri 命令**

1. `src-tauri/src/commands.rs` 实现 `#[tauri::command]`，错误统一 `Result<T,String>`。
2. `src-tauri/src/main.rs` 的 `generate_handler!` 注册（顺序不影响功能，但别漏）。
3. `src/lib/api.ts` 加同名方法（参数 camelCase）。
4. `src/lib/mock.ts` 加 case；浏览器要能跑通，否则 `pnpm dev` 会报 unknown command。
5. 需要新结构时同步 `models.rs` 与 `types.ts`，并在页面里处理 loading/error。

**改 schema**

1. 新表用 `CREATE TABLE IF NOT EXISTS`；新列对旧库用容错 `ALTER TABLE`（参考 `init_schema` 末尾）。
2. 同步 `models.rs` 的行映射（`repo.rs`）与 `types.ts`。
3. 检查级联：sets 删除会清 sections/materials/questions/import_batches；`attempts.set_id` 是 SET NULL。
4. 备份/恢复的 INSERT SELECT 语句要跟着改（`commands.rs::restore_backup`）。
5. 必要时补 seed 与 Rust 导入/迁移测试。

**改样式/页面**

1. 共享令牌在 `src/styles/tokens.css`；页面样式追加到对应 `styles/*.css`。
2. 只用 CSS 变量上色，不写死颜色；检查 1024/1280/1600 与深色。
3. 页面级不允许横向滚动；表格/题库卡片注意 `min-width:0` 与 ellipsis。
4. 加页面时同步 `App.tsx` 路由、Shell 导航与 `topbarLabel`（如果需要顶栏标题）。
5. 原卷相关改动优先改 `PaperView.tsx`/`paper.css`，不要在三个页面各写一套；材料簇合并条件见第 13 节。
6. 标签展示统一用 `TagChips`（详细 grouped、简要 plain），不要在页面里手拼“学科：数学”。

**构建/交付前**

1. `pnpm exec tsc --noEmit` 0 错误。
2. `pnpm build` 通过。
3. `cargo check --manifest-path src-tauri/Cargo.toml`。
4. `cargo test --manifest-path src-tauri/Cargo.toml`（导入解析 + 字体）。
5. 用 `TOKERU_DATA_DIR` 指向临时目录真机启动，走一遍导入→考试→交卷→结果；涉及 AI 时用临时 Key，测完删测试库。
6. 关掉运行中的 Tokeru 再打 NSIS；`--bundles nsis` 后重新 `--no-bundle` 拿干净便携 exe。
7. 安装器验收从 ASCII 路径静默 `/S`，不要点击窗口；确认 DisplayVersion 与 hook 杀旧进程。
8. 版本号三处同步；更新 README/RELEASE/SOURCE-MAP/SOURCE-REPORT 文档。

## 12. 源码地图勘误 / 待确认

以下记录报告落盘时（SOURCE-MAP/README 尚未修订）的差异；第 1–9、12–13 条已在文档收尾时改正，保留清单用于防止回归。行号会变，用函数/列名搜索。

| # | SOURCE-MAP / README 写法 | 代码事实 | 建议 |
| --- | --- | --- | --- |
| 1 | attempts 列 `submitted_at` | 实际是 `finished_at`（db.rs） | 文档改为 finished_at；查询/迁移勿写错 |
| 2 | answers 列 `status` | 实际是 `is_correct/score/max_score/graded_by/updated_at`，无 status | 文档改正；状态在 attempts/mistakes |
| 3 | mistakes 列 `next_review` | 实际是 `due_at`（还有 last_wrong_at/last_correct_at） | 文档改正 |
| 4 | ai_runs 列 `prompt/response/reasoning` | 实际是 `prompt_summary/response_html/reasoning_html` | 文档改正 |
| 5 | SOURCE-MAP 把 ai_runs 描述为 AI 调用记录 | 全仓没有 INSERT ai_runs，只有建表/恢复 | 要么补写入，要么注明“预留未使用” |
| 6 | SOURCE-MAP 把 ai_classify 列在 AI 分组 | 实际是本地规则桩，不读 Key、不发请求 | 文档注明“本地预览，不是 AI” |
| 7 | SOURCE-MAP 视觉返回示例字段 `note` | 实际 prompt/前端用 `caption` | 统一为 caption |
| 8 | “按顺序尝试数据目录：TOKERU_DATA_DIR → …” | 设置 TOKERU_DATA_DIR 时**只尝试该目录**，失败不回落 | 文档明确“显式覆盖，失败即报错” |
| 9 | README 图片题“提示词 v1.2” | importPrompt.ts 的 IMPORT_SPEC 头是 v1.1 | 统一版本号，避免误判提示词代际 |
| 10 | SOURCE-MAP HomePage 写“速查与整理”入口 | 复核源码：卡片按钮就是“速查与整理”（路由 `/answers`）；此前把旧截图记成“答案速查”有误 | 无需修改 |
| 11 | BankFilters 在前端有 offset | Rust 无 offset，list_bank 只有 limit；默认 500、最大 2000 | 去掉 offset 或后端实现真分页 |
| 12 | attempts.paper_answers_json 像纸面答案存储 | 只写 '{}'，全仓无读取 | 标注遗留字段，勿扩展 |
| 13 | sets.folder_id / questions.folder_id 未在 SOURCE-MAP 表列出 | 通过 ALTER TABLE 补齐，实际存在 | 文档补迁移列 |
| 14 | Section 前端有 instructions/duration_minutes/question_count | Rust 只有 subtitle/kind/position/...；分区说明实际读 subtitle | 不要依赖前端多出的字段 |
| 15 | pnpm test 的结论 | src/ 下无测试文件；只有 Rust 测试 | 保留“前端无单测”的表述，别把 cargo test 当全绿 |

另有两个实现风险（不一定是文档错误）：

- collect_mistakes 对已存在的错题不累加 wrong_count、不刷新 due_at；“错 N 次”不会随重复做错增长。
- ai::explain / ai::vision_segment 的 reqwest::Client 没有超时和取消；网络异常时只能等系统 TCP 超时。

以上两处如果要修，属于行为变更，建议先补测试再改。

## 13. 3.4 增量

### 13.1 这一版解决什么

3.3 的用户反馈集中在六件事：题库“详细模式”仍是题目卡片、材料题被拆成答题卡式小题；AI 填了 Key 仍测试失败；导入第一步不能拖 PDF/粘贴 Markdown；不能删除试卷；标签没有栏、无法按学科/题型/难度组织；release 双击还会弹终端。3.4 的目标是把这六件事做成可验收的闭环，并用 2024 高考数学卷做真实样例。

### 13.2 原卷 / 答题卡彻底分开

新增 `src/components/PaperView.tsx`（408 行）和 `src/styles/paper.css`，把原来只在 ExamPage 里的 `.paper-*` 渲染抽成共享组件：

- `PaperDoc({groups,materials,title?,eyebrow?,meta?,showAnswer?,renderQuestion?,renderMergedAnswer?,className?,headerExtra?})`：按分区渲染整卷。
- `PaperSection`：分区标题、说明、题组。
- `MaterialBlock({material,questionIds?,active?})`：材料正文 + 词库；顶层渲染 `<span id="paper-q-<id>" class="paper-anchor" />` 作为深链锚点；`active` 时加 `.is-active`。
- `PaperQuestion`：非材料题的逐题卡，支持 `current/flash/selected/onSelect/onToggle/action/footer/showAnswer`。
- `PaperAnswerKey({questions,renderAnswer?})`：材料题组合并后的紧凑答案条（题号 + 正确答案 + 解析），不再逐题出卡。

**合并判定**（PaperSection 内）：

```text
sharedMaterial = section.material ?? group 中第一个带 material 的题
blankDriven = sharedMaterial 存在
  && questions.length > 0
  && every(q => q.qtype ∈ {cloze, fill_blank, dictation})
  && every(q => q.material_id == null || q.material_id == sharedMaterial.id)
```

满足时只渲染一次 `sharedMaterial` 与一次词库；`showAnswer` 时在其后渲染 `PaperAnswerKey`。阅读 `short_answer` 有真实题干，仍逐题渲染；`matching` 暂不合并。

页面接线：

- `ExamPage.tsx`：中栏由 `PaperDoc` 渲染，`renderQuestion` 注入当前题高亮/闪烁/选中；右栏仍是逐题答题卡（选择 A-D、填空输入、解答 textarea）。
- `BankPage.tsx`：`density="detail"` 用 `PaperDoc`（无答案，顶部有全选本卷/分区全选/选择分区），`brief` 用紧凑列表 + 裸标签。
- `AnswersPage.tsx`：详细模式用 `PaperDoc` + `PaperAnswerKey`，简要模式用分区行列表，点击行才展开完整题干/选项/答案/标签编辑；`?q=` 深链滚到 `paper-q-<id>`。

取舍：合并后没有逐题选择圈是有意的——原卷不应看起来像答题卡；要逐题勾选请切简要模式或用分区全选。

### 13.3 标签栏（学科 / 题型 / 难度 + 自定义）

数据层：

- `tag_groups(id,name UNIQUE,color,position,created_at)`；`tag_assignments(tag PRIMARY KEY,group_id REFERENCES tag_groups ON DELETE SET NULL)`。
- `db.rs::init_schema` 建表；首次启动播种 `学科/violet`、`题型/teal`、`难度/amber`，写 `settings["tag_groups_seeded"]`，只播一次。
- 旧标签按词典归类（英语/数学→学科；单选/填空/完形/阅读/写作等→题型；易/中/难→难度），其余留未归类。
- `repo.rs`：`list_tag_groups`、`tag_group_id_by_name`、`set_tag_group`；`list_tags` 填 `group_id/group_name/group_color`。

命令：`list_tag_groups`、`create_tag_group`、`rename_tag_group`、`delete_tag_group`、`assign_tag_group`、`assign_tags_group`。删栏后 `group_id` 置空，标签回未归类。

组件：

- `TagChips({tags,tagMap,mode:"grouped"|"plain",colors,max,onRemove,onClick})`：grouped 显示“学科：数学”并按 `group_color` 着色；plain 只显示裸名。
- `TagBoard({tags,groups,selected,onToggle,onChanged,compact})`：原生 HTML5 拖放（`.tag-chip` → `.tag-group`），新建/改名/删除栏，AI 整理预览→`applyTagSuggestions`。
- 颜色映射只认 `violet/teal/amber/rose/slate`，分别落到 `--accent/--ok/--warn/--bad/--text-2`。

页面：题库左侧固定显示学科/题型/难度三栏（空栏显示“暂无标签”），未归类仅非空时显示；速查详细用 grouped，简要用 plain。

### 13.4 导入第一步：拖入 / 粘贴 / AI 清洗

`ImportPage.tsx` 第一步重写：

1. 拖放区 + 文件选择，支持 `.pdf/.md/.markdown/.txt/.json`，≤8 MB；`pdf.ts::pdfFileToText` 用 pdfjs-dist 抽文字，最多 20 页。
2. 可直接把 Markdown 粘贴进编辑器；材料窗口旁常驻“复制提示词”。
3. `inspectMaterial(text)` 本地判断：完整 JSON / 题号+分区+答案等特征；规范则直接 `runPreview`，非规范显示三选一：重新上传、应用内 AI 清洗、复制提示词。
4. 应用内清洗：`api.aiComplete(system,user)`，system 为 `importPrompt.ts` 的 9 题型规范，user 为材料；去代码围栏后 `runPreview`；未配置 AI 时提示去设置。
5. 预览、确认、撤销仍走 `preview_import/confirm_import/undo_import`；确认按钮在底部 `.import-actions`，文本是“确认导入 N 题”，不要误点顶部 stepper 的“4 确认导入”。

### 13.5 AI 测试与通用补全

- `ai_test(config,kind)`：`resolve_ai_config` 优先未保存表单值，空串回退已保存配置；不依赖题目、不要求先保存；成功返回实际模型与耗时，失败返回真实错误字符串。
- 设置页“测试连接/测试视觉模型”都调它；成功后徽标变“已连接”，改动配置复位。
- `ai_complete(system,user,config?)`：通用文本补全，`max_tokens=8192`；导入清洗和标签整理共用。
- `ai_organize_tags` 只返回建议，`apply_tag_suggestions` 才写库；AI 不会自动新建栏。

### 13.6 删除试卷与无终端启动

- `delete_set(set_id)`：事务内 `DELETE answers WHERE attempt_id IN (...)` → `attempts` → `import_batches` → `sets`；sections/materials/questions/mistakes 由外键级联。0 行报“试卷不存在”。
- 题库试卷卡“更多”→“删除试卷”→确认弹窗，明确会删该卷练习记录与错题；成功后刷新题库与首页。
- `main.rs` 首行 `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`；release PE Subsystem=2，双击无控制台。dev 仍会有终端，属正常。

### 13.7 2024 高考数学样例（真实 E2E）

- 素材：`Tokeru/tools/fixtures/2024-math-ii.md`（约 5.2 KB）与 `2024-math-ii.json`；19 题 / 4 分区 / 150 分：单选 8（1-8，各 5 分）、多选 3（9-11，各 6 分）、填空 3（12-14，各 5 分）、解答 5（15-19，13+15+15+17+17）。
- 真实 AI 清洗：设置 DeepSeek 后导入页粘贴 md → 应用内 AI 清洗 → 约 20 s 出预览，19 题/4 分区/0 材料/150 分/0 警告；标题“2024 高考数学新课标Ⅱ卷”、文件夹“高考数学真题”、试卷标签 数学/高考/真题。
- 确认导入后测试库 2 卷/86 题；首页显示 2 份试卷、86 道题、1 次练习。
- 真机考试：`#/sets/2/exam` 19 题原卷、0 卡片；作答 q1 C、q9 B+C、q12 -5、q15 文本，交卷 10.0/150，答对 2/答错 1/未答 15/待自评 5。
- 内置 AI 讲解：结果页 q1“完整解析”真实返回，截图 `math-ai-panel-34.png`。
- 标签整理：真实 AI 返回 35 条建议，应用 16 条，未归类 21→19；数学知识点标签仍留未归类（当前只三栏，AI 未硬塞）。
- 删除试卷/自定义栏/空文件夹清理均已真机验证，截图见 `tools/shots/`。

### 13.8 3.4 改动文件清单

新增：`src/components/PaperView.tsx`、`src/components/TagChips.tsx`、`src/components/TagBoard.tsx`、`src/styles/paper.css`、`src/styles/tags.css`。

重写/大改：`src/pages/BankPage.tsx`、`src/pages/AnswersPage.tsx`、`src/pages/ImportPage.tsx`、`src/pages/SettingsPage.tsx`、`src/pages/ExamPage.tsx`、`src/lib/pdf.ts`。

契约/后端：`src/lib/types.ts`、`src/lib/api.ts`、`src/lib/mock.ts`、`src-tauri/src/models.rs`、`db.rs`、`repo.rs`、`ai.rs`、`commands.rs`、`main.rs`。

文档/样例：`README.md`、`docs/RELEASE-3.4.md`、`docs/SOURCE-MAP.md`、本报告、`tools/fixtures/2024-math-ii.*`、`dist-portable/Tokeru/samples/2024-math-ii.*`。

### 13.9 交付与验证边界

- 干净 release 构建：tsc 0、build 0、cargo test 5 passed；干净 exe 16,060,928 B / `13a6e95d...`，PE Subsystem=2。
- 安装包：71,214,339 B / `0cf46648...`；便携包：73,208,774 B / `83f7ebeb...`。
- 安装验收：从 ASCII 路径 `/S` 静默安装成功，DisplayVersion 3.4.0；运行中旧版被 hook 杀掉后继续安装。**没有点击安装窗口**；中文路径 `Start-Process` 不创建进程是环境问题，已用 ASCII 路径绕过。
- 未验收：真实视觉模型准确率、前端单测、干净机安装矩阵、AI 请求超时/取消。

### 13.10 3.4 的坑（给接手者）

1. 改原卷不要改三个页面：优先改 `PaperView.tsx`/`paper.css`；`renderQuestion`/`renderMergedAnswer` 是页面注入差异的扩展点。
2. 合并条件只覆盖 cloze/fill_blank/dictation；不要把阅读 short_answer 或 matching 硬并进来，除非先补选择/答案交互。
3. 标签颜色不要写 hex；`TagChips`/`TagBoard` 内部映射主题变量，换主题色要跟着变。
4. `ai_test` 不要退回“拿第 1 题测试”；用户填了未保存的 Key 就必须用它测。
5. 导入确认按钮以底部 `.import-actions` 为准；顶部 stepper 不是提交按钮。
6. 安装器静默测试从 ASCII 路径启动，且不要点窗口；`/S` 在无旧安装且 PageReinstall 无分支时会 Abort，先确认注册表/安装目录状态。

