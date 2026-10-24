#!/usr/bin/env node
/* shot.mjs — Tokeru 截图 / 调试工具（零依赖，Node 22+）
 *
 * 把「手开浏览器 → 手动截图 → 翻控制台 → 再贴图」的慢循环压缩成一条命令：
 *   - 启动系统 Edge 的 headless 模式，自己实现 CDP 客户端（内置 WebSocket / fetch，不装依赖）
 *   - 一条命令出图：整页 / 深色 / 主题色 / 视口尺寸 / 点击 / 填写 / 执行 JS
 *   - 自动收集控制台报错、未捕获异常、失败请求，附在输出里
 *   - --steps 跑多步脚本：切路由、点击、填写、切主题、改视口、连续截图
 *   - --diag 结构自检：横向溢出、横向滚动容器、无样式原生控件、内联写死颜色、「解」字、Vite 错误遮罩
 *
 * 常用：
 *   node tools/shot.mjs --route /bank --out tools/shots/bank.png
 *   node tools/shot.mjs --route /bank --out tools/shots/bank-dark.png --w 1280 --h 800 --dark --full
 *   node tools/shot.mjs --route /bank --out tools/shots/bank-detail.png --click "text=详细" --wait 700
 *   node tools/shot.mjs --route /bank --json --diag
 *   node tools/shot.mjs --route /settings --type "input.input::sk-test" --eval "document.body.innerText.slice(0,300)"
 *   node tools/shot.mjs --steps tools/steps/qa-all.mjs
 *   node tools/shot.mjs --target tauri --route /bank --out tools/shots/tauri-bank.png
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE = 'http://127.0.0.1:1420';
const TAURI_PORT = 9333;
const MAX_FULL_HEIGHT = 16000;
const MAX_TEXT = 20000;

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

const DEFAULTS = {
  route: null,
  out: null,
  w: 1600,
  h: 1000,
  dpr: 1,
  full: false,
  dark: false,
  light: false,
  accent: null,
  wait: 400,
  target: 'vite',
  base: DEFAULT_BASE,
  port: null,
  steps: null,
  json: false,
  diag: false,
  text: false,
  keep: false,
  keepGoing: false,
  hideScrollbars: true,
  stepDelay: 90,
  timeout: 30000,
  edge: null,
  profile: null,
  scroll: null,
  help: false,
  wExplicit: false,
  hExplicit: false,
};

const USAGE = [
  'shot.mjs — Tokeru 截图 / 调试工具（零依赖，Node 22+）',
  '',
  '基础：',
  '  node tools/shot.mjs --route /bank --out tools/shots/bank.png',
  '  node tools/shot.mjs --route /bank --out x.png --w 1280 --h 800',
  '',
  '视口 / 整页 / 主题：',
  '  --w <px> --h <px> --dpr <n>    视口尺寸与像素比（默认 1600x1000 dpr1）',
  '  --full                         整页截图（captureBeyondViewport）',
  '  --dark / --light               深色 / 浅色主题（内置 localStorage 预置 + dataset 覆盖）',
  '  --accent teal|violet|amber|rose|slate',
  '',
  '交互（按出现顺序执行：先全部 click，再全部 type，再 eval）：',
  '  --click "selector"             可重复；也支持 --click "text=开始练习"',
  '  --type "selector::文本"         可重复；用原生 setter + input/change 事件填 React 受控组件',
  '  --eval "js 表达式"              可重复；在页面执行并打印结果（支持 Promise）',
  '  --scroll "selector|bottom|<数字>"',
  '  --wait <ms>                    截图 / 取文本前的额外等待（默认 400）',
  '',
  '输出：',
  '  --json                         只向 stdout 打一份 JSON：{url,title,text,consoleErrors,failedRequests,evals,shots,diag}',
  '  --diag                         打印结构自检（横向溢出 / 无样式控件 / 写死颜色 / 「解」字 / 错误遮罩）',
  '  --text                         额外打印页面 innerText',
  '  --keep                         保留临时 Edge profile（排错用）',
  '  --keep-going                   多步脚本某步失败也继续（路由超时会自动重试一次；QA 巡检用）',
  '',
  '模式：',
  '  --target vite                  连 http://127.0.0.1:1420，自动起 headless Edge（默认）',
  '  --target tauri                 连已开的桌面窗口 ws 9333（WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333）',
  '  --profile <dir>                复用同一个 Edge profile（保留 localStorage / mock 数据；默认用临时目录）',
  '  --steps <file.mjs>             多步脚本，见 tools/README.md',
  '  --port <n> --edge <path> --timeout <ms> --step-delay <ms> --show-scrollbars --base <url>',
  '',
  '示例：',
  '  node tools/shot.mjs --route /bank --out tools/shots/bank.png --click "text=详细" --wait 700',
  '  node tools/shot.mjs --steps tools/steps/qa-all.mjs --json',
].join('\n');

/* ---------- 通用小工具 ---------- */

const log = function (msg) { process.stderr.write('[shot] ' + msg + '\n'); };

function sleep(ms) { return new Promise(function (r) { setTimeout(r, Math.max(0, ms)); }); }

function intArg(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(name + ' 需要一个数字，收到：' + v);
  return Math.trunc(n);
}

function numArg(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(name + ' 需要一个数字，收到：' + v);
  return n;
}

// Git Bash / MSYS 会把以 / 开头的参数当 POSIX 路径转成 Windows 路径：
//   --route /bank  ->  C:/.../bash/bank（应用拿到的就不是 /bank 了）
// 这里做一次保守还原：从第一个「像路由」的路径段开始截取。只在传入值确实是
// 盘符绝对路径时生效，普通值原样返回。更稳的写法是 --route "#/bank"。
const ROUTE_WORDS = ['bank', 'records', 'mistakes', 'import', 'settings', 'sets', 'exam', 'attempts', 'answers', 'home', 'result'];

function recoverMangledRoute(raw) {
  const s = String(raw);
  // Git Bash/MSYS 有三种改写形态：
  //   /bank                 -> C:/...bash/bank
  //   #/attempts/1          -> #/C:/...bash/attempts/1（# 前缀也一起被转）
  // 只要值里出现盘符或 bash-win32-x64，就视为被改写，从已知路由词开始截取。
  const bashAt = s.indexOf('bash-win32-x64');
  const drive = s.match(/[A-Za-z]:[\\/]/);
  if (bashAt < 0 && !drive) return s;
  const tail = bashAt >= 0
    ? s.slice(bashAt + 'bash-win32-x64'.length).replace(/^[\\/]+/, '')
    : s.slice(drive.index + 2).replace(/^[\\/]+/, '');
  const segs = tail.split(/[\\/]+/).filter(Boolean);
  for (let i = 0; i < segs.length; i++) {
    if (ROUTE_WORDS.indexOf(segs[i].toLowerCase()) >= 0) {
      const fixed = '/' + segs.slice(i).join('/');
      log('Git Bash 改写了路由参数（' + s + '），已还原为 ' + fixed + '；更稳的写法：--route "#/..." 或 MSYS_NO_PATHCONV=1');
      return s.charAt(0) === '#' ? '#' + fixed : fixed;
    }
  }
  log('路由参数被 Git Bash 改写（' + s + '）且无法还原，按 / 处理；更稳的写法：--route "#/" 或 MSYS_NO_PATHCONV=1');
  return '/';
}

