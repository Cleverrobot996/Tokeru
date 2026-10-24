# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Changed

- 主分支许可证从 Apache-2.0 切换到 AGPL-3.0-only；已发布的 v0.0.1 保持发布时的许可证。

## [0.1.0] - 2026-10-24

### Added

- 数学公式：题干、选项、材料与解析支持 TeX 定界符，用 KaTeX + mhchem 渲染；原始 TeX 存库，渲染结果不写回数据。长公式溢出时横向滚动。
- GFM 管道表格渲染，单元格内公式同样生效。
- MCP 新增 library、questions、edit 三个领域工具，支持导出试卷/题库、批量读题、修改材料/分区与删除试卷；MCP 工具总数为 22。
- 设置页「获取模型」：通过 DeepSeek、OpenAI 兼容、Anthropic 兼容、Ollama、阿里云百炼的模型列表接口拉取模型。
- 设置页「复制配置」生成可直接粘贴给客户端的 MCP JSON。
- 富文本单元测试：行内/块级公式、纯数字公式、表格、单元格公式。

### Changed

- 导入回退为单一程序入口：只提取 PDF/Markdown/TXT/JSON 文本并复制清洗提示词；移除导入内的 AI 清洗与自动分图。自动分图只保留在「速查与整理」。
- 导入页支持整窗拖放；复制/预览提示词在空材料时也可用。
- AI 提供商收敛为 DeepSeek、OpenAI 兼容、Anthropic 兼容、Ollama、阿里云百炼；思考模式按「整理与判卷 / 视觉分图 / 答案讲解」分别控制。
- Anthropic 兼容服务走 /v1/messages 与 x-api-key；视觉模型可使用独立地址。
- 答案解析入口改为「简要解析 / 详细解析」，简要解析不再强制一句话。
- 纸宽设置真正生效：页面按 min(100%, 纸宽) 排版，设置页预览可横向滚动查看完整纸宽；打印恢复全宽。

### Fixed

- 纯数字公式（如 $0$、$2$）被误判为货币而不渲染。
- 视觉连接测试使用纯文本请求导致误报通过。
- 速查/题库/打印中纸宽被容器与 max-width:none 覆盖。

## [0.0.1] - 2026-10-24

首个公开版本。

### Added

- Windows 桌面版：Tauri 2 + React 19 + Rust + SQLite，本地优先。
- PDF / 图片 / Markdown / TXT / JSON 导入，AI 清洗、视觉 OCR 与自动分图。
- 原卷排版、共享材料、行内空位、高对比与字体/字号/行高/纸宽调节。
- 题库标签栏、详细/简要模式、练习记录、错题本与 AI 判卷。
- 内置 MCP Server（默认只读、仅监听 127.0.0.1）。
- NSIS 安装包与 GitHub Actions 发布流程。

[Unreleased]: https://github.com/Cleverrobot996/Tokeru/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Cleverrobot996/Tokeru/releases/tag/v0.1.0
[0.0.1]: https://github.com/Cleverrobot996/Tokeru/releases/tag/v0.0.1
