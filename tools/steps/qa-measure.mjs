// 三栏铺满测量 + 最小宽度 1024 巡检
const JS = "(()=>{const b=document.querySelector('.exam-body');if(!b)return 'no-exam-body';const r=b.getBoundingClientRect();const cs=getComputedStyle(b);return JSON.stringify({vw:innerWidth,left:Math.round(r.left),width:Math.round(r.width),padL:cs.paddingLeft,padR:cs.paddingRight,cols:cs.gridTemplateColumns,children:[...b.children].map(c=>Math.round(c.getBoundingClientRect().width))})})()";
export default [
  { viewport: '1600x1000' }, { route: '/sets/1/exam' }, { wait: 1000 },
  { eval: { name: 'cols-1600', js: JS } },
  { viewport: '1280x800' }, { wait: 700 },
  { eval: { name: 'cols-1280', js: JS } },
  { viewport: '1024x768' }, { wait: 700 },
  { eval: { name: 'cols-1024', js: JS } },
  { diag: 'exam-1024' },
  { route: '/bank' }, { wait: 800 },
  { shot: 'tools/shots/qa/bank-1024.png' },
  { diag: 'bank-1024' },
];
