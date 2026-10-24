# Tokeru 安装包“需要管理员”调研（4.0.0 / 3.5.0 基线）

生成时间：2026-10-24 01:26 +08:00
调查人：qa-shot
工作目录：C:\Users\19646\Desktop\学习与效率工具\折腾\dsh_zone_common\Tokeru
调查对象：现有 `Tokeru_3.5.0_x64-setup.exe` 与生成它的 NSIS 脚本/配置。4.0.0 的版本号已写进配置，但本机尚无 4.0.0 安装包，见 §1.4。
限制：只读调查，不改安装器、不改源码，不运行会落地安装的 setup。文中把“已验证”“待复现”“推测”分开写，不能把推测当结论。

## 0. 一句话结论

**3.5.0 安装器的设计是非管理员安装：manifest 为 asInvoker、生成脚本为 currentUser / RequestExecutionLevel user、只写当前用户 LocalAppData 与 HKCU、快捷方式也放当前用户目录。** 本次还用一个不触发 UAC 的 CreateProcess 探测确认：3.5.0 与 3.4.4 的 setup 都能以当前 Medium integrity 进程直接启动，没有返回 ERROR_ELEVATION_REQUIRED。
**但用户实际看到的“必须管理员”还没有被复现。** 现有本机安装状态也不干净：快捷方式指向的 app-3.5.0-1 目录 owner 是 BUILTIN\Administrators，且里面是未签名的旧构建；不能把这份机器状态当成“非管理员安装已验收”的证据。要定位用户问题，必须拿到实际 setup 的路径/哈希/截图。

---

## 1. 已核对的安装器代码与生成脚本

### 1.1 配置

| 文件 | 行 | 内容 | 说明 |
| --- | --- | --- | --- |
| `src-tauri/tauri.conf.json` | :4 | `"version": "4.0.0"` | 当前配置已是 4.0.0 |
| `src-tauri/tauri.conf.json` | :38-40 | `webviewInstallMode.type = "skip"` | 不下载/不安装 WebView2，不会走需要 admin 的 WebView2 安装分支 |
| `src-tauri/tauri.conf.json` | :43 | `installerHooks: "nsis/installer-hooks.nsh"` | 使用项目自己的安装钩子 |
| `package.json` | version | `4.0.0` | 与 tauri.conf 一致 |
| `src-tauri/Cargo.toml` | version | `4.0.0` | 与 tauri.conf 一致 |

### 1.2 现有生成脚本（仍是 3.5.0 构建）

`src-tauri/target/release/nsis/x64/installer.nsi`：

- :38 `!define VERSION "3.5.0"`；:39 `VERSIONWITHBUILD "3.5.0.0"`。这说明它是 3.5.0 的生成脚本，不是 4.0.0 的。
- :41 `!define INSTALLMODE "currentUser"`。
- :101-106：
  - perMachine 分支才 `RequestExecutionLevel admin`；
  - currentUser 分支 `RequestExecutionLevel user`。
- :521 `!insertmacro SetContext`；`utils.nsh:3-19` 的 SetContext 在 currentUser 时执行 `SetShellVarContext current`，x64 时 `SetRegView 64`。
- :537-538：currentUser 时 `$INSTDIR = "$LOCALAPPDATA\Tokeru"`；随后 `RestorePreviousInstallLocation` 可能读旧路径，但 3.5 的 PREINSTALL 会无条件覆盖 `$INSTDIR`（见 1.3）。
- :698-724：写卸载信息用 `SHCTX`；currentUser 下就是 HKCU。没有写 HKLM。
- :737-747、:910-973：创建当前用户开始菜单/桌面快捷方式；静默安装也创建桌面快捷方式。没有 `$PUBLIC` 公共桌面写入。
- :582-671 WebView2 段：虽然代码存在，但生成脚本 :57 `INSTALLWEBVIEW2MODE ""`、:61 `MINIMUMWEBVIEW2VERSION ""`，所有下载/安装分支都不成立，直接走 `webview2_done`。因此 3.5.0 不会执行 :660 的 `needsadmin=true`。
- :877-879：currentUser 卸载时 `SetShellVarContext current`，删除 `$LOCALAPPDATA\{BUNDLEID}`。

