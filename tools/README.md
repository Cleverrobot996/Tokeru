# shot.mjs — 截图 / 调试工具

零依赖（Node 22+ 内置 WebSocket/fetch），自己起 headless Edge、自己说 CDP。一条命令出图 + 抓控制台报错，替掉「开浏览器 → 手截图 → 翻控制台 → 贴图」的慢循环。

```bash
node tools/shot.mjs --route /bank --out tools/shots/bank.png
```

单次约 1.6–2s（含 Edge 启停）。默认视口 1600x1000、浅色、连 Vite dev（127.0.0.1:1420）。

## 常用示例

```bash
# 1) 题库页截图
node tools/shot.mjs --route /bank --out tools/shots/bank.png

# 2) 深色 + 主题色 teal + 1280x800
node tools/shot.mjs --route /bank --out tools/shots/bank-dark.png --dark --accent teal --w 1280 --h 800

# 3) 整页截图（长页面一次全拍，最高 16000px）
node tools/shot.mjs --route /settings --out tools/shots/settings-full.png --full

# 4) 先点开「详细」再截图（支持中文文本匹配）
node tools/shot.mjs --route /bank --out tools/shots/bank-detail.png --click 详细 --wait 700

# 5) 填表单再截图（React 受控组件也能填）
node tools/shot.mjs --route /import --out tools/shots/import.png --type selector::要填的文本

# 6) 多步脚本：切路由 / 切视口 / 切主题 / 连续截图
node tools/shot.mjs --steps tools/steps/example.mjs

# 7) 一次抓全部页面两档尺寸 + 深色的证据截图
node tools/shot.mjs --steps tools/steps/qa-all.mjs

# 8) 给程序解析：stdout 只有 JSON，日志走 stderr
node tools/shot.mjs --route /bank --json --diag | jq '{url, errors: (.consoleErrors|length), failed: (.failedRequests|length), hScroll: .diag.hScroll}'

# 9) 桌面窗口（用户已开的 app.exe）
#    启动 exe 前设置 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333
node tools/shot.mjs --target tauri --route /bank --out tools/shots/tauri-bank.png
```

`--click` 里写选择器时请加引号；中文按钮可以直接写文字：`--click 开始练习`。

## 参数

| 参数 | 说明 |
| --- | --- |
| `--route <path>` | hash 路由，如 `/bank`、`/sets/1/exam`；也接受完整 URL |
| `--out <file.png>` | 截图输出（目录自动创建） |
| `--w` `--h` `--dpr` | 视口，默认 1600x1000 dpr1 |
| `--full` | 整页截图（captureBeyondViewport） |
| `--dark` / `--light` | 主题；预置 localStorage + 覆盖 dataset.theme |
| `--accent <name>` | violet / teal / amber / rose / slate |
| `--wait <ms>` | 截图前等待，默认 400 |
| `--click <sel>` | 可重复；`text=中文` 按可见文本点 |
| `--type <sel::text>` | 可重复；原生 setter + input/change，React 受控可用 |
| `--eval <js>` | 可重复；执行表达式并打印结果 |
| `--scroll <选择器或多个像素值>` | 截图前滚动：选择器 / bottom / 数字 |
| `--diag` | 结构自检：横向滚动、溢出元素、无样式控件、写死颜色、「解」字、错误遮罩 |
| `--json` | stdout 只输出 JSON |
| `--text` | 额外输出页面 innerText |
| `--target vite` / `tauri` | vite=自起 headless Edge；tauri=连已开的桌面窗口 9333 |
| `--profile <dir>` | 复用 profile，保留 localStorage / mock 数据 |
| `--steps <file.mjs>` | 多步脚本 |
| `--keep` | 保留临时 profile，排错用 |
| `--timeout` `--step-delay` `--port` `--edge` `--base` | 超时、步骤间隔、固定调试端口、浏览器路径、服务地址 |

## 多步脚本

脚本导出一个数组（也可以是返回数组的函数），按顺序执行：

```js
export default [
  { route: '/bank' },              // 切路由（或 nav）
  { wait: 500 },                   // 等 ms
  { viewport: '1280x800' },        // 或 { w, h }
  { theme: 'dark' },               // 改 dataset.theme
  { accent: 'teal' },
  { clickText: '开始练习' },        // 或 click: '选择器'
  { type: 'input::hello' },        // 或 { selector, text }
  { press: 'Enter' },
  { waitFor: '.paper', timeout: 5000 },
  { scroll: 'bottom' },            // 或选择器 / 像素
  { eval: 'location.hash' },
  { shot: 'tools/shots/a.png' },   // 或 { out, full: true, theme, wait }
  { diag: 'bank' },                // 记录一次结构自检
];
```

`tools/steps/qa-all.mjs` 是现成的全站巡检脚本：9 条路由 × 1600/1280 两档 + 深色，截图落在 `tools/shots/qa/`。可用 `SHOT_ONLY=home,bank` 只跑其中几条。

## --json 输出

```jsonc
{
  ok: true,
  url: 'http://127.0.0.1:1420/#/bank',
  title: 'Tokeru',
  text: '页面 innerText（最长 20000 字）',
  textLength: 6208,
  theme: 'dark', accent: 'teal',
  target: 'vite', viewport: { w: 1600, h: 1000, dpr: 1 },
  consoleErrors: [{ kind: 'exception | console.error', text: '...', url: '...' }],
  warnings: [],
  failedRequests: [{ status: 404, url: '...' }],
  evals: [{ js: '...', value: '...' }],
  shots: [{ rel: 'tools/shots/bank.png', width: 1600, height: 1000, bytes: 1, ms: 74 }],
  diag: { hScroll: false, overflowX: [], hScrollBoxes: [], nativeControls: [], jieCount: 0, inlineColors: [], errorOverlay: false },
  elapsedMs: 1735
}
```

退出码：0 成功，1 运行失败（错误与人话建议走 stderr），2 参数错误。失败时 `--json` 也会给 `{ ok: false, error, hint }`。

## 坑

1. **Git Bash / MSYS 会改写以 `/` 开头的参数**：`--route /bank` 可能被换成 `C:/.../bank`。工具会自动还原并提示；更稳的是
   ```bash
   node tools/shot.mjs --route '#/bank' --out tools/shots/bank.png
   MSYS_NO_PATHCONV=1 node tools/shot.mjs --route /bank --out tools/shots/bank.png
   ```
2. **Vite 没开会直接报连接失败**：先在 Tokeru 跑 `pnpm dev`（端口 1420，别占）。
3. **tauri 模式**只能连已经开着的 exe，且启动时要带调试端口参数；工具不会启停桌面程序。
4. **数据**：浏览器模式走 `src/lib/mock.ts` 的 localStorage 假数据，临时 profile 每次都是空库。要保留练习记录就加 `--profile tools/.shot-profile/qa` 复用。
5. **`/sets/:id/exam` 会新建一次 attempt**（页面挂载即 createAttempt），想拍 `/attempts/1`、`/records` 得先访问 exam 页产生数据。
6. 截图默认隐藏滚动条（`--show-scrollbars` 打开）；整页截图超过 16000px 会被截断。
7. 只过滤 `favicon.ico` 404 这类噪音，其余失败请求都会列出来。

## 自检

```bash
node tools/shot.mjs --route /mistakes --out tools/shots/mistakes.png --diag
```

只看截图不看日志的流程可以彻底删掉了：出图、报错、结构问题一条命令都给。
