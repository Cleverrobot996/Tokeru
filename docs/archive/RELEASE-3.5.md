# Tokeru 3.5.0 发布记录

日期：2026-10-24
目标：把 3.5 的安装、改名、原卷/高对比、标签、导入 AI 预览、自定义总分与 AI 判卷、首页删卷、考试沉浸标题栏全部落地，并完成非管理员安装验证。

## 需求对照

| 需求 | 落实 |
| --- | --- |
| 非管理员也能安装 | 安装器改为按版本并列安装：每次写入 %LOCALAPPDATA%\Tokeru\app-3.5.0（已被占用时依次 app-3.5.0-1、-2……），不 taskkill 旧进程、不覆盖旧 exe；安装前用真实文件写入验证目录权限，失败给中文提示 |
| exe 改名 tokeru / Tokeru | package.json name=tokeru；Cargo package name=tokeru；tauri productName=Tokeru、mainBinaryName=tokeru；安装目录与快捷方式均指向 tokeru.exe |
| 不再内置专四样卷 | 删除 data/seed/tem4_2016.json、data/media/tem4-2016.mp3、main.rs 的 seed_if_empty 调用；全新库启动为 0 卷 0 题；samples/2024-math-ii.json/.md 仅作为手动导入样例 |
| 排版高对比 / 取消浅色底 | PaperStyle 增加 contrast=normal/high；高对比覆盖 --surface-2 透明与线/文字/强调色；说明、材料、答案的浅底在 high 下移除 |
| AI 清洗结果预览带样式 | 导入第二步新增「校验表格 / 原卷预览」双 tab，原卷预览用 PaperDoc 渲染 |
| 清洗结果可让 AI 继续改 | AI 修改弹窗读取当前 JSON + 最近 4 次要求，去代码围栏后重新 preview_import 校验，可回退上一版 |
| 无分数练习自定义总分 | ai_plan_scores 读取题号/题型/题干，按总分让模型给分，normalize_score_plan 等比缩放到总和；apply_score_plan 写 questions.points 并同步进行中 attempts/answers |
| AI 主观题判卷 | ai_grade_attempt 只挑已作答且未判的主观题（最多 60 道），返回 score/comment，写 answers.score/max_score/graded_by/comment 并重算总分；客观题仍走本地规则 |
| 标签拖不动 / 不能删 | 标签固定栏 + 自定义栏；TagBoard 用 window Pointer Events 修复 portal 内拖拽；× 删除带确认；delete_tag 命令 |
| 标签筛选只筛固定学科 | 同栏内 OR、不同栏 AND，未选栏不限制；题目与试卷标签都参与命中；速查页按「学科：数学」带颜色显示 |
| 首页删除试卷 | 试卷卡垃圾桶 + 二次确认，删卷同时删题目、练习记录与错题；delete_set 命令 |
| 考试顶栏占空间 | Shell 对 /exam 隐藏整条 topbar；ExamPage 只保留单行标题栏（返回、标题、已答、栏开关、排版、主题、计时、交卷），根高 100dvh |
| 左上角不要「考试工作台」 | 考试路由不再渲染 Shell topbar，标题栏只显示试卷名 |
| 主题切换放标题栏 | ThemeMenu 组件，考试标题栏 compact 版直接切换主题/明暗 |
| 不添加冗余说明 | 3.5 新增控件只保留操作与状态，不写解释段落 |

## 安装器设计

- 关键文件：Tokeru/src-tauri/nsis/installer-hooks.nsh、Tokeru/src-tauri/tauri.conf.json。
- PREINSTALL：从 app-版本号 开始，用数字后缀循环找未被占用的目录；CreateDirectory 父/子目录；SetOutPath；FileOpen 写 .tokero-write-test 验证真实写权限；失败时静默 Abort、GUI 弹中文提示。
- 同一目录内旧 tokeru.exe/tokero.exe 先改名为 .bak，不删除运行中的旧进程；POSTINSTALL 把开始菜单与桌面快捷方式重定向到本次 $INSTDIR\tokeru.exe；PREUNINSTALL 清理 .bak。
- 不再联网下载 WebView2（webviewInstallMode=skip），Windows 10/11 自带运行时。
- 注意：旧版本目录不会自动删除，安装多个版本后会并列保留；用户可自行卸载/清理。这是为了避免非管理员覆盖安装失败而做的取舍。

## 关键实现