function normalizeRoute(route) {
  let r = String(route == null || route === '' ? '/' : route).trim();
  if (/^https?:\/\//i.test(r)) return r;
  r = recoverMangledRoute(r);
  if (r.charAt(0) === '#') r = r.slice(1);
  if (r.charAt(0) !== '/') r = '/' + r;
  return r;
}

function routeUrl(opts, route) {
  const r = normalizeRoute(route);
  if (/^https?:\/\//i.test(r)) return r;
  return opts.base.replace(/\/+$/, '') + '/#' + r;
}

function relOf(abs) {
  const rel = path.relative(process.cwd(), abs);
  return rel.split(path.sep).join('/');
}

function dedupe(list, limit) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = JSON.stringify([item.kind, item.text, item.url, item.status, item.errorText]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= (limit || 40)) break;
  }
  return out;
}

function pickEdge(opts) {
  const list = [opts.edge, process.env.EDGE_PATH].concat(EDGE_CANDIDATES).filter(Boolean);
  for (const p of list) {
    try { if (fs.existsSync(p)) return p; } catch (e) { /* 忽略 */ }
  }
  throw new Error('找不到 Edge，可试过：' + list.join('、'));
}

function freePort() {
  return new Promise(function (resolve, reject) {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', function () {
      const port = srv.address().port;
      srv.close(function () { resolve(port); });
    });
  });
}

async function fetchJson(url, timeout) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeout || 1500) });
  } catch (e) {
    const cause = e && e.cause && e.cause.message ? '：' + e.cause.message : '';
    throw new Error(url + ' 无法访问' + cause);
  }
  if (!res.ok) throw new Error(url + ' 返回 HTTP ' + res.status);
  try { return await res.json(); } catch (e) { throw new Error(url + ' 返回的不是 JSON'); }
}

async function waitForDevtools(port, timeout) {
  const deadline = Date.now() + (timeout || 15000);
  let last = null;
  while (Date.now() < deadline) {
    try {
      const version = await fetchJson('http://127.0.0.1:' + port + '/json/version', 1200);
      if (version && version.webSocketDebuggerUrl) return version;
      return version;
    } catch (e) {
      last = e;
      await sleep(150);
    }
  }
  throw new Error('无法连接调试端口 ' + port + (last ? '（' + last.message + '）' : ''));
}

async function killTree(child) {
  if (!child) return;
  try { child.kill(); } catch (e) { /* 可能已退出 */ }
  if (process.platform === 'win32') {
    await new Promise(function (resolve) {
      let done = false;
      const finish = function () { if (!done) { done = true; resolve(); } };
      try {
        const k = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        k.on('exit', finish);
        k.on('error', finish);
      } catch (e) { finish(); }
      setTimeout(finish, 3000);
    });
  } else {
    try { process.kill(child.pid, 'SIGKILL'); } catch (e) { /* 已退出 */ }
  }
  await sleep(120);
}

async function rmRetry(dir, tries) {
  const n = tries || 8;
  for (let i = 0; i < n; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return true; } catch (e) { await sleep(120); }
  }
  return false;
}

function waitForExit(child, timeout) {
  return new Promise(function (resolve) {
    if (!child || child.exitCode !== null) { resolve(); return; }
    let done = false;
    const finish = function () { if (!done) { done = true; resolve(); } };
    try { child.once('exit', finish); } catch (e) { finish(); }
    setTimeout(finish, timeout || 2500);
  });
}

/* ---------- CDP 客户端 ---------- */

class CDP {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.closed = false;
  }

  connect(timeout) {
    const self = this;
    return new Promise(function (resolve, reject) {
      let settled = false;
      const timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('WebSocket 连接超时：' + self.url));
      }, timeout || 8000);
      let ws;
      try { ws = new WebSocket(self.url); } catch (e) { clearTimeout(timer); reject(new Error('WebSocket 建连失败：' + e.message)); return; }
      self.ws = ws;
      ws.addEventListener('open', function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener('error', function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('WebSocket 连接失败：' + self.url));
      });
      ws.addEventListener('message', function (ev) { self._onMessage(ev); });
      ws.addEventListener('close', function () {
        self.closed = true;
        for (const p of self.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error('CDP 连接已断开（' + p.method + '）'));
        }
        self.pending.clear();
      });
    });
  }

  _onMessage(ev) {
    let msg = null;
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch (e) { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error('CDP 报错（' + p.method + '）：' + (msg.error.message || JSON.stringify(msg.error))));
      else p.resolve(msg.result || {});
      return;
    }
    if (msg.method) {
      const set = this.handlers.get(msg.method);
      if (set) {
        for (const fn of set) {
          try { fn(msg.params || {}); } catch (e) { /* 监听器出错不影响主流程 */ }
        }
      }
    }
  }

  send(method, params, timeout) {
    const self = this;
    return new Promise(function (resolve, reject) {
      if (!self.ws || self.closed) { reject(new Error('CDP 已断开，无法发送 ' + method)); return; }
      const id = ++self.nextId;
      const timer = setTimeout(function () {
        self.pending.delete(id);
        reject(new Error('CDP 超时（' + method + '，' + (timeout || 20000) + 'ms）'));
      }, timeout || 20000);
      self.pending.set(id, { resolve: resolve, reject: reject, timer: timer, method: method });
      try { self.ws.send(JSON.stringify({ id: id, method: method, params: params || {} })); }
      catch (e) { clearTimeout(timer); self.pending.delete(id); reject(new Error('CDP 发送失败（' + method + '）：' + e.message)); }
    });
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(fn);
    const set = this.handlers.get(event);
    return function () { set.delete(fn); };
  }

  close() {
    try { if (this.ws) this.ws.close(); } catch (e) { /* 忽略 */ }
  }
}

/* ---------- 注入到页面里执行的函数（只用浏览器全局，被 toString 后执行） ---------- */

function pageInfoFn() {
  const text = String(document.body && document.body.innerText || '').trim();
  return {
    url: location.href,
    title: document.title,
    text: text.slice(0, 20000),
    textLength: text.length,
    truncated: text.length > 20000,
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    theme: (document.documentElement.dataset && document.documentElement.dataset.theme) || '',
    accent: (document.documentElement.dataset && document.documentElement.dataset.accent) || '',
    errorOverlay: !!document.querySelector('vite-error-overlay'),
  };
}