### 1.3 项目自己的安装钩子

`src-tauri/nsis/installer-hooks.nsh`：

- :4 注释明确写“每次安装写入独立的版本目录，绝不覆盖正在运行的旧 exe，因此不需要管理员权限。”
- :9 起始目录 `$LOCALAPPDATA\Tokeru\app-${VERSION}`；:10-25 用 `-1` 到 `-50` 找未占用目录；:26 `StrCpy $INSTDIR $2` 覆盖生成脚本设置。
- :29-31 只创建 `$LOCALAPPDATA\Tokeru` 与版本目录，然后 SetOutPath。
- :37-45 写 `.tokero-write-test`：**失败只 DetailPrint，不 Abort、不 MessageBox，继续安装**。
- :51-56 同目录旧 `tokeru.exe`/`tokero.exe` 改名为 `.bak`，不删运行中的旧进程。
- :60-67 POSTINSTALL 只在快捷方式已存在时重定向；创建动作由 Tauri 脚本完成。
- :69-73 卸载前清 `.bak` 与写测试文件。

### 1.4 4.0.0 的状态

- 配置/package/Cargo 已是 4.0.0，但 `bundle/nsis` 里最新仍是 `Tokeru_3.5.0_x64-setup.exe`（2026-10-24 00:40:07），没有 4.0.0 setup。
- `installer.nsi` 的 VERSION 仍是 3.5.0，说明尚未用 4.0.0 配置重新生成 NSIS 脚本。
- 因此：**本报告只能证明 3.5.0 安装包；4.0.0 安装包必须重建后重新核验 manifest、INSTALLMODE 和产物哈希。** 任务标题写 4.0.0，但当前没有可验证的 4.0.0 二进制。

### 1.5 一个文档与代码不一致的点

`RELEASE-3.5.md:10` 写“安装前用真实文件写入验证目录权限，失败给中文提示”。
实际 `installer-hooks.nsh:37-45` 失败只 `DetailPrint "Tokeru: 写测试未通过（继续尝试安装）"`，随后继续 `File` 写入；GUI 安装时用户可能只看到 NSIS 的通用写入错误，而不是“需要管理员”的明确说明。这个不一致会放大“装不上 = 要管理员”的误判。

---

## 2. setup 二进制证据

### 2.1 3.5.0 setup

路径：

```
C:\Users\19646\Desktop\学习与效率工具\折腾\dsh_zone_common\Tokeru\src-tauri\target\release\bundle\nsis\Tokeru_3.5.0_x64-setup.exe
```

- 大小：4,716,672 B
- 修改时间：2026-10-24 00:40:07
- SHA-256：`74AF016A9BD568D18F1F6E84DF64218D97B7E5A9FE9F4DF9722621E8B427A7E2`
- FileVersion/ProductVersion：3.5.0
- Authenticode：Status `Valid`（“签名已通过验证”）
- Signer：`CN=Tokeru, O=Tokeru, C=CN`
- Thumbprint：`9F74324389BD46A7D098B6B05F18C060470AFF2A`
- NotBefore/NotAfter：2026-10-24 00:29:35 / 2031-10-24 00:39:34
- TimeStamperCertificate：空（未加时间戳）
- 用 `mt.exe` 提取 manifest：`requestedExecutionLevel level="asInvoker" uiAccess="false"`；assemblyIdentity 为 `Nullsoft Install System v3.13`；ManifestDPIAware/PerMonitorV2。
- 备用数据流只有 `:$DATA`，**本机这份没有 Zone.Identifier**（不是从浏览器下载带 MOTW 的副本）。

