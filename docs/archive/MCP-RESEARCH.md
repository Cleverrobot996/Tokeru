# Tokeru MCP 调研：从 4.0.0 到下一版的协议、安全与生态对照

> 调研对象：Tokeru 4.0.0 的内置 MCP Server，以及 2026-10-24 时可访问的 MCP 官方规范、同类产品与客户端文档。
> 事实来源：文末「来源清单」中的链接，均为 2026-10-24 访问；Tokeru 侧事实优先引用 [MCP.md](../MCP.md) 与源码。
> 区分口径：标「事实」的内容可在来源中直接核对；标「判断」的是基于事实的推断，落地前需要产品/安全评审。
> 不涉及：安装包构建、真实客户端联调、对 4.0.0 源码的修改。

> **实现进展（2026-10-24 交付前）**：本文记录的是调研时的代码状态。交付前已完成的修复包括：
> - **P0 富文本消毒已落地**：`src/lib/richText.ts` 现在只允许 `figure`/`figcaption`/`img`/`br`，`img.src` 仅允许 `data:image`，其余标签/属性/事件处理器/远程 URL 丢弃；题干与材料都走同一白名单，旧数据在渲染时也会被收敛。写入层（MCP/导入）仍建议后续再加一道校验。
> - **confirm_import 已复查 2 小时 TTL**，过期返回明确错误。
> - **MCP 请求体上限已从 4 MiB 调到 16 MiB**，覆盖导入规范 8 MB 图片预算。
> - **写工具目标校验仍未修**（`update_question` 等对不存在 id 仍可能返回成功），仍列为 P0-2。
> 下文相关段落保留调研时原貌，具体以 [MCP.md](../MCP.md) 与当前源码为准。

---

## 1. 结论摘要

**事实：Tokeru 4.0.0 的基础方向是对的。** 它把 MCP 做成桌面进程内的 Streamable HTTP 服务，只绑定 127.0.0.1，默认关闭、默认只读，写操作必须由用户在设置页显式关闭只读；19 个工具覆盖读题库、导入预览/确认/撤销、改题、改标签和整理文件夹。相比把数据库直接暴露给外部进程，这是一个更容易解释和收口的边界。详见 [MCP.md](../MCP.md) 第 1、2、6 节。

**事实：它仍然是一个「单 Token + 单只读开关」的本地服务。** Token 明文存 SQLite，支持 Bearer 和 <code>?token=</code>；CORS 返回 <code>*</code>；鉴权是普通字符串比较；没有速率限制、失败锁定或来源 IP 白名单；只读是工具层检查，不是数据库权限隔离。见 [MCP.md](../MCP.md) 第 6.2、6.3 节。

