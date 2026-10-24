# Tokeru 3.4.2

3.4.2 只改安装器，应用功能与 3.4.1 / 3.4 相同。目标是修掉覆盖安装时的两类问题：

1. 旧 `tokero.exe` 仍被占用时，NSIS 在 File 阶段报 `Error opening file for writing`。
2. 安装日志里出现 `错误: 没有找到进程 "tokero.exe"`，看起来像安装失败，其实只是 taskkill 在没有旧进程时的正常提示。

## 根因

第一版 3.4.2 为了“只在有旧进程时才 taskkill”，在安装器里用 `tasklist | findstr` 判断进程。本机测试发现 NSIS 子进程读到的是 **Low Mandatory Level**，它看不到同时运行的 Tokeru（外部 tasklist 能看到）；于是判断为“没有进程”，跳过 taskkill，随后覆盖被锁定的 exe 就失败。

另外，把 taskkill 的输出直接写进安装日志，会在没有旧进程时显示“错误: 没有找到进程”，容易被误认为安装失败。

## 修复

`src-tauri/nsis/installer-hooks.nsh` 的 `NSIS_HOOK_PREINSTALL` 改为：

- 清除 `tokero.exe` 的只读属性。
- 用 `nsExec::ExecToStack` 连续执行两次 `taskkill /F /T /IM tokero.exe`，每次等待 1.2 秒；**输出只进栈，不写安装日志**。
- 删除旧 `tokero.exe`，最多重试 20 次（每次 500ms）。
- 删除后直接 `FileOpen "$INSTDIR\tokero.exe" a` 试写目标文件，再关闭并删掉试写产生的空文件。这个检查比“FileExists 为假”可靠：Windows 可能已标记删除但句柄还没释放，NSIS 的 `File` 仍会失败。
- 对安装目录做一次 `.tokero-write-test` 写入测试。
- 任何一步失败都给中文 MessageBox，提示关闭 Tokeru（包括便携版）、检查杀毒软件/权限或重启，而不是让 NSIS 抛英文错误。

不再用 `tasklist` 判断进程，也不再无条件把 taskkill 输出写进日志。

## 非点击验证

用户要求不得点击安装窗口；以下都通过命令行 / CDP 完成：

| 场景 | 结果 |
| --- | --- |
| 无进程 + 已有安装目录，静默 `/S` | exit 0，安装后版本 3.4.2 |
| 先启动已安装 3.4.2，再静默 `/S` 覆盖 | exit 0，旧 tokero 进程被结束，安装后版本 3.4.2 |
| 安装版启动 smoke | CDP 连接 `http://tauri.localhost/`；首页/题库正常；控制台无错误、无失败请求 |
| 安装后 exe 子系统 | PE Subsystem = 2（Windows GUI），启动不附带控制台 |

安装测试在 ASCII 临时路径执行（把 setup 复制到 `%LOCALAPPDATA%\Temp\Tokero342.exe`），避免中文项目路径被 Git Bash / start 改写。安装窗口没有被点击。

## 交付物

- 安装包：`src-tauri/target/release/bundle/nsis/Tokeru_3.4.2_x64-setup.exe`
  - 71,212,851 B
  - SHA-256 `2d877dbe526f210438e984cba223caaf5392dd21bca2db7ca11c9e9d84585966`
- 安装后 exe：`%LOCALAPPDATA%\Tokeru\tokero.exe`
  - 16,061,952 B
  - SHA-256 `0e5a5307b980974b3c1032382786e62b54bc915e027e06baa0ea2c7a3e5abc3f`
- 干净便携 exe：`src-tauri/target/release/tokero.exe`
  - 16,061,952 B
  - SHA-256 `68d02b49662e371a5e7a265851db35c81e845d35df9a991b4f7666d79114716c`
- 便携包：`dist-portable/Tokeru_3.4.2_x64_portable.zip`
  - 72,599,757 B
  - SHA-256 `867456e1d46c5e13df9b8466c0c906503c076425f7abb317be3f26753948d22c`

## 已知限制

- 安装包未签名，Windows 可能提示“未知发布者”。
- 安装器不联网下载 WebView2（`webviewInstallMode: skip`）；Windows 10/11 一般自带，确实缺失时需先装 Edge WebView2 Runtime。
- 如果旧 Tokeru 以更高权限运行、被杀毒软件保护，或安装目录本身不可写，安装器无法强行覆盖；此时会显示中文提示，需手动退出 Tokeru / 检查权限 / 重启后重试。
- 3.4.2 没有新增应用功能；3.4 的 E2E 证据见 `RELEASE-3.4.md`。
