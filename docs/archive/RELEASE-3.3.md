# Tokeru 3.3.0

2026-10-23。3.3 只做两件核心事：**修好 NSIS 安装失败**，以及**给「速查与整理」加上多模态自动分图**。3.2 的题库、速查、排版、字体、侧栏收起等能力全部保留。

## 1. 安装失败修复

### 现象
用户覆盖安装时在 NSIS 的 File 阶段报：

```
Error opening file for writing:
C:\Users\19646\AppData\Local\Tokeru\tokero.exe
```

点「中止」后提示 `Installation Aborted / Can't write`。

### 根因
- 旧版 `tokero.exe` 还在运行，Windows 锁住文件；NSIS 的 `File` 写入失败。
- 原安装器虽带 Restart Manager 检查，但用户没有看到「先关闭 Tokeru」的提示，流程仍走到覆盖写。
- WebView2 检测在部分注册表布局下会误判，随后尝试联网下载引导程序；无网络或受限网络时安装器会长时间无响应。

### 修复
1. 新增 `src-tauri/nsis/installer-hooks.nsh`，在 `NSIS_HOOK_PREINSTALL` 中：
   - `nsExec::ExecToLog 'taskkill /F /IM tokero.exe'` 关闭正在运行的 Tokeru；
   - 等待 800ms，再循环 `Delete "$INSTDIR\tokero.exe"`，最多 12 次、每次 500ms；
   - 仍删不掉时用中文 MessageBox 告诉用户「Tokeru 仍在运行或文件被占用」，然后 Abort，而不是留下半截安装。
2. `tauri.conf.json` 的 `bundle.windows.nsis.installerHooks` 指向该文件。
3. `bundle.windows.webviewInstallMode` 改为 `{ "type": "skip" }`： Windows 10/11 自带 WebView2，不再由安装器联网下载；系统确实缺失时请用户先安装 Edge WebView2 Runtime。
4. 版本升到 3.3.0（`package.json` / `tauri.conf.json` / `Cargo.toml`）。

### 验证
- 从 ASCII 临时路径 `%TEMP%\Tokeru-setup.exe` 静默安装（PowerShell `Start-Process -ArgumentList '/S' -Wait`）：**EXIT=0**，安装到 `%LOCALAPPDATA%\Tokeru`，包含 `tokero.exe` / `media/` / `uninstall.exe`。
- 安装出的 `tokero.exe`：ProductVersion **3.3.0**，15,836,160 B，SHA-256 `74119DAE7AF9C6A1790D96D57FFC91690EA48ABA682A17A3DE05BE094D92367F`。
- **覆盖运行中旧版**：先启动已安装的 Tokeru（PID 8736，窗口存在），再跑安装器，EXIT=0；安装后检查进程为 `APP_RUNNING=False`，说明 preinstall 的 taskkill 生效。
- 安装后的 app 带 CDP 启动并截图 `tools/shots/final330-home.png`，首页正常渲染。
- 便携包 exe 也用独立 `TOKERU_DATA_DIR` 启动过：进程存活、成功建库（`tokero.db` + `media/` + `webview/`），验证便携包内 exe 可用。
- Rust 测试：`cargo test --manifest-path src-tauri/Cargo.toml` **5 passed / 0 failed**（导入解析 4 个 + Windows 字体枚举 1 个）；仅两条旧 warning（max_score 未读、BankFilters.tag 未读）。

### 复现/测试注意
- Git Bash 会把 `/S` 路径转换，必须 `MSYS_NO_PATHCONV=1`，或直接用 PowerShell。
- 中文路径 + cmd/bash 编码也可能造成「系统找不到指定路径」的假失败；安装器本身放 ASCII 路径测试最稳。

## 2. 多模态自动分图

### 使用路径
「速查与整理」→ 顶部「自动分图」→ 选择试卷 PDF 或题目页截图（最多 16 页）→ 勾选要分析的页面 → 开始识别 → 模型返回题号 + 归一化框 → 前端裁成 JPEG 缩略图 → 勾选要写入的图 → 写进对应题题干。

### 设置
设置页 AI 区新增：
- **多模态模型（自动分图）**：例如 `gpt-4o`、`qwen2.5-vl-72b-instruct`；留空沿用文本模型。
- **视觉 API 地址（可选）**：留空沿用文本模型地址。

任何 OpenAI 兼容、支持 `image_url` 的端点都可以；本地端点不需要 API Key。