function findRectFn(spec) {
  function visible(el) {
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  }
  function all(sel) {
    try { return Array.prototype.slice.call(document.querySelectorAll(sel)); } catch (e) { return []; }
  }
  let el = null;
  const raw = String(spec);
  if (raw.indexOf('text=') === 0) {
    const want = raw.slice(5).trim();
    const pool = all('button, a, [role="button"], label, summary, .nav-item, .q-card, .tile, .opt, .seg button, input, select, textarea, li, td');
    const exact = pool.filter(function (e) { return visible(e) && String(e.textContent || '').trim() === want; });
    const loose = pool.filter(function (e) { return visible(e) && String(e.textContent || '').trim().indexOf(want) >= 0; });
    el = exact[0] || loose[0] || null;
  } else {
    const sel = raw.indexOf('css=') === 0 ? raw.slice(4) : raw;
    const nodes = all(sel);
    el = nodes.filter(visible)[0] || nodes[0] || null;
  }
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  return {
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
    w: r.width,
    h: r.height,
    tag: el.tagName.toLowerCase(),
    text: String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    disabled: !!el.disabled,
  };
}

function jsClickFn(spec) {
  const raw = String(spec);
  let el = null;
  if (raw.indexOf('text=') === 0) {
    const want = raw.slice(5).trim();
    const pool = Array.prototype.slice.call(document.querySelectorAll('button, a, [role="button"], label, .q-card, .tile, .opt'));
    el = pool.filter(function (e) { return String(e.textContent || '').trim().indexOf(want) >= 0; })[0] || null;
  } else {
    try { el = document.querySelector(raw.indexOf('css=') === 0 ? raw.slice(4) : raw); } catch (e) { el = null; }
  }
  if (!el) return { ok: false, reason: 'not-found' };
  if (el.disabled) return { ok: false, reason: 'disabled' };
  el.click();
  return { ok: true, text: String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50) };
}

function fillInputFn(selector, text) {
  const nodes = Array.prototype.slice.call(document.querySelectorAll(selector));
  function visible(el) {
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden';
  }
  const el = nodes.filter(visible)[0] || nodes[0] || null;
  if (!el) return { ok: false, reason: 'not-found' };
  if (el.readOnly || el.disabled) return { ok: false, reason: 'readonly-or-disabled' };
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, text); else el.value = text;
  } else if (el instanceof HTMLSelectElement) {
    el.value = text;
  } else if (el.isContentEditable) {
    el.textContent = text;
  } else {
    return { ok: false, reason: 'not-editable' };
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: false }));
  return { ok: true, tag: el.tagName.toLowerCase(), value: String(el.value == null ? el.textContent : el.value) };
}

function scrollFn(arg) {
  if (typeof arg === 'number') { window.scrollTo(0, arg); return { y: Math.round(window.scrollY) }; }
  if (typeof arg === 'string') {
    if (arg === 'bottom') { window.scrollTo(0, document.documentElement.scrollHeight); return { y: Math.round(window.scrollY) }; }
    if (arg === 'top') { window.scrollTo(0, 0); return { y: Math.round(window.scrollY) }; }
    const el = document.querySelector(arg);
    if (!el) return { error: '找不到 ' + arg };
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    return { y: Math.round(window.scrollY) };
  }
  if (arg && typeof arg === 'object') {
    if (arg.selector) {
      const el = document.querySelector(arg.selector);
      if (!el) return { error: '找不到 ' + arg.selector };
      el.scrollIntoView({ block: arg.block || 'center', inline: 'nearest' });
      return { y: Math.round(window.scrollY) };
    }
    if (arg.y != null) { window.scrollTo(Number(arg.x || 0), Number(arg.y)); return { x: Math.round(window.scrollX), y: Math.round(window.scrollY) }; }
  }
  return { error: '无法理解的滚动参数：' + JSON.stringify(arg) };
}

function diagFn() {
  const de = document.documentElement;
  const body = document.body;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  function visible(el) {
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  }
  function pathOf(el) {
    if (!el || el === body) return 'body';
    const parts = [];
    let n = el;
    while (n && n !== body && parts.length < 5) {
      let p = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(p + '#' + n.id); break; }
      const cls = [];
      for (let i = 0; i < n.classList.length && cls.length < 2; i++) {
        const c = n.classList[i];
        if (c && c.indexOf('css-') !== 0) cls.push(c);
      }
      if (cls.length) p += '.' + cls.join('.');
      parts.unshift(p);
      n = n.parentElement;
    }
    return parts.join(' > ');
  }
  function short(t) { return String(t || '').replace(/\s+/g, ' ').trim().slice(0, 36); }

  const overflowX = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const cs = window.getComputedStyle(el);
    if (cs.position === 'fixed' || cs.position === 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1.5 || r.left < -1.5) {
      overflowX.push({ el: pathOf(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), text: short(el.textContent) });
      if (overflowX.length >= 20) break;
    }
  }

  const hScrollBoxes = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const cs = window.getComputedStyle(el);
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 2) {
      hScrollBoxes.push({ el: pathOf(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
      if (hScrollBoxes.length >= 12) break;
    }
  }

  // 判断「无样式原生控件」：拿同 tag/type 的默认探针元素比计算样式，
  // 与浏览器默认几乎一致 = 没做视觉设计（比只看 class 名准，不会误报 sheet-line 这类自定义类）
  function looksNative(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') {
      const cs = window.getComputedStyle(el);
      return cs.borderTopStyle === 'inset' || cs.borderTopStyle === 'outset';
    }
    if (tag === 'select') {
      const cs = window.getComputedStyle(el);
      return cs.appearance !== 'none' && cs.borderTopStyle === 'inset';
    }
    if (tag !== 'input') return false;
    const t = (el.type || 'text').toLowerCase();
    if (['button', 'submit', 'reset', 'image', 'file', 'range', 'color', 'hidden'].indexOf(t) >= 0) return false;
    const cs = window.getComputedStyle(el);
    if (cs.appearance === 'none' || cs.webkitAppearance === 'none') return false;
    if (cs.borderTopStyle === 'none' && (cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent')) return false;
    const probe = document.createElement('input');
    probe.type = t === 'checkbox' || t === 'radio' ? t : 'text';
    probe.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none';
    document.body.appendChild(probe);
    const ps = window.getComputedStyle(probe);
    let diff = 0;
    ['borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderRadius', 'backgroundColor', 'paddingLeft', 'fontSize'].forEach(function (k) {
      if (String(cs[k]) !== String(ps[k])) diff++;
    });
    probe.remove();
    return diff <= 1;
  }

  const nativeControls = [];
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (!visible(el)) continue;
    const cls = typeof el.className === 'string' ? el.className : '';
    if (looksNative(el)) {
      nativeControls.push({ tag: el.tagName.toLowerCase(), type: el.type || '', el: pathOf(el), cls: cls.slice(0, 50), placeholder: el.getAttribute('placeholder') || '' });
      if (nativeControls.length >= 20) break;
    }
  }

  let jieCount = 0;
  const jieAt = [];
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const t = String(node.nodeValue || '');
    if (t.indexOf('解') >= 0) {
      const host = node.parentElement;
      if (host && visible(host)) {
        jieCount += (t.match(/解/g) || []).length;
        if (jieAt.length < 6) jieAt.push({ el: pathOf(host), text: short(t) });
      }
    }
    node = walker.nextNode();
  }

  const inlineColors = [];
  for (const el of document.querySelectorAll('[style]')) {
    const s = el.getAttribute('style') || '';
    if (/#[0-9a-fA-F]{3,8}/.test(s) || /rgba?\(/.test(s)) {
      inlineColors.push({ el: pathOf(el), style: s.slice(0, 90) });
      if (inlineColors.length >= 12) break;
    }
  }

  return {
    url: location.href,
    viewport: { w: vw, h: vh, dpr: window.devicePixelRatio },
    doc: { scrollWidth: de.scrollWidth, scrollHeight: de.scrollHeight, clientWidth: de.clientWidth, clientHeight: de.clientHeight },
    hScroll: de.scrollWidth > de.clientWidth + 1 || (!!body && body.scrollWidth > body.clientWidth + 1),
    vScroll: de.scrollHeight > de.clientHeight + 1,
    theme: (de.dataset && de.dataset.theme) || '',
    accent: (de.dataset && de.dataset.accent) || '',
    overflowX: overflowX,
    hScrollBoxes: hScrollBoxes,
    nativeControls: nativeControls,
    jie: { count: jieCount, at: jieAt },
    inlineColors: inlineColors,
    errorOverlay: !!document.querySelector('vite-error-overlay'),
    rootChildren: (document.querySelector('#root') || { children: [] }).children.length,
    textLength: String(body && body.innerText || '').length,
  };
}

