# 巡检报告（摘要）

> 完整版：[../QA.md](../QA.md)。初检 2026-10-22 23:04，复核 23:17，最终包复验 23:21；浏览器 1600/1280/1024 + 深色，36 张截图。

## 机械项
console error 0 · failed request 0 · 横滚 0 · 原生控件 0 · 内联色 0 · 错误遮罩 0。

## 最终状态（23:21 最终包）
- 15 项：**14 ✅ / 1 部分 ✅（⑬ 拆出题数据未实测）**，无 ❌。
- P1/P2 全关档：P1-A「解」字按产品判断保留（非缺陷）；P1-B 听写框、P2-A 顶栏页名、P2-B createAttempt 已修复并复核（P2-B 最终包真机：连进两次仅 1 条 in_progress、answers 0 条）。
- P3 全修复：P3-A 答案去重、P3-B 暗色对比、P3-C 设置文案（final3-settings.png 已确认）。

## 已修复清单（供最终包核对）
1. P1-B 1280 听写框：clientHeight = scrollHeight = 114（原 74/114）。
2. P2-A 顶栏页名：Shell.tsx topbarLabel，仅考试工作台保留。
3. P2-B createAttempt：resume_attempt + ExamPage.tsx:57-74；mock 三次进入 attempts 恒 5、in_progress 恒 2，草稿保留。
4. P3-A 答案重复：`#/sets/1/answers`「也可接受」0 次。
5. P3-B 暗色「全选」对比 6.48 / 8.96:1。
6. P3-C 设置文案收敛：SettingsPage.tsx:206/:219 各一行，final3-settings.png 确认。

## 历史观察（非回归）
早期 exam.css 未生效时 1280 下 scrollWidth 1323；样式到位后复测 docSW=1280、无越界（探针 `tools/steps/qa-overflow.mjs`）。
