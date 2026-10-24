const shot = (n) => "tools/shots/e2e-" + n + ".png";
export default [
  { route: "/sets/2/answers" },
  { wait: 1400 },
  { eval: "(() => { const b=document.querySelector('.org-q .org-tag-add'); if(!b) return 'no q add'; b.click(); return 'q tag open'; })()" },
  { wait: 250 },
  { eval: "(() => { const i=document.querySelector('.org-q .org-tag-input'); if(!i) return 'no q input'; const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(i,'E2E题标签'); i.dispatchEvent(new Event('input',{bubbles:true})); return i.value; })()" },
  { eval: "(() => { const b=document.querySelector('.org-q .org-tag-confirm'); if(!b) return 'no q confirm'; b.click(); return 'q tag clicked'; })()" },
  { wait: 800 },
  { shot: "org-qtag" },
  { eval: "(() => document.querySelector('.org-q .org-tags')?.innerText || 'none')()" },
  { route: "/sets/2/answers?q=31" },
  { wait: 1600 },
  { shot: "org-deeplink" },
  { eval: "(() => ({hash:location.hash, flash:document.querySelectorAll('.focus-flash').length, top:document.querySelector('.focus-flash')?.getBoundingClientRect().top}))()" },
];
