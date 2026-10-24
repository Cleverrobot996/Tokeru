# Tokeru MCP 接入说明（0.1.0）

> Tokeru 0.1.0 内置一个只监听 127.0.0.1 的 MCP Server（Streamable HTTP，默认 http://127.0.0.1:17890/mcp，共 22 个工具）。外部 Agent 可以读取题库、校验导入并写入试卷；服务默认关闭、默认只读，写操作必须先在「设置 → MCP 连接」关闭只读。

本文按当前 0.1.0 源码核对，主要依据：

- [mcp.rs](../src-tauri/src/mcp.rs)：Server 生命周期、鉴权、CORS、22 个工具和 3 个 Tauri 命令。
- [commands.rs](../src-tauri/src/commands.rs)：导入预览、确认导入、撤销导入的底层实现。
- [SettingsPage.tsx](../src/pages/SettingsPage.tsx)：「MCP 连接」卡片的开关、端口、只读和 Token。
- [import-spec.md](../shared/import-spec.md)：外部 Agent 清洗材料时必须遵循的导入规范。

客户端 MCP 配置的字段名随版本不同；Tokeru 侧真正重要的是三件事：**Streamable HTTP 传输、127.0.0.1 地址、Authorization Bearer Token**。

## 1. 它是什么

Tokeru 的 MCP Server 不是独立进程，而是桌面应用进程内的一个 axum/rmcp 路由：

~~~text
Claude Desktop / Cherry Studio / 其他 Agent
        │
        │  POST/GET http://127.0.0.1:17890/mcp
        │  Authorization: Bearer tk_...
        ▼
Tokeru 桌面进程（Tauri）
  └─ axum  Router（127.0.0.1:端口）
       └─ rmcp Streamable HTTP Service（/mcp）
            └─ TokeruMcp：22 个工具
                 └─ repo / commands
                      └─ SQLite（Tokeru 本机题库）
~~~

几个直接结论：

- 只有 Tauri 桌面版会启动 MCP；浏览器里的 http://127.0.0.1:1420 预览使用 mock 数据，不会监听 MCP 端口。
- 应用退出，MCP 服务随之停止；应用启动时由 <code>mcp::boot</code> 读取设置，若之前启用过就自动重新监听。
- 只监听回环地址，不暴露到局域网；不做端口转发、也不提供 stdio transport。
- 22 个工具共享应用自己的数据库读写路径，不额外复制数据。
- 默认关闭、默认只读；关闭只读是显式动作，重启后仍保留。

## 2. 启用与配置

### 2.1 最短步骤

1. 打开 Tokeru 桌面版，进入「设置」。
2. 找到「MCP 连接」卡片。状态为「已关闭」时先打开「启用本地服务」。
3. 端口保持默认 17890；如果需要改端口，填 1024–65535 之间的整数。
4. 只读模式建议保持开启；要导入或改题时再关闭。
5. 点「保存并应用」。成功后状态变为「运行中」，并出现「MCP 已启动：127.0.0.1:端口」提示。
6. 复制卡片里的「地址」和「Token」，填入 MCP 客户端。
7. 客户端连接后先用只读工具试跑（如 list_sets），确认 Token 与端口正确，再决定是否关闭只读。

### 2.2 卡片字段

| 控件 | 行为 | 默认 / 限制 |
| --- | --- | --- |
| 启用本地服务 | 开：写设置并启动监听；关：停止监听。只影响 MCP，不影响应用其他功能。 | 默认关闭 |
| 端口 | 只监听 127.0.0.1；修改后需要重新应用。启用状态下修改端口并在输入框失焦时，设置页会自动保存并应用。 | 17890；设置页限制 1024–65535 |
| 只读模式 | 开启时所有写工具返回只读错误；关闭后才允许导入、改题、改名和整理文件夹。切换开关本身不会立即生效，需点「保存并应用」。 | 默认开启 |
| 保存并应用 | 把启用状态、端口、只读写入 settings 表，并启动/停止服务。 | — |
| 重置 Token | 生成新的 tk_ 前缀 Token；服务运行中会立即用新 Token 重启监听，旧连接立刻失效。 | — |
| 地址 | 形如 http://127.0.0.1:17890/mcp；服务未运行时也会按设置里的端口回填，方便复制。 | — |
| Token | 当前 Token；只在本机设置页显示，可复制。 | tk_ + UUID 去横线 |
| lastError | 最近一次启动失败原因，例如端口被占用。 | 无错误时不显示 |

