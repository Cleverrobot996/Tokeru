// 桌面端/浏览器端导入一份 AI 生成的 JSON 全流程：材料→预览→确认→题库。
// 用法：IMPORT_JSON=tools/e2e/english.json IMPORT_TAG=english node tools/shot.mjs --steps tools/e2e/steps-import.mjs [--target tauri]
import { readFileSync } from "node:fs";

const file = process.env.IMPORT_JSON;
if (!file) throw new Error("缺少 IMPORT_JSON");
const json = readFileSync(file, "utf8");
const tag = process.env.IMPORT_TAG || "import";
const shot = (name) => "tools/shots/e2e-" + tag + "-" + name + ".png";

const fill = "(() => { const ta = document.querySelector('.import-editor');" +
  " if (!ta) return 'no textarea';" +
  " const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;" +
  " setter.call(ta, " + JSON.stringify(json) + ");" +
  " ta.dispatchEvent(new Event('input', { bubbles: true }));" +
  " return ta.value.length; })()";

const clickByText = (text) => "(() => { const b = [...document.querySelectorAll('button')]" +
  ".find(x => (x.innerText || '').includes(" + JSON.stringify(text) + "));" +
  " if (!b) return 'not found: " + text.replace(/'/g, "") + "'; b.click(); return (b.innerText||'').trim(); })()";

export default [
  { route: "/import" },
  { wait: 800 },
  { eval: fill },
  { wait: 250 },
  { clickText: "下一步" },
  { wait: 500 },
  { shot: shot("step1") },
  { eval: clickByText("用已有 JSON 预览") },
  { wait: 1800 },
  { shot: shot("preview"), full: true },
  { eval: "(() => [...document.querySelectorAll('button')].filter(b => (b.innerText||'').includes('确认导入')).map(b => ({t:(b.innerText||'').trim(), disabled:b.disabled, r:b.getBoundingClientRect().toJSON()})))()" },
  { eval: "(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim().startsWith('确认导入') && !x.disabled); if(!b) return 'no enabled confirm'; b.scrollIntoView({block:'center'}); b.click(); return (b.innerText||'').trim(); })()" },
  { wait: 2600 },
  { eval: "(() => ({toasts:[...document.querySelectorAll('[data-sonner-toast]')].map(x=>x.innerText), body: document.body.innerText.slice(-400)}))()" },
  { shot: shot("done"), full: true },
  { shot: shot("done"), full: true },
  { diag: tag + "-done" },
  { route: "/bank" },
  { wait: 1200 },
  { shot: shot("bank"), full: true },
  { diag: tag + "-bank" },
];