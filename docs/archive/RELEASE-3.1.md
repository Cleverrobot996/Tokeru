# Tokeru 3.1 改版说明

日期：2026-10-22　版本：3.1.0（`package.json` / `tauri.conf.json` / `Cargo.toml` 已对齐）

本轮把 Tokeru 从「单卷 demo」改成可用的本地练习应用：首页、题库、考试工作台、导入、设置、侧栏全部重做，数据层补齐多试卷与真实导入写库。

## 一、用户反馈逐条落实

| # | 反馈（m11493 原意） | 落实 |
|---|---|---|
| 1 | 调试太慢，要一个方便截图查看与调试的工具 | `tools/shot.mjs`：零依赖 CDP CLI，支持切路由、点击、填表、多步脚本、暗色/主题切换、截图 + `--diag` 溢出/控制台/主题诊断；浏览器模式与桌面 `--target tauri` 两种目标 |
| 2 | 主页不要「先做题，再对答案」，只要试卷集与最近练习 | `src/pages/HomePage.tsx`：hero 文案已删，页面 = 轻头部（试卷/题目/练习统计，L70）+「试卷集」卡片网格 +「最近的练习」 |
| 3 | 题库界面崩了、查看方式窗口变形，要彻底重构、逻辑自洽 | `src/pages/BankPage.tsx` 全量重写（745 行）+ `src/styles/bank.css`（797 行）：正常流布局 + 吸顶工具条，分区头部带题数/分值/全选，右侧可收起选题篮，不再有互相挤压的 sticky 叠层 |
| 4 | 内置 9 种题型，导入清洗提示词却很简单 | `src/lib/importPrompt.ts`（848 行）：9 种题型逐类字段与 `answer` 结构、`set/section/material` 三层、听力音频、解析、分值题号、反例→正例；导入页两个复制按钮（提示词 / JSON 模板） |
| 5 | 不要默认 DeepSeek | `src/pages/SettingsPage.tsx`：AI 默认「不用 AI」，端点不预填；可选 OpenAI / DeepSeek / 硅基流动 / 本地 Ollama / 自定义。Rust 侧 `get_settings` 默认空 model/base_url，`ai_explain` 未配置时返回「未配置 AI 服务」，本地端点免 Key |
| 6 | 侧栏可收起 + 导航要经过 UI 设计、与主题统一 | `src/components/Shell.tsx`：收起/展开两态（248px ↔ 72px，localStorage `tokero:rail-collapsed`），品牌区 + 「学习/管理」分组、active 用主题色底 + 左侧指示条，深色与 5 套主题色一致 |
| 7 | 之前 15 图问题有些没落实 | 见下一节逐条核对 |

## 二、15 图历史清单核对