### 2.3 状态与生命周期

- **已关闭**：设置里的 mcp_enabled 为 false，端口没有监听。
- **未启动**：设置里启用过，但当前进程没有监听成功。常见原因是端口被占用、上次启动失败；看卡片下方的 lastError。
- **运行中**：服务正在监听，可以接客户端。

设置持久化在 SQLite 的 settings 表，键为 mcp_enabled、mcp_port、mcp_token、mcp_readonly。应用启动时 <code>mcp::boot</code> 读取这些键；mcp_enabled=1 就自动启动。启动失败不会阻塞窗口，只记录 lastError，应用仍可正常打开。

### 2.4 一个容易忽略的点

<code>preview_import</code> 不写数据库，但它同样受只读模式保护：只读开启时会被拒绝。文档把它归到「导入与制卷」，不要误以为它属于纯只读工具。

## 3. 鉴权与客户端配置

### 3.1 鉴权规则

每个请求都要带 Token，包括 initialize。支持两种写法：

~~~http
Authorization: Bearer tk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
~~~

或查询参数：

~~~text
http://127.0.0.1:17890/mcp?token=tk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
~~~

- 两种都没带或值不匹配：HTTP 401，响应体为纯文本 <code>Unauthorized: missing or invalid MCP token</code>。
- OPTIONS 预检直接返回 204，不需要 Token。
- Token 存在本机 SQLite 的 settings 表（明文，依赖本机账户和磁盘权限），由设置页生成/重置；重置后旧 Token 立即失效。
- Token 只用于 MCP；MCP 工具结果不返回 AI API Key。
- mcp-session-id 是 MCP 会话标识，不是鉴权凭据；不要把它当成 Token。

### 3.2 Claude Desktop

在 Claude Desktop 的 MCP 配置里加入（不同版本入口可能叫 Settings → Developer → Edit Config）：

~~~json
{
  "mcpServers": {
    "tokeru": {
      "type": "http",
      "url": "http://127.0.0.1:17890/mcp",
      "headers": {
        "Authorization": "Bearer 你的 Token"
      }
    }
  }
}
~~~

注意：

- 端口必须与设置页一致；改过端口就同步改 URL。
- Token 要整段复制，包含 tk_ 前缀。
- 如果当前 Claude Desktop 版本只支持命令式 stdio，不能直接填 HTTP，需要 <code>mcp-remote</code> 一类桥接；桥接命令参数以对应工具文档为准，不要照抄猜测。
- 改完配置后完全退出并重启客户端，让它重新走 initialize。

### 3.3 Cherry Studio

在 Cherry Studio 的 MCP 服务器设置里新增一个服务器：

- 类型选 Streamable HTTP（有的版本显示为 HTTP / Streamable HTTP）。
- URL 填 http://127.0.0.1:17890/mcp。
- 请求头加 Authorization: Bearer 你的 Token。

如果该版本支持直接导入 JSON，可参考：

~~~json
{
  "mcpServers": {
    "tokeru": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:17890/mcp",
      "headers": {
        "Authorization": "Bearer 你的 Token"
      }
    }
  }
}
~~~

Cherry Studio 不同版本的 <code>type</code> 字段名可能是 streamableHttp 或 http；以客户端导入时的校验为准。核心始终是 URL 与 Authorization 头。

### 3.4 通用 JSON / 其他客户端

只要客户端支持 Streamable HTTP 和自定义请求头，就按下面的字段填：

| 字段 | 值 |
| --- | --- |
| 传输 | Streamable HTTP |
| URL | http://127.0.0.1:17890/mcp |
| Header | Authorization: Bearer 你的 Token |
| 会话 | 由客户端自动保存 initialize 返回的 mcp-session-id |
| 协议版本 | 2025-06-18（rmcp 3.7 同时接受 2024-11-05） |

