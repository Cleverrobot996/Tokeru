// 1280 档横向溢出探针
export default [
  { viewport: '1280x800' },
  { route: '/sets/1/exam' },
  { wait: 1100 },
  { eval: { name: 'overflow-1280', js: "(() => {\n  const vw = innerWidth, out = [], inner = [];\n  const label = el => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\\s+/).filter(Boolean).slice(0, 2).join('.') : '') + (el.id ? '#' + el.id : '');\n  for (const el of document.querySelectorAll('*')) {\n    const r = el.getBoundingClientRect();\n    if (r.width <= 0 || r.height <= 0) continue;\n    if (r.right > vw + 1) out.push({ el: label(el), right: Math.round(r.right), w: Math.round(r.width) });\n    if (el.scrollWidth - el.clientWidth > 4) inner.push({ el: label(el), sw: el.scrollWidth, cw: el.clientWidth, over: el.scrollWidth - el.clientWidth });\n  }\n  return JSON.stringify({ vw, ih: innerHeight, docSW: document.documentElement.scrollWidth, docSH: document.documentElement.scrollHeight, beyondRight: out.slice(0, 8), internalX: inner.slice(0, 8) });\n})()" } }
];
