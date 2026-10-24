# Tokeru 源码地图（0.0.1）

> 0.0.1 是首个公开版本，功能基线来自内部 4.0：内嵌 MCP Server、PDF 50 页 / 单文件 100 MB、导入时视觉 OCR 与按 bbox 分图、HTML5 拖拽修复。第 1–12 节按当前代码更新；3.4 与 4.0 的增量地图作为历史记录保留在第 13–14 节。

这份文档给接手的人 / 子智能体一个**不必先翻遍全仓**的入口：每个文件负责什么、数据怎么流、命令怎么对应、哪里容易踩坑。源码报告见 `archive/SOURCE-REPORT.md`。

## 1. 技术栈与目录

- 桌面壳：Tauri 2（Rust）
- 前端：React 19 + TypeScript + Vite + React Router（HashRouter）+ TanStack Query
- 样式：手写 CSS，无 Tailwind
- 数据：SQLite（rusqlite，WAL，单连接 `Mutex<Connection>`）
- PDF：`pdfjs-dist` 6.4.299（只在前端渲染页面，不落库）
- 包管理：pnpm；前端在 `Tokeru/`，Rust 在 `Tokeru/src-tauri/`

```
Tokeru/
├─ src/                         # 前端
│  ├─ App.tsx                   # 路由表
│  ├─ main.tsx                  # QueryClient / ThemeProvider / HashRouter / CSS 入口
│  ├─ components/
│  │  ├─ Shell.tsx              # 侧栏、顶栏、Outlet
│  │  ├─ AutoFigures.tsx        # 自动分图弹窗（选 PDF/图片→识别→裁图→写题干）
│  │  ├─ PaperSettings.tsx      # 试卷排版弹窗（与设置页共用）
│  │  ├─ Logo.tsx               # 品牌标志
│  │  └─ ui.tsx                 # Modal / Button / Field 等基础组件
│  ├─ pages/                    # 每个路由一个页面
│  │  ├─ HomePage.tsx           # 试卷集 + 最近练习
│  │  ├─ BankPage.tsx           # 题库：标签/试卷/文件夹 + 选题篮
│  │  ├─ ExamPage.tsx           # 考试工作台（三栏）
│  │  ├─ AnswersPage.tsx        # 速查与整理 / 打印 / 自动分图 / 单题编辑
│  │  ├─ ResultPage.tsx         # 交卷结果、对照、AI 讲解
│  │  ├─ RecordsPage.tsx        # 练习记录
│  │  ├─ MistakesPage.tsx       # 错题本
│  │  ├─ ImportPage.tsx         # 材料→JSON→预览→导入/撤销
│  │  └─ SettingsPage.tsx       # AI / 外观 / 计时 / 排版 / 备份
│  ├─ lib/
│  │  ├─ api.ts                 # invoke 封装；isTauri=false 时走 mock
│  │  ├─ mock.ts                # 浏览器预览假数据（不写 SQLite）
│  │  ├─ types.ts               # 前后端共享 TS 类型
│  │  ├─ pdf.ts                 # PDF/图片→页面图、裁剪
│  │  ├─ importPrompt.ts        # 从 shared/import-spec.md 读取的 9 题型清洗提示词
│  │  ├─ visionImport.ts        # 视觉 OCR→Markdown→AI 清洗→bbox 裁图→导入流水线
│  │  ├─ labels.ts              # 题型/状态中文标签
│  │  ├─ paper.ts               # 排版配置、字体注册、localStorage
│  │  ├─ richText.ts            # 题干富文本/图片清洗
│  │  └─ theme.tsx              # 主题色/明暗
│  └─ styles/                   # tokens.css + 按页面拆分的 CSS
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs                # 启动、数据目录回退、建窗、命令注册
│  │  ├─ commands.rs            # 所有 #[tauri::command]
│  │  ├─ db.rs                  # 打开库、schema、seed、设置读写
│  │  ├─ repo.rs                # 查询/映射（set、bank、attempt、mistake、folder）
│  │  ├─ models.rs              # Rust 数据结构 + serde
│  │  ├─ grading.rs             # 客观题判分/归一化
│  │  ├─ ai.rs                  # OpenAI 兼容 chat/completions（含视觉）
│  │  ├─ mcp.rs                 # 内嵌 MCP Server（Streamable HTTP，19 个工具）
│  │  └─ fonts.rs               # Windows GDI 字体枚举
│  ├─ nsis/installer-hooks.nsh  # 安装到独立 app-版本目录；写测试失败只提示，Abort 由安装器处理
│  ├─ tauri.conf.json           # 版本、窗口、bundle（NSIS hook / WebView2 skip）
│  └─ Cargo.toml
├─ shared/import-spec.md        # 前端与 MCP 共用的导入规范（单一样本，勿分叉）
├─ data/
│  ├─ seed/math_2024.json       # 可选导入样例（不再自动播种）
│  └─ media/                    # 用户媒体文件
├─ tools/                       # 截图/调试/测试脚本，不参与打包
├─ docs/                        # 使用与开发文档；archive/ 为历史记录
└─ dist-portable/               # 便携包产物
```

