// 交互探针：验证 15 图里的交互项（题型视图直接开练 / 详细模式 / 倒计时弹层 / 导入第 2 步 / 侧栏收起）
// node tools/shot.mjs --steps tools/steps/qa-probes.mjs --profile tools/.shot-profile/qa --keep-going

const OUT = 'tools/shots/qa';
export default [
  // ⑤ 题型视图勾完直接开始练习（不再弹选卷）
  { viewport: '1600x1000' },
  { route: '/bank' }, { wait: 700 },
  { clickText: '题型视图' }, { wait: 500 },
  { click: '[role=checkbox]' }, { wait: 300 },
  { shot: OUT + '/probe-bank-qtype-selected.png' },
  { eval: { name: 'qtype-已选题数', js: "document.querySelectorAll('[role=checkbox][data-selected=true]').length" } },
  { clickText: '开始练习' }, { wait: 1200 },
  { eval: { name: 'after-start-hash', js: 'location.hash' } },
  { shot: OUT + '/probe-bank-start-exam.png' },

  // ⑥ 试卷视图 + 详细模式（整卷视图）
  { route: '/bank' }, { wait: 700 },
  { clickText: '试卷视图' }, { wait: 300 },
  { clickText: '详细' }, { wait: 500 },
  { shot: OUT + '/probe-bank-detail.png' },

  // ⑮ 倒计时弹层：预设 chip 可删 + 自定义输入框
  { route: '/sets/1/exam' }, { wait: 1200 },
  { click: '.exam-timer' }, { wait: 500 },
  { shot: OUT + '/probe-exam-timer.png' },
  { eval: { name: 'timer-pop', js: "!!document.querySelector('.exam-timer-pop')" } },

  // ⑪ 导入第 2 步：复制提示词 / 复制 JSON 模板
  { route: '/import' }, { wait: 700 },
  { type: 'textarea::PART I DICTATION\nListen and write down the passage.' },
  { wait: 300 },
  { clickText: '下一步' }, { wait: 700 },
  { shot: OUT + '/probe-import-step2.png' },

  // shell-home 侧栏收起（1280 档）
  { viewport: '1280x800' },
  { route: '/' }, { wait: 600 },
  { click: '.rail-toggle' }, { wait: 500 },
  { shot: OUT + '/probe-rail-collapsed.png' },
  { eval: { name: 'rail', js: "document.querySelector('.shell').dataset.rail" } },
];
