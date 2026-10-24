# Tokeru 0.1.2

缺陷报告审核后的 P0/P1 修复版：判分答案归一化、AI 判卷按题目 ID 匹配、整卷恢复按模式、备份与恢复重做。

## 交付物

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `Tokeru_0.1.2_x64-setup.exe` | 6,831,446 B | `41aae829b916b9946af2b0795f3f12bfe28dff1a0b81f576549726cac2bef695` |
| `Tokeru_0.1.2_x64_portable.zip` | 8,707,996 B | `8e6faf67bf1e5555bbf3bf94716b14ddf1fde4f7a2386e921801aa57b4eb97f3` |
| `tokeru.exe`（release / 便携） | 22,519,808 B | `33a25dbd588119d145906ce514fcf879e3c85b9f56f495356800bc48ff9e4226` |

安装版按当前用户安装到 `%LOCALAPPDATA%\Tokeru\app-0.1.2`，旧版本目录保留；卸载不会删除 `%APPDATA%\com.tokero.app` 中的数据。安装包与 exe 均未签名。

## 修复

- **AI 判卷串题**：请求与解析改用题目 ID 作稳定键；跨卷错题复习、同卷重复题号不会再共用同一个判分结果。模型只返回题号时，仅在题号唯一时采用。AI 给出部分分时 `is_correct=-1`，不再显示为答错。
- **导入答案**：字符串选项 `"ACD"`、`"A,C"`、`"A、C"` 拆成独立选项，多选顺序无关；判断题把 对/错/√/×/true/false/yes/no 统一成 T/F，本地判分和 AI 判分读同一套答案。布尔答案同样转为 T/F。
- **整卷恢复**：`resume_attempt` 按练习模式过滤，整卷入口只接整卷记录，不会接到同卷的自选练习。
- **备份不含密钥**：备份后清理 `api_key`、`deepseek_api_key`、`mcp_token`，备份文件可安全外传。
- **恢复完整**：覆盖 13 张表（含标签、标签栏、导入批次），按列名复制，不再依赖表内列顺序；缺失表、SQL 失败会回滚并返回具体错误；只允许恢复 `backups` 目录内的 `.db`，恢复后保留本机当前 Key 与 Token。
- **恢复入口**：设置页「数据与备份」新增备份列表与恢复按钮，恢复后刷新题库、试卷、标签、记录、错题与设置缓存。

## 验证

- `pnpm exec tsc --noEmit`、`pnpm exec vitest run`（1 文件 / 6 用例）通过。
- `cargo test`：15 passed（新增选项拆分、判断题 T/F、字符串答案导入用例）。
- 非管理员静默安装 exit 0（2.0 s），注册表 `DisplayVersion=0.1.2`、`InstallLocation=%LOCALAPPDATA%\Tokeru\app-0.1.2`；安装版与便携版均能启动到设置页。
- 备份实测：备份文件含 13 张表、2 份试卷 / 49 题，`api_key`、`mcp_token` 为空；删除一份试卷后通过设置页恢复，试卷与 49 题回来，两个密钥仍是恢复前本机的值。
- 真实 AI 模型下的判卷与部分分行为未在本机构造完整模型调用；选项归一化与判分由单元测试覆盖。

## 文件

- 变更：`CHANGELOG.md`
- 源码地图：`docs/SOURCE-MAP.md`
- MCP：`docs/MCP.md`
- 第三方声明：`THIRD_PARTY_NOTICES.md`