## 2. 启动链路

1. `src-tauri/src/main.rs` 的 `run()` 注册插件、`setup_app`、`generate_handler!`。
2. `setup_app` 决定数据目录：设置了 `TOKERU_DATA_DIR` 就**只用该目录**（失败不静默回退，便于测试定位）；未设置时依次尝试 Tauri `app_data_dir` → `%LOCALAPPDATA%\com.tokero.app` → exe 同目录 `data/` → `%TEMP%/Tokeru/data`。
3. `db::Db::open(dir)` 创建 `media/`、`backups/`、`tokero.db`，执行 `init_schema`（WAL + 外键）。**不再自动播种样卷**，空库就是空库；`data/seed/math_2024.json` 只是给用户手动导入的样例。
4. `app.manage(db)` 后创建 `McpManager`，`mcp::boot(handle)` 读取设置，若启用就绑 `127.0.0.1:<mcp_port>/mcp`。MCP 启动失败只记录 `last_error`，不阻塞窗口。
5. 建 `WebviewWindowBuilder`，`data_directory` 指到数据目录下 `webview/<pid>`；失败退回临时目录；链上调用 `.disable_drag_drop_handler()`，否则 Tauri 会拦截 WebView2 的 HTML5 文件拖放，导入页收不到 `dataTransfer.files`。
6. 所有候选都失败（或显式 `TOKERU_DATA_DIR` 不可写）：exe 旁写 `tokero-startup-error.log` + Windows MessageBox，进程退出 1。
7. 前端 `main.tsx` 挂 QueryClient、ThemeProvider、HashRouter；`App.tsx` 决定页面。

## 3. 数据模型（`db.rs`）

| 表 | 作用 | 关键列 |
| --- | --- | --- |
| `sets` | 试卷 | `title/subtitle/year/duration_minutes/source/audio_file/description/tags_json/folder_id` |
| `folders` | 文件夹 | `name/parent_id/sort` |
| `sections` | 分区 | `set_id/key/title/subtitle/kind/position/audio_file/material_id` |
| `materials` | 阅读/听力材料 | `set_id/key/title/content` |
| `questions` | 题目 | `set_id/section_id/material_id/number/label/qtype/stem/options_json/answer/explanation/points/position/tags_json/folder_id` |
| `attempts` | 一次练习 | `set_id/title/mode/status/started_at/finished_at/time_limit/total_score/max_score/question_ids_json/paper_answers_json`（`paper_answers_json` 目前只写 `{}`，无读取方） |
| `answers` | 作答 | `attempt_id/question_id/raw/is_correct/score/max_score/graded_by/comment/updated_at`（`comment` 存 AI 判卷评语，3.5 起） |
| `mistakes` | 错题本 | `question_id/origin/status/wrong_count/correct_streak/last_wrong_at/last_correct_at/due_at/note` |
| `ai_runs` | AI 调用记录（预留） | `question_id/mode/model/custom_prompt/prompt_summary/response_html/reasoning_html/created_at`；全仓目前**没有 INSERT**，表未启用 |
| `settings` | 键值设置 | `key/value`；`tag_groups_seeded` 一次性播种标记；MCP 用 `mcp_enabled/mcp_port/mcp_token/mcp_readonly`（不进 `AppSettings` 通用返回） |
| `import_batches` | 导入批次 | 用于撤销 |
| `tag_groups` | 标签栏（3.4） | `id,name UNIQUE,color,position,created_at`；种子：学科/题型/难度 |
| `tag_assignments` | 标签→栏映射（3.4） | `tag PRIMARY KEY,group_id REFERENCES tag_groups ON DELETE SET NULL`；删除栏后标签回未归类 |

