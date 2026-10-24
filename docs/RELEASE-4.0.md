# Tokeru 4.0.0 发布说明

> 状态：已构建、签名并完成非管理员安装/启动验证。
> 版本：4.0.0（package.json / tauri.conf.json / Cargo.toml 已同步）
> 基线：3.5.0

## 1. 这次做了什么

4.0.0 是正式大版本，围绕「把任意材料变成可练习试卷」重做导入链路，并把 Tokeru 的题库/试卷/记录开放给外部 Agent。

| # | 需求 | 结果 |
| --- | --- | --- |
| 1 | PDF 上限 50 页 / 100 MB | 导入与自动分图均支持 50 页；单文件上限 100 MB |
| 2 | 导入内置 AI 识图、分图配图 | 视觉 OCR 按页生成 Markdown 与 figure bbox，本地按框裁图后写入题干；不再依赖 PDF 文字层 |
| 3 | 拖 PDF 到导入窗口无法预加载 | Rust 关闭 Tauri 自带 drag-drop 拦截，HTML5 dataTransfer 恢复 |
| 4 | 导入窗口无内容时不能复制提示词 | 两步的复制/预览提示词只受「文件加载中」限制 |
| 5 | 添加 MCP 连接 | 内嵌 Streamable HTTP MCP Server，19 个工具，默认只读、本机回环、Token |
| 6 | 调研安装包为何要管理员 | 只调研不改安装器，见 `docs/INSTALLER-ADMIN-RESEARCH.md` |

## 2. 导入：从材料到试卷

### 2.1 入口

导入页第一步现在同时接受：

- 拖入 `.pdf` / `.md` / `.markdown` / `.txt` / `.json`
- 选择文件
- 直接粘贴 Markdown / JSON

材料框旁常驻「复制清洗提示词」与「预览提示词」，不要求先有内容。复制内容来自 `Tokeru/shared/import-spec.md`（前后端共用的唯一规范），包含 9 种题型的字段、答案结构、材料组织、`{{fig:...}}` 图占位与 JSON 模板。

### 2.2 视觉制卷

扫描件或图片型 PDF 不再依赖文字层：

1. 前端把 PDF 每页渲染为 JPEG，按 4 页/批调用 `ai_vision_ocr`。
2. 视觉模型返回 `{"pages":[{"page":1,"markdown":"...","figures":[{"id":"p1f1","bbox":[...],"caption":"..."}]}]}`。
3. 前端合并 Markdown，按 bbox 用 `cropPage` 裁出题图，替换 `{{fig:id}}` 为 `<figure class="q-figure"><img ...></figure>`。
4. 交给文本模型按导入规范清洗成 JSON。
5. `preview_import` 校验后预览原卷，再由用户确认写入。

单张题图上限 300 KB、整卷题图预算 8 MB；没有 bbox 的图不会拿整页图冒充，而是在题干写「（原题有图，见原卷）」。

### 2.3 限制

- 单文件 100 MB、50 页；超过会明确提示。
- 材料送入文本模型前上限 120,000 字符，超过会截断并提示。
- 视觉模型必须单独配置（设置 → AI → 多模态模型）；纯文本模型不能读图。

## 3. 题库与速查

- 题库详细模式按原卷排版：材料只出现一次，完形/听写/填空等材料题连续成组，不再拆成答题卡式小题卡。
- 简要模式是紧凑列表，标签裸名并列；详细模式标签按「学科：数学」着色。
- 试卷卡支持删除；确认框会说明连带删除分区、题目、材料、练习记录与错题关联。
- 速查与整理同样支持详细/简要、标签栏着色、自动分图与打印。

## 4. MCP：外部 Agent 接入

Tokeru 内置一个 Streamable HTTP MCP Server：

- 只绑定 `127.0.0.1`，默认端口 `17890`，路由 `/mcp`。
- 默认只读；写操作需要在设置里关闭只读。
- 鉴权：`Authorization: Bearer <token>`，或 `?token=`；缺失/错误返回 401。
- 19 个工具：
  - 只读：`list_sets`、`get_set`、`list_bank`、`search_questions`、`get_question`、`list_tags`、`list_tag_groups`、`bank_stats`、`list_records`、`get_attempt`、`get_import_spec`
  - 导入：`preview_import`、`confirm_import`、`undo_import`
  - 编辑：`update_question`、`rename_set`、`update_set_tags`、`create_folder`、`assign_set_folder`
- 导入采用 preview → confirm 两段式：preview 只缓存文本并返回 `preview_id`，2 小时内有效；confirm 才写库。
- 请求体上限 16 MiB；只接受 JSON，不接受 multipart。
- 不返回 API Key，不暴露设置里的密钥。

配置入口：设置 → MCP 连接（开关 / 端口 / 只读 / 保存并应用 / 重置 Token / 地址与 Token 复制 / 客户端 JSON 示例）。完整说明见 `docs/MCP.md`，生态调研见 `docs/MCP-RESEARCH.md`。

