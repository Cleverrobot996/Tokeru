# Tokeru

本地优先的练习应用：把任意试卷、讲义或题库变成可练的题目，同时保留原卷的阅读体验。Windows 桌面版，Tauri 2 + React 19 + Rust + SQLite；题目、作答、错题与设置都只存本机。

当前公开版本 **0.0.1**。这是首个公开仓库版本，功能基线来自内部 4.0 构建；版本号按公开仓库重新起算。

![首页](docs/screenshots/home.png)

| 导入材料 | 考试工作台 |
| --- | --- |
| ![导入](docs/screenshots/import.png) | ![考试](docs/screenshots/exam.png) |

## 它能做什么

- **导入任意材料**：PDF、图片、Markdown、TXT、JSON 都可以拖进「导入」，也可以直接粘贴按导入规范写的文字。PDF 单文件上限 100 MB、最多读取 50 页；扫描件可走视觉 OCR。
- **原卷优先**：详细模式按试卷原样排版，材料题只出现一次共享材料，题干支持 `{{blank:31}}` 行内空位；完形、听写、阅读这类题不会被拆成一张张孤立的答题卡。排版可切换高对比、字号、行高、段距、纸宽与字体。
- **题库与标签**：固定「学科 / 题型 / 难度」三栏，可增加自定义标签栏；同栏多选是 OR，不同栏之间是 AND。标签可拖放归类、删除；试卷与题目都能打标签。
- **练习与判分**：整卷、自选、错题复习、限时练习；客观题本地判分，主观题可自评或让 AI 判卷并写评语。没有分值的练习可以自定义总分，让 AI 重新分配每题分值。
- **记录与错题**：练习记录按日期归档，可多选写进错题本；错题本支持待复习 / 已掌握 / 全部，也能直接组一套复习练习。
- **AI 可选**：AI 解释、写作自评、导入清洗、视觉 OCR、自动分图、AI 判卷都走 OpenAI 兼容接口；默认关闭，Key 只存本机。默认不绑定任何厂商。
- **MCP 连接**：桌面版内置只监听 `127.0.0.1` 的 MCP Server（Streamable HTTP，默认 17890 端口，19 个工具）。外部 Agent 可以读题库、校验导入、写入试卷；默认关闭、默认只读。详见 [docs/MCP.md](docs/MCP.md)。
- **本地数据**：SQLite 单文件，支持立即备份与恢复；换机器时复制数据目录即可。

## 快速开始

### 从源码运行

需要 Windows 10/11、WebView2 Runtime、Node.js 22+、pnpm 10+、Rust stable，以及带 C++ 桌面开发负载的 Visual Studio Build Tools。

```powershell
pnpm install
pnpm tauri dev
```

只做前端界面预览：

```powershell
pnpm dev
# http://127.0.0.1:1420
```

浏览器预览使用 `src/lib/mock.ts` 的演示数据，不写 SQLite；桌面版才连接真实数据库。

### 构建

```powershell
pnpm exec tsc --noEmit
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml

pnpm tauri build --no-bundle        # 便携版 exe
pnpm tauri build --bundles nsis     # NSIS 安装包
```

产物：

- `src-tauri/target/release/tokeru.exe`
- `src-tauri/target/release/bundle/nsis/Tokeru_0.0.1_x64-setup.exe`

安装器使用独立版本目录 `%LOCALAPPDATA%\Tokeru\app-版本号`，不会覆盖正在运行的旧 exe；快捷方式会在安装后重定向到新版本。应用本身不要求管理员权限。

### 导入第一份材料

1. 打开「导入」，把 PDF / Markdown / TXT / JSON 拖进材料框，或直接粘贴原文。
2. 若材料不是规范 JSON，点「复制清洗提示词」交给任意 AI，或使用应用内 AI 清洗。
3. 在「预览校验」里检查结构、警告、题型分布和原卷预览，确认后写入题库。
4. 想先跑通流程，可导入 [data/seed/math_2024.json](data/seed/math_2024.json)：2024 高考数学新课标Ⅱ卷，19 题。

导入格式说明见 [shared/import-spec.md](shared/import-spec.md)。

## 数据位置

Windows 默认：

```text
%APPDATA%\com.tokero.app\tokero.db
%APPDATA%\com.tokero.app\media\
%APPDATA%\com.tokero.app\backups\
```

开发或自动化测试可用环境变量 `TOKERU_DATA_DIR` 指定独立目录：

```bash
TOKERU_DATA_DIR="$(pwd)/.smoke-run" ./src-tauri/target/release/tokeru.exe
```

## AI 配置

默认「不用 AI」。在「设置 → AI 解释」里选择 OpenAI / DeepSeek / 硅基流动 / 本地 Ollama / 自定义，填写 API Key 与地址即可。地址填到 `/v1` 为止，不要带 `/chat/completions`。

- 自动分图、视觉 OCR 需要另填「多模态模型」，模型必须支持 `image_url` 输入。
- 测试连接会直接使用当前填写的地址、模型与 Key，不必先保存。
- API Key 只写入本机 SQLite，不回显、不上传。

## MCP

设置页打开「MCP 连接」后，外部 Agent 可按下面的形式连接：

```text
http://127.0.0.1:17890/mcp
Authorization: Bearer tk_...
```

默认只读；导入、改题、改名等写操作需要在设置页显式关闭只读。工具列表、客户端配置、鉴权与排错见 [docs/MCP.md](docs/MCP.md)。

## 目录

```text
src/                    React 前端
  pages/                首页、题库、考试、速查、记录、错题、导入、设置
  components/           Shell、排版、弹窗、图表等
  lib/api.ts            Tauri 命令封装
  lib/types.ts          前后端共享类型
  styles/               设计令牌与页面样式
src-tauri/src/          Rust 后端
  commands.rs           Tauri 命令
  repo.rs / db.rs       SQLite 读写与迁移
  models.rs             数据模型
  ai.rs                 OpenAI 兼容 AI 调用
  mcp.rs                内嵌 MCP Server
src-tauri/nsis/         安装器钩子
shared/import-spec.md   导入规范
data/seed/              可选导入样例（不随应用内置）
docs/                   架构、MCP、QA 与版本说明
branding/               图标与品牌设计稿
```

## 开发约定

- UI 文案使用中文；不添加冗余说明，优先让交互自解释。
- TypeScript 严格模式，提交前跑 `pnpm exec tsc --noEmit`。
- Rust 格式化使用 `cargo fmt`；测试使用 `cargo test`。
- 不提交 `node_modules`、`dist`、`dist-portable`、`src-tauri/target`、本地数据库与 `tools/shots` 的过程截图；README 使用的 `docs/screenshots` 是例外。
- 给其他 Agent 的入口、源码地图和验证命令见 [AGENTS.md](AGENTS.md)。

## 协议与署名

代码与图标以 **Apache License 2.0** 发布，允许商用、修改与再分发。分发或衍生作品请保留 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)，并注明来源：

> Tokeru — https://github.com/Cleverrobot996/tokeru

如果只参考了设计或实现思路，也请在文档或致谢里说明来源。