注意：题干里的图片是 data URL，直接存在 `stem` 的 `<figure class="q-figure"><img src="...">` 里；单题上限 8 MB。

## 4. Tauri 命令分组（`commands.rs` / `mcp.rs` / `main.rs`，共 54 个）

- 题库/首页：`list_sets`、`get_set`、`list_bank`、`list_tags`、`rename_set`、`update_set_tags`、`delete_set`、`list_folders`、`create_folder`、`rename_folder`、`delete_folder`、`assign_folder`、`update_question`、`list_system_fonts`、`media_path`
- 练习：`create_attempt`、`resume_attempt`、`get_attempt`、`save_answer`、`submit_attempt`、`self_grade`
- 记录/错题：`list_records`、`delete_attempt`、`list_mistakes`、`collect_mistakes`、`set_mistake_status`
- 设置/备份：`get_settings`、`save_settings`、`backup_now`、`restore_backup`
- 标签栏：`list_tag_groups`、`create_tag_group`、`rename_tag_group`、`delete_tag_group`、`assign_tag_group`、`assign_tags_group`
- AI：`ai_test`、`ai_complete`、`ai_explain`、`ai_vision_segment`、`ai_vision_ocr`、`ai_organize_tags`、`apply_tag_suggestions`、`ai_plan_scores`、`apply_score_plan`、`ai_grade_attempt`；`ai_classify` 是本地规则桩（不发请求、不改题型/标签），不是真模型调用
- 导入：`preview_import`、`confirm_import`、`undo_import`
- MCP（`mcp.rs`）：`mcp_status`、`mcp_configure`、`mcp_regenerate_token`；真正的 19 个 MCP 工具走 `POST /mcp`，不是 Tauri invoke

`ai_test` 用表单未保存的 baseUrl/model/apiKey；`ai_complete` 供导入清洗和标签整理共用；`delete_set` 在事务里删 answers→attempts→import_batches→sets（分区/材料/题/错题级联）。

前端调用统一走 `src/lib/api.ts` 的 `api.*`；`isTauri` 为假时走 `src/lib/mock.ts`，所以 `pnpm dev` 浏览器里能点完整流程但不写库。

## 5. 页面与主要交互

- **Shell**（`components/Shell.tsx`）：左侧 108px 窄栏；顶部分栏按钮切换 0px 全收起，状态写 `localStorage: tokero:rail-collapsed`；右侧 Outlet。
- **HomePage**：`list_sets` + `list_records`；只显示试卷集卡片与最近练习；卡片上有开始练习/速查与整理/改名。
- **BankPage**：`list_bank(filters)`；左栏按标签栏分组（学科/题型/难度 + 自定义栏），主区试卷卡 + 原卷/题目列表，右侧选题篮。详细模式用 `PaperDoc` 原卷，简要模式为紧凑列表；试卷卡「更多」可删除试卷；「管理标签」打开 `TagBoard`。选题篮选中后 `create_attempt({questionIds, mode:'custom'})` 进考试。
- **ExamPage**：路由 `/sets/:setId/exam`（新建）或 `/exam/:attemptId`（继续）；`get_attempt` 拿题与作答；`save_answer` 自动保存；`submit_attempt` 判分并跳结果；三栏宽度可拖、左右可收起；计时器支持预设/自定义/不限时。中栏用 `PaperDoc`，材料题组只渲染一次材料/词库；右栏仍是答题卡。
- **AnswersPage**：`get_set` 拿整卷；详细/简要切换（sessionStorage `tokeru.answers.mode`）；详细用 `PaperDoc` 原卷 + `.paper-answer-key` 答案条，简要为分区题目列表点击展开；题号索引、标签/题型/文件夹编辑、加入错题本、打印、整卷练习；顶部「自动分图」挂 `AutoFigures`；每题右侧「添加题图」走单图上传。
- **ResultPage**：`get_attempt` + 题号总览 + 你的答案/正确答案对照 + 自评 + AI 讲解；批量收错题。
- **ImportPage**：第 1 步支持拖入/选择 PDF/MD/TXT/JSON 或粘贴 Markdown，材料旁常驻「复制提示词」；本地 `inspectMaterial` 判断是否规范，非规范给「重新上传 / 应用内 AI 清洗 / 复制提示词」；清洗走 `ai_complete`；后续 `preview_import` 校验、`confirm_import` 写库、`undo_import(batchId)` 撤销。
- **SettingsPage**：AI 端点/Key/模型/多模态模型/视觉地址；「测试连接」「测试视觉模型」直接用未保存表单值调 `ai_test`；「MCP 连接」卡片控制开关/端口/只读/Token，并给客户端配置；主题色 5 套、明暗、计时预设、排版、备份。

