# Tokeru 导入清洗规范 v1.1

这份规范用来把任何来源的学习材料（真题、教材、笔记、截图转出的文本）整理成 Tokeru 可以导入的 JSON。
它既可以全文复制给 AI，也可以当作人工整理的对照表。

## 0. 先搞清楚目标

- 输入：一段自然语言材料，可能带题号、选项、答案、说明，也可能只有原文。
- 输出：**一个 JSON 对象**，描述「一份试卷 → 若干分区 → 若干材料 + 若干题目」。
- 导入器只认结构，不猜内容：字段缺失会变成警告，结构写错会被拒绝。
- 宁缺毋滥：材料里没有的答案不要编；宁可标成主观题或留空，让用户补，也不要把猜测写成正确答案。
- 同一份材料可以同时包含原文、题目与答案，整理时要把它们拆到对应的层：原文进 materials，题目进 questions，答案进 answer，说明进 explanation。

## 1. 硬性输出规则（违反任意一条都可能导入失败）

1. 只输出一个 JSON 对象。不要输出数组、不要输出多份试卷、不要输出 Markdown 代码围栏（不要三个反引号）。
2. 不要输出任何说明性文字、前言、后记、思考过程。导入器虽然会从第一个「{」截取到最后一个「}」，但请直接给纯 JSON。
3. 所有键名必须是英文双引号包裹的字符串，不能有注释、尾逗号、单引号、未转义换行。
4. 字符串里的换行写成 
，双引号写成 "，反斜杠写成 \；中文标点可以直接写，不用转义。
5. 数字不要加引号；布尔值只用 true / false；空值用 null 或直接省略该字段。
6. 顶层推荐同时提供 set、materials、sections、questions 四个键；最少必须有 questions。
7. 题目按作答顺序排列，数组顺序就是显示顺序，不要依赖 position 字段做排序。
8. 不要写「同上」「见第 3 题」这类引用：每道题必须自包含，答案写完整。
9. 只允许一种 HTML：题图/材料图用 <figure class="q-figure"><img src="data:image/jpeg;base64,..." alt="题图" /></figure>，放在 stem 或 material.content 里；其他任何 HTML 标签、样式都不要输出。
10. 图片必须内联成 data URL（image/jpeg 或 image/png，单张 ≤300KB，整卷 ≤8MB）。拿不到原始图片数据时，在 stem 写「（原题有图，见原卷）」，并在 warnings 里说明；不要凭文字臆造图，也不要输出外部链接。

## 2. 三层结构总览

一份试卷由四部分数据组成：

- set：试卷本身，一份材料只写一个 set。包含标题、年份、时长、来源、音频文件名、简介、试卷标签与目标文件夹。
- materials：共享材料。一段阅读原文、一份听力文本稿、一段写作引文放在这里，供分区或题目引用。
- sections：分区（PART / SECTION）。决定试卷的作答顺序、分区标题、分区说明与分区材料。
- questions：题目。每题通过 section 引用分区，可以再通过 material 引用材料。

结构关系：

    set
     ├─ materials[]            （可被多个分区/题目共享）
     ├─ sections[]             （排序后的作答分区，可引用一份材料）
     │    └─ questions[]       （题目通过 section 的 key 归属分区）
     └─ 题目也可以单独引用 material

三条硬约束：

- 一份 JSON 只描述一份试卷；多份试卷请分多次导入。
- 每个分区的 key 唯一、每份材料的 key 唯一。
- 每道题必须属于一个已有分区；如果没有写分区，导入器会把它放进自动创建的「全部题目」分区并给出警告。

## 3. 试卷层 set

字段说明：

- title（必填，字符串）：试卷标题。例如「2024 高考数学新课标Ⅱ卷」。不要带书名号，不要重复写年份。
- subtitle（可选，字符串）：副标题或英文原名。例如「2024 年普通高等学校招生全国统一考试」。
- year（可选，数字或字符串）：年份，例如 2024。没有就省略。
- duration_minutes（可选，整数）：整卷建议时长，单位分钟。例如 120。
- source（可选，字符串）：来源说明，例如「2024 年真题」「用户上传 PDF 转写」。不要写成长段落。
- audio_file（可选，字符串）：整卷听力音频的**文件名**，例如 "listening.mp3"。没有音频写空字符串或省略。
- description（可选，字符串）：一句话简介，例如「完整 19 题：选择、多选、填空、解答」。
- tags（可选，字符串数组）：试卷级标签，用于题库筛选与分类，建议 2–5 个。写学科、考试、主题，例如 ["数学","高考","真题"]。命名规则见第 14 节。
- folder（可选，字符串或 null）：目标文件夹名称，例如 "高考数学真题"。导入时文件夹不存在会自动创建；不填、写空串或 null 表示未归类。只写一个文件夹名，不要写路径或多级层级。

注意：

