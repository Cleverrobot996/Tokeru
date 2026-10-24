# 第三方声明

Tokeru 以 **AGPL-3.0-only** 发布。完整许可见 [LICENSE](LICENSE)，对应源码见
<https://github.com/Cleverrobot996/Tokeru>。

## 随应用分发的依赖

| 组件 | 用途 | 许可 |
| --- | --- | --- |
| React / React DOM | 界面 | MIT |
| Tauri | 桌面壳与 IPC | MIT / Apache-2.0 |
| KaTeX | 数学公式渲染 | MIT |
| pdfjs-dist | PDF 文本与页面解析 | Apache-2.0 |
| react-markdown / remark-gfm / rehype-sanitize | Markdown 与表格渲染 | MIT |
| Radix UI | 基础控件 | MIT |
| lucide-react | 图标 | ISC |
| TanStack Query / React Router / Sonner / motion / clsx | 前端基础库 | MIT |
| Rust crates（rusqlite、serde、tokio、rmcp 等） | 后端 | 以 Cargo.lock 中各 crate 的许可以及 crates.io 页面为准 |

KaTeX 字体随 katex/dist 一起打包，许可同 KaTeX（MIT）。应用不分发 Windows 系统字体。

## 参考过设计的项目

以下项目与本项目同为 AGPL-3.0，实现时只参考了机制，没有复制其源代码：

- **思源笔记（SiYuan）**：原始 TeX 与渲染结果分离、公式溢出处理、领域化 MCP 工具（action 枚举）。
  <https://github.com/siyuan-note/siyuan>
- **BabelDOC / PDFMathTranslate**：公式占位与自适应排版思路；Tokeru 不内置 PDF 排版引擎，PDF 处理交给外部 Agent/MCP。
  <https://github.com/funstory-ai/BabelDOC>
  <https://github.com/PDFMathTranslate/PDFMathTranslate>

如果后续移植了上述项目的具体代码，必须在本文件登记来源文件、版权声明与修改内容，并继续遵守 AGPL-3.0。