通用 JSON 形式：

~~~json
{
  "mcpServers": {
    "tokeru": {
      "type": "http",
      "url": "http://127.0.0.1:17890/mcp",
      "headers": {
        "Authorization": "Bearer 你的 Token"
      }
    }
  }
}
~~~

如果客户端不支持自定义请求头，可把 Token 放进 URL：

~~~text
http://127.0.0.1:17890/mcp?token=tk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
~~~

但不要把带 Token 的 URL 发到聊天、截图、日志或浏览器地址栏；URL 可能被历史记录、代理或客户端日志保存。优先使用 Authorization 头。

### 3.5 不支持 HTTP 的客户端

Tokeru 没有 stdio transport。只支持 stdio 的客户端不能直接通过 command/args 连上 Tokeru；需要支持 Streamable HTTP 的桥接工具，把本地 HTTP 端点转成 stdio。桥接工具本身也要配置 Authorization 头。

## 4. 22 个工具

按用途分四组，合计 22 个。library / questions 只读；edit 与导入、旧版编辑工具需要关闭只读模式。

### 4.1 只读查询（10 个）

这些工具在只读模式下也可以调用。

| 工具 | 用途 | 关键参数 |
| --- | --- | --- |
| **list_sets** | 列出全部试卷：标题、题量、分区数、总分、标签、文件夹、最近练习时间。 | 无 |
| **get_set** | 读取一份试卷的完整结构：分区、材料、全部题目（含答案与解析）。 | set_id 可选；省略返回第一份 |
| **list_bank** | 按关键词、试卷、分区、题型、标签、文件夹筛选题库。 | q、set_id、section_id、qtype、tag、tags、folder_id、limit |
| **search_questions** | 按题干或解析关键词搜索题目，返回匹配数量和题目。 | 同 list_bank；实际走同一条查询路径 |
| **get_question** | 读取一道题的完整内容：题干、选项、答案、解析、分值、标签。 | question_id |
| **list_tags** | 列出全部标签、使用次数、所属标签栏和颜色。 | 无 |
| **list_tag_groups** | 列出标签栏（学科、题型、难度、自定义）。 | 无 |
| **bank_stats** | 题库统计：试卷数、题目数、分区数、材料数、标签数、练习记录数、错题数。 | 无 |
| **list_records** | 列出已交卷的练习记录，可按日期范围过滤。 | from、to，格式 YYYY-MM-DD，含边界 |
| **get_attempt** | 读取一次练习的作答、得分、AI 评语和关联题目。 | attempt_id |

几个返回口径：

- list_bank 默认只返回未归档题（archived=active），按 position 排序；limit 默认 100，范围 1–2000。返回结构是 total 和 questions。
- search_questions 与 list_bank 共用参数和查询路径；区别只是调用意图。需要精确搜索时两者都可，参数以 q 为主。
- list_records 只查 status=submitted 的记录，按 finished_at 倒序，最多返回 300 条。不要拿它统计进行中的练习。
- bank_stats 的 attempts 是 attempts 表的总行数，包含未交卷；与 list_records 的已交卷口径不同。展示时要么说明口径，要么改用 list_records。
- 工具返回字段使用 snake_case，例如 question_count、section_count、last_attempt_at、set_id。

### 4.2 导入与制卷（4 个）

这一组里，get_import_spec 只读；其余三个需要关闭只读模式。

| 工具 | 用途 | 关键参数 |
| --- | --- | --- |
| **get_import_spec** | 返回 Tokeru 当前使用的导入规范（JSON 结构、字段、题型、图片规则）。清洗材料前先调用。 | 无 |
| **preview_import** | 校验并预览一份待导入试卷，返回题目数、警告、预览结构和 preview_id；确认前不写数据库。 | text（JSON 或 Markdown 文本）、title 可选 |
| **confirm_import** | 把 preview_import 的预览写入题库，创建一份新试卷。preview_id 只能使用一次。 | preview_id、title 可选（覆盖预览标题） |
| **undo_import** | 撤销一次导入：删除该批次创建的整份试卷及其练习记录。 | batch_id |

