# Tokeru 3.2 交付说明

版本 3.2.0 · 2026-10-23

本轮把 Tokeru 从「英语试卷练习器」推进为**面向任意材料的通用题库**：试卷不再只有「试卷 / 题型」两种看法，而是用**标签、试卷、文件夹**三条线并行的组织方式；试卷卡固定尺寸、可在卡上改名；「答案速查」升级为「速查与整理」，可以直接给试卷和每道题打标、改题型、补题图；导入提示词补齐标签、文件夹与图片规则；考试页新增试卷排版与字体选择。同时修掉了便携版在受限环境下启动即退出、以及重复进入整卷会新建练习记录两个问题。

## 1. 需求落实

| 用户反馈 | 落实 |
| --- | --- |
| 便携版启动提示「数据目录不可用」，关掉弹窗后应用退出（m01756） | 启动数据目录改为回退链：`TOKERU_DATA_DIR` → 应用数据目录 → `%LOCALAPPDATA%\com.tokero.app` → exe 同目录 `data/` → 临时目录。只有全部不可写时才写 `tokero-startup-error.log` 并弹窗退出；内置题库写入失败只记日志、不阻断启动。 |
| 试卷卡尺寸不固定，侧栏收起时拉伸卡顿（m01756） | 试卷卡固定 **368×200**，网格 `repeat(auto-fill, 368px)`，侧栏收起不再触发卡片重排；1600 三列 / 1280 两列。 |
| 试卷卡上直接改名（m01756） | 卡片标题双击或铅笔按钮进入内联编辑，Enter 保存、Esc 回滚、失焦保存；走 `rename_set` 并刷新首页与题库。 |
| 题库不要「题型视图」，改为标签 + 试卷分类，可多选标签、单选/多选试卷，可只看试卷或只看题目（m01756） | 题型视图整体移除。题库左栏 = 标签（多选、带计数、可搜索）+ 试卷（可多选）+ 文件夹；顶部 = 搜索、排序、显示模式 **试卷+题目 / 仅试卷 / 仅题目**。标签命中试卷时，该试卷下的题目一并显示，不再出现「只筛出卷、0 道题」。 |
| 标签可以是学科/题型，AI 导入时自行打标与归类（m01756） | 导入 JSON 新增 `set.tags`、`set.folder`、每题 `tags`；提示词 v1.1 起加入标签与文件夹章节。导入预览展示目标文件夹、试卷标签与题目标签；导入时自动建文件夹并写入 `sets.tags_json` / `sets.folder_id`。 |
| 在试卷卡点「答案速查」进入详细页打标（m01756） | 入口改名「速查与整理」：可编辑试卷标签、归属文件夹、整卷练习、打印；每道题可增删标签、切换 9 种题型、加入错题本；支持 `?q={questionId}` 深链定位高亮。 |
| 给试卷集添加文件夹（m01756） | 题库与首页都有文件夹筛选；题库可新建 / 改名 / 删除文件夹（二次确认），速查与整理可改归属；空文件夹显示 0。 |
| 数学试卷题目里的图片没有进来（m02310） | 新增图片题管线：题干/材料支持 `<figure class="q-figure"><img src="data:...">`；「速查与整理」每题可「添加题图」，图片压缩到最长边 1400px JPEG 后写入题干；考试页、排版预览、答案速查统一渲染。导入提示词 v1.2 说明图片写法与「拿不到图」时的降级。PDF 矢量图无法由文本模型自动分题，需按题截图后补图（见限制）。 |
| 进试卷的字体和排版有问题，想要内置默认方案 + 用户定制 + 预览（m02362） | 新增「试卷排版」：默认 / 紧凑 / 宽松 / 大字四套预设，可调衬线/无衬线、字号 14–22、行高 1.4–2.2、段距 4–28、纸宽 720–1040，实时预览，可恢复默认；设置页与考试页顶栏「排版」共用配置并即时生效。 |
| 支持从 Windows 读取字体或弹文件选择（m02551） | 字体选择弹窗支持读取 Windows 已安装字体（GDI 枚举，本机 318 个）、搜索、逐项字体预览；也支持选择 `.ttf/.otf/.woff/.woff2` 文件，注入 `FontFace` 后立即用于试卷与预览。 |
| 侧栏像 Fushi 一样展开收缩（m01257）与「全收起、默认上一版收起态、用这个分栏图标」（m01498） | 默认 **108px 窄栏**（图标在上、文字在下），点顶部分栏图标**完全收起为 0px**；收起后左上角出现同一图标按钮恢复。状态存 localStorage `tokero:rail-collapsed`。 |
| 左上角不要「英语题库」，Tokeru 面向通用材料；新 Logo（m01270） | 副标题删除；品牌标记改为「叠起的题卡 + 对勾」，`branding/` 提供线稿、应用图标与审核稿。 |