/* ---------- 会话：起浏览器 / 连 webview / 收事件 / 清理 ---------- */

function buildEdgeArgs(port, profile, opts) {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--mute-audio',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    '--window-size=' + opts.w + ',' + opts.h,
  ];
  if (opts.hideScrollbars) args.push('--hide-scrollbars');
  args.push('about:blank');
  return args;
}

function makeSession(opts) {
  return {
    opts: opts,
    cdp: null,
    port: null,
    child: null,
    profile: null,
    tempProfile: false,
    launched: false,
    consoleErrors: [],
    warnings: [],
    failedRequests: [],
    requests: new Map(),
    shots: [],
    evals: [],
    diags: [],
    startedAt: Date.now(),
  };
}

// favicon 404 之类的噪音：Vite dev 没有 favicon，每个页面都会报一次，不算问题
function isNoiseUrl(url) {
  return String(url || '').indexOf('/favicon.ico') >= 0;
}

function wireEvents(session) {
  const cdp = session.cdp;

  cdp.on('Runtime.consoleAPICalled', function (p) {
    if (p.type !== 'error' && p.type !== 'warning' && p.type !== 'assert') return;
    const parts = (p.args || []).map(function (a) {
      if (a.value !== undefined) return typeof a.value === 'string' ? a.value : JSON.stringify(a.value);
      if (a.description) return a.description;
      if (a.unserializableValue) return a.unserializableValue;
      return a.type;
    });
    const text = parts.join(' ').slice(0, 1500);
    const entry = { kind: p.type === 'warning' ? 'console.warning' : 'console.error', text: text, url: p.stackTrace && p.stackTrace.callFrames && p.stackTrace.callFrames[0] ? p.stackTrace.callFrames[0].url : '' };
    if (p.type === 'warning') session.warnings.push(entry); else session.consoleErrors.push(entry);
  });

  cdp.on('Runtime.exceptionThrown', function (p) {
    const d = p.exceptionDetails || {};
    const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text || '未捕获异常';
    session.consoleErrors.push({ kind: 'exception', text: String(desc).split('\n')[0].slice(0, 500), detail: String(desc).slice(0, 1500), url: d.url || '' });
  });

  cdp.on('Log.entryAdded', function (p) {
    const e = p.entry || {};
    // 网络类失败由 Network 域单独收集（带 URL），避免同一条报错出现两遍
    if (e.source === 'network') return;
    if (e.level === 'error') session.consoleErrors.push({ kind: 'log', text: String(e.text || '').slice(0, 1500), url: e.url || '' });
    else if (e.level === 'warning') session.warnings.push({ kind: 'log.warning', text: String(e.text || '').slice(0, 800), url: e.url || '' });
  });

  cdp.on('Network.requestWillBeSent', function (p) {
    if (p.requestId && p.request) session.requests.set(p.requestId, p.request.url);
  });

  cdp.on('Network.responseReceived', function (p) {
    const r = p.response || {};
    if (isNoiseUrl(r.url)) return;
    if (r.status >= 400) session.failedRequests.push({ kind: 'http', status: r.status, url: r.url, type: p.type || '' });
    if (session.requests.size > 400) session.requests.clear();
  });

  cdp.on('Network.loadingFailed', function (p) {
    if (p.canceled) return;
    const url = session.requests.get(p.requestId) || ('requestId:' + p.requestId);
    if (isNoiseUrl(url)) return;
    session.failedRequests.push({ kind: 'loadingFailed', url: url, errorText: p.errorText || '', type: p.type || '' });
  });
}

async function connectToPage(session) {
  const port = session.port;
  const deadline = Date.now() + 12000;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson('http://127.0.0.1:' + port + '/json/list', 1500);
      const pages = (targets || []).filter(function (t) {
        return (t.type === 'page' || t.type === 'webview') && !String(t.url || '').startsWith('devtools://');
      });
      const page = pages.filter(function (t) { return !String(t.url || '').startsWith('about:blank'); })[0] || pages[0];
      if (page && page.webSocketDebuggerUrl) {
        session.cdp = new CDP(page.webSocketDebuggerUrl);
        await session.cdp.connect(8000);
        wireEvents(session);
        const t = session.opts.timeout;
        await session.cdp.send('Page.enable', {}, t);
        await session.cdp.send('Runtime.enable', {}, t);
        await session.cdp.send('Log.enable', {}, t);
        await session.cdp.send('Network.enable', {}, t);
        return;
      }
      lastErr = new Error('调试目标列表里没有可用页面（' + (targets || []).length + ' 个目标）');
    } catch (e) { lastErr = e; }
    await sleep(150);
  }
  throw new Error('拿不到页面调试目标（端口 ' + port + '）' + (lastErr ? '：' + lastErr.message : ''));
}

async function openSession(opts) {
  const session = makeSession(opts);
  if (opts.target === 'tauri') {
    session.port = opts.port ? Number(opts.port) : TAURI_PORT;
    log('连接已运行的桌面窗口：127.0.0.1:' + session.port);
    await connectToPage(session);
    return session;
  }

  const edge = pickEdge(opts);
  if (opts.profile) {
    session.profile = path.resolve(opts.profile);
    fs.mkdirSync(session.profile, { recursive: true });
  } else {
    session.profile = path.join(os.tmpdir(), 'tokeru-shot-' + process.pid + '-' + Date.now().toString(36));
    session.tempProfile = true;
  }

  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = attempt === 0 && opts.port ? Number(opts.port) : await freePort();
    session.port = port;
    log('启动 headless Edge（' + edge + '，调试端口 ' + port + '，视口 ' + opts.w + 'x' + opts.h + '）');
    session.child = spawn(edge, buildEdgeArgs(port, session.profile, opts), { stdio: 'ignore', windowsHide: true });
    session.launched = true;
    session.child.on('error', function (e) { lastErr = e; });
    try {
      await waitForDevtools(port, 15000);
      await connectToPage(session);
      return session;
    } catch (e) {
      lastErr = e;
      log('第 ' + (attempt + 1) + ' 次启动失败：' + e.message);
      await killTree(session.child);
      session.child = null;
      await sleep(250);
    }
  }
  throw new Error('启动 headless Edge 失败：' + (lastErr ? lastErr.message : '未知原因'));
}