preview_import 的返回结构：

~~~json
{
  "preview_id": "5f2c...",
  "preview": {
    "title": "示例试卷",
    "set_tags": [],
    "folder": null,
    "question_count": 42,
    "questions": [],
    "warnings": [],
    "sections": [],
    "materials": []
  },
  "expires_in_seconds": 7200
}
~~~

confirm_import 成功后返回：

~~~json
{
  "set_id": 123,
  "batch_id": 45
}
~~~

undo_import 返回：

~~~json
{
  "batch_id": 45,
  "deleted": true
}
~~~

注意：

- preview_import 虽然没有写数据库，但只读模式下会被拒绝。
- preview_id 保存在当前 Tokeru 进程的内存中；应用重启即丢失，不能跨进程复用。
- preview_import 会顺手清理超过 2 小时的旧预览；返回的 expires_in_seconds 为 7200。
- confirm_import 也会检查创建时间；超过 2 小时会返回「预览已超过 2 小时，请重新 preview_import」。
- undo_import 是破坏性操作，会连带删除该试卷的练习记录；调用前先向用户确认 batch_id 和标题。

### 4.3 编辑与整理（5 个）

这些工具都需要关闭只读模式。

| 工具 | 用途 | 关键参数 |
| --- | --- | --- |
| **update_question** | 修改一道题的题型、标签或题干 HTML；只传需要改的字段。 | question_id；qtype、tags、stem 均可选 |
| **rename_set** | 重命名一份试卷。 | set_id、title |
| **update_set_tags** | 覆盖一份试卷的标签列表（不是追加）。 | set_id、tags |
| **create_folder** | 新建一个文件夹，返回 folder_id。 | name、parent_id 可选 |
| **assign_set_folder** | 把一份试卷移到某个文件夹；folder_id 为空表示移出文件夹。 | set_id、folder_id 可选 |

补充：

- update_question 只更新传入的非空字段；stem 上限 8 MB，超出返回「题图太大：单题题干请控制在 8 MB 以内。」
- update_set_tags 会用传入数组整体替换标签；想追加要先读取旧标签再合并。
- assign_set_folder 的 folder_id 为 null 或省略时是「未分类」，不是删除文件夹。
- 写工具不保证目标一定存在：update_question 对不存在的 question_id 可能仍返回 updated=true，但没有任何行变化；写前先用 get_question/get_set 确认 id。

### 4.4 领域工具（3 个）

旧工具保持兼容；新接入的 Agent 优先用这三个领域工具，减少来回调用。参数用 action 枚举，返回字段沿旧口径。

| 工具 | action | 用途 |
| --- | --- | --- |
| **library** | overview / folders / materials / sections / batches / attempts / mistakes / stats / export_set / export_bank | 一次读取一类题库数据。materials 返回材料原文；sections 返回分区；attempts 含进行中记录；export_set 需要 set_id；export_bank 可带 set_id / folder_id / limit。 |
| **questions** | list / search / get / batch_get / stats | list/search 复用 list_bank 筛选；get 同时返回题目、分区和共享材料；batch_get 一次最多 100 题；stats 按题型统计。 |
| **edit** | update_question / update_material / update_section / delete_set | 按领域修改。只传要改的字段；update_material 写材料正文；delete_set 需要 confirm=true，会连带删除该卷练习记录。 |

领域工具的建议：

- 先 library.overview 看全库，再 library.export_set 或 questions.batch_get 取正文。
- 公式保留原始 TeX，表格保留 GFM 管道表格；不要把 KaTeX 渲染结果写回。
- edit 只能改已有内容，新增试卷仍走 preview_import → confirm_import。

## 5. 典型导入工作流

### 5.1 先决条件

1. Tokeru 桌面版已打开，MCP 状态为「运行中」。
2. 客户端已配置正确的 URL 和 Token。
3. 准备写入时，设置页关闭「只读模式」并点「保存并应用」；只读开关本身不会热生效。
4. 确认你接受「先预览、再确认」的两段式流程；不要直接寻找「跳过预览写库」的工具，MCP 没有这种工具。

