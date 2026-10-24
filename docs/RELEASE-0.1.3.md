# Tokeru 0.1.3

MCP 只读开关修复版：开关切换后立即生效，已经建立的 MCP 连接也会按当前设置决定是否允许写入。

## 交付物

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `Tokeru_0.1.3_x64-setup.exe` | 6,833,912 B | `dc0143351d4322a3f0c99e1fe381e0a1b1e69781fb106ba105e5387bcf4b8070` |
| `Tokeru_0.1.3_x64_portable.zip` | 8,701,329 B | `e595c9c5a0db78888624f6aa3366c8578f1966be1a500ee455effa8c477e77a2` |
| `tokeru.exe`（release / 便携） | 22,525,440 B | `81068d5e27d0f1630b599d27c413fb5dc7c028ff80937fdbdd95366412d4d456` |

安装版按当前用户安装到 `%LOCALAPPDATA%\Tokeru\app-0.1.3`，旧版本目录保留；卸载不会删除 `%APPDATA%\com.tokero.app` 中的数据。安装包与 exe 均未签名。

## 修复

- **只读开关不生效**：MCP Server 不再在启动时把只读状态复制进连接处理器；每次写操作都从 settings 读取当前值，已经连接的客户端无需重连。
- **状态显示**：设置页运行中显示 settings 表的只读状态，不再被服务启动时的旧快照覆盖。
- **不必要重启**：单独切换只读不再重启监听；只有启用状态、端口或 Token 变化时才重启。

## 验证

- `pnpm exec tsc --noEmit`、`pnpm exec vitest run`（1 文件 / 6 用例）通过。
- `cargo test`：17 passed（新增 2 个只读默认值与动态读取用例）。
- 实测：测试库 `mcp_readonly=1` 时同一 MCP 会话写操作被拒；在设置页关闭只读后，同一会话立即越过只读检查（返回“题目不存在”，目标题目为不存在的 -1）；再打开只读后，同一会话立即恢复只读错误。整个过程 MCP 端口未变化。
- 非管理员静默安装 exit 0，注册表 `DisplayVersion=0.1.3`、`InstallLocation=%LOCALAPPDATA%\Tokeru\app-0.1.3`；安装版与便携包均能启动，窗口标题 Tokeru。
- 真实 AI 模型与真实外部 MCP 客户端未在本次回归中重新构造；只读行为由单元测试与本地 Streamable HTTP 会话覆盖。

## 文件

- 变更：`CHANGELOG.md`
- 源码地图：`docs/SOURCE-MAP.md`
- MCP：`docs/MCP.md`
- 第三方声明：`THIRD_PARTY_NOTICES.md`