async function cleanupSession(session) {
  if (!session) return;
  if (session.launched && session.cdp && !session.cdp.closed) {
    try { await session.cdp.send('Browser.close', {}, 1500); } catch (e) { /* 忽略 */ }
  }
  try { if (session.cdp) session.cdp.close(); } catch (e) { /* 忽略 */ }
  await waitForExit(session.child, 2500);
  await killTree(session.child);
  if (session.tempProfile && session.profile) {
    if (session.opts.keep) log('保留临时 profile：' + session.profile);
    else {
      const ok = await rmRetry(session.profile);
      if (!ok) log('临时 profile 没删干净：' + session.profile);
    }
  }
}

/* ---------- 页面操作 ---------- */

async function evaluate(session, expression, timeout) {
  const res = await session.cdp.send('Runtime.evaluate', {
    expression: expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  }, timeout || session.opts.timeout);
  if (res && res.exceptionDetails) {
    const d = res.exceptionDetails;
    const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text || '页面执行出错';
    throw new Error('页面执行报错：' + String(desc).split('\n')[0]);
  }
  return res ? res.result && res.result.value : undefined;
}

async function waitFor(session, expression, timeout, hint) {
  const deadline = Date.now() + (timeout || 8000);
  let last = null;
  while (Date.now() < deadline) {
    try {
      const v = await evaluate(session, expression, 8000);
      if (v) return v;
    } catch (e) { last = e.message; }
    await sleep(80);
  }
  throw new Error('等待超时（' + (timeout || 8000) + 'ms）：' + expression + (hint ? ' — ' + hint : '') + (last ? ' — ' + last : ''));
}

async function waitForFonts(session) {
  await evaluate(session, '(document.fonts && document.fonts.ready ? document.fonts.ready.then(function () { return true; }) : true)', 6000).catch(function () { return null; });
  await evaluate(session, 'new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { r(true); }); }); })', 6000).catch(function () { return null; });
}

async function applyViewport(session, w, h, dpr) {
  await session.cdp.send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: dpr || 1,
    mobile: false,
    screenWidth: w,
    screenHeight: h,
  }, 10000);
}

async function installThemeSeed(session, opts) {
  if (!(opts.dark || opts.light || opts.accent)) return;
  const lines = ['try {'];
  if (opts.dark) lines.push('  localStorage.setItem("tokero.theme", "dark");');
  if (opts.light) lines.push('  localStorage.setItem("tokero.theme", "light");');
  if (opts.accent) lines.push('  localStorage.setItem("tokero.accent", ' + JSON.stringify(String(opts.accent)) + ');');
  lines.push('} catch (e) {}');
  await session.cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: lines.join('\n'),
    runImmediately: false,
  }, 8000).catch(function () { return null; });
}

async function applyTheme(session, o) {
  const parts = [];
  const opts = session.opts;
  const dark = o.dark !== undefined ? o.dark : opts.dark;
  const light = o.light !== undefined ? o.light : opts.light;
  const accent = o.accent !== undefined && o.accent !== null ? o.accent : opts.accent;
  if (dark) parts.push('document.documentElement.dataset.theme = "dark"');
  if (light) parts.push('document.documentElement.dataset.theme = "light"');
  if (accent) parts.push('document.documentElement.dataset.accent = ' + JSON.stringify(String(accent)));
  if (!parts.length) return;
  await evaluate(session, parts.join('; '));
  await sleep(90);
}

async function settle(session) {
  await waitFor(session, 'document.readyState === "complete"', 8000, '页面没有加载完');
  await waitFor(session, 'document.querySelector("#root") && document.querySelector("#root").children.length > 0', 10000, '#root 为空，可能是编译错误（看控制台报错）');
  await waitForFonts(session);
}

async function goto(session, route) {
  const opts = session.opts;
  const isUrl = /^https?:\/\//i.test(String(route)) || opts.target !== 'tauri';
  if (isUrl) {
    const url = routeUrl(opts, route);
    log('打开 ' + url);
    let off = null;
    const loaded = new Promise(function (resolve) {
      let done = false;
      const finish = function () { if (!done) { done = true; if (off) off(); resolve(); } };
      off = session.cdp.on('Page.loadEventFired', finish);
      setTimeout(finish, 15000);
    });
    const nav = await session.cdp.send('Page.navigate', { url: url }, 20000);
    if (nav && nav.errorText) throw new Error('导航失败：' + nav.errorText + '（' + url + '）');
    await loaded;
  } else {
    const hash = '#' + normalizeRoute(route);
    log('切换路由 ' + hash);
    await evaluate(session, 'location.hash = ' + JSON.stringify(hash));
    await sleep(150);
  }
  await settle(session);
  if (opts.dark || opts.light || opts.accent) await applyTheme(session, {});
  await sleep(150);
}

async function click(session, spec) {
  const rect = await evaluate(session, '(' + findRectFn.toString() + ')(' + JSON.stringify(String(spec)) + ')', 15000);
  if (!rect || rect.w < 1 || rect.h < 1) {
    const fb = await evaluate(session, '(' + jsClickFn.toString() + ')(' + JSON.stringify(String(spec)) + ')', 8000).catch(function () { return { ok: false }; });
    if (fb && fb.ok) {
      await sleep(session.opts.stepDelay);
      return { x: 0, y: 0, w: 0, h: 0, tag: 'js-click', text: fb.text };
    }
    throw new Error('点不到元素：' + spec + '（选择器没命中，或元素不可见 / 尺寸为 0）');
  }
  await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y, button: 'none', buttons: 0 }, 8000);
  await session.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 }, 8000);
  await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', buttons: 0, clickCount: 1 }, 8000);
  await sleep(session.opts.stepDelay);
  return rect;
}

async function typeInto(session, spec) {
  const idx = String(spec).indexOf('::');
  if (idx < 0) throw new Error('--type 需要 "选择器::文本" 格式，收到：' + spec);
  const selector = String(spec).slice(0, idx).trim();
  const text = String(spec).slice(idx + 2).replace(/\\n/g, '\n');
  if (!selector) throw new Error('--type 的选择器为空：' + spec);
  const res = await evaluate(session, '(' + fillInputFn.toString() + ')(' + JSON.stringify(selector) + ', ' + JSON.stringify(text) + ')', 10000);
  if (!res || !res.ok) throw new Error('填写失败（' + (res && res.reason ? res.reason : '未知') + '）：' + selector);
  await sleep(session.opts.stepDelay);
  return res;
}

