import type { CardType } from "@/lib/db";

export const AI_LINKS = [
  { label: "ChatGPT", href: "https://chatgpt.com/" },
  { label: "Gemini", href: "https://gemini.google.com/" },
  { label: "Grok", href: "https://grok.com/" },
  { label: "Claude", href: "https://claude.ai/" },
];

export const PROMPTS: Record<string, Record<CardType, string>> = {
  en: {
    basic: `Create a JSON array with 20 flashcards about [TOPIC].

Mandatory rules:
- Return ONLY the JSON, no explanation, no markdown, no code blocks.
- Each item must have "front" and "back".
- "front" is the question, definition, or context clue.
- "back" is the short answer (a word, term, or phrase).
- You may use basic HTML inside the strings to format content: <p>, <b>, <strong>, <em>, <br>, <ul>, <li>.
- Do not use CSS classes, inline styles, or images.

Exact expected format:
[
  {
    "front": "Used to introduce a contrasting idea, in spite of that",
    "back": "however"
  },
  {
    "front": "<p>The verb <strong>to be</strong> is used to express:</p><ul><li>State or condition</li><li>Profession</li><li>Location</li></ul>",
    "back": "<p><strong>am</strong> → I am a student.<br><strong>is</strong> → She is a doctor.<br><strong>are</strong> → They are at home.</p>"
  }
]`,

    typing: `Create a JSON array with 20 typing practice flashcards about [TOPIC].

In this card type, the user reads "front" and types the exact "back" as the answer.
So "back" must always be short and objective, a single word, acronym, or short phrase.

Mandatory rules:
- Return ONLY the JSON, no explanation, no markdown, no code blocks.
- Each item must have "front" and "back".
- "front" may use basic HTML: <p>, <b>, <strong>, <em>, <br>.
- "back" must be plain text and short (it will be compared literally with what the user types).

Exact expected format:
[
  {
    "front": "What is the capital of France?",
    "back": "Paris"
  },
  {
    "front": "<p>Which preposition do we use for <strong>specific times</strong>?</p><p>Example: ___ 3pm</p>",
    "back": "at"
  }
]`,

    cloze: `Create a JSON array with 20 cloze deletion flashcards about [TOPIC].

In this card type, the app hides a word in the text using the syntax {{c1::word}}.
The user sees the sentence with a blank and tries to recall the hidden word.

Mandatory rules:
- Return ONLY the JSON, no explanation, no markdown, no code blocks.
- Each item has ONLY a "front" field, there is no "back".
- Each "front" must contain at least one {{c1::word}}.
- You may use basic HTML: <p>, <b>, <strong>, <em>, <br>.
- Do not hide more than one blank per card.

Exact expected format:
[
  {
    "front": "The capital of France is {{c1::Paris}}."
  },
  {
    "front": "<p>We use <strong>{{c1::present simple}}</strong> to describe habits and routines.</p>"
  }
]`,
  },

  zh: {
    basic: `创建一个包含 20 张关于 [主题] 的抽认卡的 JSON 数组。

强制规则：
- 只返回 JSON，不要解释，不要 markdown，不要代码块。
- 每个条目必须包含 "front" 和 "back"。
- "front" 是问题、定义或语境提示。
- "back" 是简短的答案（一个单词、术语或短语）。
- 你可以在字符串内使用基本 HTML 来格式化内容：<p>、<b>、<strong>、<em>、<br>、<ul>、<li>。
- 不要使用 CSS 类、内联样式或图片。

期望的确切格式：
[
  {
    "front": "Used to introduce a contrasting idea, in spite of that",
    "back": "however"
  },
  {
    "front": "<p>The verb <strong>to be</strong> is used to express:</p><ul><li>State or condition</li><li>Profession</li><li>Location</li></ul>",
    "back": "<p><strong>am</strong> → I am a student.<br><strong>is</strong> → She is a doctor.<br><strong>are</strong> → They are at home.</p>"
  }
]`,

    typing: `创建一个包含 20 张关于 [主题] 的打字练习抽认卡的 JSON 数组。

在这种卡片类型中，用户阅读 "front" 并输入与 "back" 完全一致的答案。
因此 "back" 必须始终简短而明确：一个单词、缩写或简短短语。

强制规则：
- 只返回 JSON，不要解释，不要 markdown，不要代码块。
- 每个条目必须包含 "front" 和 "back"。
- "front" 可以使用基本 HTML：<p>、<b>、<strong>、<em>、<br>。
- "back" 必须是纯文本且简短（它会与用户输入的内容逐字比较）。

期望的确切格式：
[
  {
    "front": "What is the capital of France?",
    "back": "Paris"
  },
  {
    "front": "<p>Which preposition do we use for <strong>specific times</strong>?</p><p>Example: ___ 3pm</p>",
    "back": "at"
  }
]`,

    cloze: `创建一个包含 20 张关于 [主题] 的填空（cloze）抽认卡的 JSON 数组。

在这种卡片类型中，应用使用 {{c1::单词}} 语法隐藏文本中的一个单词。
用户看到带有空白的句子，并尝试回忆被隐藏的单词。

强制规则：
- 只返回 JSON，不要解释，不要 markdown，不要代码块。
- 每个条目只有 "front" 字段，没有 "back"。
- 每个 "front" 必须至少包含一个 {{c1::单词}}。
- 你可以使用基本 HTML：<p>、<b>、<strong>、<em>、<br>。
- 每张卡片不要隐藏超过一个空白。

期望的确切格式：
[
  {
    "front": "The capital of France is {{c1::Paris}}."
  },
  {
    "front": "<p>We use <strong>{{c1::present simple}}</strong> to describe habits and routines.</p>"
  }
]`,
  },
};
