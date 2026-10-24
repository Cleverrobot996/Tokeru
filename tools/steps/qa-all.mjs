// 全站巡检：node tools/shot.mjs --steps tools/steps/qa-all.mjs
// 9 条路由 × 1600/1280 两档 + 1600 深色，截图落在 tools/shots/qa/。
// 只跑其中几条：SHOT_ONLY=home,bank node tools/shot.mjs --steps tools/steps/qa-all.mjs

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

const OUT = 'tools/shots/qa';
const only = String(process.env.SHOT_ONLY || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
const routes = only.length ? ROUTES.filter(function (r) { return only.indexOf(r.slug) >= 0; }) : ROUTES;

const VIEWPORTS = ['1600x1000', '1280x800'];
const steps = [];

// 先访问一次考试页：mock 里 attempts 初始为空，这一步会产生 attempt#1，
// 后面 /records、/attempts/1 才有内容可拍。
steps.push({ route: '/sets/1/exam' }, { wait: 700 });

for (const vp of VIEWPORTS) {
  steps.push({ viewport: vp }, { wait: 150 });
  for (const r of routes) {
    steps.push({ route: r.route }, { wait: 600 });
    steps.push({ shot: OUT + '/' + r.slug + '-' + vp.split('x')[0] + '.png' });
    steps.push({ diag: r.slug + '-' + vp });
  }
}

// 深色档：只跑 1600，深色主要是配色问题，尺寸问题两档已覆盖。
steps.push({ viewport: '1600x1000' }, { theme: 'dark' }, { wait: 200 });
for (const r of routes) {
  steps.push({ route: r.route }, { wait: 600 });
  steps.push({ shot: OUT + '/' + r.slug + '-1600-dark.png' });
  steps.push({ diag: r.slug + '-1600-dark' });
}

export default steps;