async function pressKey(session, key) {
  const KEYS = {
    Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' },
    Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
    Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
    Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
    Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ', unmodifiedText: ' ' },
  };
  const k = KEYS[key];
  if (!k) throw new Error('不支持的按键：' + key + '（支持 ' + Object.keys(KEYS).join('/') + '）');
  const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode, nativeVirtualKeyCode: k.windowsVirtualKeyCode };
  if (k.text) { base.text = k.text; base.unmodifiedText = k.unmodifiedText; }
  await session.cdp.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, base), 8000);
  await session.cdp.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, { key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode }), 8000);
  await sleep(session.opts.stepDelay);
  return { key: key };
}

async function scrollToArg(session, arg) {
  let value = arg;
  if (typeof arg === 'string' && /^-?\d+$/.test(arg.trim())) value = Number(arg.trim());
  const res = await evaluate(session, '(' + scrollFn.toString() + ')(' + JSON.stringify(value) + ')', 10000);
  await sleep(session.opts.stepDelay);
  return res;
}

async function screenshot(session, out, o) {
  const opts = session.opts;
  if (!out) throw new Error('截图需要输出路径（--out 或步骤里的 shot）');
  const abs = path.resolve(out);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const full = !!(o && o.full !== undefined ? o.full : opts.full);
  const metrics = await session.cdp.send('Page.getLayoutMetrics', {}, 10000);
  const meta = await evaluate(session, '({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio, theme: (document.documentElement.dataset.theme || ""), accent: (document.documentElement.dataset.accent || "") })', 8000);
  let width = Math.max(1, Math.ceil(meta.w));
  let height = Math.max(1, Math.ceil(meta.h));
  let clipped = false;
  if (full) {
    const size = metrics.cssContentSize || metrics.contentSize || { width: width, height: height };
    width = Math.max(width, Math.ceil(size.width));
    height = Math.ceil(size.height);
    if (height > MAX_FULL_HEIGHT) { height = MAX_FULL_HEIGHT; clipped = true; log('整页高度超过 ' + MAX_FULL_HEIGHT + 'px，已裁剪'); }
  }
  const params = { format: 'png', fromSurface: true };
  if (full) {
    params.captureBeyondViewport = true;
    params.clip = { x: 0, y: 0, width: width, height: height, scale: 1 };
  }
  const t0 = Date.now();
  const res = await session.cdp.send('Page.captureScreenshot', params, 60000);
  if (!res || !res.data) throw new Error('截图失败：浏览器没有返回图像数据');
  fs.writeFileSync(abs, Buffer.from(res.data, 'base64'));
  const stat = fs.statSync(abs);
  const info = {
    path: abs,
    rel: relOf(abs),
    width: width,
    height: height,
    bytes: stat.size,
    full: full,
    clipped: clipped,
    theme: meta.theme || '',
    accent: meta.accent || '',
    ms: Date.now() - t0,
  };
  session.shots.push(info);
  log('截图 -> ' + info.rel + '（' + width + 'x' + height + (full ? ' 整页' : '') + '，' + Math.round(stat.size / 1024) + ' KB，' + info.ms + 'ms）');
  return info;
}

async function runDiag(session, name) {
  const d = await evaluate(session, '(' + diagFn.toString() + ')()', 15000);
  if (name) d.name = name;
  session.diags.push(d);
  return d;
}

async function capturePageInfo(session) {
  const info = await evaluate(session, '(' + pageInfoFn.toString() + ')()', 15000);
  return info || {
    url: '', title: '', text: '', textLength: 0, truncated: false,
    viewport: { w: session.opts.w, h: session.opts.h, dpr: session.opts.dpr },
    theme: '', accent: '', errorOverlay: false,
  };
}

/* ---------- 输出 ---------- */

