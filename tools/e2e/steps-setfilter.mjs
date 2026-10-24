const shot = (n) => "tools/shots/e2e-" + n + ".png";
export default [
  { route: "/bank" },
  { wait: 1200 },
  { eval: "(() => { const r=[...document.querySelectorAll('.bk-set-row')].find(x=>(x.innerText||'').includes('2024 高考数学')); if(!r) return 'no row'; r.click(); return r.innerText.replace(/\s+/g,' ').slice(0,60); })()" },
  { wait: 900 },
  { shot: "bank-set-filter" },
  { eval: "(() => ({sets:document.querySelectorAll('.bk-set-card').length, questions:document.querySelectorAll('.bk-qcard').length, sub:(document.querySelector('.bk-head-sub')||{}).innerText}))()" },
];
