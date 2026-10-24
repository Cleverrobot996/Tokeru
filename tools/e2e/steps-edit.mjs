const shot = (n) => "tools/shots/e2e-" + n + ".png";
const clickText = (sel, text) => "(() => { const el=[...document.querySelectorAll(" + JSON.stringify(sel) + ")].find(x=>(x.innerText||'').includes(" + JSON.stringify(text) + ")); if(!el) return 'not found: " + text + "'; el.click(); return (el.innerText||'').trim().slice(0,40); })()";
export default [
  { route: "/home" },
  { wait: 1200 },
  { eval: "(() => { const b=document.querySelector('[aria-label=\"改试卷名\"]'); if(!b) return 'no rename btn'; b.click(); return 'rename open'; })()" },
  { wait: 250 },
  { eval: "(() => { const i=document.querySelector('.set-title-input'); if(!i) return 'no input'; const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(i,'数学卷 2024·改名验收'); i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true})); return i.value; })()" },
  { wait: 1000 },
  { shot: "home-renamed" },
  { eval: "(() => [...document.querySelectorAll('.set-title')].map(x=>x.innerText))()" },
  { route: "/bank" },
  { wait: 1200 },
  { eval: "(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='新建'); if(!b) return 'no create'; b.click(); return 'create open'; })()" },
  { wait: 250 },
  { eval: "(() => { const i=document.querySelector('.bk-folder-edit input'); if(!i) return 'no folder input'; const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(i,'E2E 文件夹'); i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true})); return i.value; })()" },
  { wait: 1000 },
  { shot: "bank-folder-created" },
  { eval: "(() => [...document.querySelectorAll('.bk-folder-main')].map(x=>x.innerText.replace(/\n/g,' ')))()" },
];
