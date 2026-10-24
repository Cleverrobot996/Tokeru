// 1280 档听写框溢出测量
const JS = "JSON.stringify([...document.querySelectorAll('.sheet-area')].map(t=>({h:t.clientHeight,sh:t.scrollHeight,len:(t.value||'').length})))";
export default [
  { viewport: '1280x800' }, { route: '/sets/1/exam' }, { wait: 1000 },
  { eval: { name: 'areas-1280', js: JS } },
  { shot: 'tools/shots/qa/probe-exam-1280-right.png' },
];