- tags 是给整份试卷打标，不是题目标签；题目自己的标签写在每道题的 tags 里。
- folder 只决定导入后放在哪个文件夹，不影响题目内容；同一份试卷只能属于一个文件夹。
- audio_file 只写文件名，不要写绝对路径、不要写 http 链接。
- 音频文件需要用户自己放进应用的媒体目录；写错文件名不会导致导入失败，但播放时会找不到音频。
- set 里没有 title 时，导入页会用用户填的「题库名」兜底；两者都没有就叫「导入题目」。
- 不要把题目数量、总分写进 set：它们会由题目自动统计，手写反而可能对不上。

## 4. 材料层 materials

材料是「会被多道题共享的长文本」。每份材料是一个对象：

- key（必填，字符串）：材料唯一标识，建议用小写英文、数字、连字符，例如 "passage-one"、"talk-outline"、"writing-excerpt"。只能在同一份 JSON 内唯一。
- kind（可选，字符串）：材料类型，建议取 listening、reading、cloze、writing、audio、mixed 之一。
- title（可选，字符串）：材料标题，例如「PASSAGE ONE — The Million-Pound Bank-Note」。
- content（必填，字符串）：材料正文。保留段落，换行写成 
。原文多长就写多长，不要缩写、不要总结。
- position（可选，整数）：显示顺序，从 0 或 1 开始都可以，导入器按数组顺序重排。

写作要求：

- content 是给考生看的原文，不要在里面混入题目、答案或说明。
- 阅读读懂要保留原文的段落编号（如 (1) (2)），因为题目常引用「Para. 2」。
- 完形填空的词库（A-O 的 15 个单词）可以放在 material.content 末尾，也可以放进题干；不要两边都放。
- 同一段材料只建一次：三道阅读题共用一篇原文，就建一份 material，三道题都引用它。
- 不要按题复制材料：那会让试卷原样里出现多份重复原文，界面会变得很长。
- 材料标题不要带「材料一」这种编号，除非原文本身就这么写；分区已经负责分组。

## 5. 分区层 sections

分区决定作答顺序与页面分组。每个分区是一个对象：

- key（必填，字符串）：分区唯一标识，例如 "dictation"、"listening"、"language"、"cloze"、"reading"、"writing"。
- title（必填，字符串）：分区标题，例如「PART II LISTENING · SECTION A TALK」。原卷怎么写就怎么抄。
- kind（可选，字符串）：分区类型，建议取 dictation、listening、language、cloze、reading、short_answer、writing、mixed 之一。它只影响统计与图标，不影响判分。
- position（可选，整数）：排序，按数组顺序即可。
- instructions（可选，字符串）：作答说明，例如「听两遍后作答」「用不超过 10 个词回答」。没有就省略或写空串。
- duration_minutes（可选，整数）：该分区建议时长；没有就省略。
- material（可选，字符串）：引用某份材料的 key，作为「分区材料」，显示在分区标题下方。
- audio_file（可选，字符串）：分区独立音频文件名；整卷只有一个音频时省略，用 set.audio_file。

组织规则：

- 分区顺序 = 作答顺序，按数组排列，不要靠 position 猜测。
- 一个分区可以只有一道题（例如写作），也可以有很多题。
- 同一份材料被一个分区内多道题共用时，优先写在分区上（section.material），题目里就不必重复写 material。
- 如果某道题用的是另一份材料（例如阅读分区里的对比阅读），再在题目上单独写 material 覆盖。
- 分区标题要完整保留原卷编号（PART / SECTION），不要改写成「第一部分」如果原卷是英文。
- 不要为「全部题目」造分区；只有确实没有分区信息时，导入器才会自动归入「全部题目」。

## 6. 题目层 questions 通用字段

每道题是一个对象。下面是所有题型共有或常用的字段：

- number（必填，整数）：全局题号，从 1 开始，整卷连续、不重复。不要每个分区重新从 1 开始。
- section（必填，字符串）：所属分区的 key。必须能在 sections 里找到。
- material（可选，字符串）：所属材料的 key；分区已引用材料时可省略。
- label（可选，字符串）：显示用题号，默认等于 number。听力填空可用 "(1)"，阅读可用 "41"，写作可用 "写作"。
- qtype（必填，字符串）：题型，必须是下面 9 种之一：
  choice_single 单选、choice_multi 多选、fill_blank 填空、cloze 完形填空、true_false 判断、
  short_answer 简答、writing 写作、dictation 听写、matching 匹配。
- stem（必填，字符串）：题干。不要包含选项文字；填空类用 6 个下划线表示空位。
- options（选择题类必填，数组）：每个元素形如 {"key":"A","text":"..."}。key 用大写字母，题内唯一，数组顺序就是显示顺序。
- answer（必填，对象）：答案。不同题型写法不同，见第 7 节。
- explanation（可选，字符串）：答案与说明。写「为什么对、为什么错、下次怎么判断」，不要写「略」。
- points（可选，整数）：分值，默认 1。必须大于 0。
- tags（可选，字符串数组）：题目标签，建议放题型、知识点、难度，例如 ["单项选择","细节理解","易"]。可以自行根据题目内容打标，但标签不能替代 qtype、answer 等必需字段；命名规则见第 14 节。
- source（可选，字符串）：题目来源，例如 "2024 高考数学"。

