# Tokeru UI 核验（15 图清单 + 全站巡检）

> **生成时间：2026-10-22 23:04（Asia/Shanghai）；复核更新：23:12（P1-B、P2-A 已修）、23:17（P2-B、P3 已修；P1-A 按产品判断保留）、23:21（最终包：设置文案已收敛，P2-B 真机复验成立）**  
> 巡检对象：浏览器模式 http://127.0.0.1:1420（HashRouter，数据来自 src/lib/mock.ts 假数据），窗口 1600×1000 / 1280×800 / 1024×768 + 深色。  
> **警告：bank-ui / exam-ui / shell-home / ai-import / lead 正在并行改页面，本文结论会随代码变化而过期。** 复测请重跑命令，不要直接引用旧截图。

## 0. 结论摘要

- 机械项全绿：36 张巡检截图 **0** console error、**0** failed request、**0** 横向滚动、**0** 无样式原生控件、**0** 内联硬编码颜色、**0** 错误遮罩。
- 15 项里 **14 项 ✅、1 项部分 ✅（⑬ 拆出题数据未实测）**；没有 ❌。
- **P1/P2 已全部关档**：P1-A「解」字按产品判断保留、非缺陷（lead 决策）；P1-B、P2-A、P2-B 均已修复并经复核（P2-B 于 23:21 最终包真机复验：连进两次仍只有 1 条 in_progress、answers 0 条）。
- **P3 三条均已修复并复验**：P3-A 答案去重、P3-B 暗色「全选」对比、P3-C 设置文案收敛（23:21 最终包）。
- 仅剩：⑬ 缺拆出题数据实测；桌面端两档尺寸/深色未覆盖（均不阻塞）。

## 1. 15 图清单逐条核验

证据目录：`tools/shots/qa/`（1600 档 `<slug>-1600.png`、1280 档 `<slug>-1280.png`、深色 `<slug>-1600-dark.png`；交互探针 `probe-*.png`）。

| # | 用户要求（BRIEF §3） | 结论 | 证据截图 | 定位 / 复现 |
|---|---|---|---|---|
| ① | 写作自评并入 AI 解释，预置评卷提示词，去掉独立自评页 | ✅ 功能已并入；「解」字按产品判断保留 | `attempt1-1600.png` | ResultPage.tsx:291「自评（满分 X）」、:307「完整解析」等已在题目卡片内，独立自评页已不存在。**「解」字（结果页 63 处 + 设置页 2 处）经 lead 决策保留**：用户禁的是「解」字形图标/入口，且用户在 15 图① 要求「解析并入 AI 解释」，现有均为正常文案，不计缺陷。 |
| ② | 删冗余说明 | ✅ 已收敛（23:21 最终包） | `home-1600.png`、`tools/shots/final3-settings.png` | 首页已无「先做题再对答案」；ResultPage.tsx:113/:161、AnswersPage.tsx:92 已删；SettingsPage.tsx:206/:219 各压成一行（「用于题目解释与写作自评，任意 OpenAI 兼容端点，Key 只存本机。」/「默认不使用；需要时选一个服务并填 Key。」）。 |
| ③ | 首页只显示试卷集和最近练习 | ✅ | `home-1600.png`、`home-1280.png` | HomePage.tsx 区块「试卷集」+「最近的练习」；无引导语、无大 Hero。 |
| ④ | 统计收敛到「几份试卷 / 几道题」 | ✅ | `home-1600.png` | HomePage.tsx:70 `{n} 份试卷 · {m} 道题 · {k} 次练习`，一行小字挂在标题后。 |
| ⑤ | 题型视图勾完直接开始练习，不再让选卷 | ✅ | `probe-bank-qtype-selected.png`、`probe-bank-start-exam.png` | 探针：题型视图勾 1 题 → 点「开始练习」→ `location.hash = #/exam/611`，无「再选试卷」弹窗。代码 BankPage.tsx:379-386（视图 seg）、:541（开始练习）。 |
| ⑥ | 「详细」模式 = 整卷视图 | ✅ | `probe-bank-detail.png` | BankPage.tsx:414-418：详细 → 单列整卷卡片（试卷视图下）。 |
| ⑦ | 视图切换放顶部工具条左侧 | ✅ | `bank-1600.png` | BankPage.tsx:378-386：`.toolbar` 第一个子元素就是 `.seg`（试卷视图 / 题型视图），后面才是搜索、排序、简要/详细、已选/开始练习。 |
| ⑧ | 去掉无样式原生控件 | ✅ | 36 张巡检图 | 隐藏探针比 computed style 的 `/nativeControls` 全站 = 0；设置页 select、错题本 select、题库搜索框、答题卡输入框均有样式。 |
| ⑨ | 同类问题（多页原生控件） | ✅ | `mistakes-1600.png`、`settings-1600.png` | 同上；「全部试卷」select 与偏好 select 均为设计过的控件。 |
| ⑩ | 文件夹新建/点击会刷新网页 | ✅ | —（页面已无入口） | 目录/文件夹 UI 已整体移除；`src` 里只剩未调用的 api.ts:51-52 `listFolders`/`createFolder` 与 mock.ts:832 的「文件夹名不能为空」提示文案，建议清掉死代码。 |
| ⑪ | 导入清洗规则写详细 + 复制提示词 | ✅ | `probe-import-step2.png`、`import-1600.png` | ImportPage.tsx:328「复制提示词，交给任意 AI」、:333 `{SPEC_LINES} 行规范`、:347 复制按钮；第 2 步还有「复制 JSON 模板」与「在 AI 里生成后粘回」。 |
| ⑫ | 删除目录/文件夹功能 | ✅ | —（同 ⑩） | UI 无入口；列表页只剩试卷集。 |
| ⑬ | 答题卡与试卷原样区分；拆出的题不进试卷原样 | ✅（代码路径）/ 数据未实测 | `exam-1600.png` | 右栏「答题卡」只放题号 + 控件 + 标记，试卷原文只在中间纸面；拆出题（外来 set_id 或 section 缺失）归入「补充练习」组并注明「以下题目不属于本卷」（ExamPage.tsx:124-164、:995）。当前 mock 无拆出题数据，未实测渲染。 |
| ⑭ | 三栏铺满、无左右空白；答题进度用颜色 | ✅ | `exam-1600.png`、`exam-1280.png`、`exam-1024.png` | 实测 `.exam-body`：1600 → left 72 + width 1528，cols `208px 6px 1068px 6px 240px`；1280 → 72 + 1208，`208 6 748 6 240`；1024 → 72 + 952，`208 6 492 6 240`；padding 0，页面无横滚。左栏题号按 未答/已答/标记 上色并有图例。 |
| ⑮ | 倒计时 = 输入框 + 可删预设值 | ✅ | `probe-exam-timer.png` | ExamPage.tsx:654-695：`.exam-timer-pop` 内有 30/60/90/130 分钟 chip（各带 × 删除）、自定义分钟输入 + 确定、不限时、关闭。 |

