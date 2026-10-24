// 复核 2：恢复侧栏展开态后重截 4 页（顶栏页名已删的视觉确认）
const steps = [
  { viewport: '1600x1000' },
  { route: '/sets/1/exam' },
  { wait: 900 },
  { eval: { name: 'rail-reset', js: 'localStorage.setItem("tokero:rail-collapsed","0"); "0"' } },
  { route: '/' }, { wait: 900 }
];
for (const [slug, route] of [['home','/'],['records','/records'],['import','/import'],['bank','/bank']]) {
  steps.push({ route }, { wait: 900 });
  steps.push({ shot: 'tools/shots/qa/' + slug + '-1600.png' });
  steps.push({ diag: slug + '-1600x1000' });
}
export default steps;