## 2. 版本内的主要改动

### 题库与首页
- `src/pages/BankPage.tsx` 全量重写：标签多选、试卷多选、文件夹、显示模式、固定卡、题目按试卷分组、右侧选题篮、排序（题号 / 名称 / 添加时间）。
- `src/pages/HomePage.tsx`：固定 368×200 卡片、文件夹 chips、卡上改名、最近练习；卡片字段包含标签、上次成绩。
- 后端新增 `rename_set`、`update_set_tags`、`list_tags`；`list_bank` 支持按试卷 id 集合与标签过滤；`sets` 表新增 `tags_json` 迁移。

### 速查与整理
- `src/pages/AnswersPage.tsx` 整页重写（908 行）：试卷标签/文件夹、分区索引、材料折叠、完形词库只渲染一次、每题标签与题型编辑、题图、加入错题本、打印、深链定位。
- `update_question` 增加 `stem` 参数（单题题干上限 8 MB）。

### 导入
- `src/lib/importPrompt.ts` 升到 v1.2（约 848 行规范）：9 种题型字段规范、set/section/material 三层、标签与文件夹、图片题、自检清单。
- 导入预览显示文件夹、试卷标签、题型分布、题目标签列；确认导入后自动建文件夹、写标签；撤销按批次级联删除。

### 考试页与排版
- `src/lib/paper.ts`：排版预设与规范化、`paperCssVars`、自定义字体持久化。
- `src/components/PaperSettings.tsx`：预设、字体、字号/行高/段距/纸宽滑杆、实时预览、恢复默认；字体弹窗读取系统字体或选择文件。
- `src/pages/ExamPage.tsx`：顶栏「排版」弹层、纸面变量生效、题图渲染；进入整卷时优先复用进行中的 attempt（`resume_attempt`）。
- `src-tauri/src/fonts.rs`：Windows GDI 字体枚举（318 个字体族），单测覆盖。

### 启动与侧栏
- `src-tauri/src/main.rs`：数据目录回退链、非致命 seed、`tokero-startup-error.log`、Windows MessageBox 启动错误。
- `src/components/Shell.tsx` + `src/styles/home.css`：108px 窄栏 / 0px 全收起、分栏图标、顶栏恢复按钮、焦点交接。

## 3. 全流程 E2E（真实桌面端 + 真实 SQLite）

环境：`TOKERU_DATA_DIR=.e2e-data`，WebView2 调试端口 9333，DeepSeek `deepseek-chat`。

| 材料 | 生成结果 | 导入结果 |
| --- | --- | --- |
| `Unit 2 同步测试.md`（30 选择 + 10 改错 + 5 翻译） | `tools/e2e/english.json`：47 题 / 3 分区 / 0 材料 / 56 分 / 0 警告；标签 英语、同步测试、词汇语法、改错、翻译；文件夹「Unit 2 同步测试」 | 批次 #1，DB `sets.id=2`，自动建文件夹 1 |
| `1717916773_9867.pdf`（2024 高考数学新课标Ⅱ卷） | `tools/e2e/math.json`：19 题 / 4 分区 / 147 分 / 0 警告；标签 数学、高考、真题、新课标Ⅱ卷；文件夹「高考数学真题」 | 批次 #2，DB `sets.id=3`，自动建文件夹 2 |

最终库：3 份试卷、133 道题、2 个导入批次、3 个文件夹。

已验证的真实交互：

- 首页三张固定卡（TEM4、Unit 2、数学卷），文件夹 chips 与标签正常；卡片改名落库。
- 题库按「数学」标签筛选 → 1 张试卷卡 + 19 张题卡；按试卷多选、文件夹新建/改名/删除正常。
- 速查与整理：试卷标签新增、题目标签新增、文件夹切换、题型下拉均写库；`?q=68` 深链滚动并高亮。
- 给第 1 题添加题图（640×220 PNG）→ 压缩为 JPEG data URL 写入题干 → 整卷考试页正常渲染。
- 系统字体弹窗 318 项；选择 Arial 后试卷正文使用 Arial，排版选择「大字」后字号 18.5px / 行高 1.9 / 纸宽 860px。
- 重复进入同一整卷复用进行中的 attempt，不再产生空的练习记录。
- 导入提示词生成：英文 prompt 38,414 字符、规范 21,708 字符、图片规则生效。