## 6. 自动分图（速查页保留）

1. 用户 `AnswersPage` 点「自动分图」打开 `AutoFigures`。
2. `pdf.ts:filesToPages` 把 PDF 每页或图片转成 JPEG data URL（**最多 50 页**；`GlobalWorkerOptions.workerSrc` 必须显式设置，否则 PDF 报 worker 错）。
3. 用户勾选页面，`identify()` **每 12 页一批**调用 `api.aiVisionSegment` 并合并结果（后端单次上限 20 页，不能一次传 50 页）。
4. 后端 `commands::ai_vision_segment` 取设置：`vision_base_url || base_url`、`vision_model || model`；本地端点不要求 Key；调 `ai::vision_segment`。
5. `ai::vision_segment` 发 OpenAI 兼容 `messages[].content` 数组，图片用 `image_url`；提示模型返回：
   `{"figures":[{"question":"1","page":1,"bbox":[x,y,w,h],"caption":"..."}]}`
   bbox 是 0..1 归一化坐标；返回原始文本，不在后端解析。
6. 前端 `parseFigures` 做宽松解析（代码围栏/数组/对象/百分数/x1y1x2y2），`cropPage` 用 canvas 裁图，用户勾选后 `update_question` 把 `<figure class="q-figure">` 追加到题干。
7. 视觉模型必须支持图片输入；自动化验证用本地 mock 端点验证“解析→裁剪→写题干”链路，真实模型准确率未验收。
8. 导入页还有一条独立的 **视觉 OCR → AI 清洗 → 分图** 流水线，见 `src/lib/visionImport.ts` 与第 8 节；它不依赖程序提取 PDF 文字。

## 7. AI 解释

- `commands::ai_explain` 取 `api_key/base_url/model/custom_prompt/thinking`；base 为空或未配置 Key（且非本地端点）时报「未配置 AI 服务」。
- `ai::explain` 构造 system + user 文本消息，POST `{base}/chat/completions`，Bearer Key；DeepSeek 端点额外带 `thinking`；解析 `choices[0].message.content` 与 `reasoning_content`。
- 结果页有「一句话点破 / 完整解析 / 易错点 / 追问」入口；Key 只存本机，不回显。

## 8. 导入与判分

- 导入规范只有一份：`shared/import-spec.md`（784 行，9 种题型、一层 set/分区/题、答案结构、标签/文件夹、图片规则）。前端 `src/lib/importPrompt.ts` 用 `?raw` 引入，后端 MCP 用 `include_str!` 提供 `get_import_spec`，不要复制成两份。
- `ImportPage` 第一步支持拖入/选择 PDF/MD/TXT/JSON 或粘贴 Markdown；PDF 上限 **100 MB / 50 页**，渲染 1400px JPEG；复制/预览提示词即使材料为空也启用。
- 视觉导入 `src/lib/visionImport.ts`：把页面压到 300 KB、按 4 页/8 MB 分批调 `ai_vision_ocr`；后端每批最多 8 页，提示词要求返回每页 Markdown + figures（id/bbox/caption），图片占位用 `[[FIG:id]]`；合并后转 `{{fig:id}}`，再交给 `aiComplete` 清洗成规范 JSON；最后按 bbox 用 `cropPage` 裁图（不把整页图当题图），替换为 `<figure class="q-figure"><img ...></figure>`。无 bbox 的图保留「（原题有图，见原卷）」提示。
- `aiComplete` 的材料上限是 **120000 字符**，超出会截断并显式提示；50 页 OCR Markdown 不应再被 24000 截断。
- `preview_import` 在 Rust 里解析 JSON、校验题型/答案/分区、生成 warning；`confirm_import` 事务写库并记 `import_batches`；`undo_import` 按批次撤销。
- `grading.rs` 负责选择题多选/填空归一化（大小写、标点、空格）；主观题可 `self_grade`，也可走 `ai_plan_scores` / `ai_grade_attempt`。
- `repo::list_bank` 支持关键词、标签多选、试卷、文件夹、题型、显示模式等筛选；返回 `BankResult`。