题号与顺序的三条规则：

1. number 全局连续，导入器按它排序并检测重复；重复时会顺延并给警告。
2. 同一个分区的题目在 questions 数组里必须连续排列，不要交叉。
3. display 顺序由数组决定；position 只在需要覆盖显示顺序时使用，平时省略。

## 7. 九种题型逐一说明

下面每种题型都给出：适用场景、必填字段、answer 的正确写法、正例与反例、常见坑。

### 7.1 choice_single 单选

适用场景：四选一、三选一、听力选择题、语法词汇选择题。

必填：stem、options（至少 2 个，通常 4 个）、answer.correct（恰好 1 个字母）。

answer 正确写法：

    {"kind":"choice","correct":["B"]}

正例：

    {
      "number": 12,
      "section": "listening",
      "qtype": "choice_single",
      "stem": "Why does the woman call the man?",
      "options": [
        {"key":"A","text":"To ask about a job opening."},
        {"key":"B","text":"To reschedule an interview."},
        {"key":"C","text":"To confirm a meeting time."},
        {"key":"D","text":"To recommend a candidate."}
      ],
      "answer": {"kind":"choice","correct":["B"]},
      "points": 1
    }

反例与修正：

- 反例：correct 写成 "B"（字符串）。修正：单答案也写成数组 ["B"]。
- 反例：correct 写成 ["B","C"]。修正：单选只能有一个答案，保留真正正确的那一个；如果是多选，把 qtype 改成 choice_multi。
- 反例：options 用对象 {"A":"...","B":"..."}。修正：必须改成数组，每项有 key 与 text。
- 反例：把选项文字直接写进 stem。修正：选项拆进 options，stem 只留问句。
- 反例：stem 写「下列哪个选项正确？A. ... B. ...」。修正：同上，去掉题干里的选项。

自检：options 的 key 从 A 连续排列；correct 的字母在 options 里存在。

### 7.2 choice_multi 多选

适用场景：多项选择、选出所有正确项、听力多选题。

必填：stem、options（至少 2 个）、answer.correct（1 到多个字母，按字母升序）。

answer 正确写法：

    {"kind":"choice","correct":["A","C","D"]}

正例：

    {
      "number": 25,
      "section": "reading",
      "qtype": "choice_multi",
      "stem": "Which of the following are mentioned as benefits of the program?",
      "options": [
        {"key":"A","text":"Lower tuition."},
        {"key":"B","text":"Free housing."},
        {"key":"C","text":"Flexible schedules."},
        {"key":"D","text":"Career support."},
        {"key":"E","text":"Guaranteed employment."}
      ],
      "answer": {"kind":"choice","correct":["A","C","D"]},
      "points": 2
    }

反例与修正：

- 反例：correct 写成 ["ACD"]。修正：数组里每个元素只放一个字母，改成 ["A","C","D"]。
- 反例：只写一个正确项，漏了其他。修正：多选必须列全，漏一个就判错。
- 反例：选项 key 重复或跳号（A、B、D）。修正：保持连续字母，显示更整齐。
- 反例：用「以上都对」这种选项。修正：改成具体的正确项组合，避免判分歧义。

自检：答案字母都在 options 中；数量与题干要求一致（如「选出两项」）。

### 7.3 true_false 判断

适用场景：判断正误、听力和阅读的 True/False 题。

必填：stem、options（两个，key 用 T/F 或 A/B）、answer.correct（一个字母）。

answer 正确写法（推荐 T/F）：

    {"kind":"choice","correct":["T"]}

正例：

    {
      "number": 8,
      "section": "listening",
      "qtype": "true_false",
      "stem": "The man has visited the museum before.",
      "options": [
        {"key":"T","text":"正确"},
        {"key":"F","text":"错误"}
      ],
      "answer": {"kind":"choice","correct":["F"]},
      "points": 1
    }

兼容写法：

- 答案写「对」「错」「正确」「错误」「√」「×」「是」「否」，导入器会自动转成 T/F。
- 如果选项用 A（正确）/ B（错误），就把 correct 写成 ["A"] / ["B"]，与选项字母保持一致。

反例与修正：

- 反例：answer 写成 {"correct": true}（布尔）。修正：用字母，["T"] 或 ["F"]。
- 反例：options 写「正确的」「错误的」但 correct 写 ["对"]。修正：统一成选项的 key。
- 反例：把判断题写成填空，要求考生写 True。修正：判断题用选项，判分更稳。

### 7.4 fill_blank 填空

适用场景：单句填空、听力填空、语法填空、表格填空。**一个空一道题。**

必填：stem（用 6 个下划线表示空）、answer.accept（至少一个可接受答案）。

answer 正确写法：

    {"kind":"text","accept":["success","a success"]}

正例：

    {
      "number": 3,
      "section": "listening",
      "material": "talk-outline",
      "qtype": "fill_blank",
      "stem": "空 (1)：What is the key to ______?",
      "answer": {"kind":"text","accept":["success","being successful"]},
      "points": 1
    }