### 实现
- 后端命令 `ai_vision_segment(pages, questions)`：
  - 最多 20 页、题目列表非空；
  - 视觉地址/模型为空时回退到 `base_url/model`；
  - 调用 `ai::vision_segment`，把页面 `data:image/...` 作为 `image_url`，题干用于让模型对号；
  - 返回原始 JSON 文本，解析放在前端（宽松解析，兼容不同模型的输出习惯）。
- 前端：
  - `src/lib/pdf.ts` 用 pdf.js 把 PDF 渲染为页面 JPEG；`GlobalWorkerOptions.workerSrc` 显式设置，修复了 pdf.js 6 的 worker 报错。
  - `src/components/AutoFigures.tsx` 负责选页、识别、解析、裁剪、勾选、写入；`parseFigures` 支持代码围栏、数组/对象、`bbox` 数组或对象、`x1y1x2y2`、百分数等格式；过小的框（宽或高 < 0.4%）直接跳过。
  - `AnswersPage.tsx` 在「打印」旁加入口；写入走 `api.updateQuestion`，把 `<figure class="q-figure"><img ...></figure>` 追加到题干。
- 单图补题仍保留：每题右侧「添加题图」走原有单图上传，和自动分图并存。

### 验证
- `pnpm exec tsc --noEmit` 通过；`pnpm build` 通过。
- 用本地 mock 视觉端点（`tools/mock-vision.mjs`，127.0.0.1:18080）完成两条 E2E：
  1. 图片页：选择样图 → 识别 2 行（1 个正常框 + 1 个过小框）→ 只勾正常框 → 写入成功 → 题干出现 data URL figure；测试后已恢复原始题干。
  2. PDF：选择 `autofig-sample.pdf` → 渲染 1 页 → 识别 → 写入 → 恢复。
- 截图：`tools/shots/auto-settings.png`、`auto-settings-custom.png`、`auto-answers.png`、`auto-modal.png`、`auto-image-loaded.png`、`auto-identified.png`、`auto-applied.png`、`auto-pdf-loaded.png`。

## 3. 交付物

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `src-tauri/target/release/bundle/nsis/Tokeru_3.3.0_x64-setup.exe` | 71,156,059 B | `8cb12f3bb332035ad4f9a442d33afb389459e7ad0ef5c81538d1113c72125a5a` |
| `src-tauri/target/release/tokero.exe` | 15,836,160 B | `da4743501f37b5022085b63d12b047e64a0fe18e091ac3a46efa49a0b3c58904` |
| `dist-portable/Tokeru_3.3.0_x64_portable.zip` | 72,630,112 B | `c826c46dd0f7bec14f4c409ed09427988363910c130066145efa15fdcf726a73` |

便携包内含 `Tokeru.exe`（15,836,160 B）、`data/media/tem4-2016.mp3`、`使用说明.txt`；数据仍写到 `%APPDATA%\com.tokero.app`，可用 `TOKERU_DATA_DIR` 改位置。

## 4. 保留的 3.2 能力

- 题库标签 / 试卷 / 文件夹三分类，固定 368×200 试卷卡、卡上改名、选题篮；
- 速查与整理：标签/题型/文件夹/题图/打印/深链；
- 导入：9 种题型清洗规范、标签、文件夹、图片题、预览/确认/撤销；
- 试卷排版与 318 个 Windows 系统字体、字体文件；
- 侧栏 108px / 0px 全收起；
- 考试工作台三栏、计时预设、自动保存、结果页 AI 讲解、错题本、练习记录、备份。

## 5. 已知限制

- 真实多模态模型尚未做准确率验收：自动化 E2E 用的是本地 mock，验证链路（解析、裁剪、写题干），不验证模型识别质量。实际效果取决于模型和 PDF 清晰度。
- 扫描件可以处理，但页数多时识别慢；单次最多 16 页（后端上限 20）。
- 公式/几何图是 PDF 矢量绘制时，视觉模型给框可能有偏差；可在预览里不勾选或改用单题截图。
- 前端没有单元测试文件；`pnpm test` 目前会报 "No test files found"，不要当作通过。
- 安装包未签名，Windows 可能提示未知发布者；WebView2 缺失需用户先装 Runtime。
- 字体只支持 Windows 系统字体枚举；自定义字体文件只在当前会话生效（大字体不落库）。

## 6. 升级说明

- 从 3.2 覆盖安装：安装器会先关闭旧进程，再覆盖 exe；题库与练习记录在 `%APPDATA%\com.tokero.app\tokero.db`，不会丢。
- 自动分图需要在设置里填视觉模型；不填也能正常用其他功能。
- 如果安装仍失败，先确认没有其他进程占用 `tokero.exe`（任务管理器结束 Tokeru），再重试；安装器会给出中文提示。