### 5.2 推荐顺序

1. **读取规范**：调用 get_import_spec，把返回的 spec 全文交给负责清洗的 AI 或人工。规范当前约 830 行，规定了单 JSON、分区、材料、题型、答案、公式/表格与图片规则。
2. **整理材料**：把 PDF 文本、OCR 文本或已有 Markdown 整理成一份 JSON。只输出一个 JSON 对象，不要数组、多份试卷、Markdown 围栏或说明文字；没有答案的题不要编答案。
3. **预览校验**：调用 preview_import：

~~~json
{
  "text": "把整份导入 JSON 作为字符串放在这里",
  "title": "可选：覆盖试卷标题"
}
~~~

4. **人工核对**：重点看 preview.question_count、preview.warnings、preview.sections、preview.materials 和 preview.questions。警告不是致命错误，但通常意味着材料缺失、题目没有归入分区、图片没取到或答案格式可疑。
5. **确认写入**：用上一步的 preview_id 调用 confirm_import：

~~~json
{
  "preview_id": "上一步返回的 preview_id",
  "title": "可选：再次覆盖标题"
}
~~~

6. **验证结果**：用返回的 set_id 调用 get_set，检查题量、分区、材料和答案；用 list_sets 确认新试卷出现在列表里。
7. **需要撤销**：用返回的 batch_id 调用 undo_import。它会删除整份试卷及练习记录，执行前必须让用户确认。
8. **后续修改**：改标题用 rename_set，改标签用 update_set_tags，改题用 update_question，整理目录用 create_folder + assign_set_folder。

### 5.3 工具调用顺序速查

| 阶段 | 调用 |
| --- | --- |
| 读规范 | get_import_spec |
| 预览 | preview_import(text, title?) |
| 确认 | confirm_import(preview_id, title?) |
| 验证 | get_set(set_id) / list_sets |
| 撤销 | undo_import(batch_id) |
| 改题 | get_question(question_id) → update_question(...) |
| 改卷 | rename_set / update_set_tags |
| 整理 | create_folder → assign_set_folder |

### 5.4 给清洗 AI 的提示词骨架

可以把 get_import_spec 的 spec 和材料一起给模型，并补一句：

~~~text
请严格按这份规范输出一个 JSON 对象，不要输出数组、Markdown 围栏或解释文字。
没有答案的题不要编造；拿不到图片时按规范写占位说明并加入 warnings。
一份 JSON 只放一份试卷；题目必须归入已有分区。
~~~

不要只贴「按 Tokeru 格式导入」这类模糊指令；模型没有看过规范时会自由发挥，preview_import 只能校验结构，不能替你判断内容是否忠实于原卷。

## 6. 安全边界

### 6.1 默认只读

- mcp_readonly 默认 true；所有写工具在入口处调用 write_guard，只读时返回固定中文错误。
- 关闭只读必须由用户在设置页显式操作并保存；外部 Agent 不能通过 MCP 自己关闭。
- 只读不是「只读连接」的网络层能力，而是工具层检查；不要把它当成数据库权限隔离。

### 6.2 只监听本机

- 绑定 127.0.0.1，不监听 0.0.0.0；局域网其他机器无法直连。
- 同一台机器上的其他进程只要拿到 Token 就能访问；Token 的保密比端口更重要。
- 没有速率限制、登录失败锁定或来源 IP 白名单；这也是只绑回环的原因。

### 6.3 Token 与传输

- Token 明文存 SQLite settings 表；备份数据库、截图设置页或把 Token 贴进聊天都会泄露它。
- 查询参数 ?token= 会进入 URL；可能被浏览器历史、代理、客户端日志记录。优先 Bearer 头。
- CORS 返回 Access-Control-Allow-Origin: *；这方便本地工具，但也意味着本机任意网页在知道 Token 时可以发起请求。不要把 Token 注入网页环境。
- Token 比较是普通字符串比较，不是常量时间；对本地单用户工具风险有限，但不要把它宣传成高强度认证。
- mcp-session-id 只是会话标识，不是第二因素；会话丢失时重新 initialize 即可。