accept 的写法：

- 判分时会把「用户输入」与 accept 中任意一项做归一化比较：忽略大小写、忽略标点、压缩空格，然后要求完全相等。
- 所以 accept 要覆盖合理的等价写法：单复数、冠词、同义短语、英式美式拼写。
- 不要写整句长答案；如果答案是一句话，说明这题更适合 short_answer。
- 如果同一个空允许填数字或单词两种形式，都列进 accept。

反例与修正：

- 反例：stem 里有三个空，却只给一个 answer。修正：拆成三道题，每题一个空、一个答案。
- 反例：accept 写 ["success."]，带句号。修正：去掉标点，写 ["success"]。
- 反例：answer 用 reference 写一段话。修正：填空要用 accept 列可接受答案。
- 反例：题干里没有下划线，考生不知道填哪里。修正：用 ______ 标出空位。
- 反例：题干还把答案原文写出来了。修正：删掉泄露答案的部分。

自检：每个空都有对应的 accept；accept 的写法覆盖大小写与单复数。

### 7.5 cloze 完形填空

适用场景：一篇短文挖多个空，从词库中选词或直接填空。

必填：stem（只描述本题的空位，如 "31. ______"）、answer.accept（字母 + 单词都写）。

answer 正确写法：

    {"kind":"text","accept":["H","lists"]}

正例：

    {
      "number": 31,
      "section": "cloze",
      "material": "cloze-passage",
      "qtype": "cloze",
      "label": "31",
      "stem": "31. ______",
      "answer": {"kind":"text","accept":["H","lists"]},
      "points": 1
    }

组织方式：

- 一篇完形 = 一个分区 + 一份材料 + N 道题；每道题只对应一个空。
- 词库（A-O 的 15 个词）放材料末尾或题干说明里，不要每题重复一遍。
- 每道题都引用同一份 material；也可以只在分区上写 material，题目省略。
- accept 同时列「字母」与「单词」：考生填 H 或 lists 都算对，避免交互方式不同导致误判。
- 如果词库单词会变形（lists / list），把变形也列进 accept。

反例与修正：

- 反例：10 个空写在一道题里，answer 写 10 个答案。修正：拆成 10 道题。
- 反例：accept 只写 ["H"]。修正：补上单词 ["H","lists"]，两种作答都兼容。
- 反例：把整篇短文复制进每道题的 stem。修正：短文放 material，stem 只留本空。
- 反例：题号在每个分区重新开始。修正：number 全卷连续。

### 7.6 matching 匹配

适用场景：人物与观点匹配、段落与标题匹配、单词与释义匹配。

必填：stem、options（候选项）、answer.correct（按空顺序的字母数组）。

answer 正确写法：

- 单空：["C"]
- 多空：["B","D","A"]

正例：

    {
      "number": 30,
      "section": "reading",
      "qtype": "matching",
      "stem": "Match each person with the opinion they express. Write the letters in order.",
      "options": [
        {"key":"A","text":"Welfare should be conditional."},
        {"key":"B","text":"Jobs matter more than benefits."},
        {"key":"C","text":"Education breaks the cycle."},
        {"key":"D","text":"Community programs are underfunded."}
      ],
      "answer": {"kind":"choice","correct":["B","D","A"]},
      "points": 3
    }

判分说明（重要）：

- 当前 matching 与多选共用判分逻辑：用户答案按逗号/空格拆开后，与正确集合做**集合比较**，顺序不影响结果。
- 如果题目有严格的顺序语义（第 1 空必须是 B、第 2 空必须是 D），请拆成多道单空匹配题，每题 answer 一个字母；否则顺序错也可能判对。
- 题干里要写清楚有几个空、按什么顺序作答；不要只写「匹配」。

反例与修正：

- 反例：把匹配关系写成文本 "1-A 2-B"。修正：拆成题或用 options + correct 数组。
- 反例：correct 顺序与题干空位不对应。修正：按空位顺序排列。
- 反例：题干没有说明有几个空。修正：在 stem 里写清「共 3 空，按 A-F 作答」。

### 7.7 short_answer 简答

适用场景：阅读读懂简答题、听力简答、用几个词回答的问题。

必填：stem（写清字数限制）、answer.reference（参考答案）。

可选：answer.rubric（评分维度）。

answer 正确写法：

    {"kind":"reference","reference":"He had to stop himself from spending the money."}

带评分维度：

    {
      "kind":"reference",
      "reference":"Welfare should be generous enough to support people, but conditional enough to encourage work.",
      "rubric": {
        "内容": ["提到 generosity", "提到 conditionality"],
        "语言": ["语法基本正确", "不超过 20 个词"]
      }
    }

正例：

    {
      "number": 51,
      "section": "short_answer",
      "material": "passage-one",
      "qtype": "short_answer",
      "stem": "In Para. 4, what does the man mean by saying "I had to put my foot down"? Answer in no more than 15 words.",
      "answer": {
        "kind":"reference",
        "reference":"He had to stop himself from spending the money.",
        "rubric": {"内容":["表达出「克制消费」"],"语言":["不超过 15 个词"]}
      },
      "points": 2
    }