| # | 要求 | 结果 | 位置 |
|---|---|---|---|
| ① | 写作自评清单/解析并入 AI 解释并预置提示词 | ✅ 结果页 AI 面板改为预置 chip：一句话点破 / 完整解析 / 讲清错因 / 按清单自评（写作·简答，带 rubric 条目）/ 易错点（听写·填空·完形）；原「解析」折叠块并入面板 | `src/pages/ResultPage.tsx:238`、`:305` |
| ②③④ | 删冗余说明；首页只放试卷集与题目数量统计 | ✅ 首页 hero、说明段落删除；统计行写「N 份试卷 · M 道题 · X 次练习」 | `src/pages/HomePage.tsx:70` |
| ⑤ | 选了题型视图的题还要再选试卷 | ✅ 题型视图按 9 题型分组、勾完直接「开始练习」，不再要求选卷 | `src/pages/BankPage.tsx:437` |
| ⑥ | 详细模式 = 整卷视图 | ✅ 题库有简要/详细两档（详细展开题干与选项）；真正的整卷视图在「整卷练习」进考试工作台、「答案速查」看原卷 | `src/pages/BankPage.tsx:413` |
| ⑦ | 视图切换放到指定位置 | ✅ 试卷视图 / 题型视图与搜索、排序、密度同处吸顶工具条，右侧是已选计数与开始练习 | `src/pages/BankPage.tsx:381` |
| ⑧⑨⑩ | 无样式 UI 太多；文件夹新建/点击会刷新网页 | ✅ 文件夹/目录 UI 全部删除（含「把当前试卷归类」）；所有按钮/输入/下拉统一用 `app.css` 共享控件；表单按钮补 `type="button"`，不再触发表单提交刷新 | `src/pages/BankPage.tsx`（无 folder 代码）、`src/styles/app.css` |
| ⑪ | 题型多 → 需要详细导入清洗规则，导入页能复制提示词 | ✅ 上述 `importPrompt.ts`；导入页四步流程 + 复制提示词 / 复制 JSON 模板 | `src/pages/ImportPage.tsx`、`src/lib/importPrompt.ts` |
| ⑫ | 删除目录功能，保留排序与简要/详细 | ✅ 目录面板删除；保留排序（题号/新增）与简要/详细密度 | `src/pages/BankPage.tsx:405`、`:413` |
| ⑬ | 答题卡与试卷原样要区分，从原卷拆出的题不应出现在试卷内 | ✅ 工作台左=进度、中=卷面原样（只显示题干/材料，不显示答案）、右=答题卡（只有题号与输入控件）；不属于本卷的题进单独「补充练习」分区 | `src/pages/ExamPage.tsx`、`src/styles/exam.css` |
| ⑭ | 三栏铺满窗口不留左右空白，进度用颜色表示完成 | ✅ 满宽三栏 grid（240 / 弹性 / 340），栏宽可拖、双击还原、左右可收起（`tokero.exam.layout.v1`）；左栏题号按分区着色：已答=主题色、标记=琥珀、未答=浅底 | `src/pages/ExamPage.tsx:27` |
| ⑮ | 倒计时一个输入框 + 可删除预设值 + 可自定义 | ✅ 顶栏计时 popover：预设 chips（设置里可增删，默认 30/60/90/130）+ 自定义输入 + 不限时；剩 5 分钟变警告色，归零自动交卷 | `src/pages/ExamPage.tsx:648`、`src/pages/SettingsPage.tsx` |

补充（更早反馈）：练习记录按日期归档、可多选把错题写进错题本、可删除（`RecordsPage.tsx`）；结果页「你的答案 vs 正确答案」两栏大字、长答案不截断（`ResultPage.tsx` + `app.css .answer-compare.long`）；答案速查支持 `?q=题号` 深链跳转并高亮（`AnswersPage.tsx`）；不出现「解」字图标入口。

## 三、本轮代码改动

前端（`src/`）

- 新增：`styles/{home,bank,exam,import}.css`、`lib/labels.ts`、`lib/importPrompt.ts`
- 全量重写：`pages/{HomePage,BankPage,ExamPage,ImportPage,SettingsPage,ResultPage,RecordsPage,MistakesPage,AnswersPage}.tsx`、`components/Shell.tsx`
- 设计系统：`styles/app.css` 补共享控件（`.seg .toolbar .tile .page-head .ai-presets .answer-compare` 等）、`main.tsx` 引入分区样式
- mock：`lib/mock.ts` 扩到 4 次练习 / 5 条错题 / 多种题型，时间戳用本地时间（`MOCK_VERSION=4`）；**答案按 `attempt_id` 隔离**，所以「再做一次」拿到的是空白新练习，不会读回上一条记录的同题旧答案
- 修复：导入/撤销后 `invalidateQueries()`，题库与首页立即刷新；`list_sets` 不再只返回第一份试卷
- QA 复核修复：1280 档答题卡长答案不再被裁（`ExamPage.tsx` 的 `AutoArea`，minRows 听写 5 / 简答 3 / 写作 8）；顶栏不再重复页名（`Shell.tsx` `topbarLabel` 仅考试台显示）；同卷再次进入改为复用未交卷记录（`commands.rs resume_attempt` + `ExamPage` useEffect）；答案速查「也可接受」与正确答案重复时不再重复渲染；题库分区头对比度提到 light 6.48:1 / dark 8.96:1

Rust（`src-tauri/src/`）