**事实：官方规范在 2026-07-28 版把协议描述为 stateless、self-contained requests、per-request capability negotiation，并明确工具 annotations 不可信，除非来自可信 server。** 这意味着 <code>mcp-session-id</code> 不能当鉴权，工具注解不能当权限；真正的授权仍要由 host/server 自己完成。见 [MCP 规范概览](https://modelcontextprotocol.io/specification/latest) 与 [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)。

**事实：同类产品里最值得警惕的不是「有没有 Token」，而是「工具面太宽 + 参数不设边界」。** SiYuan 的 CVE-2026-66012 说明，即使 <code>/mcp</code> 有 <code>model.CheckAuth</code>，缺少 admin/read-only 限制时，31 个工具中的文件读写能力仍可能把未认证访问升级为管理员接管；后续 <code>asset.upload</code> 的绝对路径问题说明「管理员门槛」不等于「参数安全」。见 [GHSA-hp8g-g2qj-wgpj](https://github.com/advisories/GHSA-hp8g-g2qj-wgpj) 与 [GHSA-p23f-cm6q-2qp8](https://github.com/advisories/GHSA-p23f-cm6q-2qp8)。

**事实：Tokeru 当前最具体的代码级风险是富文本渲染的 stored XSS 面。** <code>src/lib/richText.ts</code> 对普通文本会转义，但只要内容含 <code>figure</code>/<code>img</code>，媒体块会原样保留；材料更是整段原样返回。MCP 的 <code>update_question</code> 可写入题干 HTML（上限 8 MB），随后 <code>PaperView.tsx</code>、<code>AnswersPage.tsx</code>、<code>ResultPage.tsx</code> 通过 <code>dangerouslySetInnerHTML</code> 渲染。详见第 6.6 节。

**判断：下一版最值得投入的顺序是 P0 富文本白名单消毒、P0 写工具目标校验与撤销确认、P1 鉴权硬化与权限分层。** 协议升级、请求体上限、resources/prompts、客户端配置生成器可以排在后面；它们重要，但不会像前两项那样直接改变「外部输入能否变成本机代码执行/数据破坏」的风险。

### 1.1 建议优先级一览

| 优先级 | 建议 | 主要收益 | 预估成本 |
| --- | --- | --- | --- |
| P0 | 富文本白名单消毒 | 关闭 stored XSS 到 WebView 的路径 | 1–2 人日 |
| P0 | 写工具目标校验 + undo 确认/预演 | 降低误删、误改、无效写入 | 1–2 人日 |
| P1 | 鉴权硬化（Origin、常量时间、Token 管理） | 降低本机网页/日志泄露后的利用面 | 2–4 人日 |
| P1 | 权限分层（read/import/edit/admin，按范围） | 让「只读」之外有可解释的授权模型 | 4–8 人日 |
| P1 | 协议升级与双栈评估 | 跟上 stateless 规范，减少未来迁移成本 | 3–5 人日 |
| P1 | 4 MiB 与 8 MB 口径对齐 | 减少带图导入的 413 与支持成本 | 0.5–1 人日 |
| P2 | resources / prompts / 批量工具 | 提升 Agent 工作流效率 | 3–5 人日 |
| P2 | 客户端文档与配置生成器 | 降低 Cline/Continue/AnythingLLM 配置失败 | 1–2 人日 |
| P2 | 可观测性与限速 | 让问题可定位、异常可发现 | 2–4 人日 |

### 1.2 现在不建议做的事

- 不要把监听地址改成 <code>0.0.0.0</code> 或提供公网隧道；当前的安全模型只适用于回环地址。
- 不要把工具 annotations 当成授权依据；它们只是给客户端的提示，规范明确说不可信。
- 不要让 Agent 自动完成 <code>preview_import → confirm_import</code>；至少保留一次人工确认。
- 不要对外承诺宽松的过期窗口；<code>confirm_import</code> 当前会复查 TTL，超时返回明确错误（见交付前实现进展）。
- 不要为了兼容旧客户端而长期保留 <code>?token=</code> 作为默认写法；优先 Authorization 头。

---

## 2. 调研范围与方法

### 2.1 范围

1. MCP 官方规范：概览、传输、工具、安全最佳实践（2026-07-28 版）。
2. 同类产品的 MCP 实现：SiYuan、Obsidian、Logseq、Anytype、Notion。
3. 客户端配置方式：Claude Desktop、Cline、Continue、AnythingLLM。
4. Tokeru 4.0.0 的实现边界：以 [MCP.md](../MCP.md) 为主，关键结论回查 <code>src-tauri/src/mcp.rs</code> 与前端渲染代码。

### 2.2 方法

- 官方规范逐页读取，只把页面明确写出的要求标为「事实」；把「这对 Tokeru 意味着什么」标为「判断」。
- 同类产品优先看官方文档/官方仓库；安全结论优先看 GitHub Advisory 原文，而不是二手转述。
- 客户端配置以各项目文档中的字段名为准；不同版本文档可能变化，文末给出访问日期。
- Tokeru 侧引用 [MCP.md](../MCP.md) 的章节，避免重复它已经写清楚的工具表、curl 示例和排错表。

### 2.3 局限

- 没有在目标机器上重新执行桌面端 curl/客户端联调；客户端兼容性仍需实测。
- 没有审计 Tokeru 的全部 Rust 代码，只核对了与 MCP 边界直接相关的鉴权、CORS、写工具和渲染路径。
- 同类产品的工具数量、配置字段可能随版本漂移；本文只保证 2026-10-24 页面所写内容。
- 不引用 star 数、下载量等易变指标；需要时应在发布前重新查。

---

## 3. 官方规范：2026-07-28 版的关键变化

### 3.1 协议模型：stateless 与 per-request negotiation

**事实：** [MCP 规范概览](https://modelcontextprotocol.io/specification/latest) 把当前协议描述为 JSON-RPC 2.0、stateless、self-contained requests、per-request capability negotiation。每个请求自带完成它所需的信息；能力协商按请求进行，而不是只依赖连接建立时的一次握手。

**判断：** 这对 Tokeru 有两层影响。第一，<code>mcp-session-id</code> 更不应该被当作身份凭据；它只是会话标识，应用重启后丢失是正常行为。第二，未来升级时，服务端不能把「连接建立时协商过的状态」当成唯一事实来源；工具调用需要能独立校验参数和权限。

**对 Tokeru 的具体含义：**

- 现有的 <code>2025-06-18</code> 协议版本仍可用，但应在文档中明确它是当前实现版本，不要把「最新规范」当作已支持。
- 如果升级到 2026-07-28，需要评估 rmcp 版本是否支持 stateless 语义；这不是改一个字符串就能完成。
- 在过渡期可以做双栈：保留旧版兼容，同时让新客户端按新版本协商；不要一刀切导致现有客户端全部失效。

### 3.2 传输：stdio 与 Streamable HTTP 的边界

**事实：** [传输规范](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports) 描述了两类传输。stdio 由 client 启动子进程，消息按换行分隔；Streamable HTTP 对每个消息发一个 POST，响应可以是 JSON，也可以是请求级 SSE。协议元数据放在 body 的 <code>_meta</code> 中，Streamable HTTP 还会把它镜像到 header。2026-07-28 起协议是 stateless 的；旧版本的连接级 session 只作为向后兼容存在。

**判断：** Tokeru 只提供 Streamable HTTP，不提供 stdio，这个选择对桌面应用是合理的：它不需要让客户端启动 Tokeru 子进程，也不会把 Token 放进 command/args。但它也意味着只支持 stdio 的客户端必须桥接，配置成本比「复制一段 command」高。

**事实：** [MCP.md](../MCP.md) 第 3.5、7.3 节已经说明 Tokeru 没有 stdio transport，并给出桥接进程需要做的四件事：initialize、保存 session、带 Authorization、把 SSE 转成 stdio 消息。

**判断：** 短期不需要新增 stdio。更划算的是把桥接配置写清楚，并在设置页提供「复制给 Cline/Continue/AnythingLLM 的配置」按钮；桥接工具本身也要带 Authorization 头，不能只转 URL。

### 3.3 工具语义：annotations 不是权限

**事实：** [Tools 规范](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) 要求工具名 1–128 字符、唯一、建议使用 ASCII；工具可以有 <code>inputSchema</code>/<code>outputSchema</code>；人类应能拒绝工具调用；工具列表不应随连接变化。规范同时明确：工具 annotations 应被视为不可信，除非它们来自可信 server。

**判断：** annotations 的价值在于让客户端做 UI 提示（例如对 <code>destructive_hint=true</code> 弹确认），而不是让服务端省掉鉴权。Tokeru 现在给只读工具标了 <code>read_only_hint=true</code>，给 <code>undo_import</code> 标了 <code>destructive_hint=true</code>，这是正确的方向；但不能因为某个工具标了只读就默认它没有副作用，也不能因为某个工具没标 destructive 就默认它安全。

**对 Tokeru 的具体含义：**

- 保留现有 annotations，并补齐语义：<code>preview_import</code> 不写库但受只读限制，标 <code>read_only_hint=false</code> 是保守且合理的；文档要解释这一点，避免客户端误判。
- 对 <code>undo_import</code>、<code>confirm_import</code> 这类操作，客户端确认不能只依赖 annotation；服务端仍要校验目标、范围和幂等性。
- 工具描述本身也可能被不可信内容影响；不要把工具返回的文本当作指令执行。

### 3.4 本地 MCP Server 的攻击面

**事实：** [安全最佳实践](https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices) 新增了「Local MCP Server Compromise」一节。它列出的攻击面包括：攻击者在客户端配置里放入恶意启动命令、在 server 里分发恶意 payload、通过 DNS rebinding 访问留在 localhost 的不安全 server。规范要求：如果客户端支持一键配置本地 MCP Server，必须在执行命令前展示完整、未截断的命令，明确这是在本机执行代码的高风险操作，要求显式同意，并允许取消；同时应使用沙箱和最小权限。

**判断：** Tokeru 是「本地 server」而不是「客户端启动的 stdio server」，所以「恶意启动命令」这一项不直接适用；但另外两项适用：

- 本机其他进程只要拿到 Token 就能访问，Token 的保密比端口更重要。
- 如果用户把 Tokeru 的 MCP 地址/Token 粘贴给不可信网页或脚本，CORS <code>*</code> 会让浏览器请求更容易发出；Origin 校验和「不要把 Token 注入网页环境」是现实的缓解。
- 规范在同一章节还强调对 HTTP 暴露面使用鉴权或受限 IPC，并建议把 stdio 限制为仅 MCP client 访问。Tokeru 没有 stdio，因此重点是 Token、Origin、回环绑定和最小权限。

**事实：** [MCP.md](../MCP.md) 第 6.3 节已经指出 CORS <code>*</code>、Token 明文、普通字符串比较、查询参数会进 URL 等边界。

**判断：** 这些不是「马上会被远程攻破」的漏洞，因为服务只绑定回环；但它们会把「本机某网页/某脚本拿到 Token」的后果放大。鉴权硬化应作为 P1，而不是等出现事故再补。

### 3.5 Token Passthrough 与会话劫持

**事实：** 同一份安全最佳实践明确把 Token Passthrough 列为反模式：MCP Server 不应接受不是签发给自己的 Token，更不能把它原样转发给下游 API；否则会造成 audience 校验失败、审计困难，以及拿偷来的 Token 当代理用。Session Hijacking 章节主要针对 2025-11-25 及更早版本的 session ID 处理。

**判断：** Tokeru 目前没有 OAuth、没有下游 API、没有把 Token 转发给第三方，所以 Token Passthrough 不是当前漏洞。它的启示是「Token 的受众和用途要单一」：Tokeru 的 Token 只用于本机 MCP，不应被复用到其他服务；也不要把 AI API Key 放进 MCP 工具结果。

**对 Tokeru 的具体含义：**

- 保持 Token 只用于 MCP；工具结果不返回 AI API Key（[MCP.md](../MCP.md) 第 3.1 节已说明）。
- 如果未来接入远程模型/云端服务，不要把 MCP Token 传给对方；应使用独立的服务凭据。
- 会话 ID 不作为第二因素；应用重启后旧 session 失效是预期行为。

### 3.6 规范对照结论

| 规范要求 | Tokeru 4.0.0 现状 | 判断 |
| --- | --- | --- |
| 明确用户同意工具调用 | 设置页开启服务、关闭只读；客户端侧确认 | 基础具备，但缺少每次高风险调用的服务端确认 |
| annotations 不可信 | 已有 annotations，但权限仍靠只读开关 | 方向正确，不能把 annotations 当授权 |
| 本地 server 最小权限 | 只绑回环、默认只读 | 好，但 Token 权限过大、无范围 |
| HTTP 鉴权/受限 IPC | Bearer 或 query token | 有鉴权，但 CORS/Origin/比较方式可硬化 |
| stateless 请求 | 当前 2025-06-18，有 session | 可继续用，升级需评估 SDK |
| 工具列表稳定 | 19 个工具固定 | 符合；改工具名要同步文档 |

---

## 4. 同类产品：五种不同的 MCP 取舍

### 4.1 SiYuan：能力最全，也最值得作为反例

**事实（社区整理）：** SiYuan 3.7+ 内置 MCP，以管理员身份启动，通过网络伺服暴露 <code>http://127.0.0.1:6806/mcp?token=...</code>，也支持 <code>Authorization</code> 头。2026-07-02 的社区文章列出约 30 个工具，覆盖 document、block、outline、notebook、search、sql、attr、tag、database、dailynote、template、repo、history、web_search、web_fetch、http_request、export、import、ref、bookmark、frontend、system、workspace、sync、file、asset、unzip、skill、todo_write、question。见 [SiYuan MCP 工具整理](https://ld246.com/article/1782963855695)。

**事实（安全公告）：** CVE-2026-66012（GHSA-hp8g-g2qj-wgpj，Critical，影响 <3.7.2）指出：<code>POST /mcp</code> 只由 <code>model.CheckAuth</code> 把关，没有 admin-role 或 read-only 限制，暴露 31 个 MCP 工具，其中 file 工具可对整个 workspace 执行 list/read/write/delete/rename/copy。更严重的是，当 Publish server 处于匿名模式（<code>Conf.Publish.Enable=true</code> 且 <code>Conf.Publish.Auth.Enable=false</code>）时，服务会附加 anonymous RoleReader JWT；远程未认证者可到达 <code>/mcp</code>，读取 <code>conf/conf.json</code> 取得 accessAuthCode、api.token、cookieKey，写任意文件，并在 <code>data/plugins/</code> 植入 <code>nodeIntegration:true</code> 的插件，最终接管管理员权限。

**事实（后续公告）：** GHSA-p23f-cm6q-2qp8 指出 <code>asset.upload</code> 的 <code>files</code> 是绝对路径列表，handler <code>kernel/mcp/tools/asset.go:195</code> 只做 <code>filepath.Abs</code>，没有 workspace 边界或敏感路径检查；<code>kernel/model/upload.go:97</code> 直接 <code>os.Open</code> 并复制进 assets/。<=3.8.0 受影响，3.8.1 修复。利用需要 MCP 已配置且用户点过类别级确认，确认框不显示真实源路径，因此仍属于 prompt injection 的残余风险。

**判断：** SiYuan 的教训不是「不要做 MCP」，而是三条：

1. **工具面越宽，鉴权越不能只看一个入口检查。** 31 个工具里只要有一个文件写入，管理员门槛被绕过就是系统级接管。
2. **admin gate 不等于参数安全。** <code>asset.upload</code> 的绝对路径问题发生在 CVE-2026-66012 修复之后，说明「谁能调用」和「能传什么参数」必须分别校验。
3. **匿名/Publish 模式必须与 MCP 隔离。** 一个面向公网的匿名入口，不应该能到达拥有 workspace 写权限的 MCP 路由。

**对 Tokeru 的映射：** Tokeru 没有 workspace 文件工具，也没有 Publish 模式，这是优势；但 <code>update_question</code> 的题干 HTML、<code>undo_import</code> 的整卷删除、<code>assign_set_folder</code> 的目标校验，属于同一类「参数边界」问题，应该在 P0/P1 处理。

### 4.2 Obsidian：适配器模式与文件夹级权限

**事实：** [cyanheads/obsidian-mcp-server](https://github.com/cyanheads/obsidian-mcp-server) 提供 14 个工具和 3 个 resources，依赖 Obsidian 的 Local REST API 插件；既可作为 stdio 进程运行，也可作为本地 Streamable HTTP server 运行。它的卖点是 folder-scoped read/write permissions，以及对外科手术式编辑 heading、block、frontmatter 的支持。工具包括 get/list/search/write/append/patch note、tags、frontmatter 等。

**判断：** 这是「适配器」而不是「重写数据层」的典型：MCP Server 不直接碰 vault 文件，而是通过 Obsidian 的本地 REST API，权限边界也落在 folder 级别。对 Tokeru 的启示是：如果未来要开放文件/附件能力，应该复用应用自己的存储层并加范围，而不是给 Agent 一个任意路径的 <code>file</code> 工具。

**另一个启示：** Obsidian 把「读」和「写」拆成多个细工具，客户端更容易做确认和回滚；Tokeru 目前是「19 个工具 + 一个只读开关」，粒度偏粗，但胜在简单。短期不必拆成几十个工具，可以先把权限层做出来。

### 4.3 Logseq：本地 API + 两种传输

**事实：** [engolder/mcp-logseq](https://github.com/engolder/mcp-logseq) 要求 Logseq 开启 HTTP API（Settings → Features → HTTP APIs）。默认 stdio；HTTP 模式使用 <code>-http=true -http-port=8080 -stdio=false</code>。它依赖 <code>LOGSEQ_API_URL</code>（默认 <code>http://localhost:12315</code>）和 <code>LOGSEQ_API_TOKEN</code>。工具包括 <code>get_page</code>、<code>write_page</code>、<code>edit_page</code>、<code>search_pages</code>、<code>list_journal_pages</code>、<code>search</code>、<code>get_block</code>，并支持 <code>limit</code>/<code>offset</code> 分页。

**判断：** Logseq 把 Token 放在环境变量里，适合 stdio 客户端；Tokeru 的 HTTP 模式则必须把 Token 放在 header。两者没有优劣，关键是文档要写清楚「stdio 用 env、HTTP 用 header」。Logseq 的 outline text 格式（两空格缩进、<code>- </code> 前缀）也说明：MCP 工具的输出格式是契约，改了就会破坏客户端提示词。

### 4.4 Anytype：从 OpenAPI 生成工具

**事实：** [Anytype 官方 MCP 文档](https://developers.anytype.io/docs/examples/featured/mcp/) 描述的是把 Anytype OpenAPI 规范转换成 MCP tools，需要 Anytype API key；覆盖 global/space search、spaces/members、objects/lists、properties/tags、types/templates 等能力。

**判断：** 这是「已有 API → MCP」的轻量路径，适合 API 稳定、工具数量多的产品。Tokeru 的 19 个工具是手写的，短期不需要 OpenAPI 生成；但如果未来工具数继续增长，应该先有稳定的内部 API 契约，再考虑生成，而不是让 MCP 直接拼 SQL。

### 4.5 Notion：hosted MCP 与 OAuth

**事实：** [Notion MCP 入门](https://developers.notion.com/guides/mcp/get-started-with-mcp) 与 [构建 MCP 客户端](https://developers.notion.com/guides/mcp/build-mcp-client) 描述的是 hosted MCP：推荐 Streamable HTTP 端点 <code>https://mcp.notion.com/mcp</code>，SSE 端点作为回退；使用 OAuth 授权，stdio 客户端可用 <code>npx -y mcp-remote https://mcp.notion.com/mcp</code> 桥接；访问令牌只用于 Notion MCP。

**判断：** Notion 是「远程 SaaS + OAuth + 多租户」模型，Tokeru 是「本机单用户 + 本地 Token」模型，不能照搬。可以借鉴的是「令牌受众单一」和「stdio 客户端用桥接」两点；不需要为了对齐 Notion 而引入 OAuth。

### 4.6 横向对照

| 产品 | 部署形态 | 传输 | 鉴权 | 权限模型 | 工具面 | 对 Tokeru 的启示 |
| --- | --- | --- | --- | --- | --- | --- |
| SiYuan | 本地应用内置 | HTTP（<code>/mcp</code>） | Token + admin | 管理员 + 只读（修复前缺失） | 30–31 个，含文件/系统 | 工具越宽，参数校验越重要 |
| Obsidian | 本地适配器 | stdio / 本地 HTTP | Local REST API | folder-scoped | 14 tools + 3 resources | 适配器 + 细粒度范围 |
| Logseq | 本地应用 + 适配器 | stdio 默认 / HTTP | API token（env） | 应用自身权限 | 页面/块级 | 传输与配置要写清楚 |
| Anytype | 本地/远程 API | MCP（由 OpenAPI 生成） | API key | API 权限 | 空间/对象/属性 | 先有稳定 API 再做 MCP |
| Notion | 远程 hosted | Streamable HTTP / SSE | OAuth | 工作区授权 | 官方工具集 | 令牌受众单一、桥接 stdio |
| Tokeru 4.0.0 | 本地应用内置 | Streamable HTTP | 单 Token + 只读开关 | 全局只读 | 19 个，题库域 | 简单可控，但范围与参数安全不足 |

### 4.7 共同模式

1. **本地优先产品通常不暴露公网。** 即使有 Token，也默认只绑回环；这是最低成本的防线。
2. **权限要么按范围（folder/space），要么按角色（admin/read-only）。** 两者至少有其一；Tokeru 目前只有全局只读。
3. **危险操作需要显式确认。** 删除、覆盖、批量导入是共同的高风险点；annotations 只是提示，服务端仍要校验。
4. **工具输出是契约。** 字段名、分页、格式变化会影响客户端提示词；改名要同步文档和测试。
5. **stdio 与 HTTP 的配置方式不同。** 把 Token 放 env 还是 header，是客户端文档必须写清楚的第一件事。

---

## 5. 客户端配置生态：字段名比协议更容易出错

### 5.1 Claude Desktop

**事实：** [MCP.md](../MCP.md) 第 3.2 节给出 Claude Desktop 的配置：<code>type</code> 为 <code>http</code>，<code>url</code> 指向 <code>http://127.0.0.1:17890/mcp</code>，<code>headers.Authorization</code> 放 Bearer Token。若当前版本只支持 stdio，需要用 <code>mcp-remote</code> 一类桥接，桥接本身也要带 Authorization 头。

**判断：** Claude Desktop 的坑主要在「版本差异」和「改完要完全退出重启」。文档应给出「先测 401，再测 initialize」的顺序，而不是让用户直接粘贴配置后猜。

### 5.2 Cline

**事实：** [Cline MCP 文档](https://docs.cline.bot/mcp/mcp-overview) 说明远程 MCP 必须显式写 <code>"type": "streamableHttp"</code>；省略 <code>type</code> 会按 legacy SSE 处理。它支持 headers/OAuth、<code>autoApprove</code>、<code>disabled</code>，也提供 <code>cline mcp add ... --transport http --header ...</code> 的 CLI。

**判断：** 这是最容易配错的一个：用户可能只写 <code>url</code> 和 <code>headers</code>，结果客户端按 SSE 连接，表现为超时或 404。Tokeru 的设置页示例目前只有 <code>url</code> 和 <code>headers</code>（[MCP.md](../MCP.md) 第 8 节第 4 条也提到这一点），应该补上 Cline 的显式 <code>type</code> 示例。

### 5.3 Continue

**事实：** [Continue MCP 文档](https://github.com/continuedev/continue/blob/main/docs/customize/deep-dives/mcp.mdx) 使用 <code>.continue/mcpServers</code> 下的 YAML；<code>type</code> 支持 <code>sse</code>、<code>stdio</code>、<code>streamable-http</code>；密钥使用 Continue 的 secrets 变量（例如 <code>secrets.X</code>）；MCP 工具只在 agent mode 可用；配置包含 <code>name</code>、<code>command</code>、<code>args</code>、<code>env</code> 等字段。

**判断：** Continue 的 <code>streamable-http</code> 拼写和 Cline 的 <code>streamableHttp</code> 不同，不能互相复制。文档应按客户端分栏，而不是给一个「通用 JSON」就结束。

### 5.4 AnythingLLM

**事实：** [AnythingLLM MCP 文档](https://github.com/Mintplex-Labs/anythingllm-docs/blob/main/pages/mcp-compatibility/overview.mdx) 使用 <code>anythingllm_mcp_servers.json</code>；stdio 是默认方式，必须有 <code>command</code>；<code>sse</code>/<code>streamable</code> 使用 <code>type</code> + <code>url</code>，可带 headers；stdio 配置里如果写了 <code>url</code> 会失败。

**判断：** AnythingLLM 的错误模式是「把 HTTP 配置写成 stdio」或反过来。文档应明确「Tokeru 没有 stdio，所以 AnythingLLM 必须用 streamable，不能只写 command」。

### 5.5 客户端对照

| 客户端 | 传输字段 | Token 位置 | 常见错误 | 建议文档写法 |
| --- | --- | --- | --- | --- |
| Claude Desktop | <code>type: http</code> + <code>url</code> | <code>headers.Authorization</code> | 旧版只支持 stdio | 给 HTTP 与 mcp-remote 两种 |
| Cline | <code>type: streamableHttp</code> | headers | 省略 type 变 SSE | 明确「不能省 type」 |
| Continue | <code>type: streamable-http</code> | secrets 变量 | 拼写错误、非 agent mode | 给 YAML 片段与 secrets |
| AnythingLLM | <code>type: streamable</code> + <code>url</code> | headers | 写成 stdio/command | 明确「Tokeru 无 stdio」 |

### 5.6 生态结论

**判断：** MCP 协议层的兼容性通常不是最大问题，客户端配置字段才是。Tokeru 应该把「配置生成」当成产品能力，而不是文档附属品：用户在设置页选客户端，复制一段已经填好 URL 和 Token 占位符的配置，比读四段文档更可靠。

---

## 6. Tokeru 4.0.0 对照：哪些已经做对，哪些还不够

### 6.1 架构与生命周期

**事实：** Tokeru 的 MCP Server 是 Tauri 进程内的 axum/rmcp 路由，Streamable HTTP，默认 <code>http://127.0.0.1:17890/mcp</code>，19 个工具；只监听回环；默认关闭、默认只读；应用退出即停止；浏览器 mock 不启动；没有 stdio。见 [MCP.md](../MCP.md) 第 1 节。

**判断：** 这个架构适合桌面单用户产品：不需要额外进程、不需要 IPC 权限、不需要把数据库暴露给外部。它的代价是「应用没开就连不上」和「只支持 HTTP 客户端」，但这两点在文档里已经说清楚，属于可接受的产品取舍。

### 6.2 工具面与 annotations

**事实：** 19 个工具中，源码里有 11 个标了 <code>read_only_hint=true</code>：<code>get_import_spec</code>、<code>list_sets</code>、<code>get_set</code>、<code>list_bank</code>、<code>search_questions</code>、<code>get_question</code>、<code>list_tags</code>、<code>list_tag_groups</code>、<code>bank_stats</code>、<code>list_records</code>、<code>get_attempt</code>；其余 8 个是写/导入工具。这个统计来自 <code>src-tauri/src/mcp.rs</code> 的 <code>#[tool(...)]</code> 注解。

**事实：** [MCP.md](../MCP.md) 第 4.1 节把「只读查询」写成 10 个，<code>get_import_spec</code> 放在 4.2「导入与制卷」并注明它只读。两种口径都不算错，但对外文档最好统一：要么按「是否受只读保护」分组，要么按「是否写库」分组，并明确 <code>preview_import</code> 不写库但受只读保护。

**判断：** annotations 与文档口径不一致会增加客户端误判。建议在工具表增加一列「只读保护 / 是否写库 / destructive」，并在发布检查中对比 <code>#[tool]</code> 注解。

### 6.3 鉴权与传输

**事实：** 鉴权中间件接受 <code>Authorization: Bearer</code> 或 <code>?token=</code>；OPTIONS 直接 204；失败返回 401 纯文本；Token 明文存 SQLite；CORS 返回 <code>*</code>，允许 <code>authorization, content-type, mcp-session-id, mcp-protocol-version</code>；没有 Origin 校验、速率限制、失败锁定或 IP 白名单；Token 比较是普通字符串比较。见 <code>src-tauri/src/mcp.rs:162-204</code> 与 [MCP.md](../MCP.md) 第 6.3 节。

**判断：** 这些设计对「本机单用户 + 回环」是够用的，但不应被描述成强安全边界。最现实的风险不是远程扫描，而是：

- 用户把带 <code>?token=</code> 的 URL 贴进聊天/截图/日志；
- 本机恶意网页在知道 Token 后利用 CORS <code>*</code> 发请求；
- 本机其他进程读取 SQLite 或设置页截图拿到 Token。

**建议方向：** 默认只接受 Authorization 头；对带 <code>Origin</code> 的浏览器请求做白名单/拒绝；Token 比较改为常量时间；提供「每客户端 Token + 撤销」和最小审计。具体见第 7.4 节。

### 6.4 写工具的安全边界

**事实：** 所有写工具入口调用 <code>write_guard</code>，只读时返回固定中文错误；<code>preview_import</code> 也受这个检查。写工具不保证目标存在：<code>update_question</code> 对不存在的 <code>question_id</code> 可能返回 <code>updated=true</code>；<code>undo_import</code> 会删除整份试卷及练习记录，没有 dry-run；<code>confirm_import</code> 不复查 2 小时 TTL。见 [MCP.md](../MCP.md) 第 4.2、4.3、8 节。

**判断：** 「默认只读」是很好的第一道门，但它不能替代目标校验和可逆性设计。一个 Agent 在关闭只读后，仍可能因为 id 拼错、预览过期、批量操作而改错/删错。建议：

- 写前 <code>get_question</code>/<code>get_set</code> 校验存在与归属，不存在直接报错，不要返回成功。
- <code>undo_import</code> 增加「预演影响范围 + 二次确认」，至少返回将删除的试卷标题、题量、练习记录数。
- <code>confirm_import</code> 对过期 preview 给出明确错误；不要把 TTL 只写在文档里。
- 对批量写提供 dry-run 或 diff，而不是让调用方自己拼。

### 6.5 请求体与图片上限

**事实：** rmcp 默认请求体上限 4 MiB，而导入规范允许整卷图片预算到 8 MB；带多张 data URL 题图的 JSON 可能先被 413 拒绝，而不是进入 <code>preview_import</code>。见 [MCP.md](../MCP.md) 第 6.5、8 节。

**判断：** 这是「文档承诺与运行时限制不一致」的典型。两个方向都可以：把请求体上限调到覆盖 8 MB 图片预算（并评估内存/滥用风险），或把导入规范的图片预算降到 4 MiB 以内并给出压缩建议。无论选哪个，413 的响应都应包含可操作提示，而不是只给状态码。

### 6.6 富文本渲染：最具体的代码级风险

**事实：** <code>src/lib/richText.ts</code> 的 <code>richStemHtml</code> 在无媒体时全量转义；一旦含 <code>figure</code>/<code>img</code>，按 <code>MEDIA_BLOCK_RE</code> 切分，媒体块原样保留（包括任意属性），其余部分转义。<code>richMaterialHtml</code> 更直接：只要含 figure/img，就整段原样返回。见 <code>src/lib/richText.ts:7-35</code>。

**事实：** 这些 HTML 最终通过 <code>dangerouslySetInnerHTML</code> 进入页面：<code>src/components/PaperView.tsx:472</code>（材料）、<code>src/components/PaperView.tsx:580</code>（题干）、<code>src/pages/AnswersPage.tsx:1776</code>（简要模式完整题干）、<code>src/pages/ResultPage.tsx:298</code>（结果页题干）。

**事实：** MCP 的 <code>update_question</code> 可写题干 HTML，上限 8 MB；<code>preview_import</code>/<code>confirm_import</code> 也接受含 figure/img 的内容。只要这些内容来自不可信 PDF/OCR/网页，或来自被提示注入的 Agent，就可能写入带事件属性的 <code>img</code>/<code>figure</code>。

**判断：** 这是 stored XSS，而不是普通「样式跑偏」。桌面 WebView 中执行脚本的后果取决于 Tauri 能力配置；即使不能直接调用 Rust 命令，也可能读取页面数据、伪造 UI、发起本机请求。应在写入和渲染两端都做白名单：

- 仅允许 <code>figure</code>、<code>img</code>、<code>figcaption</code> 等少量标签；
- <code>src</code> 仅允许 <code>data:image/(png|jpeg|webp|gif)</code>；
- 剥离 <code>on*</code> 事件属性、<code>style</code>、外链和 <code>javascript:</code>；
- 复用 <code>src/components/ui.tsx</code> 已引入的 <code>rehype-sanitize</code> 思路，但不要直接套 Markdown 的 schema，要针对 figure/img 写最小 schema。

### 6.7 数据暴露

**事实：** <code>get_set</code>、<code>get_question</code>、<code>get_attempt</code> 会返回答案、解析和 AI 评语；MCP 不返回 AI API Key，但会返回题库数据、练习记录和错题信息。见 [MCP.md](../MCP.md) 第 6.6 节。

**判断：** 这是产品功能，不是漏洞；但需要在客户端配置页提醒：外部 Agent 可能把工具结果上传到云端。对「正在做题的人」，答案泄露是产品风险；对「把 Tokeru 当第二大脑」的用户，练习记录是隐私数据。建议在设置页加一句「连接前确认客户端的数据处理方式」。

### 6.8 与同类产品对照后的强弱点

| 维度 | Tokeru | SiYuan | Obsidian | 判断 |
| --- | --- | --- | --- | --- |
| 部署 | 进程内、回环 | 进程内、HTTP | 适配器 | Tokeru 更轻，但生态窄 |
| 鉴权 | 单 Token | Token + admin | Local REST API | 都偏本地信任 |
| 权限 | 全局只读 | 修复前缺失，修复后 admin | folder-scoped | Tokeru 需要范围 |
| 工具面 | 19，题库域 | 30–31，含文件/系统 | 14，笔记域 | Tokeru 风险面小 |
| 危险操作 | undo 删整卷 | 文件删/写 | 文件写 | 都需要确认/预演 |
| 传输 | 仅 HTTP | HTTP | stdio/HTTP | 各自匹配产品 |

**判断：** Tokeru 不需要模仿 SiYuan 的工具数量，也不应该因为「别人有文件工具」就加文件工具。它的优势是领域窄、数据结构清楚；应该把这种优势转成更细的权限和更安全的写路径，而不是扩成通用文件系统。

---

## 7. 建议：按风险排序的落地清单

### 7.1 排序原则

1. 先处理「外部输入 → 本机代码执行/数据破坏」的路径，再处理「配置不方便」。
2. 优先做服务端可强制执行的校验，不把安全寄托在客户端确认或 annotations 上。
3. 每项建议都要有可验证的验收条件，避免「加了开关但没有效果」。
4. 不为了对齐规范而做大版本跳跃；先双栈、再迁移。

### 7.2 P0-1：富文本白名单消毒

**问题**：第 6.6 节的 stored XSS 路径。
**动作**：在 <code>richText.ts</code> 增加 <code>sanitizeRichHtml</code>，白名单标签/属性，<code>src</code> 仅允许 <code>data:image/(png|jpeg|webp|gif)</code>，剥离 <code>on*</code>、<code>style</code>、<code>srcdoc</code>、<code>javascript:</code> 和外链；MCP 写入层先消毒再落库，渲染层再消毒一次防旧数据；材料/题干共用同一函数。
**验收**：注入 <code><img src=x onerror=alert(1)></code>、<code><figure onmouseover=...></code> 不执行脚本，DOM 无事件属性；正常 data URL 题图仍显示。
**成本**：1–2 人日。

### 7.3 P0-2：写工具目标校验与撤销确认

**问题**：写工具不校验目标存在；<code>undo_import</code> 无 dry-run；<code>confirm_import</code> 不复查 TTL。
**动作**：<code>update_question</code>/<code>rename_set</code>/<code>update_set_tags</code>/<code>assign_set_folder</code> 先查存在与可写范围，不存在返回 not found；<code>undo_import</code> 增加 <code>dry_run</code> 或 <code>preview_undo_import</code>，返回将删除的试卷标题/题量/记录数，确认后才执行；过期 preview 返回明确错误；批量写提供 diff 或 dry-run。
**验收**：不存在的 <code>question_id</code> 不再返回 <code>updated=true</code>；预演不删数据；过期 preview 被拒。
**成本**：1–2 人日，需改 Rust 工具签名与文档。

### 7.4 P1-1：鉴权硬化

**问题**：CORS <code>*</code>、query token、普通字符串比较、Token 明文、无速率限制。
**动作**：默认只接受 <code>Authorization: Bearer</code>，<code>?token=</code> 降为默认关闭的兼容开关并在 UI 警告；对带 <code>Origin</code> 的请求做白名单，允许无 Origin 的本地 Agent，拒绝未知浏览器 Origin；Token 比较改常量时间；增加每客户端 Token（名称、最后使用、撤销）与简单审计日志，记录失败次数；可选连续 401 退避。
**验收**：未知 Origin 被拒、无 Origin 正常；撤销某 Token 后仅该 Token 401；审计能回答「谁调用了 undo_import，删了哪份卷」。
**成本**：2–4 人日，涉及设置页、DB 迁移和文档。

### 7.5 P1-2：权限分层

**问题**：只有一个全局只读开关，关闭后 Agent 可导入、改题、删卷、整理文件夹。
**动作**：拆成 <code>read</code>、<code>import</code>、<code>edit</code>、<code>admin</code> 四层，默认 <code>read</code>；支持按 folder/set 范围授权；工具入口按层校验，不只靠 UI；<code>preview_import</code> 归入 <code>import</code>；设置页展示当前 Token 能做什么并支持一键降级。
**验收**：<code>read</code> 调写工具报错；<code>import</code> 不能 undo/改题；<code>edit</code> 不能管理文件夹；<code>admin</code> 才能 undo/删除；范围外返回 forbidden。
**成本**：4–8 人日，这是产品能力而非单纯安全补丁。

### 7.6 P1-3：协议升级与双栈

**问题**：当前 2025-06-18，官方最新 2026-07-28 已转 stateless。
**动作**：先确认 rmcp 对 2026-07-28 的支持程度，不支持不要手写协议层；设计双栈，旧客户端走 2025-06-18，新客户端按新版本协商，服务端按请求判断而非连接状态；保留 <code>mcp-session-id</code> 兼容但业务逻辑不依赖；同步文档版本与示例。
**验收**：旧客户端 initialize/tools/call 不回归；新客户端协商成功；无 session 的只读调用可用（若新规范要求）；文档不混淆「最新规范」与「当前实现」。
**成本**：3–5 人日，取决于 SDK。

### 7.7 P1-4：4 MiB 与 8 MB 口径对齐

**问题**：rmcp 默认 4 MiB，导入规范图片预算 8 MB，带图 JSON 可能 413。
**动作**：二选一，提高请求体上限覆盖 8 MB（评估内存/滥用），或把导入规范图片预算降到 4 MiB 内；413 返回可操作提示「压缩题图/拆分材料/改用应用内导入」；MCP.md 与导入规范写同一个数字。
**验收**：带 6 MB data URL 的 JSON 要么成功 preview，要么返回带建议的 413；文档数字与运行时一致。
**成本**：0.5–1 人日。

### 7.8 P2-1：resources / prompts / 批量工具

**问题**：目前只有 tools，导入规范和常用工作流靠文档。
**动作**：把导入规范做成 resource（如 <code>tokeru://import-spec</code>）；提供「清洗试卷」「按标签整理」「安全检查导入」等 prompts，prompt 不直接写库；评估批量更新工具，但必须带 dry-run 与逐项结果；<code>get_set</code> 增加分页/字段选择。
**验收**：客户端能列出并读取 import-spec，内容与 <code>get_import_spec</code> 一致；prompts 不含写操作；批量工具默认 dry-run。
**成本**：3–5 人日。

### 7.9 P2-2：客户端文档与配置生成器

**问题**：Cline/Continue/AnythingLLM 字段名不同，用户容易配错。
**动作**：设置页增加「复制配置」，选客户端生成填好 URL 与 Token 占位符的 JSON/YAML；文档按客户端分栏，写清 <code>type</code> 拼写、Token 位置、是否桥接、是否重启；给只支持 stdio 的客户端桥接示例并提醒带 Authorization；提供 initialize + tools/list + 只读调用的最小连通性测试。
**验收**：四个示例能被对应客户端字段校验接受；新用户 5 分钟内完成一次 <code>list_sets</code>。
**成本**：1–2 人日。

### 7.10 P2-3：可观测性与限速

**问题**：没有速率限制、失败锁定、最近调用记录。
**动作**：记录最近 N 次调用（时间、工具、目标、耗时、结果），设置页可查看/清空；连续失败退避，高频调用软限速；401 加 <code>WWW-Authenticate: Bearer</code>；错误区分缺 Token/Token 错/只读/目标不存在；日志不记录完整 Token 或题干。
**验收**：设置页能看到最近调用与失败原因；连续错误不爆 CPU/日志；日志不含 Token。
**成本**：2–4 人日。

### 7.11 路线图

| 阶段 | 内容 | 退出条件 |
| --- | --- | --- |
| 现在 | P0-1 消毒、P0-2 目标校验/undo 预演 | 安全用例通过；tsc/单测通过 |
| 下一版 | P1-1 鉴权硬化、P1-4 口径对齐 | 未知 Origin 被拒；带图导入有明确结果 |
| 再下一版 | P1-2 权限分层、P1-3 协议双栈 | 四层权限可验证；旧客户端不回归 |
| 后续 | P2 resources/prompts、配置生成器、可观测性 | 配置成功率与排错时间可量化 |

---

## 8. 结论与来源

### 8.1 五条结论

1. **Tokeru 的本地回环 + 默认只读是正确的起点，不应为了「生态兼容」放弃。** 它把最危险的默认值设对了：服务默认关闭、写操作默认拒绝、只绑本机。
2. **下一版的安全重点不是再加一个 Token，而是缩小「关闭只读后能做什么」。** 目标校验、范围授权、undo 预演，比再写一段鉴权文档更有用。
3. **富文本消毒是当前最具体的代码级风险，应该先做。** 它同时影响 MCP 写入、导入、渲染三条路径，修复成本低、收益直接。
4. **协议升级要跟着 SDK 走，不要手写 2026-07-28。** 当前 2025-06-18 仍可用；双栈比一次性切换更稳。
5. **客户端配置是产品体验问题，不是文档问题。** 配置生成器 + 分客户端示例，能显著降低「连不上」的支持成本。

### 8.2 不要做的事

- 不要把 MCP 服务暴露到 <code>0.0.0.0</code> 或公网。
- 不要把 annotations 当权限，也不要把 <code>mcp-session-id</code> 当 Token。
- 不要让 Agent 自动确认导入/撤销；至少保留一次人工确认。
- 不要承诺 <code>preview_id</code> 严格 2 小时过期。
- 不要为了工具数量而加入文件/系统级工具；Tokeru 的优势是领域窄。

### 8.3 待确认的问题

- rmcp 当前版本对 2026-07-28 stateless 语义的支持程度；是否需要升级到新 SDK。
- Tauri WebView 的能力配置与 CSP 是否足以降低 XSS 后果；是否需要在渲染层再加一层 sandbox。
- 是否要把 <code>preview_import</code> 的 annotations 改为更精确的「受只读保护但不写库」，还是维持保守的 <code>read_only_hint=false</code>。
- 4 MiB 与 8 MB 的最终口径；是提高请求体上限，还是降低图片预算。
- 是否需要在 4.1 之前支持每客户端 Token；这会涉及 DB 迁移和设置页改版。

### 8.4 来源清单

以下链接均于 2026-10-24 访问。同类产品的工具数量与配置字段可能随版本变化，发布前应复核。

**官方规范**

- MCP 规范概览（最新版本入口）：https://modelcontextprotocol.io/specification/latest
- 传输（2026-07-28）：https://modelcontextprotocol.io/specification/2026-07-28/basic/transports
- 安全最佳实践（2026-07-28）：https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices
- 工具（2026-07-28）：https://modelcontextprotocol.io/specification/2026-07-28/server/tools

**安全公告**

- SiYuan CVE-2026-66012：https://github.com/advisories/GHSA-hp8g-g2qj-wgpj
- SiYuan asset.upload 路径问题：https://github.com/advisories/GHSA-p23f-cm6q-2qp8

**同类产品**

- SiYuan MCP 工具整理（社区，2026-07-02）：https://ld246.com/article/1782963855695
- Obsidian MCP Server（cyanheads）：https://github.com/cyanheads/obsidian-mcp-server
- Logseq MCP Server（engolder）：https://github.com/engolder/mcp-logseq
- Anytype MCP：https://developers.anytype.io/docs/examples/featured/mcp/
- Notion MCP 入门：https://developers.notion.com/guides/mcp/get-started-with-mcp
- Notion 构建 MCP 客户端：https://developers.notion.com/guides/mcp/build-mcp-client

**客户端**

- Cline MCP 文档：https://docs.cline.bot/mcp/mcp-overview
- Continue MCP 文档：https://github.com/continuedev/continue/blob/main/docs/customize/deep-dives/mcp.mdx
- AnythingLLM MCP 兼容说明：https://github.com/Mintplex-Labs/anythingllm-docs/blob/main/pages/mcp-compatibility/overview.mdx

**Tokeru 内部**

- [MCP.md](../MCP.md)：4.0.0 的权威接入说明，含工具表、鉴权、CORS、排错与实现边界。
- <code>src-tauri/src/mcp.rs</code>：鉴权、CORS、写保护、19 个工具与 annotations。
- <code>src/lib/richText.ts</code>：题干/材料的富文本渲染规则。
- <code>src/components/PaperView.tsx</code>、<code>src/pages/AnswersPage.tsx</code>、<code>src/pages/ResultPage.tsx</code>：富文本的渲染入口。

### 8.5 维护方式

- 改工具名、参数或 annotations：同步本文第 6.2 节与 [MCP.md](../MCP.md) 第 4 节。
- 改鉴权、CORS、Token：同步本文第 6.3、7.4 节与 [MCP.md](../MCP.md) 第 6.3 节。
- 改富文本渲染：同步本文第 6.6、7.2 节，并补一条 XSS 回归用例。
- 改请求体/图片上限：同步本文第 6.5、7.7 节与 [MCP.md](../MCP.md) 第 6.5、8 节。
- 每次发布前重新访问来源清单；规范版本、客户端字段和同类产品工具数都可能变化。
