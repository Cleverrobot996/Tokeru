# Tokeru 3.4.3

3.4.3 只改安装器与启动清理，应用功能与 3.4.2 / 3.4 相同。目标是解决“旧版 Tokeru 还在运行、覆盖安装仍失败”的问题：用户实测 3.4.2 在安装页仍会弹出 `Error opening file for writing: C:\Users\...\AppData\Local\Tokeru\tokero.exe`，随后 `Installation Aborted / Can't write`；中文日志为“无法删除旧版 tokero.exe：文件被其他程序占用”。

## 根因

3.4.2 的 preinstall 已经会：

- 连续两次 `taskkill /F /T /IM tokero.exe`
- 删除旧 `tokero.exe`，最多 20 次
- 直接试写目标 exe 与安装目录
- 失败时给中文提示

但“结束进程 + 删除”这条路有一个前提：taskkill 真的能结束 Tokeru，且旧文件句柄已经释放。实际 Windows 上可能遇到：

1. 旧 Tokeru 以更高权限运行，或安装器的子进程权限/完整性级别不同，taskkill 被拒绝；
2. 杀毒软件实时扫描持有 `tokero.exe` 的句柄，Delete 一直失败；
3. 资源管理器 / 预览 / 其他进程短暂持有文件。

这种情况下旧 exe 既删不掉、也覆盖不了，NSIS 的 `File` 阶段就会报 `Error opening file for writing`。3.4.2 只覆盖了“能结束进程”的路径，没有“结束不了”的退路。

## 修复

### 安装器：改名回退

`src-tauri/nsis/installer-hooks.nsh` 的 `NSIS_HOOK_PREINSTALL` 在原有“taskkill → 删除 → 试写”之后新增：

1. 删除 20 次仍失败时，尝试把 `$INSTDIR\tokero.exe` **改名**为：
   - `tokero.exe.old`
   - 若已存在，依次尝试 `tokero.exe.old1` … `tokero.exe.old9`
2. 正在运行的 exe 在 Windows 上通常**允许改名、不允许删除/覆盖**，所以这一步通常能成功；
3. 改名成功后，NSIS 可以写入全新的 `tokero.exe`，旧进程继续从改名后的文件运行，不影响安装；
4. 如果改名也失败，给出中文提示并 Abort，不再只抛 NSIS 英文错误；
5. 安装完成后 `NSIS_HOOK_POSTINSTALL` 尝试删除 `.old` 系列；卸载前 `NSIS_HOOK_PREUNINSTALL` 也会清理。旧进程还活着时 Delete 会静默失败，不影响新版本。

安装日志会明确显示：

```text
Tokeru: 旧版 exe 正在运行，已改名为 C:\Users\...\Tokeru\tokero.exe.old，继续写入新版本。
```

### 应用启动清理

`src-tauri/src/main.rs` 新增 `cleanup_old_binaries()`：

- 启动时遍历 exe 同目录，删除文件名以 `tokero.exe.old` 开头的文件；
- 旧进程已经退出后，下次启动就会把残留的 `.old` 清掉；
- 删除失败只忽略，不影响启动。

这也是为什么“安装时旧进程还在、安装后马上看还有 .old”是正常的：旧进程退出后，下一次启动 Tokeru 会清理。

## 非点击验证

用户要求不点击安装窗口，以下全部通过命令行静默 `/S` 完成。

| 场景 | 结果 |
| --- | --- |
| 无进程 + 已有安装目录，静默安装 | exit 0，约 9.5s；注册表 DisplayVersion=3.4.3，启动后 ProductVersion=3.4.3 |
| 旧 3.4.2 运行中，正常 taskkill 可结束 | exit 0，约 8.6s；旧进程被结束，没有 `.old` |
| 旧版运行中 + 模拟 taskkill 失败（setup 同目录放 stub `taskkill.exe`） | exit 0，约 18.8s；旧进程仍存活；生成 `%LOCALAPPDATA%\Tokeru\tokero.exe.old`；新 `tokero.exe` 已是 3.4.3 |
| 旧进程退出后启动 3.4.3 | 启动清理删除残留 `.old`；窗口标题 Tokeru，Responding=True |
| 安装版启动 smoke | 窗口正常，MainWindowTitle=Tokeru，Responding=True |
| 测试安装窗口 | 未点击；全部为静默安装 |

改名回退的关键证据是第 3 行：taskkill 被 stub 挡住、旧 PID 仍存活的情况下，安装仍然成功，旧文件变成 `.old`，新文件版本为 3.4.3。

## 交付物

- 安装包：`src-tauri/target/release/bundle/nsis/Tokeru_3.4.3_x64-setup.exe`
  - 71,209,059 B
  - SHA-256 `c531602c9d66a744f17bda9ad71ba5ba84488ac7f0786085cb81a751c45971f7`
- 安装后 exe：`%LOCALAPPDATA%\Tokeru\tokero.exe`
  - 16,011,264 B
  - SHA-256 `87bc87f5a50f1d9889d678b0f8c36a50857fac0354442c2a927d545df563c03a`
- 干净便携 exe：`src-tauri/target/release/tokero.exe`
  - 16,011,264 B
  - SHA-256 `332881a94b7a7e9715a0da4ddfc5d8843307cc1ae13cd1cb70e6cb1fcb4f24ae`
- 便携包：`dist-portable/Tokeru_3.4.3_x64_portable.zip`
  - 72,592,040 B
  - SHA-256 `36e027a3293248114b1ddf038f50f66b45b3c9ecce6d4261ff908f835fa344b7`

便携包内的 `Tokeru/Tokeru.exe` 与干净便携 exe 哈希一致。

## 已知限制

- 安装包未签名，Windows 可能提示“未知发布者”。
- 安装器不联网下载 WebView2（`webviewInstallMode: skip`）；Windows 10/11 一般自带，确实缺失时需先装 Edge WebView2 Runtime。
- 改名回退要求安装目录允许 Rename；如果旧 exe 被安全软件以独占方式锁死，连改名也失败，安装器会显示中文提示，需临时关闭实时扫描或重启。
- 旧进程继续运行时，系统里会短暂同时存在“旧进程 + 新 exe”；旧进程退出后下次启动走新版本，残留 `.old` 会被启动清理删除。
- 3.4.3 没有新增应用功能；3.4 的 E2E 证据见 `docs/RELEASE-3.4.md`。