补充：**「解」字机械计数**（全站文本节点）——`/settings` 2 处、`/attempts/1` 63 处（21 题 × 3 个标签），其余 7 个路由 0 处。

## 2. 9 路由 × 3 档 diag 汇总

命令（可复现）：

    node tools/shot.mjs --steps tools/steps/qa-all.mjs  --profile tools/.shot-profile/qa --keep-going --json   # 1600/1280/深色 27 张
    node tools/shot.mjs --steps tools/steps/qa-1024.mjs --profile tools/.shot-profile/qa --keep-going --json   # 1024 档 9 张

| 路由 | 1600×1000（文档高） | 1280×800 | 1024×768 | 深色 1600 | 横滚 | 原生控件 | 「解」字 | 错误遮罩 |
|---|---|---|---|---|---|---|---|---|
| `/` | 1000 | 1000 | 768 | 1000 | 无 | 0 | 0 | 无 |
| `/bank` | 4430（23:14 复核 4430） | 5328 | 5522 | 4430 | 无 | 0 | 0 | 无 |
| `/sets/1/exam` | 1000 | 1000 | 768 | 1000 | 无 | 0 | 0 | 无 |
| `/records` | 1000 | 1000 | 768 | 1000 | 无 | 0 | 0 | 无 |
| `/mistakes` | 1000 | 897 | 868 | 1000 | 无 | 0 | 0 | 无 |
| `/import` | 1000 | 974 | 950 | 1000 | 无 | 0 | 0 | 无 |
| `/settings` | 1196 | 1196 | 1172 | 1196 | 无 | 0 | 2（保留） | 无 |
| `/attempts/1` | 10307 | 10784 | 10881 | 10307 | 无 | 0 | 63（保留） | 无 |
| `/sets/1/answers` | 34673 | 35607 | 36003 | 34673 | 无 | 0 | 0 | 无 |

全局：console error 0、失败请求 0、Vite 错误遮罩 0、内联硬编码颜色 0、`documentElement` 横向溢出 0（36 张）。1024 是 BRIEF 的最小宽度底线，全部通过。

