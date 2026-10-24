# Tokeru 3.4.1 安装修复

2026-10-23。3.4.1 只修安装/覆盖安装，不改 3.4 的功能与数据格式。

## 1. 问题

安装 3.4.0 时，NSIS 在写入主程序阶段报：

```text
Error opening file for writing:
C:\Users\19646\AppData\Local\Tokeru\tokero.exe
```

随后 `Installation Aborted`。用户自行卸载后重装仍失败。这个错误来自 NSIS 的 `File` 指令，说明旧 `tokero.exe` 仍被占用，或文件处于“已标记删除但句柄未释放”的状态，安装器拿不到写权限。

## 2. 根因

- 旧版 Tokeru 还在运行（包括托盘/后台进程），Windows 锁住 exe。
- 旧 preinstall 钩子只做了一次 `taskkill`、一次 `Sleep 800` 和固定次数的 `Delete`；如果进程退出较慢，或文件进入 delete-pending，`FileExists` 可能为假，但 NSIS 随后仍写不进去。
- 机器上同时有 Kaspersky、腾讯电脑管家、Windows Defender 实时防护，安全软件也可能短暂锁定新写入的 exe。
- 用户手上可能还有 3.2/3.3 的旧安装包；旧包的钩子没有等待进程真正退出。

## 3. 修复

### 3.1 安装器 preinstall 钩子

文件：`src-tauri/nsis/installer-hooks.nsh`

- 对 `$INSTDIR\tokero.exe` 先 `SetFileAttributes NORMAL`，清掉只读/隐藏属性。
- `taskkill /F /T /IM tokero.exe`，连子进程一起结束；Windows 的 `/IM` 不区分大小写，同时覆盖 `Tokero.exe`。
- 用 `tasklist /FI "IMAGENAME eq tokero.exe" /NH | find /I "tokero.exe"` 轮询，最多 40 次 × 500ms，确认进程真的退出；仍存活则中文 MessageBox + `Abort`。
- 再次清属性并 `Delete` 旧 exe，最多 20 次 × 500ms；删不掉则提示“文件被其他程序占用”，不再拖到 NSIS `File` 阶段报英文错误。
- 写入 `.tokero-write-test` 验证安装目录可写；再写入 `.tokero-write-test.exe` 验证 exe 可写。失败时提示把安装目录加入杀毒软件信任区，或暂时关闭实时扫描。
- 全部通过后才继续安装。

### 3.2 手动清理脚本

文件：`tools/cleanup-before-install.ps1`

- 结束所有 `tokero.exe` 并确认进程消失。
- 删除 `%LOCALAPPDATA%\Tokeru`。
- 删除卸载注册表项（`HKCU\...\Uninstall\Tokeru` / `Tokero`）和 `HKCU\Software\tokero\...`。
- 删除开始菜单快捷方式。
- **不会删除题库/练习记录**；它们在 `%APPDATA%\com.tokero.app`。
- 脚本带 UTF-8 BOM，保证 Windows PowerShell 5.1 能正确解析中文。

## 4. 验证（本机，2026-10-23）

| 场景 | 结果 |
| --- | --- |
| 静默卸载 3.4.0 | `uninstall.exe /S` exit 0；安装目录和卸载注册表项都消失 |
| 干净安装 3.4.1 | 从 ASCII 临时路径 `/S` 安装 exit 0；ProductVersion 3.4.1；DisplayVersion 3.4.1 |
| 覆盖安装（旧版正在运行） | 启动 3.4.1 后 `/S` 安装 exit 0；旧进程被杀，版本仍 3.4.1 |
| 主程序只读 | 钩子清除 `IsReadOnly` 后安装成功；安装后 `IsReadOnly=False`，版本 3.4.1 |
| 清理脚本 | PowerShell 5.1 语法解析 `PARSE_OK`；实际运行 exit 0，删除安装目录/卸载注册表项/开始菜单快捷方式；随后静默安装 3.4.1 成功 |
| 构建 | `pnpm exec tsc --noEmit`、`pnpm build` 通过（1936 modules）；Rust release 编译通过 |

安装器验证遵守“不要点击安装窗口”的要求：全部用 `/S` 静默安装，不点击、不按键。GUI 双击流程未做人工点击验收。

## 5. 交付物

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `src-tauri/target/release/bundle/nsis/Tokeru_3.4.1_x64-setup.exe` | 71,212,207 B | `86f0c5350d09e30f4835829767f079b6145a83aa4b728b0a5574cdbbad196fb7` |
| `dist-portable/Tokeru_3.4.1_x64_portable.zip` | 73,209,277 B | `a2d540e64bbb66f63b0232f22b5b8a1f72ed8b35c4dcb2df219b424de37cb30d` |
| 干净 exe：`src-tauri/target/release/tokero.exe` | 16,060,928 B | `568e6dbc2222cf262ea5821e7f7478c98cdec2cc5a9bc7b1e7380468692004a5` |

说明：`pnpm tauri build --bundles nsis` 会 patch release exe 写入 bundle 信息，所以安装包里的 exe 与“干净 exe”hash 不同；便携包使用的是最后重新 `--no-bundle` 生成的干净 exe（hash 与上表一致）。如果拿到的安装包 hash 不是 `86f0c535...`，说明拿到的是旧包，请重新下载。

## 6. 安装/升级建议

1. 先退出所有 Tokeru，包括便携版和托盘进程。
2. 运行新的 `Tokeru_3.4.1_x64-setup.exe`。
3. 若仍失败，运行 `tools/cleanup-before-install.ps1` 清理旧目录与注册表，再运行安装包。
4. 若安全软件拦截，把安装包和 `%LOCALAPPDATA%\Tokeru` 加入信任区，或暂时关闭实时扫描后再安装。
5. 安装包未签名，Windows 可能提示“未知发布者”，这是预期行为。

## 7. 已知限制

- 安装包仍未代码签名。
- 安全软件（Kaspersky / 腾讯电脑管家 / Defender）仍可能在写入 exe 的瞬间拦截；安装器现在会给出明确提示，但不能替代用户把目录加入信任区。
- 从中文路径用 `Start-Process` 启动安装器在本机曾出现“进程不创建”的现象；本机验证统一先把安装包复制到 ASCII 临时路径。桌面双击安装不受此影响。
- 本轮没有做 GUI 点击验收，只做静默安装、覆盖安装和只读文件场景。