重要规则：

- 简答题**不会自动判分**，交卷后显示待自评；所以 reference 是给人看的参考答案，不是机器比对。
- reference 写完整句子，不要只写关键词；rubric 用短句列出可检查的点。
- 题干必须写字数或形式限制，否则自评没有标准。
- 一个简答题只问一个问题；连环追问拆成多题。

反例与修正：

- 反例：answer 只写 {"correct":"..."}。修正：主观题用 reference。
- 反例：题干「谈谈你的看法」但没有字数、没有参考方向。修正：补要求与 rubric。
- 反例：把简答写成选项题。修正：如果答案唯一且短，改用 fill_blank；否则保留 short_answer。

### 7.8 writing 写作

适用场景：作文、书信、读后续写、材料作文。

必填：stem（题目要求 + 字数 + 时间）、answer.reference（范文或详细要点）、points（建议 15-25）。

可选：answer.rubric（内容/结构/语言三维度）、material（写作引文）。

answer 正确写法：

    {
      "kind":"reference",
      "reference":"Term-time holidays: a false economy. ...（完整范文或分点提纲）",
      "rubric": {
        "内容": ["明确立场", "覆盖材料要点"],
        "结构": ["开头—论证—结尾", "段落衔接自然"],
        "语言": ["句式多样", "无明显语法错误"]
      }
    }

正例：

    {
      "number": 67,
      "section": "writing",
      "material": "writing-excerpt",
      "qtype": "writing",
      "label": "写作",
      "stem": "Read the excerpt and write a response of NO LESS THAN 200 words. You should state your position and support it with reasons. Time limit: 45 minutes.",
      "answer": {
        "kind":"reference",
        "reference":"（范文）It is often argued that ...",
        "rubric": {"内容":["立场明确"],"结构":["三段式"],"语言":["衔接自然"]}
      },
      "points": 20
    }

关键规则：

- 写作题**不会自动判分**，交卷后待自评；rubric 是自评清单，要具体、可勾选。
- reference 可以是完整范文，也可以是分点提纲；若只给提纲，要在 rubric 里补足评分标准。
- 写作材料（引文、图表说明）放 material，不要塞进 stem；stem 只写任务与要求。
- 字数要求写清楚：不少于多少词、不超过多少词；时间限制可选。
- 一道写作题只对应一篇作文；不要拆成多道。

反例与修正：

- 反例：answer 是空的，只有题干。修正：至少写参考要点与 rubric，否则自评无从下手。
- 反例：把范文放进 options。修正：写作没有选项，用 reference。
- 反例：材料与题目混在一起，题干 500 字。修正：材料进 material，题干只留任务。

### 7.9 dictation 听写

适用场景：整段听写、句子听写、单词听写。

必填：stem（听写说明）、answer.reference（完整原文）、points（建议 5-10）。

answer 正确写法：

    {"kind":"reference","reference":"Are you confident or insecure in a difficult situation? Think positive and feel positive. ..."}

正例：

    {
      "number": 1,
      "section": "dictation",
      "qtype": "dictation",
      "label": "听写",
      "stem": "听写：Think Positive and Feel Positive（首句已给出：Are you confident or insecure in a difficult situation?）",
      "answer": {"kind":"reference","reference":"Are you confident or insecure in a difficult situation? Think positive and feel positive. ..."},
      "points": 10
    }

关键规则：

- 听写的完整原文只能放在 answer.reference，**不要放进 material.content**：试卷原样会显示材料，提前看到原文就失去听写意义。
- 材料里可以放听写说明、首句提示、生词表，但不能放答案全文。
- 音频文件放 set.audio_file（或 section.audio_file），不要写进题目。
- 整段听写保持一题；不要按句拆成十几题，除非评分标准就是逐句给分。
- stem 里给出首句、主题、播放次数等提示；不要给全文。

反例与修正：

- 反例：把听力原文放进 material，考生进考场就能看到。修正：移到 answer.reference。
- 反例：听写题用 fill_blank，一个空一段。修正：整段听写用 dictation。
- 反例：reference 只写首句。修正：写完整原文，否则自评没依据。

## 8. answer 对象完全指南

answer 只有三种 kind，按题型选：

### 8.1 kind = "choice"（选择类）

适用：choice_single、choice_multi、true_false、matching。

结构：

    {"kind":"choice","correct":["B"]}

- correct 必须是数组；每个元素是一个大写字母（判断题可用 T/F）。
- 单选恰好 1 个；多选 1 个以上；匹配按空位顺序。
- 判分方式：用户输入按逗号/空格拆开，全部转大写，与 correct 做集合比较；数量与集合都对才得分。
- 因此 correct 里不要放 "AC" 这种合并字母，也不要放中文。

### 8.2 kind = "text"（文本比对类）

适用：fill_blank、cloze。

结构：

    {"kind":"text","accept":["success","a success"]}