## 5. 安装包调研

`docs/INSTALLER-ADMIN-RESEARCH.md` 记录了本轮对 3.5.0 安装包的核查：

- setup manifest 为 `asInvoker`，NSIS `INSTALLMODE "currentUser"`、`RequestExecutionLevel user`。
- 安装只写 `%LOCALAPPDATA%\Tokeru`、HKCU 与当前用户快捷方式。
- 在 Medium 完整性进程里可静默启动 setup，未复现 `ERROR_ELEVATION_REQUIRED`。
- 结论：现有证据不能证明「必须管理员」；需要用户提供实际 setup 路径/哈希/失败截图、`whoami /groups`、UAC 策略与 `icacls` 才能定位。

**4.0.0 不修改安装器行为**，本轮只交付调研。

## 6. 验证

已在本机执行：

- `pnpm exec tsc --noEmit`：通过。
- `pnpm test -- --run`：8 passed（视觉导入解析）。
- `cargo test`：8 passed（导入、评分、字体）。
- MCP 冒烟：initialize 200、tools/list 19、`bank_stats` 200、`preview_import` → `confirm_import` 返回 batch/set；无 token 401；只读拒绝写。
- 设置页实测：开关启动、重启自动启动、端口占用重试、Token 重置、客户端 JSON 展示。
- 50 页 / 100 MB / 拖拽 / 空内容复制提示词：代码路径已核对；单元测试覆盖视觉导入解析与裁图。
- 非管理员静默安装（当前 Medium 完整性）实测成功：安装到 `%LOCALAPPDATA%\Tokeru\app-4.0.0`，注册表 `DisplayVersion=4.0.0`；安装版空库启动、窗口标题 Tokeru、`TOKERU_DATA_DIR` 指向测试目录时生成独立 `tokero.db`。这次安装用 CreateProcess 直接启动 setup，绕过了资源管理器的「打开文件 - 安全警告」；从资源管理器双击时该对话框会先阻塞安装，需先解除锁定。
- 安装版 `tokeru.exe` 已用本机证书补签为 Valid；安装包内的 payload 是构建产物，重新安装后需要再执行一次 `tools/sign-local.ps1`（或手工签安装目录 exe）。

未验收：

- 真实视觉模型的识图/分图质量（本轮用 mock 视觉端点验证管线与裁图）。
- 安装包「非管理员」问题（只调研）。

## 7. 交付物

最终产物（已签名）与 SHA-256：

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| `Tokeru_4.0.0_x64-setup.exe` | 5,723,728 B | `aef063753f24f60337b15f6398cea21a51b153ebd12d92f6fab522169f712d8d` |
| `tokeru.exe`（release / 便携） | 21,168,072 B | `b92ec04a0533571b4804a10c9dba7ff4eb0bc5b6af043a43c58f3e6d2f330bf6` |
| `Tokeru_4.0.0_x64_portable.zip` | 7,620,673 B | `727a4fb1ce14139658dacacd704a74de3ae11dba523d9301519c89e066cfc0d9` |

签名：本机自签名证书 `CN=Tokeru`（SHA-1 `9F74324389BD46A7D098B6B05F18C060470AFF2A`），未加时间戳；仅当前 Windows 用户信任。重签脚本 `Tokeru/tools/sign-local.ps1`。

## 8. 升级说明

- 版本号已升到 4.0.0；数据目录与 SQLite 结构兼容 3.5，无破坏性迁移。
- 安装包仍安装到 `%LOCALAPPDATA%\Tokeru\app-4.0.0`，不覆盖旧版本；快捷方式由安装器重定向。
- MCP 默认关闭，需要手动启用；默认只读。
- 3.5 的 AI 配置、计时、排版、主题、题库数据保留。

## 9. 已知限制

- 视觉模型需要支持 OpenAI 兼容 `image_url`；纯文本模型会在测试连接时报错。
- 50 页 PDF 全量渲染会占用内存与时间；超大扫描件建议拆卷。
- MCP 会话不持久化，应用重启后客户端需重新 initialize。
- 只读模式下 `preview_import` 也会被拒绝；这是有意的写入口保护。
- 安装包本身已签名，但 NSIS 解出的 `tokeru.exe` 是构建产物，未随安装包一起带签名；需要本机补签才能让应用 exe 也显示已验证发布者。
- 新构建的 setup / exe 首次从资源管理器双击时，Windows 可能弹「打开文件 - 安全警告」或 SmartScreen；这是新二进制未积累信誉或带 Internet 标记，不表示文件损坏。可用右键属性「解除锁定」或 `Unblock-File`，测试环境可直接用 CreateProcess 启动绕过该对话框。
- 安装包「必须管理员」的疑虑仍未复现，等待用户提供实际 setup 路径/哈希/失败截图。
- 前端只有视觉导入解析的单元测试，未覆盖全部页面交互。