- `repo.rs`：新增 `list_set_summaries`（全部试卷，按 id），`set_summary` 复用同一段 SQL 与行映射
- `commands.rs`：`list_sets` 改为返回全部试卷；`preview_import` 返回 `sections` / `materials`（预览页能显示分区与材料数）；`get_settings` 默认留空、`ai_explain` 未配置时友好报错；`confirm_import`/`undo_import`/`preview_import` 真实实现（事务写入、按批次级联删除）
- `models.rs`：`ImportPreview` 增 `sections` / `materials`
- `ai.rs`：通用 OpenAI 兼容客户端，未填 Key 不发 Authorization，非 DeepSeek 端点不发 thinking
- `db.rs`：新增 `import_batches` 表

工程

- 版本统一 3.1.0；`README.md` 重写（构建、数据目录、调试、AI）
- `tools/shot.mjs` 截图/诊断 CLI；`tools/steps/*.mjs` 多步脚本；`tools/fixtures/smoke-import.json` 导入样例

## 四、验证记录

- 类型：`pnpm exec tsc --noEmit` → 0 错误
- 前端：`pnpm build` → dist 生成（index-*.js ≈ 727 KB，仅有 chunk 体积提示）
- Rust：`cargo check` → 通过（仅 2 条既有 dead_code 警告：`commands.rs:52 max_score`、`models.rs:136 tag`）；`cargo test import_tests` → 4 passed
- 打包：`pnpm tauri build --no-bundle` → `src-tauri/target/release/tokero.exe`（最终包 2026-10-22 23:21，15,160,320 字节；dist `index-DOjfymIQ.js` 727,894 字节）
- 最终包真机冒烟（`TOKERU_DATA_DIR=.smoke-final3`，CDP 9333）：设置页文案已收敛（`tools/shots/final3-settings.png`）；连续两次进 `#/sets/1/exam` 后 SQLite `attempts` 仅 1 条 `in_progress`、`answers` 0 条，无控制台错误；工作台三栏截图 `tools/shots/final3-exam.png`
- 桌面端冒烟（真实 SQLite，`TOKERU_DATA_DIR=.smoke-run`）：首页（1 份试卷 · 67 题）；题库（67 题 / 8 分区）；工作台（三栏、进度着色、答题卡控件）；导入预览（3 题 / 2 分区 / 2 材料 / 17 分 / 0 警告）→ 确认导入 → 首页变 2 份试卷 · 70 题 → 进新卷整卷练习 → 交卷 → 结果页 0/17、记录页出现该次、首页最近练习更新 → 再次导入并撤销 → 回到 2 份试卷、数据库 `sets=2, questions=70, import_batches=1`
- 视觉巡检：9 条路由 × 1600/1280/1024，横向滚动 0、原生控件 0、控制台错误 0
- 交互回归（浏览器 mock）：`#/attempts/1` 点「再做一次」→ 新练习 0/67、答题卡空白（此前会读回旧答案 38/67）；连续两次进入 `#/sets/1/exam` 只留 1 条 in_progress（id 601），attempts 总数不变、草稿保留
- QA（`QA.md`）：15 项 = 14 ✅ / 1 部分 ✅（⑬ 拆出题仅代码路径、缺数据实测），无 ❌；P1-A「解」字为产品判断保留，P1-B / P2-A / P2-B / P3 全部修复并复核；最终包 23:21 真机复验 P2-B 成立

## 五、QA 剩余项的处置说明

- **P1-A「解」字**：QA 按「UI 不出现解字」字面统计出 ResultPage 63 处、SettingsPage 2 处。判断为**不改**——用户 m10311 禁的是「解」字形态的 UI 图标/入口，且用户自己在 15 图①里写的就是「解析并入 AI 解释」，本轮所有出现都是「解析 / 解释 / AI 讲解」这类正常文案。
- **P2-B 重复创建练习**：已实现 `resume_attempt`（同试卷取最新未交卷记录）并在工作台入口复用；浏览器 mock 与桌面端均已按「连进两次只有 1 条 in_progress」验收。
- **P3 三项**：答案重复已修；暗色对比已由 bank-ui 修到 dark 8.96:1；设置页说明文案已收敛（ai-import 交付时一并处理）。

## 六、已知限制