- accept 必须是非空字符串数组。
- 判分方式：两边都做「转小写、非字母数字转空格、压缩空格」后比较，完全相等才算对。
- 因此不要依赖模糊匹配：把可能的写法都列进 accept。
- 不要用 reference 代替 accept；也不能把长句当作填空答案。

### 8.3 kind = "reference"（主观题）

适用：short_answer、writing、dictation。

结构：

    {"kind":"reference","reference":"...","rubric":{"内容":["..."],"语言":["..."]}}

- reference 必填，写参考答案、范文或完整原文。
- rubric 可选，键是维度名，值是「可检查的短句」数组；用于交卷后的自评清单。
- 判分方式：永远待自评，不会自动对错；所以 reference 的质量决定自评体验。
- 不要给主观题写 correct；写了也会被忽略。

### 8.4 三种 kind 的对照表

- 自动判分、多选题：choice，correct 字母数组。
- 自动判分、填空：text，accept 可接受答案数组。
- 人工自评：reference，reference 文本 + 可选 rubric。
- 不确定时：如果答案唯一且短，用 text；如果需要人判断，用 reference。

## 9. explanation 怎么写

explanation 是交卷后展示的「答案与说明」，不是必填，但强烈建议客观题都写。

推荐结构（3 到 5 句）：

1. 定位：答案在原文/听力/语法点的哪一处。
2. 判断：为什么这个选项/这个词是对的。
3. 排除：其他选项为什么错（至少覆盖最容易误选的 1 到 2 个）。
4. 迁移：下次遇到同类题怎么快速判断。

示例：

    "答案 B。原文说 the interview was moved to Thursday，B 的 reschedule 与之对应。A 的 job opening 原文未提；C 的 meeting time 是干扰项，原文只改了日期；D 是推荐候选人，发生在面试之后。"

反例：

- 「略」「见原文」「同上」——没有信息量，删掉或补全。
- 把整段原文复制一遍——重复材料，界面变长。
- 只写「因为 B 是对的」——没有说明。
- 在一道题里讲整份试卷的方法——拆到相应题目，或省略。
- 写作与简答的 explanation 写评分标准——放进 rubric 更合适。

## 10. points 分值规则

- 所有题目都必须有分；省略时默认 1 分。
- points 必须是正整数；写 0 或负数会被改成 1 并给警告；小数会四舍五入。
- 参考分值：客观单选/判断/匹配 1 分；多选 1 到 2 分；填空/完形每空 1 分；简答 2 到 5 分；听写 5 到 10 分；写作 15 到 25 分。
- 整卷总分 = 所有题目 points 之和，导入后自动统计；不要把总分写进 set。
- 同一分区内同类题分值应一致；如果有差异，要在题干或说明里写清楚。
- 不要用 0 分题占位；不需要的题直接不输出。

## 11. 题号、label 与 position

- number：全卷唯一、连续递增，决定排序与统计。缺省时导入器按数组下标补，容易错位，建议都写。
- label：显示用文字，默认等于 number。以下情况才需要自定义：
  - 听力填空在分区内编号：label 写 "(1)"、"(2)"；
  - 阅读题沿用原卷题号：label 写 "41"；
  - 写作题：label 写 "写作"。
- position：可选。数组顺序已经是显示顺序，只有需要覆盖顺序时才写；不要用它来弥补数组乱序。
- 分区内题目连续，题号可以跨分区连续，也可以在分区内另起；但 number 必须全局唯一。
- 如果原卷题号本身重复（例如听力与阅读都有 1），用 number 全局递增，label 保留原卷编号。

## 12. 听力与音频

- 整卷共用一个音频：set.audio_file 写文件名，例如 "listening.mp3"；各分区不要再写。
- 每个分区一个音频：在 sections[].audio_file 写文件名，set.audio_file 可省略。
- 音频文件名只写名字，不写路径；用户需要把音频放进应用媒体目录。
- 材料里的听力文本稿：kind 用 listening 或 audio，content 放「笔记框架 / 题目说明 / 生词表」，不要放答案原文。
- 听力选择题的 options 照常写在题目上；听力填空的题干用下划线标空。
- 若音频缺失，导入仍会成功，但界面会提示找不到文件；尽量写对文件名。
- 不要输出 base64、不要输出外部链接；离线应用不加载网络音频。

## 12.5 图片题与材料配图

数学、物理、化学、生物、地理和部分阅读题经常带图。Tokeru 离线运行，图片不能依赖外链，必须内联成 data URL。

### 12.5.1 支持的写法（只有这一种）

示例（stem 字段的片段）：

    "stem": "如图，在 △ABC 中，∠A = 60°，AB = 2，求 BC 的长。
<figure class="q-figure"><img src="data:image/jpeg;base64,/9j/4AAQ..." alt="题图" /></figure>"

- 图片放 stem：图属于这一道题。
- 图片放 material.content：图被同一材料下的多道题共用（如阅读理解配图、实验装置图）。
- 每道题最多 3 张图；只允许 <figure> 与 <img>，class 固定为 q-figure，alt 写「题图」或简短说明。