### 2.2 其他 setup 对照

`bundle/nsis` 下：

| 文件 | 大小 | 签名 | manifest |
| --- | ---: | --- | --- |
| Tokeru_3.2.0_x64-setup.exe | 70,679,677 B | NotSigned | asInvoker |
| Tokeru_3.3.0_x64-setup.exe | 71,156,059 B | NotSigned | asInvoker |
| Tokeru_3.4.0_x64-setup.exe | 71,214,339 B | NotSigned | asInvoker |
| Tokeru_3.4.1_x64-setup.exe | 71,212,207 B | NotSigned | asInvoker |
| Tokeru_3.4.2_x64-setup.exe | 71,212,851 B | NotSigned | asInvoker |
| Tokeru_3.4.3_x64-setup.exe | 71,209,059 B | NotSigned | asInvoker |
| Tokeru_3.5.0_x64-setup.exe | 4,716,672 B | Valid（本机自签名） | asInvoker |

桌面另有 `Tokeru_3.4.4_x64-setup.exe`：71,206,501 B、NotSigned、asInvoker、无 Zone.Identifier。
**重要：旧包大 70 MB 级别，不能直接推断是 WebView2；3.5 删掉内置 TEM4 样卷/音频后体积才降到 4.7 MB。** 旧包是否走 WebView2/perMachine，需要旧包的生成脚本或实际运行证据，当前仓库没有保留。

### 2.3 机器身份与 ACL

- 当前用户：`HONORMGBOOK16PR\19646`
- 完整性级别：`Mandatory Label\Medium Mandatory Level`（S-1-16-8192）
- `BUILTIN\Administrators`：`Group used for deny only`
- `BUILTIN\Users`：Mandatory group，Enabled
- UAC 策略：`EnableLUA=1`、`ConsentPromptBehaviorAdmin=5`、`ConsentPromptBehaviorUser=3`、`PromptOnSecureDesktop=1`、`EnableInstallerDetection=1`、`FilterAdministratorToken=1`、`EnableSecureUIAPaths=1`、`ValidateAdminCodeSignatures=0`
- `%LOCALAPPDATA%\Tokeru` ACL：当前用户 `FullControl`（继承）；SYSTEM、Administrators 也 FullControl。
- 在该目录写 `.qa-write-probe.txt` 成功并可删除，说明当前用户对安装根目录有实际写权限。

### 2.4 本机安装状态（不干净，重要）

| 路径 | Owner | 内容/证据 |
| --- | --- | --- |
| `%LOCALAPPDATA%\Tokeru` | `HONORMGBOOK16PR\19646` | 根目录创建于 2026-10-23 20:47:45 |
| `app-3.5.0` | `HONORMGBOOK16PR\19646` | 目录 2026-10-24 00:29:10；`tokeru.exe` 16,138,696 B、修改 00:40:35、SHA-256 `E6F02E51...`、已签名 Valid |
| `app-3.5.0-1` | **`BUILTIN\Administrators`** | 目录 00:45:09；`tokeru.exe` 16,137,216 B、修改 00:26:22、SHA-256 `A2422BB9...`、**NotSigned**；`uninstall.exe` 86,597 B、00:45:10、Owner Administrators |
| `tokero.exe`（根下旧文件） |  | 16,011,264 B、2026-10-23 22:29:44、NotSigned |