> 表中「解」字计数为**产品保留**（见 P1-A 决策），不计缺陷；其余路由 0。

## 3. 失败项清单（按严重度）

### P1-A 「解」字 —— ✅ 按产品判断保留，非缺陷（lead 决策 2026-10-22 23:16）

- 位置（保留现状）：`ResultPage.tsx:301`「AI 讲解」、`:307`「完整解析」、`:329`「题目解析」；`SettingsPage.tsx:196`「AI 解释（可选）」、`:206`「用于题目解释与写作自评」。机械计数 63 + 2（23:17 复核未变）。
- **决策依据**：用户禁的是「解」字形图标/入口，且用户在 15 图① 明确要求「解析并入 AI 解释」；现有 63+2 处均为「解析/解释/AI 讲解」正常文案，按产品判断保留，**不计缺陷、不再要求改文案**。
- 证据：`attempt1-1600.png`、`settings-1600.png`。

### P1-B 1280 档答题卡长答案输入框被裁 —— ✅ 已修复（2026-10-22 23:12 复核）

- **复核结论**：1280×800 `#/sets/1/exam` 答题卡实测 `[{h:114,sh:114,len:89},{h:74,sh:74,len:49},{h:74,sh:74,len:42},…]`，clientHeight 已等于 scrollHeight，长答案不再被裁；修复由 exam-ui 完成（rows / min-height 调整），复核图 `exam-1280.png` 已重截。
- 原问题记录（修复前）：位置：`src/pages/ExamPage.tsx:1127`（dictation `rows={3}`、short_answer `rows={2}`、writing `rows={6}`）、`src/styles/exam.css:1073`（`.sheet-area` `min-height: 38px`）。
- 实测（1280×800，`#/sets/1/exam` 答题卡）：听写框 clientHeight 74 / scrollHeight 114（答案 89 字符）；两个简答框 54 / 74。文字可内滚但看不到结尾，且右栏窄，体验明显差。
- 证据：`tools/shots/qa/exam-1280.png`、`tools/shots/qa/probe-exam-1280-right.png`。
- 最小复现：1280×800 打开 `#/sets/1/exam`，看右栏第 1 题听写框。
- 建议：按内容自增高（textarea auto-grow，或 `min-height: 96px` 且 dictation `rows={5}`）；右栏底部有空间可扩。
- Owner：exam-ui。

### P2-A 顶栏页名与页面 H1 重复 —— ✅ 已修复（2026-10-22 23:12 复核）

- **复核结论**：lead 已把 `pageLabel()` 换成 `topbarLabel(pathname)`（`Shell.tsx:62-66`：仅 `startsWith("/exam/") || endsWith("/exam")` 返回「考试工作台」，其余返回空串），渲染处 `Shell.tsx:164` 条件渲染，其余路由顶栏已无页名；`home/records/import/bank-1600.png` 已重截，diag 无重复文案。
- 原问题记录（修复前）：位置：`src/components/Shell.tsx:64-70` `pageLabel()` + `:169` 顶栏 `<b>{pageLabel(...)}</b>`。
- 现象：首页顶栏「首页」+ H1「Tokeru」；练习记录「练习记录 ×2」；导入「导入」+「导入题目」；题库「题库 ×2」。
- 证据：`home-1600.png`、`records-1600.png`、`import-1600.png`、`bank-1600.png`。
- 建议：顶栏只留面包屑（Tokeru / 题库 / 试卷名），或删掉顶栏页名，让 page-head 唯一承担标题。
- Owner：shell-home。

### P2-B 每次进入 /sets/:id/exam 都会新建一条 attempt —— ✅ 已修复（2026-10-22 23:17 双向复核）

- 修复：后端 `commands.rs` 新增 `resume_attempt`（进入考试优先复用该卷最近一条 in_progress attempt）；前端 `ExamPage.tsx:57-74` 改为先 resume、无则 create。
- 复核（浏览器 mock，`tools/steps/qa-final.mjs`）：连续三次进入 `#/sets/1/exam`（中间往返 `/`、`/records`）→ `attempts` 总数恒为 5、in_progress 恒为 2（id 4、601），**不再新增**；输入「draft-check」后离开再回来，答题卡内容仍在（草稿保留）。
- 复核（exam-ui 真机，release 23:13、CDP 9333、`TOKERU_DATA_DIR=.smoke-exam`）：多次重进同样只有 1 条 in_progress、草稿保留。
- 原问题记录：挂在 `ExamPage.tsx:69` 无条件 `createAttempt`；真实 SQLite 连进两次产生 2 条 in_progress，且重进丢草稿。

