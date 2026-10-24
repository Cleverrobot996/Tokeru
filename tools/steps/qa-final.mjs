// 收尾复核：P2-B / P3-A / ② 冗余文案
export default [
  { viewport: '1600x1000' },
  { route: '/sets/1/exam' }, { wait: 1100 },
  { eval: { name: 'attempts-1', js: "(() => {\n  let s = null; try { s = JSON.parse(localStorage.getItem('tokero.mock.v1') || 'null'); } catch (e) {}\n  const arr = (s && s.attempts) || [];\n  const inprog = arr.filter(a => a && (a.status === 'in_progress' || a.status === 'inProgress'));\n  return JSON.stringify({ total: arr.length, inprog: inprog.length, ids: inprog.map(a => a.id).slice(-4), firstArea: (document.querySelector('.sheet-area')||{}).value || null });\n})()" } },
  { route: '/' }, { wait: 500 },
  { route: '/sets/1/exam' }, { wait: 1200 },
  { eval: { name: 'attempts-2', js: "(() => {\n  let s = null; try { s = JSON.parse(localStorage.getItem('tokero.mock.v1') || 'null'); } catch (e) {}\n  const arr = (s && s.attempts) || [];\n  const inprog = arr.filter(a => a && (a.status === 'in_progress' || a.status === 'inProgress'));\n  return JSON.stringify({ total: arr.length, inprog: inprog.length, ids: inprog.map(a => a.id).slice(-4), firstArea: (document.querySelector('.sheet-area')||{}).value || null });\n})()" } },
  { type: { selector: '.sheet-area', text: 'draft-check' } }, { wait: 400 },
  { route: '/records' }, { wait: 600 },
  { route: '/sets/1/exam' }, { wait: 1300 },
  { eval: { name: 'attempts-3-draft', js: "(() => {\n  let s = null; try { s = JSON.parse(localStorage.getItem('tokero.mock.v1') || 'null'); } catch (e) {}\n  const arr = (s && s.attempts) || [];\n  const inprog = arr.filter(a => a && (a.status === 'in_progress' || a.status === 'inProgress'));\n  return JSON.stringify({ total: arr.length, inprog: inprog.length, ids: inprog.map(a => a.id).slice(-4), firstArea: (document.querySelector('.sheet-area')||{}).value || null });\n})()" } },
  { route: '/sets/1/answers' }, { wait: 1000 },
  { eval: { name: 'answers', js: "(() => { const t = document.body.innerText; return JSON.stringify({ accept: (t.match(/也可接受/g)||[]).length, colorHint: t.includes('颜色 = 答题情况'), selectHint: t.includes('勾选题目可批量收进错题本'), jie: (t.match(/解/g)||[]).length }); })()" } },
  { route: '/settings' }, { wait: 800 },
  { eval: { name: 'settings', js: "(() => { const t = document.body.innerText; return JSON.stringify({ jie: (t.match(/解/g)||[]).length, oldTip1: t.includes('AI 解释（可选）'), oldTip2: t.includes('用于题目解释与写作自评'), tip3: t.includes('默认不使用 AI'), excerpt: t.slice(t.indexOf('AI ') >= 0 ? t.indexOf('AI ') : 0, 160) }); })()" } },
  { shot: 'tools/shots/qa/settings-1600.png' },
  { diag: 'settings-final' }
];
