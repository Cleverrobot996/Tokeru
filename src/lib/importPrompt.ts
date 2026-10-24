/**
 * Tokeru 导入清洗规范与提示词。
 *
 * 这里是导入页「复制提示词」的唯一内容来源：
 * - IMPORT_SPEC：完整规范，覆盖 9 种题型、三层结构、答案写法、分值、题号、标签与文件夹、自检清单。
 * - JSON_TEMPLATE：可直接复制的完整 JSON 骨架，含 1 份试卷、2 个分区、3 种题型与材料。
 * - buildPrompt()：把规范、模板、用户材料与额外要求拼成一段可粘贴给任意 AI 的提示词。
 *
 * 规范里的字段与 src/lib/types.ts、src-tauri/src/commands.rs 的导入处理保持一致。
 */

import importSpec from "../../shared/import-spec.md?raw";

export const IMPORT_SPEC = importSpec;

export const JSON_TEMPLATE = `{
  "set": {
    "title": "示例：主题阅读小测",
    "subtitle": "Demo Set",
    "year": 2024,
    "duration_minutes": 30,
    "source": "示例材料",
    "audio_file": "",
    "description": "一份用来对照结构的示例，复制后替换内容即可。",
    "tags": ["英语", "模拟", "阅读"],
    "folder": "示例文件夹"
  },
  "materials": [
    {
      "key": "audio-script",
      "kind": "listening",
      "title": "听力题目说明",
      "content": "W: Are you going to the museum on Friday?\\nM: I planned to, but the train strike may change my plan.\\nW: Then let's meet on Saturday instead.",
      "position": 1
    },
    {
      "key": "reading-passage",
      "kind": "reading",
      "title": "PASSAGE ONE — Learning by Teaching",
      "content": "(1) Students who explain a concept to others tend to remember it longer.\\n(2) The act of explaining forces them to reorganize what they know and to notice gaps in their understanding.",
      "position": 2
    }
  ],
  "sections": [
    {
      "key": "listening",
      "title": "PART I LISTENING",
      "kind": "listening",
      "position": 1,
      "instructions": "听两遍后作答。",
      "duration_minutes": 10,
      "material": "audio-script"
    },
    {
      "key": "reading",
      "title": "PART II READING",
      "kind": "reading",
      "position": 2,
      "instructions": "阅读材料后作答。",
      "duration_minutes": 20,
      "material": "reading-passage"
    }
  ],
  "questions": [
    {
      "number": 1,
      "section": "listening",
      "material": "audio-script",
      "label": "1",
      "qtype": "choice_single",
      "stem": "Why may the man change his plan?",
      "options": [
        {"key": "A", "text": "He has to work on Friday."},
        {"key": "B", "text": "The train strike may affect his trip."},
        {"key": "C", "text": "The museum is closed on Friday."},
        {"key": "D", "text": "He prefers to go alone."}
      ],
      "answer": {"kind": "choice", "correct": ["B"]},
      "explanation": "答案 B。男士说 the train strike may change my plan，与 B 对应。A、C、D 原文均未提及。",
      "points": 1,
      "tags": ["听力", "出行", "易"]
    },
    {
      "number": 2,
      "section": "listening",
      "material": "audio-script",
      "label": "2",
      "qtype": "fill_blank",
      "stem": "The two speakers will meet on ______.",
      "answer": {"kind": "text", "accept": ["Saturday", "on Saturday"]},
      "explanation": "女士提议 meet on Saturday instead，因此填 Saturday。",
      "points": 1,
      "tags": ["听力", "填空", "易"]
    },
    {
      "number": 3,
      "section": "reading",
      "material": "reading-passage",
      "label": "写作",
      "qtype": "writing",
      "stem": "Write a short passage of about 120 words explaining one benefit of teaching others. Support your idea with an example.",
      "answer": {
        "kind": "reference",
        "reference": "Teaching others helps learners reorganize knowledge and notice gaps. For example, when a student explains a grammar rule to a classmate, the classmate's questions often reveal parts the student only half understood, which pushes the student to review the rule again.",
        "rubric": {
          "内容": ["说明一个好处", "给出具体例子"],
          "结构": ["开头点题", "中间举例", "结尾收束"],
          "语言": ["句子基本正确", "约 120 词"]
        }
      },
      "explanation": "先给观点，再用一个具体场景支撑；最后回扣观点即可。",
      "points": 15,
      "tags": ["写作", "学习", "中"]
    }
  ]
}`;

export interface BuildPromptOptions {
  /** 用户提供的原始材料。 */
  material: string;
  /** 试卷标题（可省略）。 */
  title?: string;
  /** 额外要求，例如「只整理阅读部分」「难度标注放在 tags」。 */
  extra?: string;
  /** 是否附上完整 JSON 模板，默认附上，结构更稳。 */
  withTemplate?: boolean;
}

/**
 * 把规范、可选模板、用户材料与额外要求拼成一段给任意 AI 的提示词。
 * 不依赖具体厂商；用户可以直接复制到 ChatGPT / Claude / Kimi / 本地模型。
 */
export function buildPrompt({ material, title, extra, withTemplate = true }: BuildPromptOptions): string {
  const blocks: string[] = [];
  blocks.push(
    "你是 Tokeru 的题库整理助手。把用户提供的学习材料清洗成可直接导入 Tokeru 的 JSON 题库。",
  );
  blocks.push(
    [
      "## 本次任务",
      title ? `- 试卷标题：${title}` : "- 试卷标题：根据材料自己判断，写一个简洁标题。",
      "- 逐题整理：保留原题的题号、选项、答案与说明；缺少答案时标注为待自评，不要编造。",
      "- 材料里的原文、题目、答案、说明要拆到正确的层：materials、questions、answer、explanation。",
      "- 自动整理：给 set.tags 写 2–5 个学科/考试/主题标签，给 set.folder 写一个目标文件夹名（不确定写 null），给每题 tags 写 1–5 个题型/知识点/难度标签。标签可以自行判断，但 qtype、answer、options 等题目字段必须严格按规范，不能用标签替代。",
      "- 图中材料：材料里的 {{fig:...}} 是题图占位符，必须原样保留在对应题干或材料内容里，不要删除、改写或移动。",
    ].join("\n"),
  );
  blocks.push("## 硬性要求\n- 只输出一个 JSON 对象，从 { 开始、到 } 结束；不要 Markdown 代码块、不要前后说明。\n- 严格遵守下面的《Tokeru 导入清洗规范》。\n- 结构优先：字段名、题型名、answer 结构都要与规范一致。");
  blocks.push("## Tokeru 导入清洗规范\n\n" + IMPORT_SPEC);
  if (withTemplate) {
    blocks.push("## JSON 骨架（结构示例，可增删题目，但保持字段形状）\n\n" + JSON_TEMPLATE);
  }
  blocks.push("## 待清洗材料\n\n<<<材料开始>>>\n" + material.trim() + "\n<<<材料结束>>>");
  if (extra && extra.trim()) blocks.push("## 额外要求\n" + extra.trim());
  blocks.push(
    "## 输出前自检\n- 顶层是对象，含 set / materials / sections / questions；\n- 每题 qtype 是 9 种标准题型之一，answer 的 kind 与题型匹配；\n- set.tags、set.folder 与每题 tags 已按第 14 节命名，标签没有替代题目字段；\n- {{fig:...}} 图占位符全部保留在原位；\n- number 全卷连续、无重复；\n- 没有代码围栏、注释、尾逗号；\n- 只输出 JSON。",
  );
  return blocks.join("\n\n");
}