- 原卷：src/lib/paper.ts 的 PaperStyle / paperCssVars；src/components/PaperView.tsx 的 PaperDoc/PaperSection；材料题组只渲染一次共享材料，题干支持 {{blank:31}} 与 {{blank:31|兜底}}，旧式 (31) ______ 继续兼容。
- 标签：src/pages/BankPage.tsx 按 TagGroup 分组筛选；src/components/TagBoard.tsx 拖拽与删除；后端 delete_tag/delete_tag_group。
- 导入：src/pages/ImportPage.tsx 第一步选择/拖入/粘贴；src/lib/importPrompt.ts 的提示词已去掉 TEM4 示例；AI 修改走 api.aiComplete + previewImport。
- 评分：src-tauri/src/commands.rs:404 ai_plan_scores、:500 apply_score_plan、:545 ai_grade_attempt；src/lib/api.ts 对应命令。
- 判卷数据：answers.comment 迁移与 repo 映射；ResultPage 的 AI 判卷按钮、已判状态与评语样式。
- 考试：src/pages/ExamPage.tsx 单行标题栏；src/components/Shell.tsx 对考试路由隐藏 topbar；src/components/ThemeMenu.tsx。

## 验证

- pnpm exec tsc --noEmit：通过。
- pnpm build：通过（1937 modules；pdf worker 1.26 MB，主包 1.27 MB）。
- cargo test：8 passed（导入解析 4 + 分值归一化 3 + Windows 字体枚举 1）；cargo build 只有 seed_if_empty 未使用的 warning。
- 全新数据目录启动：list_sets=[]，首页显示 0 份试卷 / 0 道题 / 0 次练习，确认无内置样卷。
- 非管理员安装：当前进程为 Medium Mandatory Level（Administrators deny-only），旧 3.4.4 进程运行中，setup /S 退出 0、约 1.5 秒，安装到 app-3.5.0，快捷方式指向新 exe，旧进程未被结束。
- 真实 AI（用户库副本）：ai_test ok=true、model=deepseek-flash、1154 ms；ai_plan_scores 47 题总分 150，原始合计 220 等比调整为 150；apply 后 total_points=150；ai_grade_attempt graded=2、有中文评语。已修复当时 max_score=34 的问题（改为按 question_ids_json 求和 questions.points）。
- 视觉测试：ai_test 的 vision 分支发送真实 1x1 PNG data URI，不再用纯文本假阳性。

## 已知限制

- 真实视觉模型未在本机验收；自动分图用 mock 视觉端点验证了 PDF 渲染、框解析、裁剪、写回题干。
- 前端仍无单元测试；验收依赖 tsc、vite build、Rust 测试与真机 E2E。
- 安装器是并列版本安装，不是原地升级；旧版本目录会保留。
- PDF 中的矢量公式图无法自动分离，视觉模型给框的准确率取决于模型和清晰度。
- 未内置 LaTeX 编辑器：题干/材料按 Markdown + 受限 HTML 渲染，数学公式建议用图片或 Unicode；后续可再评估 KaTeX。
- 系统字体只支持 Windows；超过约 5.6 MB 的自定义字体只在当前会话生效。

## 本机签名

- 3.5.0 交付物使用本机自签名代码签名证书：Subject `CN=Tokeru, O=Tokeru, C=CN`，SHA-1 `9F74324389BD46A7D098B6B05F18C060470AFF2A`，有效期 5 年。
- 证书已导入 `CurrentUser\Root` 与 `CurrentUser\TrustedPublisher`；本机打开 setup 不再弹出「未知发布者」。`signtool verify /pa` 返回 Valid；未加时间戳。
- 已签：安装包、`release/tokeru.exe`、便携包内 `Tokeru.exe`、已安装的 `tokeru.exe` 与 `uninstall.exe`。
- 证书只在当前 Windows 用户下受信任；换机器、换用户仍会提示未知发布者。自签名不适合对外正式分发；正式分发需要受信任的代码签名证书。
- 重新构建后签名会丢失，需要重新执行：`signtool sign /fd SHA256 /sha1 9F74324389BD46A7D098B6B05F18C060470AFF2A /s My <file>`；也可以运行 `Tokeru/tools/sign-local.ps1`。

## 交付物

- 安装包：Tokeru/src-tauri/target/release/bundle/nsis/Tokeru_3.5.0_x64-setup.exe（4,716,672 B，SHA-256 `74af016a9bd568d18f1f6e84df64218d97b7e5a9fe9f4df9722621e8b427a7e2`）
- 便携 exe：Tokeru/src-tauri/target/release/tokeru.exe（16,138,696 B，SHA-256 `43f7a49c7213f47548864a96c7d0061a4a2a9742e234405246c2e8ca2a04be24`）
- 便携包：Tokeru/dist-portable/Tokeru_3.5.0_x64_portable.zip（6,064,793 B，SHA-256 `94427a19f7fc23978911f3633973a2978018c6cd64cc960cdb6b4856ade71386`）
- 便携包内 Tokeru.exe 与 release/tokeru.exe 哈希一致（16,138,696 B）。
- 源码与文档：Tokeru/README.md、Tokeru/RELEASE-3.5.md、Tokeru/../SOURCE-MAP.md、Tokeru/SOURCE-REPORT.md

> 安装包和 exe 已做本机自签名，本机不再提示未知发布者；复制到其他电脑仍会提示。