- 当前运行：`tokeru.exe` PID 32192，StartTime 2026-10-24 00:45:12，Path `%LOCALAPPDATA%\Tokeru\app-3.5.0-1\tokeru.exe`。
- 开始菜单 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Tokeru.lnk` 和桌面 `%USERPROFILE%\Desktop\Tokeru.lnk` 都指向 `app-3.5.0-1\tokeru.exe`。
- `$PUBLIC\Desktop\Tokeru.lnk` 不存在。
- HKCU 卸载键：DisplayName Tokeru、DisplayVersion 3.5.0、InstallLocation `...\app-3.5.0-1`、UninstallString `...\app-3.5.0-1\uninstall.exe`；HKLM（含 WOW6432Node）下无同名键。
- 当前运行的是 **旧构建、未签名**的 `app-3.5.0-1`；最终 3.5.0 构建在 `app-3.5.0`（已签名）和 `target/release/tokeru.exe`（16,138,696 B、SHA-256 `43F7A49C...`、Valid）。

**结论：owner 是 Administrators 的 app-3.5.0-1 至少说明它不是与 app-3.5.0 相同的创建上下文，可能是提升进程创建或人工提升复制；不能仅凭 owner 断言“安装器自动提权”，但也不能把这份机器状态当作“非管理员安装成功”的干净证据。** 需要一台干净 VM 重做。

### 2.5 UAC 日志

- 日志：`Microsoft-Windows-UAC/Operational`，Enabled=True，Records=33。
- 最新 5 条均为 2026-10-02 11:33:46 及更早，Event ID 1，Level Error，消息：
  `The process failed to handle ERROR_ELEVATION_REQUIRED during the creation of a child process.`
- 2026-10-23/24 没有记录；`Microsoft-Windows-UAC-FileVirtualization/Operational` 不存在。
- **解释限制：该日志只记录 UAC 失败/错误，成功提权与普通启动不写。所以“没有记录”不能单独证明用户没看到 UAC，只能作为辅证。**
- 本次执行过 `Start-Process` 尝试（见 §3.3），事后也没有新增 UAC 事件。

### 2.6 AppCompat

- `HKCU/HKLM\...\AppCompatFlags\Layers` 均无 Tokeru 值，未发现“以管理员身份运行”兼容标记。
- `Compatibility Assistant\Store` 中有 `...\Tokeru\tokero.exe`、`...\uninstall.exe`、`...\Tokeru_3.4.4_x64-setup.exe`、`...\tokeru-test-ascii.exe` 的二进制值（SACP...），未见 3.5.0 setup 的条目。
- 仍建议在用户机器上复查这两处，因为兼容标记是每台机器独立的。

---

## 3. 不提权启动探测（已验证）

### 3.1 方法

用 PowerShell P/Invoke `CreateProcessW`，`dwCreationFlags = CREATE_SUSPENDED (0x4)`，对 setup 调用；如果目标 manifest 是 `requireAdministrator`，非提升进程会收到 `ERROR_ELEVATION_REQUIRED (740)`，且不弹 UAC。成功创建后立刻 `TerminateProcess`，不运行安装逻辑。

### 3.2 结果

```
Tokeru 3.5.0 setup | CREATE_OK (suspended, terminated) | procId=16580
Tokeru 3.4.4 setup | CREATE_OK (suspended, terminated) | procId=10220
notepad control    | CREATE_OK (suspended, terminated) | procId=36092
```

**含义：** 3.5.0 与 3.4.4 的 setup 在当前 Medium integrity、Administrators deny-only 的进程里都能直接创建，不存在“PE manifest 要求提升”的问题。
**边界：** `CreateProcess` 不经过 ShellExecute，也不模拟双击；它证明的是“二进制启动不要求提权”，不等于“用户双击一定不会看到 UAC”。双击路径的 UAC 行为需要单独复现。

### 3.3 一次未定论的 `Start-Process` 尝试

早前用 PowerShell `Start-Process` 运行 `setup /S`，监视 `consent.exe`，run_code 到 120 s 被整体终止。事后检查：

- 没有残留 setup / consent 进程；
- 没有新增 app-3.5.0-2；
- 没有新增 UAC 事件；
- 快捷方式、HKCU 卸载键未变化；
- `%TEMP%` 无新的 NSIS 解压目录。

**不能从这次实验得出任何结论。** 可能是在 ShellExecute 阶段被 UAC 提示阻塞，也可能是 NSIS 对话框、PowerShell `WaitForExit`/子进程句柄导致等待；没有留下可判定的证据。报告里不把它写成“需要管理员”或“不需要管理员”的证明。

---

## 4. 可能原因（按可解释性排序）

| # | 假设 | 现有证据 | 状态 | 如何区分 |
| --- | --- | --- | --- | --- |
| A | 用户运行的不是这份 3.5.0 最终包，而是旧包/别的构建 | bundle 里有 3.2.0–3.5.0 多个包；桌面还有 3.4.4；当前本机 app-3.5.0-1 还是未签名旧构建；4.0.0 尚未生成 | **待用户提供路径/哈希** | 要 `Get-FileHash`、文件属性版本、下载来源 |
| B | 用户看到的是 SmartScreen/“未知发布者”，不是 UAC | 3.5.0 是自签名且未加时间戳；证书只在本机当前用户 Root/TrustedPublisher 受信任；换机/换用户会提示未知发布者；旧包全部 NotSigned | **常见误判，待截图** | 看提示标题是“用户账户控制”还是“Windows 已保护你的电脑/未知发布者” |
| C | 用户右键“以管理员身份运行”或快捷方式带了 Run as administrator | 本机 Layers 无 Tokeru；但每台机器可不同 | **待复现** | 查 `AppCompatFlags\Layers`、快捷方式高级属性、启动方式 |
| D | 用户机器上 `%LOCALAPPDATA%\Tokeru` 写入被拒（ACL/重定向/安全软件），安装器报写入错误，被理解成“要管理员” | 本机 ACL 是 FullControl；但 `installer-hooks.nsh:37-45` 写测试失败只记日志、不明确提示，随后 `File` 阶段才失败；文档却声称会给中文提示 | **待复现，且代码有改进点** | 用户机器 `icacls`、Process Monitor、安装日志 |
| E | 用户是标准用户/UAC 策略/组策略导致不同提示 | 本机是 Medium、Administrators deny-only；不代表用户机器 | **待复现** | `whoami /groups`、UAC 注册表、`gpresult` |
| F | 旧安装器是 perMachine / 需要写 Program Files / 装 WebView2 | 现有旧包 manifest 都是 asInvoker；本机没有旧包生成脚本；3.5 已 skip WebView2 | **待旧包验证** | 找旧包对应的 installer.nsi，或干净机运行旧包 |
| G | 安全软件/EDR 拦截未签名或自签名安装器 | 旧包 NotSigned；3.5 自签名；本机 Defender 未显示拦截记录（未穷举） | **推测** | 查 Defender/第三方杀软日志 |
| H | ShellExecute 的 installer detection 触发提升 | 3.5 manifest asInvoker；CreateProcess 成功；Start-Process 实验未定论 | **未定论** | 干净机双击并同时抓 consent/UAC 事件；或用 ProcMon 看父进程 |
| I | 下载损坏/哈希不符 | 本机 3.5 hash 与发布记录一致 | **低概率，待用户哈希** | 对比发布记录 SHA-256 |

---

## 5. 需要用户提供的最小复现信息

请用户按顺序提供（能提供多少算多少）：

1. 实际双击的 setup 完整路径、文件名、大小、修改时间：
   ```powershell
   $f='<setup路径>'
   Get-Item $f | Select-Object FullName,Length,LastWriteTime
   Get-FileHash $f -Algorithm SHA256
   (Get-Item $f).VersionInfo | Select-Object FileVersion,ProductVersion
   Get-AuthenticodeSignature $f | Format-List Status,StatusMessage,SignerCertificate,TimeStamperCertificate
   ```
2. 提示框截图/原文：标题栏是“用户账户控制”“Windows 已保护你的电脑”还是 NSIS 错误？按钮是“是/否”还是“仍要运行/不运行”？
3. Windows 版本 + 账户类型 + UAC：
   ```powershell
   winver
   whoami
   whoami /groups | findstr /i "Mandatory Administrators Users"
   Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' |
     Select-Object EnableLUA,ConsentPromptBehaviorAdmin,ConsentPromptBehaviorUser,PromptOnSecureDesktop,EnableInstallerDetection
   ```
4. 安装目录 ACL 与是否存在：
   ```powershell
   $p="$env:LOCALAPPDATA\Tokeru"
   Test-Path $p
   if (Test-Path $p) { icacls $p; (Get-Acl $p).Owner }
   ```
5. UAC 事件与兼容性标记：
   ```powershell
   Get-WinEvent -LogName 'Microsoft-Windows-UAC/Operational' -MaxEvents 20 |
     Select-Object TimeCreated,Id,LevelDisplayName,Message
   Get-ItemProperty 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers' -ErrorAction SilentlyContinue
   Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers' -ErrorAction SilentlyContinue
   ```
6. 是否从浏览器下载/聊天工具接收：
   ```powershell
   Get-Item '<setup路径>' -Stream * | Select-Object Stream,Length
   ```
   有 `Zone.Identifier` 说明有 MOTW，可能触发 SmartScreen；没有也不代表一定不触发。
7. 是否正在运行旧 Tokeru、安装是否在旧目录、是否用“以管理员身份运行”启动；安装时是否被杀软拦截。
8. 如果愿意，提供安装失败的 **Process Monitor** 过滤结果（Process Name 含 setup/tokeru，Result 为 ACCESS DENIED 的事件），或录屏。

---

## 6. 修复/改进建议

1. **保持非管理员路线**：继续 `INSTALLMODE=currentUser`、`RequestExecutionLevel user`、LocalAppData + HKCU + 当前用户快捷方式；不要为了“装得上”改成 perMachine/requireAdministrator，那会把问题扩大。
2. **在构建 CI 里校验生成产物的 manifest 与脚本**：
   - 断言 `installer.nsi` 里 `INSTALLMODE "currentUser"`、`RequestExecutionLevel user`；
   - 用 `mt.exe` 或 `sigcheck -m` 断言 setup 的 `requestedExecutionLevel` 是 `asInvoker`；
   - 断言产物里没有 `needsadmin=true` 的 WebView2 分支（3.5 已 skip）。
3. **修掉写测试的“只记日志”问题**：`installer-hooks.nsh:37-45` 写测试失败时应 `Abort` 并 `MessageBox` 说明“当前用户对 … 无写权限，请检查 ACL 或改用便携版”，而不是继续到 `File` 阶段才报通用错误；同时保留 DetailPrint 便于日志。
4. **给安装器加可读日志/错误码**：至少输出 `$INSTDIR`、版本、写测试结果、失败阶段；GUI 下 `DetailPrint` 用户看不到，建议失败时 MessageBox 带日志路径。
5. **发布包与版本标识**：发布记录、安装包文件名、HKCU DisplayVersion 必须一致；当前本机 app-3.5.0-1 是未签名旧构建，却占着 3.5.0 的注册表/快捷方式，容易让用户以为“最新版还要管理员”。建议安装前清理/提示旧目录，或在关于页显示 build hash。
6. **签名策略**：本机自签名只适合本机验收；对外分发应使用受信任代码签名证书并加时间戳，否则 SmartScreen/未知发布者会持续被误判为“管理员/权限”问题。发布页同时给 SHA-256 与“如何校验”。
7. **干净机验收矩阵**（4.0.0 重建后必须重跑）：
   - Windows 10 22H2 / Windows 11 23H2+，标准用户（非 Administrators），UAC 开启（默认 5）；
   - 无旧 Tokeru、有旧 Tokeru 运行中、`%LOCALAPPDATA%\Tokeru` 不存在/存在但只读/存在且被重定向；
   - 中文用户名、含空格路径、非系统盘；
   - 安装、卸载、覆盖安装、静默 `/S` 各一次；
   - 记录 setup 退出码、安装目录 owner/ACL、HKCU/HKLM、快捷方式、UAC 事件、是否出现 consent.exe。
8. **文档明确区分三种提示**：UAC（用户账户控制）、SmartScreen（Windows 已保护你的电脑）、NSIS 写入错误。附截图和“该找谁/怎么修”，避免用户一句“要管理员”掩盖真实原因。
9. **如果用户确实需要装到 Program Files**：另做 perMachine 包并明确要求管理员；不要让 currentUser 包去写 Program Files，也不要在 currentUser 包里静默提权。
10. **本机清理建议**：当前快捷方式指向未签名的 app-3.5.0-1 旧构建。验收 4.0.0 前应卸载/清理旧目录，重新用最终 setup 安装，避免旧构建干扰判断。

---

## 7. 附录：关键证据与命令

### 7.1 代码定位

- `src-tauri/tauri.conf.json:4,38-40,43`
- `src-tauri/target/release/nsis/x64/installer.nsi:38-41,101-106,521,537-538,582-671,698-724,737-747,877-879,910-973`
- `src-tauri/nsis/installer-hooks.nsh:4,9-31,37-45,51-56,60-67,69-73`
- `src-tauri/target/release/nsis/x64/utils.nsh:3-19`
- `RELEASE-3.5.md:10,49,64-68,72`

### 7.2 setup 哈希/签名

```
SHA256  74AF016A9BD568D18F1F6E84DF64218D97B7E5A9FE9F4DF9722621E8B427A7E2
Status  Valid
Signer  CN=Tokeru, O=Tokeru, C=CN
Thumb   9F74324389BD46A7D098B6B05F18C060470AFF2A
Stamp   (none)
```

### 7.3 CreateProcess 探测输出

```
Tokeru 3.5.0 setup | CREATE_OK (suspended, terminated) | procId=16580
Tokeru 3.4.4 setup | CREATE_OK (suspended, terminated) | procId=10220
notepad control    | CREATE_OK (suspended, terminated) | procId=36092
```

### 7.4 本机安装状态摘要

```
app-3.5.0    owner=HONORMGBOOK16PR\19646   tokeru.exe 16,138,696  signed  E6F02E51...
app-3.5.0-1  owner=BUILTIN\Administrators   tokeru.exe 16,137,216  unsigned A2422BB9...
shortcuts -> app-3.5.0-1\tokeru.exe
running   -> app-3.5.0-1\tokeru.exe (PID 32192)
HKCU Uninstall\Tokeru -> app-3.5.0-1
HKLM Uninstall\Tokeru -> 不存在
```

### 7.5 未做的事

- 没有运行会落地安装的 setup；§3.3 的 `Start-Process` 尝试没有完成，已明确标为未定论。
- 没有修改安装器、源码、注册表或快捷方式。
- 没有验证 4.0.0 安装包（尚不存在）。
- 没有在用户机器上复现其提示；本文的原因表是候选清单，不是结论。

---

## 8. 给接手人的最短路径

1. 先让用户给 setup 的路径 + SHA-256 + 提示截图；对不上 §2.1 的哈希就先解决“包不对”。
2. 如果截图是 SmartScreen/未知发布者：按签名/时间戳/下载来源处理，不要改安装器权限。
3. 如果截图是 UAC：在干净 VM 用同一包双击复现，抓 `consent.exe`、UAC 事件、`whoami /groups`、Layers；同时确认没有右键“以管理员身份运行”。
4. 如果是 NSIS 写入错误：查 `%LOCALAPPDATA%\Tokeru` ACL/重定向/杀软，并修 `installer-hooks.nsh:37-45` 的失败提示。
5. 4.0.0 重建后，重复 §7.2 的 setup manifest/签名核验与 §3.1 的 CreateProcess 探测，再跑 §6.7 矩阵。