证据截图：`tools/shots/e2e-desk-bank.png`、`e2e-desk-home2.png`、`e2e-desk-organize.png`、`e2e-desk-math-exam.png`、`desk-font-modal.png`、`desk-font-selected.png`、`desk-image-added.png`、`desk-image-exam.png`、`desk-paper-large.png`、`desk-bank-math-tag.png`、`desk-deeplink-q68.png`。

## 4. 验证记录

- `pnpm exec tsc --noEmit`：0 错误。
- `cargo check`：通过；仅保留 2 条既有 warning（`commands.rs` 的 `max_score` 未读、`models.rs` 的 `BankFilter.tag` 未读）。
- `cargo test`：导入解析测试 + Windows 字体枚举测试通过（font families: 318）。
- 浏览器 1600 / 1280 / 1024、浅色 / 深色：无横向滚动、无控制台错误、无原生控件、无硬编码色、无「解」单字图标。
- 真机：首页、题库、速查与整理、整卷、设置、排版、字体、题图、导入、撤销均无控制台错误。

## 5. 已知限制

1. **PDF 矢量图不能自动分题**：这份数学卷大量图形是矢量绘制，文本模型也看不到图；目前需在「速查与整理」按题截图补图，或在导入时由多模态模型写入 data URL。未补图的题目会显示「（原题有图，见原卷）」。
2. **AI 图片能力取决于端点**：默认的纯文本模型不能读图；提示词会把缺失图片写成 warning，不会伪造。
3. **字体文件持久化阈值**：字体文件转 data URL 后 ≤ 5.6 MB（约 4 MB 原文件）会存 localStorage 下次恢复；更大的字体只在当前会话生效。
4. **系统字体枚举仅 Windows**：其他平台只提供字体文件选择。
5. **图片存在题干里**：题图以 data URL 形式内联进 `questions.stem`，单题上限 8 MB；大量题图会增大数据库体积。
6. **排版配置在 WebView localStorage**：换机器/清缓存后回到默认方案，不写入 SQLite。
7. **浏览器预览的导入不落库**：mock 的 `confirm_import` 只返回批次号；导入结果请以桌面端为准。
8. **数学公式以文本呈现**：PDF 文本层已尽量转成 x²、√2 等文本；进一步排版需要人工整理或改用公式图片。

## 6. 构建产物

- 便携 exe：`src-tauri/target/release/tokero.exe`
- 便携目录：`dist-portable/Tokeru/`（Tokeru.exe + data/media + 使用说明）
- 便携包：`dist-portable/Tokeru_3.2.0_x64_portable.zip`
- 安装包：`src-tauri/target/release/bundle/nsis/Tokeru_3.2.0_x64-setup.exe`

构建命令与注意事项见 `README.md`。`--bundles nsis` 会 patch release exe，最后需再跑一次 `--no-bundle` 得到干净便携版。

## 7. 最终冒烟（3.2.0）

- 用最终 exe、全新数据目录 `.smoke-320` 启动：自动建库并写入内置题库，`sets=1 / questions=67 / title=TEM4 2016 真题`；无启动错误弹窗、无 `tokero-startup-error.log`。
- 同一 exe 连到 3.2 E2E 数据库复验：首页 3 份试卷 / 133 题、题库标签与文件夹、速查与整理题图、整卷考试页题图、系统字体 318 项、试卷排版面板全部正常；控制台 0 错误、无横向滚动。
- 冒烟截图：`tools/shots/final320-fresh-home.png`、`final320-home.png`、`final320-bank.png`、`final320-organize.png`、`final320-exam-image.png`、`final320-font-modal.png`、`final320-paper.png`。
- `tokero.exe`：15,304,704 字节，ProductVersion/FileVersion = 3.2.0，SHA-256 前缀 `d9b2c702082ace74`。
- 安装包：70,679,677 字节；便携包：72,050,591 字节（SHA-256 前缀 `eb84130ab6a504d4`）。