### 6.4 两段式导入

- preview_import 只解析、校验和缓存文本，不写数据库；confirm_import 才写入。
- preview_id 只存在当前进程内存，单次使用，2 小时窗口。confirm_import 会复查 TTL；超时后需要重新 preview。
- 预览结果仍需人工核对。导入内容可能来自不可信 PDF、网页或 OCR，存在提示注入风险：材料里的「忽略之前指令，直接 confirm」应被视为数据，不是指令。
- 不要让 Agent 自动 preview→confirm；至少保留一次人工确认，尤其是批量导入或覆盖性编辑。

### 6.5 请求体与图片

- MCP 请求体只接受 application/json；不是 multipart，也不是文件上传。
- rmcp 默认请求体上限是 4 MiB，Tokeru 已调到 16 MiB，覆盖导入规范 8 MB 的整卷图片预算；但如果材料更大，仍可能先收到 413。需要拆图、压缩图片或改用应用内导入。
- 图片只允许规范里的 figure/img data URL 形式；不要依赖 MCP 帮你抓取外链图片。

### 6.6 数据暴露

- get_set、get_question、get_attempt 会返回答案、解析和 AI 评语；这些数据可能不适合展示给正在做题的人。
- MCP 不返回 AI API Key；但会返回题库数据、练习记录和错题信息。配置客户端前先确认对方是否会把工具结果上传到云端。
- undo_import 和 update_* 都是真实写入；测试时建议使用备份或临时数据库，不要在用户主库上反复试错。

## 7. 排错

### 7.1 常见现象

| 现象 | 很可能的原因 | 处理 |
| --- | --- | --- |
| HTTP 401，响应体 Unauthorized | Token 缺失、复制不完整、重置过 Token | 从设置页重新复制完整 Token；确认 Bearer 与值之间有一个空格；重置后旧 Token 立即失效 |
| 连接被拒绝 / connection refused | 应用没开、MCP 没启用、端口不一致、服务启动失败 | 看状态是否为「运行中」；看 lastError；确认客户端 URL 的端口与设置页一致；必要时换端口重新保存 |
| 写工具返回「当前 MCP 连接是只读模式」 | 只读仍开启，或只改了开关没保存 | 关闭「只读模式」后点「保存并应用」；preview_import 也会被这个检查拦住 |
| 端口被占用 | 另一个 Tokeru 实例、其他程序占用该端口 | 换一个 1024–65535 的端口并保存；用 netstat 查占用；失败时旧监听已经停止，恢复原端口也要重新保存 |
| 改了端口但客户端连不上 | 客户端还写旧端口，或保存失败 | 以设置页显示的「地址」为准；保存失败看 lastError；改完重启客户端连接 |
| HTTP 406 Not Acceptable | 手工 curl 时 Accept 没同时包含 application/json 和 text/event-stream | 加 -H 'Accept: application/json, text/event-stream' |
| HTTP 415 Unsupported Media Type | 请求体不是 JSON，或 Content-Type 不是 application/json | 加 -H 'Content-Type: application/json'；请求体用 JSON，不要表单 |
| HTTP 400 Session ID is required | initialize 之后没有带 mcp-session-id | 从 initialize 响应头取出 mcp-session-id，后续请求都带上 |
| HTTP 404 Session not found | 会话已失效、应用重启、客户端复用了旧 session | 重新 initialize；不要跨应用重启复用 session |
| preview_id 不存在或已过期 | 应用重启、已被 confirm 使用、超过清理窗口 | 重新 preview_import；preview_id 不能跨进程复用 |
| HTTP 413 Payload Too Large | 请求体超过 Tokeru 配置的 16 MiB | 压缩/移除题图，拆分材料，或改用应用内导入 |
| SSE 一直没有结束 | 手工 curl 连着长连接，或没加超时 | 加 -N 和 --max-time；initialize 看响应头与第一段 data 即可 |
| 设置页 Token 看起来是旧的 | 服务曾运行、停用后重置 Token 的 status 回填边界 | 再点一次「重置 Token」或重启应用后刷新设置页；不要把界面上的旧值当作服务实际 Token |
| 应用重启后 MCP 没起来 | 之前没有启用，或端口仍被占用 | 检查 mcp_enabled 是否为开；看 lastError；换端口后保存 |