- AI 讲解需要自备 OpenAI 兼容 Key；没配时结果页只给温和提示，不报错。
- 听力音频来自 `data/media`，导入的试卷若写了不存在的音频文件名，播放会找不到文件（导入规范第 9 节已提示校验方法）。
- 桌面窗口内的浏览器预览（`http://tauri.localhost`）不支持浏览器默认音频控件样式，音频条是自绘的；实际播放依赖系统 WebView2 解码。
- 备份只有「立即备份」按钮（写 `backups/`），恢复要在文件管理器里替换 `tokero.db`；`restore_backup` 命令已存在但没有选文件 UI（需要 `tauri-plugin-dialog`，本轮不新增依赖）。
- `lib/api.ts` 里仍保留 `listFolders/createFolder/...` 五个已无 UI 入口的旧命令（后端函数也在），不影响构建；如要彻底清理可一起删。
- 便携目录已在第八节重新打包（`dist-portable/Tokeru/` + `Tokeru_3.1.0_x64_portable.zip`）。
## 七、3.1 增补：可收起侧栏、新标志与安装包（2026-10-22 23:45）

### 侧栏（中间形态，最终形态见第八节）
- 仿 Fushi：`Shell.tsx` 顶部新增开关，展开时「三横 + 左箭头」与品牌同一行，收起时「三横」居中在标志上方；展开 248px，收起 108px。
- 收起态不是纯图标：`.rail-link` 改为纵向（图标在上、10.5px 文字在下，min-height 56px）；分组标签、版本号、品牌文字隐藏，两个分组之间加分隔线。
- 状态写入 `localStorage`（key `tokero:rail-collapsed`），刷新与重开窗口保持；`aria-expanded` / `aria-controls` 同步。
- 相关文件：`src/components/Shell.tsx`、`src/styles/home.css`（`.rail-head`、`.rail-toggle`、收起态块）。

### 标志
- 新图形：叠起的题卡 + 对勾，24×24 viewBox，线稿 stroke 1.7–1.9；语义 = 任意材料 → 刷题 → 解出。
- `src/components/Logo.tsx` 的 `TokeroMark` 在侧栏 38px 渐层底块内以 21px 渲染；品牌副标题「英语题库」删除，README 定位改为「面向任意材料的本地练习应用」。
- 资产：`branding/tokero-mark.svg`（线稿）、`branding/tokero-appicon.svg`（图标）、`branding/logo-review.html` / `.png`（审核稿）、`branding/README.md`。

### 验证
- `pnpm exec tsc --noEmit` → 0；`pnpm build` 通过（`dist/assets/index-BBL-vzmn.js` 728,301 B、`index-br-Gyu9x.css` 80,274 B）
- 浏览器 1600×1000：展开 / 收起 / 深色收起三态截图（`tools/shots/nav-*.png`），hScroll=no、控制台错误 0
- 真机（`TOKERU_DATA_DIR=.smoke-nav`、CDP 9333）：`desk-nav-expanded.png`、`desk-nav-collapsed.png`，点击顶部开关即时切换，0 控制台错误 / 0 失败请求 / 无横滚

### 产物（2026-10-22 23:45）
- 便携版：`src-tauri/target/release/tokero.exe` 15,160,320 字节
- 安装包：`src-tauri/target/release/bundle/nsis/Tokeru_3.1.0_x64-setup.exe` 70,636,124 字节（NSIS，未签名）
- 构建命令：`pnpm tauri build --bundles nsis`（`--no-bundle` 只出便携版）

### 打包注意
- NSIS 工具链首次从 GitHub 下载（`nsis-3.13.zip` + `nsis_tauri_utils.dll` 到 `%LOCALAPPDATA%\tauri\NSIS`）；网络慢时会报 `timeout: global`，重试或在能直连的终端用 curl 预置缓存后重跑。
- 安装包未签名，Windows SmartScreen 会提示「未知发布者」；便携版不写注册表，删目录即卸载。

## 八、3.1 最终交付：全收起侧栏、便携版启动修复、正式包（2026-10-23 00:12）

本轮针对用户 m01498 反馈：「便携版启动失败；收起侧栏改成全收起而不是细条；默认宽度改成上一版收起态；并用我给的图标」。

