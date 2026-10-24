# 贡献指南

Tokeru 是 Windows 本地优先的练习应用。提交代码、文档或 Issue 前，先读 [README](README.md) 和 [AGENTS.md](AGENTS.md)。

## 环境

- Windows 10/11、WebView2 Runtime
- Node.js 22+、pnpm 10+
- Rust stable
- Visual Studio Build Tools，含「使用 C++ 的桌面开发」

## 开发

```powershell
pnpm install
pnpm tauri dev
```

只改前端时可以运行 `pnpm dev`，浏览器预览走 `src/lib/mock.ts`，不写 SQLite。

## 提交前检查

```powershell
pnpm exec tsc --noEmit
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
```

涉及 Rust 命令或数据库时再加：

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

## Pull Request

- 一个 PR 只做一件事；不要把前端页面、Rust 命令和安装器混在一个提交里。
- 关联对应 Issue，说明「改了什么 / 为什么」。
- 附上验证命令与结果；UI 改动附截图。
- 不提交 `node_modules`、`dist`、`dist-portable`、`src-tauri/target`、本地数据库或 `tools/shots` 过程截图。
- 不提交 API Key、Token、`.env`、证书或带本机路径的日志。
- AI 生成的代码由提交者负责验证；AI 实际参与时，可加 `Co-authored-by: 名称 <邮箱>` 尾注。

## 提交信息

建议使用 `type: 摘要`，类型包括 `feat`、`fix`、`docs`、`refactor`、`test`、`chore`。示例：

```text
docs: 规范化 README 与协作文件
fix: 修复导入预览空材料报错
```

## 报告问题

- Bug 用 [Bug 报告](https://github.com/Cleverrobot996/Tokeru/issues/new?template=bug_report.yml)。
- 功能建议用 [功能建议](https://github.com/Cleverrobot996/Tokeru/issues/new?template=feature_request.yml)。

## 许可证

贡献的代码与文档按 [GNU Affero General Public License v3.0](LICENSE) 授权。
