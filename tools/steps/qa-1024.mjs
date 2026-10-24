// 1024x768 最小宽度巡检
const ROUTES = [
  { slug: 'home', route: '/' },
  { slug: 'bank', route: '/bank' },
  { slug: 'exam', route: '/sets/1/exam' },
  { slug: 'records', route: '/records' },
  { slug: 'mistakes', route: '/mistakes' },
  { slug: 'import', route: '/import' },
  { slug: 'settings', route: '/settings' },
  { slug: 'attempt1', route: '/attempts/1' },
  { slug: 'answers1', route: '/sets/1/answers' },
];
const steps = [{ viewport: '1024x768' }, { wait: 150 }, { route: '/sets/1/exam' }, { wait: 800 }];
for (const r of ROUTES) {
  steps.push({ route: r.route }, { wait: 700 });
  steps.push({ shot: 'tools/shots/qa/' + r.slug + '-1024.png' });
  steps.push({ diag: r.slug + '-1024' });
}
export default steps;