### 12.5.2 拿不到图片时
- 在 stem 末尾写「（原题有图，见原卷）」；
- 在顶层 warnings 里加「第 N 题图片未能提取，请用「速查与整理」的加图按钮补上」；
- 导入后用户可以在「速查与整理」页对任意题手动加图（自动压到合适尺寸）。

### 12.5.3 好/坏例
- 好：题干完整文字 + 一张内联图，图和题干在同一条记录里。
- 坏：stem 只有「如图」却没有图；<img src="https://..."> 外链；整页截图重复塞进每道题；把 base64 写进 explanation。
- 图片题仍然必须保留可判分的 answer 与 qtype，不能因为「有图」就把答案写成「略」。

## 13. 什么时候合并成一份材料

建 material 的条件（满足任意一条）：

- 同一段原文被 2 道以上题目引用（阅读读懂、完形、匹配）。
- 同一段听力文本被多道题共享（听力填空、听力选择）。
- 写作题有一段引文、图表说明或背景材料。
- 材料很长（超过 80 个词），放进题干会让题干失控。

不建 material 的条件（满足任意一条）：

- 只有一道题用，且材料很短（一句话以内）——直接写进 stem。
- 材料其实是答案或说明——放 answer 或 explanation，别放 materials。
- 材料是选项列表——放 options。
- 只是格式说明（「阅读下列材料」）——写进 instructions。

合并后的检查：

- 每个 material.key 唯一。
- 引用它的题目都写了 material（或分区写了 material）。
- 材料正文完整，没有「此处省略」。
- 材料顺序按在试卷中出现的先后排列。

## 14. 标签、文件夹与 source

标签和文件夹负责「整理」，题目字段负责「作答」。两者都要写对，但不要互相替代：qtype、answer、options、points 仍然必须严格符合本规范。

### 14.1 试卷标签 set.tags

- 位置：set.tags，字符串数组，建议 2–5 个。
- 用途：在题库里按标签筛选整份试卷，也用于首页和速查页的分类。
- 写什么：学科、考试、主题各取一个维度，例如：
  - 学科："英语"、"数学"、"政治"
  - 考试："高考"、"考研"、"中考"、"期末"
  - 主题/来源："真题"、"模拟"、"阅读理解"、"Unit 2"
- 好例子：["数学","高考","真题"]
- 好例子：["英语","考研","阅读理解","模拟"]
- 坏例子：["英语考试题目材料"] —— 一句话不是标签，无法筛选。
- 坏例子：["英语","英语","English","english"] —— 同一个概念重复、大小写混用。
- 坏例子：["2024年普通高等学校招生全国统一考试数学新课标Ⅱ卷"] —— 太长，应该拆成 "高考"、"数学"、"真题"。

### 14.2 题目标签 question.tags

- 位置：每道题的 tags，字符串数组，建议 1–5 个。
- 用途：在题库里按标签找题，也用于错题整理和组卷。
- 写什么：题型、知识点、难度，例如：
  - 题型："单项选择"、"完形填空"、"写作"、"听写"
  - 知识点："细节理解"、"主旨大意"、"词义辨析"、"时态"、"定语从句"
  - 难度："易"、"中"、"难"
- 同一份试卷里，同一个概念必须复用同一个写法：都写「细节理解」，不要一半写「细节题」、一半写「细节理解题」。
- 难度只用「易 / 中 / 难」三个值，不要混用「简单 / 中等 / 困难」。
- 好例子：["单项选择","细节理解","易"]
- 好例子：["写作","议论文","中"]
- 坏例子：["选择题","选一个正确答案的题","简单题"] —— 三个标签都在描述题型，且写法不统一。
- 坏例子：["Unit 2 第三题"] —— 题号不是标签，题库里会重复且无法复用。
- 坏例子：[] 或省略 —— 可以，但会失去筛选能力；能判断时尽量补 2–3 个。

### 14.3 目标文件夹 set.folder

- 位置：set.folder，字符串或 null，可省略。
- 用途：导入后把整份试卷放进指定文件夹；文件夹不存在时导入器会自动创建。
- 写法：只写一个文件夹名称，例如 "高考数学真题"、"考研英语"、"Unit 2 同步测试"。
- 不写路径：不要写 "考试/数学/高考"；当前文件夹是单层名称，不按斜杠拆分。
- 不确定归属时写 null 或不写，导入后会进入「未归类」，之后可以在题库里移动。
- 不要把所有试卷都塞进「英语」这种过大的文件夹；文件夹应该能帮你在一屏内找到目标。

### 14.4 AI 可以自行打标与归类

- 你可以根据材料内容自行判断学科、考试、主题、题型、知识点和难度，并写入 set.tags、set.folder 和每题 tags。
- 判断依据优先用材料里明确出现的信息：标题、年份、考试名称、分区名、题目 instruction。
- 材料没有明确依据时，用保守的通用标签（如 "英语"、"阅读"），不要编造具体考试名称或年份。
- 打标是附加信息，不是改写题目的许可：qtype 仍必须是 9 个标准值之一；answer 仍必须按题型写；options 仍必须与题干对应。
- 同一份 JSON 内保持标签一致：同一知识点、同一难度、同一题型只用一个固定写法。