### 1. 侧栏（最终形态）
- 默认就是窄栏 `108px`（= 上一版的收起态）：顶部开关与标志纵向排列，每个导航项图标在上、10.5px 文字在下；分组标签、版本号、品牌文字隐藏。
- 点侧栏顶部的分栏图标（用户给的 PanelLeft 图形，24×24：外框 + 左侧分栏线）后**完全收起为 0px**，`.rail` 的 padding/opacity/pointer-events 同步归零并禁用，内容区占满整窗。
- 收起后顶栏左侧出现**同一个图标**的按钮，点它恢复窄栏；开关与恢复按钮之间做焦点交接（避免焦点留在 `aria-hidden` 区域内触发浏览器告警）。
- 状态写 `localStorage` 的 `tokero:rail-collapsed`（"1" = 收起，缺省 = 打开），刷新与重开窗口保持。
- 文件：`src/components/Shell.tsx`（`PanelGlyph`、`railOpen`、`railToggleRef`/`railOpenBtnRef`、`aria-hidden`）、`src/styles/home.css`（`.shell{--rail-w:108px}`、`[data-rail="closed"]{--rail-w:0px}`、`.rail-open-btn`）、`src/styles/app.css`（`.shell` 用 `var(--rail-w, 108px)`）。

### 2. 便携版启动失败修复
- 根因：建库目录 `%APPDATA%\com.tokero.app` 只建出 `backups/`、`media/` 而没有 `tokero.db`（用户环境里数据库从未成功创建），随后 `db: open sqlite: unable to open database file` 直接 panic，窗口闪退——正是「便携版启动失败」。
- `src-tauri/src/main.rs` 重构：抽 `setup_app()`；数据目录优先 `TOKERU_DATA_DIR`，否则 `app_data_dir()`；**建库失败自动回退到 exe 同目录的 `data/` 文件夹**，并 eprintln 说明；两处都失败时写 `tokero-startup-error.log`（exe 旁，含本地时间戳）并弹原生「Tokeru 启动失败」对话框（user32 `MessageBoxW`，不新增依赖）后退出，不再 panic / 静默闪退。
- 实测（干净 exe、不设 `TOKERU_DATA_DIR`）：stderr 提示回退、窗口正常、`target/release/data/tokero.db` 建库成功、练习首页可交互（`tools/shots/final-exe-rail-narrow.png`）。

### 3. 打包注意（已写入 README）
- `pnpm tauri build --bundles nsis` 会 patch `release/tokero.exe`（日志 `Info Patching ... with bundle type information: nsis`，hash 改变）。要交付干净便携版，必须在出安装包后 `rm src-tauri/target/release/tokero.exe && pnpm tauri build --no-bundle`。
- 打包前先 `taskkill //IM tokero.exe //F`，否则 `failed to remove file ... os error 5`。

### 4. 最终产物（2026-10-23 00:09–00:10）
- 安装包：`src-tauri/target/release/bundle/nsis/Tokeru_3.1.0_x64-setup.exe` 70,639,599 B（NSIS，未签名）
- 干净便携 exe：`src-tauri/target/release/tokero.exe` 15,194,112 B，sha256 前缀 `a1442a754a6b8a85`
- 便携目录：`dist-portable/Tokeru/`（`Tokeru.exe` + `data/media/tem4-2016.mp3` + `使用说明.txt`）
- 便携压缩包：`dist-portable/Tokeru_3.1.0_x64_portable.zip` 72,667,029 B
- 前端：`dist/assets/index-CvGCeWC6.js` 728,788 B、`index-B812xe29.css` 79,511 B

### 5. 验证
- `pnpm exec tsc --noEmit` = 0；`cargo check` 仅 2 条既有 warning（`commands.rs:51/52 max_score`、`models.rs:136 BankFilter.tag`）
- 浏览器 1600×1000：默认窄栏（`rail-narrow.png`）、全收起（`rail-closed.png`，内容左移占满、顶栏出现恢复按钮）、深色（`rail-narrow-dark.png`）、题库 1280（`rail-narrow-bank-1280.png`），hScroll=no、原生控件 0、内联硬编码色 0、控制台错误 0
- 干净便携 exe 真机（CDP 9333，未设数据目录）：`final-exe-rail-narrow.png` / `final-exe-rail-closed.png`，点击开关 `data-rail` 由 open→closed，布局与浏览器一致，控制台错误 0
- 截图证据保留在 `tools/shots/`（含 `qa/` 的 36 张历史巡检图）