## 9. 构建、安装与便携包

```powershell
cd Tokeru
pnpm install
pnpm exec tsc --noEmit
pnpm build
pnpm tauri build --bundles nsis
```

- 版本号要同时改：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`；3.5.0 起产品名 Tokeru、二进制名 `tokeru.exe`。
- 安装器：`src-tauri/nsis/installer-hooks.nsh` 的 `NSIS_HOOK_PREINSTALL` **不 taskkill、不覆盖旧 exe**：从 `%LOCALAPPDATA%\Tokeru\app-<版本>` 开始用数字后缀找空目录，`CreateDirectory` 父/子目录，`SetOutPath` 后用相对文件名 `.tokero-write-test` 做真实写入测试（绝对路径 FileOpen 在中文启动目录下会误报），失败只 `DetailPrint`，由安装器自己的错误页兜底；POSTINSTALL 把开始菜单/桌面快捷方式重定向到 `$INSTDIR\tokeru.exe`；PREUNINSTALL 清理 `.bak`。
- 3.5 起安装器写 `%LOCALAPPDATA%\Tokeru`、HKCU 和当前用户快捷方式，`webviewInstallMode: skip` 不联网下载 WebView2；中文路径下 `/S` 已实测退出 0。旧版本目录不会自动删除，多个版本并列保留。
- 静默安装用 PowerShell `Start-Process -ArgumentList '/S' -Wait`；Git Bash 会把 `/S` 转成 `S:/`，用 `MSYS_NO_PATHCONV=1`。不要点击安装窗口。
- **注意**：`--bundles nsis` 会 patch `release/tokeru.exe` 的 bundle 标记，hash 会变；要交付干净的便携 exe，最后再执行一次 `pnpm tauri build --no-bundle`。发布产物不做代码签名。
- 内部 4.0 的最终产物、大小与 SHA-256 见 `archive/RELEASE-4.0.md`；发布产物不做代码签名。

## 10. 调试 / 截图

- 浏览器：`pnpm dev` → http://127.0.0.1:1420，走 mock 数据。
- 桌面：`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` 启动 exe，然后 `node tools/shot.mjs --target tauri --route "#/..." --out ...`。
- `tools/shot.mjs` 是零依赖 CDP CLI；支持 `--click`、`--eval`、`--diag`、`--json`。
- `--click` 后要等过渡动画，建议再 `--eval "new Promise(r=>setTimeout(()=>r('wait'),600))"`。
- Git Bash 会把 `/S`、`--route /bank` 误当路径；用 `MSYS_NO_PATHCONV=1` 或写成 `--route "#/bank"`。
- 测试库用 `TOKERU_DATA_DIR` 指向临时目录，避免污染 `%APPDATA%\com.tokero.app`。

## 11. 已知限制 / 易踩坑

- 前端有 8 个单元测试（`src/lib/visionImport.test.ts`，`pnpm test` 运行）；目前只覆盖视觉导入解析，页面与裁剪仍靠手动验证。
- 自动分图的真实视觉模型未做验收；mock 只验证链路。
- 题库详细模式中，合并后的材料题组没有逐题选择圈，可用「全选本卷/分区全选」或切到简要模式逐题选。
- 速查/题库在 1024px 宽度下左侧题号栏会变成横向条，内部可横向滚动。
- PDF 矢量图（公式/几何）本质是矢量绘制，视觉模型给框的准确率取决于模型；扫描件也可，但慢。
- 字体只支持 Windows 系统字体枚举；自定义字体文件只在当前会话生效（>5.6 MB 不落库）。
- 发布包与安装器不做代码签名（NotSigned），Windows SmartScreen 可能提示；不要用本机自签名证书签发布产物。WebView2 缺失需用户自己装 Runtime。
- 导入的题目图片存进 SQLite 文本，题干上限 8 MB。

## 12. 给接手者的建议

1. 先读 `src/lib/types.ts` 与 `src-tauri/src/models.rs`，两边字段必须同步。
2. 加命令的顺序：`commands.rs` 实现 → `main.rs` 注册 → `api.ts` 封装 → `mock.ts` 加 case → 页面调用。
3. 加页面样式优先追加到对应 `styles/*.css`，共享令牌在 `styles/tokens.css`。
4. 改数据库 schema 时，`db.rs:init_schema` 用 `CREATE TABLE IF NOT EXISTS`；已有用户库需要迁移时补 `ALTER TABLE`。
5. 任何交付前跑：`pnpm exec tsc --noEmit`、`pnpm build`、`cargo check`、`cargo test`，并真机启动安装版。

## 13. 3.4 增量地图

### 13.1 新增/重写的前端文件

| 文件 | 作用 | 关键导出/入口 |
| --- | --- | --- |
| `src/components/PaperView.tsx` | 共享原卷渲染器（考试/题库/速查共用） | `PaperDoc`、`PaperSection`、`MaterialBlock`、`PaperQuestion`、`PaperAnswerKey`、`shortNo`、`shortSection` |
| `src/styles/paper.css` | 原卷纸张/分区/材料簇/答案条样式 | `.paper-*`、`.paper-material.is-active`、`.paper-answer-key` |
| `src/components/TagChips.tsx` | 标签展示 | `TagChips`（`mode="grouped"\|"plain"`、`colors`、`max`） |
| `src/components/TagBoard.tsx` | 标签栏管理（拖放/CRUD/AI 整理） | `TagBoard` |
| `src/styles/tags.css` | 标签/标签栏样式 | `.tag-*` |
| `src/lib/pdf.ts` | PDF→页面图 / PDF→文字 / 裁图 | `pdfFileToPages`、`imageFileToPages`、`filesToPages`、`cropPage`、`pdfFileToText` |
| `src/components/AutoFigures.tsx` | 自动分图弹窗（3.3 引入，3.4 保留） | `AutoFigures` |

### 13.2 数据流

1. **原卷渲染**：页面取 `SetDetail.sections/questions` → 组装 `PaperGroup[]` → `PaperDoc`。材料强相关题（同一 `material_id` 且题型为 `cloze/fill_blank/dictation`，整组满足）进入 `blankDriven` 分支：材料与词库各渲染一次，题号藏在 `<span id="paper-q-<id>" class="paper-anchor">` 锚点里；`showAnswer` 时材料后渲染 `PaperAnswerKey` 紧凑答案条。非材料题仍逐题 `PaperQuestion`。
2. **速查详细/简要**：`AnswersPage` 用 `sessionStorage["tokeru.answers.mode"]` 记忆模式；详细=卷头 + `PaperDoc` + 每题答案/标签/收错题；简要=分区 + 单行列表，点击展开完整题干/选项/答案/编辑，标签用 `mode="plain"`。
3. **题库详细/简要**：详细=试卷卡 + `PaperDoc`（无答案，可全选/分区全选），简要=紧凑列表 + 裸标签；试卷卡“更多”里 `api.deleteSet` 走确认弹窗。
4. **标签栏**：`TagBoard` 拖放调用 `assignTagGroup(tag, groupId|null)`，新建/改名/删除调 `create/rename/delete_tag_group`；「AI 整理」调 `aiOrganizeTags` 拿 `TagSuggestion[]` 预览，勾选后 `applyTagSuggestions`。
5. **导入**：第 1 步读文件/粘贴 → `inspectMaterial` 本地判断；规范 JSON 直接预览；非规范可「应用内 AI 清洗」（`ai_complete`，提示词来自 `importPrompt.ts`）→ 去围栏 → `previewImport`；第 4 步 `confirmImport`；失败可 `undoImport`。
6. **AI 测试**：设置页把未保存的 `baseUrl/model/apiKey/visionModel/...` 作为 `AiConfigInput` 传给 `ai_test`（`kind="chat"|"vision"`），后端 `resolve_ai_config` 优先用传入值、空值回退已保存配置，本地端点免 Key。

### 13.3 后端对应改动

- `models.rs`：`TagInfo` 增 `group_id/group_name/group_color`；新增 `TagGroup`、`TagSuggestion`、`AiTestResult`、`AiConfigInput`、`VisionQuestion`；`AppSettings` 增 `vision_model/vision_base_url`。
- `db.rs`：新表 `tag_groups`/`tag_assignments`，播种学科/题型/难度三栏 + 旧标签按词典归类；`settings["tag_groups_seeded"]` 只播一次。
- `repo.rs`：`list_tag_groups`、`tag_group_id_by_name`、`set_tag_group`；`list_tags` 填 group 字段。
- `ai.rs`：`post_chat` 统一 HTTP；`complete(system,user,key,base,model,thinking)` 供测试/清洗/整理；`explain` 与 `vision_segment` 复用。
- `commands.rs`：`ai_test`/`ai_complete`、标签栏 6 个命令、`delete_set`（事务删 answers→attempts→import_batches→sets）、`ai_vision_segment`。
- `main.rs`：首行 `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`，release 双击不弹控制台；`generate_handler!` 注册全部命令（4.0 起 54 个）。

### 13.4 3.4 的取舍/坑

- 只合并「同一材料 + cloze/fill_blank/dictation」的题组；阅读 `short_answer` 有真实题干，仍逐题渲染。
- 合并后没有逐题选择圈是有意为之（原卷不应像答题卡）；要逐题勾选请用「全选本卷/分区全选」或简要模式。
- `PaperDoc` 的 `renderQuestion/renderMergedAnswer` 是页面注入差异化 UI 的扩展点（考试页注入当前题/闪烁/选中，速查注入答案与标签编辑）。
- 标签颜色只认 `violet/teal/amber/rose/slate`，在 `TagChips`/`TagBoard` 内映射到主题变量；不要写死 hex。
- 安装器静默验收见第 9 节；3.5 起从中文路径 `/S` 已修复，但 Git Bash 会把 `/S` 转成 `S:/`，请用 PowerShell `Start-Process` 或 `MSYS_NO_PATHCONV=1`。

## 14. 4.0 增量地图（历史）

### 14.1 新增文件

| 文件 | 作用 | 关键入口 |
| --- | --- | --- |
| `src-tauri/src/mcp.rs` | 内嵌 MCP Server（Streamable HTTP） | `McpManager`、`boot(app)`、`mcp_status`、`mcp_configure`、`mcp_regenerate_token` |
| `shared/import-spec.md` | 导入规范唯一来源（9 题型/三层结构/图片规则） | 前端 `?raw`、MCP `get_import_spec` |
| `src/lib/visionImport.ts` | 视觉 OCR→合并→AI 清洗→bbox 裁图→preview | `visionCleanPipeline`、`parseVisionOcr`、`buildFigureMap` |
| `docs/MCP.md` | 外部 Agent 接入说明 | 配置/工具/安全/排错 |
| `archive/MCP-RESEARCH.md` | 同类项目 MCP 调研与改进建议（历史） | 思源笔记等 |

### 14.2 MCP Server

- 传输：Streamable HTTP，`POST /mcp`，只绑 `127.0.0.1`，默认端口 `17890`；SSE 响应，`mcp-session-id` 由 rmcp 管理。
- 鉴权：`Authorization: Bearer <token>` 或 `?token=`；缺失/错误返回 401 纯文本 `Unauthorized: missing or invalid MCP token`；CORS 允许 `*` 与 `mcp-session-id`。
- 设置：`mcp_enabled/mcp_port/mcp_token/mcp_readonly`；默认 `readonly=true`；`mcp_status` 在服务未运行时也会从 DB 回填 port/readonly/url/token，设置页重启后仍能显示；`mcp_configure` 可开关、改端口、改只读、重置 Token。
- 19 个工具：只读 `list_sets/get_set/list_bank/search_questions/get_question/list_tags/list_tag_groups/bank_stats/list_records/get_attempt/get_import_spec`；导入 `preview_import/confirm_import/undo_import`；编辑 `update_question/rename_set/update_set_tags/create_folder/assign_set_folder`。
- 写工具先检查 `readonly`；只读拒绝文案固定为「当前 MCP 连接是只读模式。请在 Tokeru「设置 → MCP 连接」里关闭只读后重试。」
- `preview_import` 把规范 JSON 缓存在进程内（TTL 2 小时）返回 `preview_id`；`confirm_import` 只接受本进程的 preview_id，避免外部 Agent 直接写任意 JSON；`get_import_spec` 返回共享规范全文。
- 不通过 MCP 返回 API Key；工具结果只含题库/试卷/记录数据。
- 冒烟证据：无 token 401；Bearer initialize/tools/list 200；只读模式 `preview_import` 被拒；关闭只读后 preview→confirm 成功；19 工具名称以 `tools/list` 为准（见 `docs/MCP.md`）。

### 14.3 导入视觉流水线与拖拽

- `pdf.ts`：`MAX_PAGES=50`、`MAX_WIDTH=1400`；`pdfFileToPages` 渲染前 50 页；`pdfFileToText` 默认 20 页，但 ImportPage 显式传 50。
- `ImportPage`：`MAX_PDF_FILE=100MB`、`PDF_MAX_PAGES=50`、`MAX_AI_MATERIAL=120000`；拖拽区有 `onDragEnter/Over/Leave/Drop` + `.is-over`；复制/预览提示词按钮只在文件读取中禁用，空材料也能用。
- 拖拽根因：Tauri 默认 `dragDropEnabled` 会在 WebView2 层接管文件拖放，HTML5 `dataTransfer.files` 收不到；`main.rs` 建窗链上 `.disable_drag_drop_handler()` 后恢复。
- `visionImport.ts`：每页压到 300 KB；`chunkPages` 4 页/批且受 8 MB 限制；`ai_vision_ocr` 每批最多 8 页、max_tokens 8192；合并 `[[FIG:id]]`→`{{fig:id}}`；`buildFigureMap` 对每个 figure 用 `cropPage` 按 bbox 裁图（单图≤300 KB、整卷≤8 MB），没有 bbox 不拿整页图冒充，保留「（原题有图，见原卷）」；`resolveFigureTokens` 写 `<figure class="q-figure"><img ...></figure>`；最后 `previewImport`。
- `ai.rs` 新增 `VISION_OCR_SYSTEM` / `vision_ocr`；返回原始 JSON 文本，前端宽松解析。
- `AutoFigures.tsx`（速查页）改为 12 页/批调用 `aiVisionSegment` 并合并，避免后端 20 页上限；页面上限 50。

### 14.4 富文本安全与请求边界

- `src/lib/richText.ts` 对含 figure/img 的题干和材料走白名单：只允许 `figure`/`figcaption`/`img`/`br`，`img.src` 仅允许 `data:image/(png|jpeg|webp|gif)`；未知标签丢弃、只保留纯文本，事件属性/远程 URL 不进入 DOM。渲染层统一调用，旧数据也会被收敛。
- `mcp.rs` 的 `StreamableHttpServerConfig` 把请求体上限调到 16 MiB（覆盖导入规范 8 MB 图片预算）。
- `confirm_import` 会复查 preview 的 2 小时 TTL，过期返回明确错误。
- 写工具目标存在性校验仍未补（`update_question` 等），见 `archive/MCP-RESEARCH.md` P0-2。

### 14.5 4.0 的坑（历史）

- MCP 端口被占用时服务启动失败但应用继续运行；`last_error` 会显示在设置页，改端口后保存重试。
- 外部客户端必须支持 Streamable HTTP + Bearer header；只接受 stdio 的客户端需用 `mcp-remote` 之类桥接。
- 视觉 OCR 结果仍是模型产出，必须经过 `preview_import` 校验和人工核对后才能 `confirm_import`；不要在 MCP 里提供绕过 preview 的直接写库工具。
- `shared/import-spec.md` 是唯一规范；改规范要同时考虑前端提示词和 MCP `get_import_spec`，不要复制两份。
- 安装器仍是 3.5 的“并列版本目录”设计；4.0 未改安装器，管理员问题调研见 `archive/INSTALLER-ADMIN-RESEARCH.md`。
