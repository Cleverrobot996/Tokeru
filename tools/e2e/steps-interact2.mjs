const shot = (n) => "tools/shots/e2e-" + n + ".png";
const clickText = (sel, text) => "(() => { const el=[...document.querySelectorAll(" + JSON.stringify(sel) + ")].find(x=>(x.innerText||'').includes(" + JSON.stringify(text) + ")); if(!el) return 'not found: " + text + "'; el.click(); return (el.innerText||'').trim().slice(0,40); })()";
export default [
  { route: "/bank" },
  { wait: 1200 },
  { eval: "(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='清空筛选'); if(!b) return 'no clear'; b.click(); return 'cleared'; })()" },
  { wait: 600 },
  { eval: clickText("button", "仅题目") },
  { wait: 700 },
  { shot: "bank-questions-only2" },
  { eval: "(() => ({sets:document.querySelectorAll('.bk-set-card').length, questions:document.querySelectorAll('.bk-qcard').length}))()" },
  { eval: "(() => { const c=document.querySelector('.bk-qcard'); if(!c) return 'no card'; c.click(); return 'card click'; })()" },
  { wait: 500 },
  { eval: "(() => (document.querySelector('.bk-basket')||{}).innerText || 'no basket')()" },
  { eval: "(() => { const b=[...document.querySelectorAll('button')].find(x=>/开始练习/.test(x.innerText||'') && x.closest('.bk-basket')); if(!b) return 'no start'; return {disabled:b.disabled, click:(b.click(),'ok')}; })()" },
  { wait: 2000 },
  { shot: "custom-exam2", full: true },
  { eval: "(() => ({hash:location.hash, text:document.body.innerText.slice(0,200)}))()" },
];