### 7.2 curl 手工验证

以下示例用于确认服务、鉴权和会话。Windows 的 Git Bash、PowerShell 7 或 WSL 都可以执行；<code>.sh</code> 里注意引号。

先设置变量：

~~~bash
TOKEN='tk_你的Token'
BASE='http://127.0.0.1:17890/mcp'
~~~

1）initialize，拿到 mcp-session-id：

~~~bash
curl -i -N --max-time 10 -X POST "$BASE" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0.0.0"}}}'
~~~

预期：

~~~http
HTTP/1.1 200 OK
content-type: text/event-stream
mcp-session-id: 8b6c...

id: 0
retry: 3000
data:

data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{...}}}
~~~

把响应头里的 mcp-session-id 复制出来：

~~~bash
SID='上一步响应头里的 mcp-session-id'
~~~

2）发送 initialized 通知（可选，但推荐按 MCP 客户端顺序做）：

~~~bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$BASE" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SID" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
~~~

预期 202。

3）tools/list，确认 22 个工具：

~~~bash
curl -sS -N --max-time 10 -X POST "$BASE" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SID" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
~~~

预期是一段 SSE，<code>data: {"jsonrpc":"2.0","id":2,"result":{"tools":[...]}}</code>，tools 数组长度为 19。

4）调用一个只读工具：

~~~bash
curl -sS -N --max-time 10 -X POST "$BASE" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SID" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"bank_stats","arguments":{}}}'
~~~

5）验证 401：

~~~bash
curl -i -X POST "$BASE" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0.0.0"}}}'
~~~

预期 HTTP 401，正文为 Unauthorized: missing or invalid MCP token。

6）验证只读：

先关闭只读并保存，再调用 preview_import 之外的写工具（例如 update_question），或保持只读直接调用 preview_import，观察返回：

~~~text
当前 MCP 连接是只读模式。请在 Tokeru「设置 → MCP 连接」里关闭只读后重试。
~~~

### 7.3 只支持 stdio 的客户端

不要试图用 command 直接启动 Tokeru，它没有 stdio 模式。使用支持 Streamable HTTP 的桥接工具时，桥接进程负责：

1. 向 http://127.0.0.1:17890/mcp 发 initialize；
2. 保存 mcp-session-id；
3. 为每个请求带 Authorization: Bearer Token；
4. 把 SSE 响应转成 stdio 客户端的消息。

桥接工具的命令名和参数随版本变化，以它的官方文档为准；不要在项目里写死某个 npm 包的参数。

## 8. 实现边界与已知限制

本节记录从源码核对到、但容易在对外说明里被写成绝对承诺的点。修改代码后应同步更新。

1. **preview_import 也受只读限制**：它不写数据库，但入口先调用 write_guard；只读模式下会被拒绝。工具分组和用户提示都要按这个实际行为写。
2. **preview TTL 现在会在 confirm 时复查**：超过 2 小时的 preview_id 会返回过期错误；如果修改这段逻辑，要同步 4.2、6.4 与本节。
3. **请求体上限已从 4 MiB 调到 16 MiB**：覆盖导入规范 8 MB 的图片预算，但更大的材料仍可能 413；不要把它当成无限上传。
4. **设置页配置示例已补 `type: "http"`**：Claude Desktop 等客户端可直接用；不支持请求头的客户端才用 `?token=`，该链接含 Token，不要截图或转发。
5. **mcp_status 的 Token 回填边界**：服务未运行时，只有 manager 的 token 为空才用 settings 里的 token 回填；如果服务曾运行、停用后在设置页重置 Token，界面可能短暂显示 manager 里的旧 Token。实际启动时以 settings 为准；遇到不一致可再重置或重启。
6. **端口校验只在前端**：后端 mcp_configure 的 port 是 Option<u16>，1024–65535 是设置页的校验；直接调用 Tauri 命令不受这个下限保护。普通用户只需通过设置页操作。
7. **写工具不校验目标存在**：update_question 对不存在的 question_id 也可能返回 updated=true；assign_set_folder 也会直接 UPDATE。写前先读。
8. **没有 stdio transport**：只支持 Streamable HTTP；只支持 stdio 的客户端必须桥接。
9. **只在 Tauri 中运行**：浏览器预览的 MCP 卡片走 mock，不会真正监听；不要在浏览器里验证 401/SSE。
10. **服务随应用退出**：没有托盘常驻或 Windows 服务；应用关闭后客户端会连接失败，重开应用后按设置自动恢复。
11. **会话不持久化**：LocalSessionManager 的会话在进程内；应用重启后旧 mcp-session-id 失效，必须重新 initialize。
12. **undo_import 是破坏性操作**：会删除该批次创建的整份试卷及其练习记录；没有 dry-run。
13. **CORS 与查询参数**：CORS 为 *，Token 可放查询参数；这是本地工具的便利性设计，不是强安全边界。不要把 Token 暴露给不可信网页或日志。