function printEval(name, value) {
  let out;
  try { out = typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
  catch (e) { out = String(value); }
  process.stdout.write('[eval] ' + String(name).slice(0, 120) + '\n' + (out === undefined ? '(undefined)' : out) + '\n');
}

function printDiagLines(diag) {
  const lines = [];
  lines.push('  [诊断' + (diag.name ? ' ' + diag.name : '') + '] 视口 ' + diag.viewport.w + 'x' + diag.viewport.h + '，文档 ' + diag.doc.scrollWidth + 'x' + diag.doc.scrollHeight + '，主题 ' + (diag.theme || '默认'));
  lines.push('    横向滚动：' + (diag.hScroll ? '有 ❌' : '无'));
  if (diag.overflowX && diag.overflowX.length) {
    lines.push('    溢出元素 ' + diag.overflowX.length + ' 个：');
    for (const o of diag.overflowX.slice(0, 6)) lines.push('      - ' + o.el + ' left=' + o.left + ' right=' + o.right + ' 文本「' + o.text + '」');
  }
  if (diag.hScrollBoxes && diag.hScrollBoxes.length) {
    lines.push('    横向滚动容器 ' + diag.hScrollBoxes.length + ' 个：');
    for (const b of diag.hScrollBoxes.slice(0, 6)) lines.push('      - ' + b.el + ' ' + b.scrollWidth + ' > ' + b.clientWidth);
  }
  if (diag.nativeControls && diag.nativeControls.length) {
    lines.push('    无样式原生控件 ' + diag.nativeControls.length + ' 个：');
    for (const c of diag.nativeControls.slice(0, 6)) lines.push('      - ' + c.tag + (c.type ? '[' + c.type + ']' : '') + ' ' + c.el + (c.placeholder ? ' placeholder=' + c.placeholder : '') + ' class=' + (c.cls || '(空)'));
  }
  if (diag.jie && diag.jie.count) {
    lines.push('    「解」字 ' + diag.jie.count + ' 处：');
    for (const j of diag.jie.at) lines.push('      - ' + j.el + ' 「' + j.text + '」');
  }
  if (diag.inlineColors && diag.inlineColors.length) {
    lines.push('    内联颜色 ' + diag.inlineColors.length + ' 处：');
    for (const c of diag.inlineColors.slice(0, 6)) lines.push('      - ' + c.el + ' style=' + c.style);
  }
  if (diag.errorOverlay) lines.push('    Vite 错误遮罩：存在 ❌');
  lines.push('    #root 子节点 ' + diag.rootChildren + '，页面文本 ' + diag.textLength + ' 字');
  return lines;
}

function buildPayload(session, info, ok) {
  const opts = session.opts;
  return {
    ok: ok !== false,
    url: info.url,
    title: info.title,
    text: info.text,
    textLength: info.textLength,
    textTruncated: !!info.truncated,
    theme: info.theme,
    accent: info.accent,
    target: opts.target,
    viewport: info.viewport,
    consoleErrors: dedupe(session.consoleErrors),
    warnings: dedupe(session.warnings, 20),
    failedRequests: dedupe(session.failedRequests),
    evals: session.evals,
    shots: session.shots,
    diag: session.diags.length ? session.diags[session.diags.length - 1] : null,
    diags: session.diags,
    stepErrors: session.stepErrors || [],
    errorOverlay: !!info.errorOverlay,
    elapsedMs: Date.now() - session.startedAt,
  };
}

function report(session, info) {
  const opts = session.opts;
  const payload = buildPayload(session, info, true);
  if (opts.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return payload;
  }
  const lines = [];
  lines.push('');
  lines.push('✓ ' + (info.url || '(无 URL)'));
  lines.push('  标题：' + info.title + '　视口：' + info.viewport.w + 'x' + info.viewport.h + '（DPR ' + info.viewport.dpr + '）　主题：' + (info.theme || '默认') + (info.accent ? ' / ' + info.accent : ''));
  lines.push('  文本：' + info.textLength + ' 字' + (info.truncated ? '（已截断）' : '') + '　耗时：' + (Date.now() - session.startedAt) + 'ms');
  if (session.shots.length) {
    lines.push('  截图：');
    for (const s of session.shots) lines.push('    - ' + s.rel + '（' + s.width + 'x' + s.height + (s.full ? ' 整页' : '') + '，' + Math.round(s.bytes / 1024) + ' KB）');
  }
  if (payload.consoleErrors.length) {
    lines.push('  控制台错误 ' + payload.consoleErrors.length + ' 条：');
    for (const e of payload.consoleErrors.slice(0, 10)) lines.push('    - [' + e.kind + '] ' + String(e.text).slice(0, 400));
  } else {
    lines.push('  控制台错误：无');
  }
  if (payload.failedRequests.length) {
    lines.push('  失败请求 ' + payload.failedRequests.length + ' 条：');
    for (const f of payload.failedRequests.slice(0, 10)) lines.push('    - ' + String(f.url).slice(0, 200) + (f.status ? ' → HTTP ' + f.status : ' → ' + f.errorText));
  }
  if (opts.diag) for (const d of session.diags) Array.prototype.push.apply(lines, printDiagLines(d));
  if (opts.text) {
    lines.push('  —— 页面文本 ——');
    lines.push(info.text);
  }
  process.stdout.write(lines.join('\n') + '\n');
  return payload;
}

/* ---------- 命令行 ---------- */

function parseArgs(argv) {
  const opts = Object.assign({}, DEFAULTS, { clicks: [], types: [], evals: [] });
  if (argv.length === 0) { opts.help = true; return opts; }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h' || arg === '-?') { opts.help = true; continue; }
    if (arg.indexOf('--') !== 0) throw new Error('无法识别的参数：' + arg + '（参数都要以 -- 开头；没有短参数）');
    let key = arg.slice(2);
    let value = null;
    const eq = key.indexOf('=');
    if (eq >= 0) { value = key.slice(eq + 1); key = key.slice(0, eq); }
    const need = function () {
      if (value !== null) return value;
      const next = argv[++i];
      if (next === undefined) throw new Error('--' + key + ' 缺少值');
      return next;
    };
    switch (key) {
      case 'route': opts.route = need(); break;
      case 'out': opts.out = need(); break;
      case 'steps': opts.steps = need(); break;
      case 'base': opts.base = need(); break;
      case 'edge': opts.edge = need(); break;
      case 'profile': opts.profile = need(); break;
      case 'accent': opts.accent = need(); break;
      case 'scroll': opts.scroll = need(); break;
      case 'target': {
        const t = need();
        if (t !== 'vite' && t !== 'tauri') throw new Error('--target 只能是 vite 或 tauri，收到：' + t);
        opts.target = t;
        break;
      }
      case 'w': opts.w = intArg(need(), '--w'); opts.wExplicit = true; break;
      case 'h': opts.h = intArg(need(), '--h'); opts.hExplicit = true; break;
      case 'dpr': opts.dpr = numArg(need(), '--dpr'); break;
      case 'wait': opts.wait = intArg(need(), '--wait'); break;
      case 'timeout': opts.timeout = intArg(need(), '--timeout'); break;
      case 'port': opts.port = intArg(need(), '--port'); break;
      case 'step-delay': opts.stepDelay = intArg(need(), '--step-delay'); break;
      case 'full': opts.full = true; break;
      case 'dark': opts.dark = true; break;
      case 'light': opts.light = true; break;
      case 'json': opts.json = true; break;
      case 'diag': opts.diag = true; break;
      case 'text': opts.text = true; break;
      case 'keep': opts.keep = true; break;
    case 'keep-going': opts.keepGoing = true; break;
      case 'show-scrollbars': opts.hideScrollbars = false; break;
      case 'click': opts.clicks.push(need()); break;
      case 'type': opts.types.push(need()); break;
      case 'eval': opts.evals.push(need()); break;
      default: throw new Error('未知参数：--' + key);
    }
  }
  if (opts.w < 200 || opts.h < 200) throw new Error('视口太小：' + opts.w + 'x' + opts.h);
  if (opts.dark && opts.light) throw new Error('--dark 和 --light 不能同时用');
  return opts;
}

