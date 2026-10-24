// 复核：顶栏重复修复后的 4 页 + 「解」字 + 1280 听写框
const AREAS = "JSON.stringify([...document.querySelectorAll('.sheet-area')].map(t=>({h:t.clientHeight,sh:t.scrollHeight,len:(t.value||'').length})))";
const pages = ['home:/', 'records:/records', 'import:/import', 'bank:/bank', 'settings:/settings', 'attempt1:/attempts/1'];
const steps = [{ viewport: '1600x1000' }, { wait: 150 }, { route: '/sets/1/exam' }, { wait: 900 }];
for (const p of pages) {
  const [slug, route] = p.split(':');
  steps.push({ route }, { wait: 900 });
  steps.push({ shot: 'tools/shots/qa/' + slug + '-1600.png' });
  steps.push({ diag: slug + '-1600x1000' });
}
steps.push({ viewport: '1280x800' }, { wait: 400 }, { route: '/sets/1/exam' }, { wait: 1100 });
steps.push({ eval: { name: 'areas-1280', js: AREAS } });
steps.push({ shot: 'tools/shots/qa/exam-1280.png' });
steps.push({ diag: 'exam-1280x800' });
export default steps;