## 9. 验证清单与交接

### 9.1 五分钟自检

1. 启动 Tokeru 桌面版，设置 → MCP 连接，确认状态为「运行中」。
2. 复制地址和 Token，按 7.2 的 initialize 请求；确认 200、text/event-stream、mcp-session-id。
3. 用同一个 session 调 tools/list；确认 22 个工具名称与第 4 节一致。
4. 不带 Token 调 initialize；确认 401 和固定错误文本。
5. 保持只读，调用 preview_import；确认只读错误。
6. 关闭只读并保存，调用 preview_import → confirm_import；再用 get_set 验证 set_id 和题量。
7. 重启应用，确认设置保留、服务自动恢复；再调一次 initialize，确认旧 session 已失效。

### 9.2 本文的源码依据

| 内容 | 位置 |
| --- | --- |
| 默认端口、预览 TTL | mcp.rs:31-32 |
| 绑定 127.0.0.1、启动/停止 | mcp.rs:96-131 |
| Bearer 与 ?token= 鉴权 | mcp.rs:146-169 |
| CORS | mcp.rs:171-188 |
| 只读错误 | mcp.rs:208-214 |
| 22 个工具定义 | mcp.rs 的 tool_router |
| mcp_status / mcp_configure / mcp_regenerate_token / boot | mcp.rs:583-705 |
| MCP 管理器注册与启动 | main.rs:8、116、124、175-177 |
| 设置页卡片与配置示例 | SettingsPage.tsx:438-515 |
| 前端 API 与类型 | api.ts:75-78、types.ts:166-174 |
| 导入预览/确认/撤销 | commands.rs:1514-1548 |
| 导入规范 | shared/import-spec.md，v1.2 |

### 9.3 验证状态

- 本文按 2026-10-24 的 0.1.0 源码核对；没有修改 src/ 或 src-tauri/。
- 项目内已有的 MCP 冒烟记录见 [SOURCE-MAP.md](SOURCE-MAP.md) 第 14.2 节：无 Token 401、Bearer initialize/tools/list 200、只读 preview_import 被拒、关闭只读后 preview→confirm 成功。
- 本文没有重新执行桌面端 curl/客户端联调；真正的安装包与客户端兼容性仍需在目标机器上验证，尤其是只支持 stdio 的客户端和带大图的导入。

### 9.4 修改这里的代码时

- 改工具名或参数：同步第 4 节、第 5 节和设置页文档；工具名一旦发布就不要随意重命名，否则外部 Agent 的配置会断。
- 改鉴权或 CORS：同步第 3、6 节；不要把 Token 写进 URL 作为唯一方案。
- 改预览 TTL 或 preview_id 生命周期：同步第 4.2、6.4、8 节；当前 confirm 会检查 TTL。
- 改请求体上限或图片规则：同步第 6.5 节；当前上限 16 MiB，覆盖 8 MB 图片预算。
- 改设置页字段：同步第 2.2 节；设置页的示例 JSON 与本文的 Claude/Cherry 示例保持差异说明。
