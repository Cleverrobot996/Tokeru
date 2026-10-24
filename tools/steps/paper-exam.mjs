export default [
  { route: "http://127.0.0.1:1420/#/exam/1", wait: 1500 },
  { click: "text=排版", wait: 700 },
  { shot: "tools/shots/paper-exam-pop.png" },
  { click: "text=大字", wait: 500 },
  { shot: "tools/shots/paper-exam-large.png" },
  { diag: "paper-exam" },
];