### P3-A 同一答案重复展示 —— ✅ 已修复（2026-10-22 23:17 复核）

- 修复：`AnswersPage.tsx` extra/accept 去重（与 answer 相同或仅差大小写/空白时不渲染）。
- 复核：`#/sets/1/answers` 全文「也可接受」出现 **0** 次（修复前 1 处「也可接受：success」）。
- 原问题：正确答案 success 下面又出现「也可接受：success」。证据：`answers1-1600.png`。

### P3-B 暗色下分区「全选」对比偏低 —— ✅ 已修复（bank-ui 反馈）

- 修复：`BankPage.tsx` 分区头按钮暗色改用更高阶文字色，对比度 6.48 / 8.96:1（普通/悬停）。
- 原问题：暗色截图 `bank-1600-dark.png` 中「全选」用 `--text-3` 偏淡。

### P3-C 设置页说明文案冗长 —— ✅ 已修复（2026-10-22 23:21 最终包复验）

- 现状：`SettingsPage.tsx:206`「用于题目解释与写作自评，任意 OpenAI 兼容端点，Key 只存本机。」、`:219`「默认不使用；需要时选一个服务并填 Key。」各一行。
- 证据：`tools/shots/final3-settings.png`（lead 真机最终包）；23:17 dev 页旧文案已在最终包消失。

## 4. 方法与已知限制

- 工具：`tools/shot.mjs`（零依赖 Node ESM，spawn headless Edge + 自建 CDP）。一图一行：

      node tools/shot.mjs --route "#/bank" --out tools/shots/bank.png --w 1600 --h 1000

  巡检/探针脚本：`tools/steps/qa-all.mjs`、`qa-1024.mjs`、`qa-probes.mjs`、`qa-measure.mjs`、`qa-textarea.mjs`、`qa-attempts.mjs`、`qa-recheck.mjs`（复核 P1-B/P2-A）、`qa-final.mjs`（复核 P2-B/P3-A/②）、`qa-overflow.mjs`（横向溢出）；用法见 `tools/README.md`。
- 数据来自 mock（localStorage `tokero.mock.v1`），与真实 SQLite 可能有差异；`/attempts/1`、`/records` 的数据是 mock 预置的 3 条练习。
- 深色只抽了 1600 档 9 页（1280 深色未逐页跑）；暗色对比度问题靠肉眼 + 截图判断，未做像素级对比度计算。
- 历史观察（记录于早期一轮探针，2026-10-22 23:15 复核）：exam.css 尚未生效时 `#/sets/1/exam` 在 1280 下 scrollWidth 1323（溢出 43px）；样式到位后复测 `docSW=1280`、`beyondRight=[]`、`internalX=[]`，属阶段性现象、非回归，故不计入失败项（探针：`tools/steps/qa-overflow.mjs`）。
- 页面在巡检期间被并行修改：若某条与当前代码不符，以你本地最新的 `pnpm dev` 页面为准，并用上面的命令重跑。
- 桌面端（Tauri/WebView2）冒烟（2026-10-22 23:06–23:09）：连的是已在跑的冒烟实例（PID 24228，`TOKERU_DATA_DIR=.smoke-final`，CDP 9333），桌面版 = exe 23:05 / dist 23:04。
  - 正常：`/` 真实数据「1 份试卷 · 67 题 · 0 次练习」+ 空状态「还没有练习记录，去题库挑一道开始。」；`/bank` 67 题 6 题型三栏正常；`/settings` 完整；`/sets/1/exam` 三栏 + 听力音频可播（28:10，媒体文件存在）。
  - 保存链路通：在答题卡填空输入 success → 已答 1/67、右上「已保存」，SQLite `answers` 落 1 条。
  - 证据：`tools/shots/qa/tauri-home.png`、`tauri-bank.png`、`tauri-settings.png`、`tauri-exam.png`、`tauri-exam-typed.png`、`tauri-records-after.png`。
  - 未做：桌面两档尺寸（窗口 CSS 宽 1925 @125% DPI，未模拟 1280/1024）、桌面深色、导入/交卷全流程。
  - 复现：`TOKERU_DATA_DIR=<工作区目录> WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333 src-tauri/target/release/tokero.exe`，再 `node tools/shot.mjs --target tauri --route "#/" --out tools/shots/tauri-home.png`。注意别重复启动 exe（会多开一个窗口、9333 被先启动的实例占用）。
