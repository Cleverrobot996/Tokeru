# AGENTS.md

给在本仓库工作的 Agent 的入口说明。先读这一页，再按源码地图定位，避免从零探索。

## 项目是什么

Tokeru 是一个 Windows 本地练习应用：导入试卷/材料，生成题目，按原卷排版练习，记录作答与错题。技术栈是 Tauri 2 + React 19 + TypeScript + Rust + SQLite。没有服务端，没有账号系统，数据只在本机。

当前版本 **0.0.1**。这是首个公开版本，功能基线来自内部 4.0 构建。

## 先跑起来

工作目录：仓库根目录（含 `package.json` 的那一层）。

```powershell
pnpm install
pnpm tauri dev
```

只改前端时可只用浏览器预览：

```powershell
pnpm dev
# http://127.0.0.1:1420
```

浏览器模式走 `src/lib/mock.ts`，使用 `data/seed/math_2024.json` 做演示数据；不写 SQLite。桌面模式才连 Rust 数据库。

## 提交前必须验证

```powershell
pnpm exec tsc --noEmit
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
```

涉及 Rust 命令/数据库时再加：

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

不要提交 `node_modules`、`dist`、`dist-portable`、`src-tauri/target`、`src-tauri/gen`、`.tmp`、本地 `*.db` 或 `tools/shots`。`.gitignore` 已覆盖这些路径。

## 源码地图

### 前端

- `src/main.tsx`：React 入口。
- `src/App.tsx`：路由表（首页、题库、考试、速查、结果、记录、错题、导入、设置）。
- `src/components/Shell.tsx`：侧栏、顶栏、导航与侧栏收起逻辑。
- `src/components/Logo.tsx`：Tokeru 三叶结标志（内联 SVG）。
- `src/pages/HomePage.tsx`：试卷集、最近练习、删除试卷。
- `src/pages/BankPage.tsx`：题库、标签栏筛选、简要/详细、选题篮。
- `src/pages/ExamPage.tsx`：三栏考试工作台、计时、答题卡、交卷。
- `src/pages/AnswersPage.tsx`：速查与整理、详细/简要、自动分图、分值分配。
- `src/pages/ResultPage.tsx`：结果、AI 判卷、错题收集。
- `src/pages/ImportPage.tsx`：材料导入、AI 清洗、结构校验、原卷预览、确认导入。
- `src/pages/SettingsPage.tsx`：AI、MCP、外观、计时、排版、数据备份。
- `src/lib/api.ts`：所有 Tauri 命令的前端封装；浏览器模式自动切到 mock。
- `src/lib/types.ts`：前后端共享的数据结构；改 Rust 模型时同步这里。
- `src/lib/mock.ts`：浏览器预览的假后端；新增命令时要加同名 case。
- `src/lib/paper.ts` / `src/components/PaperView.tsx`：原卷排版、行内空位、材料题组。
- `src/lib/importPrompt.ts`：导入清洗提示词与示例。
- `src/lib/visionImport.ts`：视觉 OCR / 分图的前端解析。
- `src/lib/richText.ts`：HTML 白名单消毒；题干/材料渲染前必须经过它。

### 后端

- `src-tauri/src/main.rs`：应用启动、数据目录回退、窗口、命令注册（`generate_handler!`）。
- `src-tauri/src/commands.rs`：Tauri 命令与业务逻辑；约 51 个命令。
- `src-tauri/src/models.rs`：Rust 数据模型与序列化结构。
- `src-tauri/src/db.rs`：SQLite 打开、建表、迁移。
- `src-tauri/src/repo.rs`：查询与写入 SQL。
- `src-tauri/src/grading.rs`：客观题判分。
- `src-tauri/src/ai.rs`：OpenAI 兼容 Chat Completions（解释、清洗、视觉、判卷）。
- `src-tauri/src/mcp.rs`：内嵌 MCP Server（Streamable HTTP，默认 127.0.0.1:17890）。
- `src-tauri/src/fonts.rs`：Windows 字体枚举。
- `src-tauri/nsis/installer-hooks.nsh`：安装器 preinstall/postinstall 钩子。
- `src-tauri/tauri.conf.json`：版本、窗口、bundle、安装器配置。
- `src-tauri/capabilities/default.json`：Tauri 权限白名单。

### 文档与工具

- `docs/SOURCE-MAP.md`：更细的模块、命令与历史增量地图。
- `docs/MCP.md`：MCP 工具表、鉴权、客户端配置与排错。
- `shared/import-spec.md`：导入 JSON/Markdown 规范；改导入格式时同步。
- `tools/shot.mjs`：零依赖 CDP 截图/诊断；示例见 `tools/README.md`。
- `branding/icon-d1-*.svg`：三叶结图标源文件；应用图标已由 `pnpm tauri icon` 生成到 `src-tauri/icons`。

## 数据流

```text
React 页面
  → src/lib/api.ts
  → Tauri invoke
  → src-tauri/src/commands.rs
  → repo.rs / db.rs / ai.rs
  → SQLite 或外部 AI
```

MCP 工具走同一套 repo/commands 路径，不复制数据库。`mcp.rs` 默认只读，写操作必须由设置页显式关闭只读。

## 修改约定

- UI 文案用中文；不要添加解释性长段落，优先让控件与空状态自解释。
- 不默认绑定 DeepSeek 或其他厂商；AI 默认关闭。
- `src-tauri/tauri.conf.json` 的 identifier 与数据目录仍是 `com.tokero.app`，这是历史兼容标识，不要改成别的名字；二进制名已经是 `tokeru`。
- 修改版本号时同步四个位置：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`。
- 新增 Tauri 命令需要：`commands.rs` 实现 → `main.rs` 的 `generate_handler!` 注册 → `src/lib/api.ts` 封装 → `src/lib/mock.ts` 的浏览器 fallback（如适用）→ `src/lib/types.ts` 类型。
- 数据库改表必须写迁移；不要只改建表 SQL。迁移要兼容已有用户数据库。
- 题干与材料可能含 HTML；渲染前走 `richText.ts` 的白名单，不要直接 `dangerouslySetInnerHTML`。
- 排版的颜色、圆角、字体优先用 `src/styles/tokens.css` 与 `paper.ts` 的 CSS 变量；不要写死 hex。
- 不新增依赖，除非现有依赖无法完成；新增前端依赖后同步 `pnpm-lock.yaml`。
- 修改安装器后同时检查 `src-tauri/tauri.conf.json` 的 `bundle.windows.nsis.installerHooks` 与生成的 `installer.nsi`。
- 不要直接操作真实用户数据 `%APPDATA%\com.tokero.app`；测试用 `TOKERU_DATA_DIR` 指向临时目录。

## 已知限制

- 安装包未做受信任代码签名；本机自签名只适合本地验证。
- 真实视觉模型需要用户自己的 Key，仓库内没有可用凭据。
- PDF 矢量图/复杂公式的分图准确率取决于视觉模型；裁剪结果必须让用户确认。
- 前端只有少量单元测试；主要靠 `tsc`、浏览器截图与手工路径验证。
- 应用目前以 Windows 为主要目标；Tauri 的移动端图标已生成，但未验收。

## 协作方式

- 一个任务只改一个范围；不要把前端页面、Rust 命令和安装器混在一个提交里。
- 提交信息用中文或英文均可，但要说明「改了什么 / 为什么」。
- 提 PR 时附验证命令与结果；UI 改动附 `docs/screenshots` 或 `tools/shots` 截图。
- 发现文档与代码不一致时，以代码为准，并顺手修正文档。