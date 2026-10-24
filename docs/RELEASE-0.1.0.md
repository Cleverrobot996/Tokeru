# Tokeru 0.1.0

首个公开版本之后的第一个功能版本：公式与表格、单入口导入、五家 AI 提供商、MCP 领域工具、纸宽修复。

## 交付物

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `Tokeru_0.1.0_x64-setup.exe` | 6,809,568 B | `8a96b3a41d919eaa7423c52f187811cce221657567cd951020b2c2043ce1b719` |
| `Tokeru_0.1.0_x64_portable.zip` | 8,669,889 B | `ffd7b4d421cfa6840de788a9f2cb54190c83e2b4c32ca528c7b4cca65360795b` |
| `tokeru.exe`（release / 便携） | 22,417,336 B | `812a4be91f02864bf8fbedda4f2b451de76d41f8c22533d20efc9120c8d5909c` |

安装版按当前用户安装到 `%LOCALAPPDATA%\Tokeru\app-0.1.0`，旧版本目录保留。卸载不会删除 `%APPDATA%\com.tokero.app` 中的数据。

## 验证

- `pnpm exec tsc --noEmit`、`pnpm build`、`cargo test`（11 passed）通过。
- 非管理员静默安装 exit 0；注册表版本、开始菜单/桌面快捷方式指向新目录。
- 安装版与便携版均启动到首页，空数据目录显示 0 份试卷、0 道题、0 次练习。
- 真实 DeepSeek Key 测试连接通过；MCP 22 个工具完成读、写、导入、删除冒烟。
- 数学卷 `MCP 数学测试卷` 验证 KaTeX、GFM 表格、解析与答案公式渲染。

## 说明

- 安装包与便携 exe 使用本机自签名证书签名；发行商显示为 Tokeru，但自签名不积累 SmartScreen 信誉，正式发布应换受信任证书。
- 安装后的 `tokeru.exe` 是构建产物，未单独签名。
- 导入页不再内置 AI 清洗或自动分图：程序只提取文本，清洗交给外部 AI/MCP；自动分图在「速查与整理」。
- 公式以原始 TeX 存储，KaTeX 只负责显示；图形仍需题图。
- 安装包放在约 120 字符的中文长路径下可能无提示退出；从下载目录或桌面短路径运行正常。

## 文件

- 变更：`CHANGELOG.md`
- 源码地图：`docs/SOURCE-MAP.md`
- MCP：`docs/MCP.md`
- 第三方声明：`THIRD_PARTY_NOTICES.md`
