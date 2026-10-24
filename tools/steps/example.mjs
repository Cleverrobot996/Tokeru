// 多步脚本示例：node tools/shot.mjs --steps tools/steps/example.mjs
// 每一步的键见 tools/README.md；执行顺序即数组顺序。
export default [
  { route: '/sets/1/exam' },        // 进考试页（顺便产生一次 attempt 数据）
  { wait: 600 },
  { viewport: '1600x1000' },
  { shot: 'tools/shots/example-exam-1600.png' },
  { diag: 'exam-1600' },

  { viewport: '1280x800' },
  { wait: 200 },
  { shot: 'tools/shots/example-exam-1280.png' },

  { theme: 'dark' },                // 深色：只改 documentElement.dataset
  { accent: 'teal' },
  { wait: 200 },
  { shot: 'tools/shots/example-exam-1280-dark.png' },
  { theme: 'light' },
  { accent: 'violet' },

  { route: '/bank' },
  { wait: 500 },
  { clickText: '详细' },             // 按中文文本点；点不到会报错
  { wait: 700 },
  { shot: 'tools/shots/example-bank-detail.png' },

  { eval: 'location.hash' },        // 结果会打印出来
  { eval: { name: 'card', js: 'document.querySelectorAll(".card").length' } },
];