function hintFor(err) {
  const m = String(err && err.message ? err.message : err);
  if (/无法访问|ECONNREFUSED|fetch failed|调试端口|调试目标/.test(m)) {
    return 'Vite 没开？在 Tokeru 目录跑 pnpm dev（端口 1420）。tauri 模式需要先设置 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333 再启动 exe。';
  }
  if (/找不到 Edge|spawn|ENOENT/.test(m)) return '用 --edge "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" 指定浏览器，或设置环境变量 EDGE_PATH。';
  if (/点不到元素|填写失败/.test(m)) return '选择器可能过期：用 --text 或 --eval "document.body.innerText.slice(0,500)" 看当前 DOM，再改选择器；中文按钮可用 --click "text=开始练习"。';
  if (/等待超时|#root 为空/.test(m)) return '页面没渲染出来：看控制台报错；Vite 编译失败会在页面上盖一层错误遮罩（--diag 会报 errorOverlay）。';
  return null;
}

async function runOnce(opts) {
  const session = await openSession(opts);
  try {
    if (opts.target === 'tauri') {
      if (opts.wExplicit || opts.hExplicit) await applyViewport(session, opts.w, opts.h, opts.dpr);
      else log('tauri 模式沿用窗口实际尺寸（要固定视口请显式传 --w/--h）');
    } else {
      await applyViewport(session, opts.w, opts.h, opts.dpr);
    }
    await installThemeSeed(session, opts);

    if (opts.target === 'tauri' && !opts.route) {
      await settle(session);
      if (opts.dark || opts.light || opts.accent) await applyTheme(session, {});
    } else {
      await goto(session, opts.route || '/');
    }

    for (const spec of opts.clicks) {
      const r = await click(session, spec);
      log('点击 ' + spec + ' → <' + r.tag + '> ' + (r.text || ''));
    }
    for (const spec of opts.types) {
      const r = await typeInto(session, spec);
      log('填写 ' + spec.slice(0, spec.indexOf('::')) + ' → ' + JSON.stringify(r.value));
    }
    for (const js of opts.evals) {
      const value = await evaluate(session, js);
      const entry = { js: js, value: value };
      session.evals.push(entry);
      if (!opts.json) printEval(js, value);
    }
    if (opts.scroll != null) await scrollToArg(session, opts.scroll);
    if (opts.wait > 0) await sleep(opts.wait);
    if (opts.out) await screenshot(session, opts.out, { full: opts.full });
    if (opts.diag) await runDiag(session, session.shots.length ? relOf(session.shots[session.shots.length - 1].path) : 'page');
    const info = await capturePageInfo(session);
    report(session, info);
    return 0;
  } finally {
    await cleanupSession(session);
  }
}

async function runStep(session, step) {
  const opts = session.opts;
  if (step.wait != null) { await sleep(intArg(step.wait, 'wait')); return; }
  if (step.viewport) {
    const v = typeof step.viewport === 'string'
      ? (function () { const m = String(step.viewport).match(/^(\d+)\s*[xX]\s*(\d+)$/); return m ? { w: Number(m[1]), h: Number(m[2]) } : null; })()
      : step.viewport;
    if (!v || !v.w || !v.h) throw new Error('viewport 需要 {w,h} 或 "1600x1000"');
    await applyViewport(session, v.w, v.h, v.dpr || opts.dpr);
    await sleep(150);
    return;
  }
  if (step.route != null || step.nav != null) { await goto(session, step.route != null ? step.route : step.nav); return; }
  if (step.clickText != null) { await click(session, 'text=' + step.clickText); log('点击 text=' + step.clickText); return; }
  if (step.click != null) { const r = await click(session, step.click); log('点击 ' + step.click + ' → <' + r.tag + '> ' + (r.text || '')); return; }
  if (step.type != null) {
    let spec;
    if (typeof step.type === 'string') spec = step.type;
    else spec = String(step.type.selector) + '::' + String(step.type.text);
    const r = await typeInto(session, spec);
    log('填写 ' + spec.split('::')[0] + ' → ' + JSON.stringify(r.value));
    return;
  }
  if (step.eval != null) {
    const js = typeof step.eval === 'string' ? step.eval : step.eval.js;
    const name = typeof step.eval === 'object' && step.eval.name ? step.eval.name : js;
    const value = await evaluate(session, js);
    session.evals.push({ name: name, js: js, value: value });
    if (!opts.json) printEval(name, value);
    return;
  }
  if (step.waitFor != null) { await waitFor(session, String(step.waitFor), step.timeout || 8000, '步骤等待超时'); return; }
  if (step.press != null) { await pressKey(session, step.press); return; }
  if (step.scroll != null) { const r = await scrollToArg(session, step.scroll); log('滚动 ' + JSON.stringify(step.scroll) + ' → ' + JSON.stringify(r)); return; }
  if (step.theme != null) {
    await evaluate(session, 'document.documentElement.dataset.theme = ' + JSON.stringify(String(step.theme)));
    await sleep(120);
    return;
  }
  if (step.accent != null) {
    await evaluate(session, 'document.documentElement.dataset.accent = ' + JSON.stringify(String(step.accent)));
    await sleep(120);
    return;
  }
  if (step.diag != null) {
    const d = await runDiag(session, typeof step.diag === 'string' ? step.diag : undefined);
    if (!opts.json) for (const line of printDiagLines(d)) process.stdout.write(line + '\n');
    return;
  }
  if (step.shot != null || step.out != null) {
    const spec = step.shot != null ? step.shot : { out: step.out };
    const o = typeof spec === 'string' ? { out: spec } : spec;
    if (o.theme) { await evaluate(session, 'document.documentElement.dataset.theme = ' + JSON.stringify(String(o.theme))); await sleep(120); }
    if (o.accent) { await evaluate(session, 'document.documentElement.dataset.accent = ' + JSON.stringify(String(o.accent))); await sleep(120); }
    if (o.wait) await sleep(intArg(o.wait, 'shot.wait'));
    await screenshot(session, o.out, { full: o.full });
    return;
  }
  throw new Error('不认识的步骤：' + JSON.stringify(step).slice(0, 200));
}

async function runSteps(opts) {
  const file = path.resolve(opts.steps);
  if (!fs.existsSync(file)) throw new Error('找不到 steps 文件：' + file);
  const mod = await import(pathToFileURL(file).href + '?t=' + Date.now());
  let steps = mod.default != null ? mod.default : mod.steps;
  if (typeof steps === 'function') steps = await steps();
  if (!Array.isArray(steps)) throw new Error('steps 文件需要导出数组：export default [ { route: "/bank" }, { shot: "tools/shots/a.png" } ]');
  if (opts.route) steps = [{ route: opts.route }].concat(steps);
  log('执行 ' + steps.length + ' 步：' + relOf(file));

  const session = await openSession(opts);
  try {
    if (opts.target === 'tauri') {
      if (opts.wExplicit || opts.hExplicit) await applyViewport(session, opts.w, opts.h, opts.dpr);
    } else {
      await applyViewport(session, opts.w, opts.h, opts.dpr);
    }
    await installThemeSeed(session, opts);
    const stepErrors = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error('第 ' + (i + 1) + ' 步不是对象');
      let failure = null;
      try {
        await runStep(session, step);
      } catch (e) {
        failure = e;
        // 路由超时多半是 Vite 正在重新编译（其他成员在改页面），等 2s 再试一次。
        if (step.route) {
          log('第 ' + (i + 1) + ' 步路由失败，2s 后重试一次：' + e.message);
          await sleep(2000);
          try { await runStep(session, step); failure = null; } catch (e2) { failure = e2; }
        }
      }
      if (failure) {
        const msg = '第 ' + (i + 1) + '/' + steps.length + ' 步失败 ' + JSON.stringify(step).slice(0, 160) + '：' + failure.message;
        if (!opts.keepGoing) throw new Error(msg);
        process.stderr.write('[shot] ✗ ' + msg + '（--keep-going，继续）\n');
        stepErrors.push({ step: i + 1, error: failure.message, def: step });
        continue;
      }
      log('完成 ' + (i + 1) + '/' + steps.length + '：' + Object.keys(step).join(','));
    }
    session.stepErrors = stepErrors;
    const info = await capturePageInfo(session);
    report(session, info);
    return stepErrors.length ? 1 : 0;
  } finally {
    await cleanupSession(session);
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(String(e.message) + '\n\n' + USAGE + '\n');
    return 2;
  }
  if (opts.help) {
    process.stdout.write(USAGE + '\n');
    return 0;
  }
  try {
    return opts.steps ? await runSteps(opts) : await runOnce(opts);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    process.stderr.write('\n✗ ' + msg + '\n');
    const hint = hintFor(e);
    if (hint) process.stderr.write('  → ' + hint + '\n');
    if (opts.json) process.stdout.write(JSON.stringify({ ok: false, error: msg, hint: hint || null, shots: [], consoleErrors: [], failedRequests: [] }, null, 2) + '\n');
    return 1;
  }
}

const exitCode = await main();
process.exitCode = exitCode;