### 14.5 标签命名建议

- 中文，2–6 个字；英文缩写用常见大写形式，如 "CET6"、"新高考"。
- 同一概念复用同一标签；不要为每道题造一个新标签。
- 标签数量宁少勿滥；不确定的标签直接省略，不要写 "其他"、"综合"、"题目" 这类无信息量的词。
- 标签里不要带标点、序号、书名号或换行；不要写句子。

### 14.6 source

- source 写来源短语，例如 "2024 高考数学"；不要写网址、不要写长段落。
- source 与 tags 不重复：来源信息已经写进 source 时，tags 里可以不再重复年份。

## 15. 一份完整 JSON 的骨架

导入页提供「复制 JSON 模板」按钮，里面是一份可以直接改的完整骨架，结构与下面一致：

- 顶层：set、materials、sections、questions 四个键。
- set：title 必填，其余可选；示例里带 set.tags 与 set.folder，导入后会显示在预览页的标签和文件夹位置。
- materials：2 份材料（一段听力文本稿、一段阅读材料）。
- sections：2 个分区（听力、阅读），分别引用一份材料。
- questions：3 道题，覆盖 choice_single、fill_blank、writing 三种题型。

复制模板后：保留结构，替换内容；删掉用不到的题目；保证 number 重排后连续。

## 16. 严格 JSON 语法

- 文件编码 UTF-8；中文直接写，不需要转义。
- 顶层只能是一个对象，不能是数组。
- 对象里每个键都用双引号；值可以是字符串、数字、布尔、null、数组、对象。
- 数组最后一项后面不能有逗号；对象最后一个键后面也不能有逗号。
- 字符串里不能出现未转义的换行；换行写 
。
- 字符串里的双引号写 "；如果不想转义，就把引文改成中文引号「」。
- 数字不要写成 "1"（字符串）除非题目本身要求文本。
- 不要写注释（// 或 /* */）；不要写单引号字符串。
- 不要用 Markdown 代码围栏包裹；直接输出 JSON 本体。
- 如果 AI 输出时加了前言或代码块，导入页会自动从第一个「{」截到最后一个「}」，但仍建议遵守规则。

## 17. 常见失败与修正对照

- 题目数量是 0：questions 键写错、数组为空、或整份 JSON 被包在代码围栏里。修正：检查顶层 questions 数组。
- 所有题都归到「全部题目」：sections 缺失或 section 的 key 与题目引用不一致。修正：补 sections 并核对 key。
- 所有题都变成填空：qtype 拼错或用了别名（如 single、essay）。修正：用 9 个标准值之一。
- 选择题答案总判错：correct 写成了 "AC"、小写、或与 options 的 key 不一致。修正：数组、大写、与 key 对齐。
- 填空题总判错：accept 只写了一种写法、带标点或大小写混用。修正：补变体、去标点。
- 主观题显示待自评：这是正常行为，不是错误；补 reference 与 rubric 即可。
- 音频不播放：audio_file 写了路径或名字对不上。修正：只写文件名，确认文件在媒体目录。
- 材料泄露答案：听力/听写原文放进了 materials。修正：移到 answer.reference。
- 题号重复：多个分区各自从 1 开始。修正：number 全卷连续。
- 导入后分区顺序乱：sections 数组顺序与作答顺序不一致。修正：按原卷顺序排列数组。

## 18. 输出前自检清单（逐条打勾）

1. 顶层是一个 JSON 对象，含 set / materials / sections / questions。
2. 没有代码围栏、注释、尾逗号、单引号。
3. set.title 已写；年份、时长、来源没有也可以省略。
4. 每个 material 有唯一 key 和完整 content；材料里没有答案。
5. 每个 section 有唯一 key、title、kind；分区顺序与作答顺序一致。
6. 每道题的 number 全卷唯一且连续；同一分区的题在数组里连续。
7. 每道题的 section 都能在 sections 里找到；material 能在 materials 里找到。
8. 每道题的 qtype 是 9 个标准值之一。
9. 选择题的 options 是数组、key 连续、correct 是字母数组且与 key 对齐。
10. 填空题与完形的 accept 非空，覆盖大小写、单复数、同义写法。
11. 简答、写作、听写都有 reference；写作与简答有可检查的 rubric。
12. 所有 points 是正整数；客观题与主观题的分值符合第 10 节。
13. 听力与听写的原文没有出现在 materials 里。
14. 没有「同上」「见第 N 题」这类跨题引用；每题自包含。
15. 输出的是纯 JSON，没有多余文字。
16. set.tags 是 2–5 个短标签；每题 tags 使用统一的题型/知识点/难度写法。
17. set.folder 只写一个文件夹名或 null；没有依据时不要硬编。

做到以上 17 条，导入页应当只有少量或零警告。
