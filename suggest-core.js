/**
 * dsh-plugin-toolkit — reply-suggestion core.
 *
 * Pure, dependency-free functions behind the smartReply optimization: turning
 * the last assistant message into a bounded prompt, building the OpenAI-shaped
 * chat request, and salvaging candidate replies out of whatever a model
 * actually returns. No network and no settings access here — suggest-api.js
 * owns the call, and client.js owns the ghost-text UI.
 *
 * The parser is deliberately forgiving: a model asked for JSON routinely wraps
 * it in a code fence, prepends "Here are the suggestions:", or returns objects
 * instead of strings. A suggestion feature that shows nothing because of a
 * stray ``` would be worse than useless, so every salvage step degrades to the
 * next one and an unsalvageable reply yields an empty list — which the client
 * renders as "no ghost text", never as an error.
 *
 * @license MIT
 */

/** Ceiling on the assistant text handed to the model. The conclusion of a turn
 *  lives at its end, so the prompt keeps the TAIL, not the head. */
export const MAX_SUMMARY_CHARS = 4000;

/** Ceiling on one suggested reply. Anything longer is not a reply a person
 *  would send, and the ghost text only has room for a line or two. */
export const MAX_SUGGESTION_CHARS = 200;

/** Reply-token ceiling for the suggestion call. Cheap, fast models are the
 *  point here — this must never cost more than a fraction of the real turn.
 *
 *  2000, not 500: a reasoning model spends this budget on its reasoning before
 *  it emits any content. Measured on cline-pass/glm-5.3-flash (2026-10-12), the
 *  reasoning run is 1300-2400 characters, so a 500 ceiling was exhausted before
 *  the first content token about one call in three, and api.cline.bot answers
 *  an empty completion with HTTP 500 `empty response content` — which the
 *  client renders as "no ghost text". At 2000 the same prompts returned content
 *  every time, while a non-reasoning model still stops well short of it. */
export const MAX_SUGGEST_TOKENS = 2000;

/** Suggested replies kept per turn; the rest are dropped. */
export const DEFAULT_SUGGEST_COUNT = 3;

/** Languages the prompt is written in. */
export const SUGGEST_LANGUAGES = /** @type {const} */ (["zh", "en"]);

/**
 * Keep the tail of an assistant message within a character budget.
 *
 * The turn's conclusion ("so next, do you want me to…?") is what a reply
 * suggestion has to be derived from, and it sits at the END of the message, so
 * truncation cuts the head. A cut lands on a code fence or a half-sentence at
 * the START of what remains, which reads as garbage to the model; dropping it
 * entirely keeps the prompt clean.
 * @param {unknown} text - the assistant message body.
 * @param {number} [maxChars] - tail budget; defaults to {@link MAX_SUMMARY_CHARS}.
 * @returns {string} the tail, or "" when nothing usable remains.
 */
export function tailSummary(text, maxChars = MAX_SUMMARY_CHARS) {
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  if (trimmed === "") return "";
  const budget = Number.isInteger(maxChars) && maxChars > 0 ? maxChars : MAX_SUMMARY_CHARS;
  if (trimmed.length <= budget) return trimmed;
  const tail = trimmed.slice(trimmed.length - budget);
  // Resume on a line boundary when one is close enough to the cut that the
  // partial line above it would be noise.
  const breakAt = tail.indexOf("\n");
  if (breakAt >= 0 && breakAt <= 200) return tail.slice(breakAt + 1).trimStart();
  return tail;
}

/**
 * Build the chat messages for one suggestion call.
 *
 * The instruction names the output shape explicitly and pins the language to
 * the UI's, because a reply suggestion in the wrong language is worse than no
 * suggestion at all: it would be filled into the composer verbatim.
 * @param {object} options - the call's inputs.
 * @param {string} options.summary - the assistant message tail.
 * @param {"zh" | "en"} [options.language] - language the replies must be in.
 * @param {number} [options.count] - how many candidates to ask for.
 * @returns {{role: string, content: string}[]} an OpenAI-shaped messages array.
 */
export function buildSuggestMessages({ summary, language = "zh", count = DEFAULT_SUGGEST_COUNT }) {
  const lang = SUGGEST_LANGUAGES.includes(language) ? language : "zh";
  const wanted = Number.isInteger(count) && count > 0 ? Math.min(count, 5) : DEFAULT_SUGGEST_COUNT;
  const zh = lang === "zh";
  const system = zh
    ? [
      `你根据助手刚刚的一段回答，为用户起草 ${wanted} 条「用户接下来可能说的话」。`,
      "规则：",
      "1. 每条都是用户口吻的完整请求，通常 10-40 字，不要写成陈述句。",
      "2. 覆盖不同的推进方向（例如：确认继续、追问细节、要求改方案、只要结论）。",
      "3. 不要提问「你想做什么」这类空泛的话；要针对上面回答的具体内容。",
      "4. 只输出一个 JSON 对象，格式为 {\"suggestions\": [\"继续跑测试\", \"把第二个方案也写出来\"]}。",
      "5. 不要输出任何解释、编号或代码块标记。",
    ].join("\n")
    : [
      `Draft ${wanted} short messages the USER might send next, based on the assistant's reply above.`,
      "Rules:",
      "1. Each is a complete user request in the first person, usually 5-25 words, never a statement.",
      "2. Cover DIFFERENT directions (confirm and continue / ask for detail / request a different approach / ask for just the conclusion).",
      "3. Be specific to the content above — never a generic \"what would you like to do?\".",
      "4. Output ONLY a JSON object like {\"suggestions\": [\"go ahead and run the tests\", \"show me the second option too\"]}.",
      "5. No prose, no numbering, no code fences.",
    ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: summary },
  ];
}

/**
 * Build the full OpenAI-compatible chat-completions request body.
 * @param {object} options - the call's inputs.
 * @param {string} options.model - the model id to ask.
 * @param {string} options.summary - the assistant message tail.
 * @param {"zh" | "en"} [options.language] - language the replies must be in.
 * @param {number} [options.count] - how many candidates to ask for.
 * @returns {object} a `POST /chat/completions` body.
 */
export function buildSuggestRequest({ model, summary, language = "zh", count = DEFAULT_SUGGEST_COUNT }) {
  return {
    model,
    messages: buildSuggestMessages({ summary, language, count }),
    temperature: 0.7,
    max_tokens: MAX_SUGGEST_TOKENS,
  };
}

/**
 * Pull the first complete JSON array out of a string that may contain prose,
 * a code fence, or both. Scans for the first `[` and then balances brackets so
 * a trailing `]` inside the text cannot close the scan early.
 * @param {string} text - the model's raw reply text.
 * @returns {string | null} the array source, or null when there is none.
 */
function firstJsonArray(text) {
  const start = text.indexOf("[");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Normalize one candidate into a plain reply string, or null when it is not
 * usable. Objects are accepted because models asked for "an array of
 * suggestions" sometimes answer `[{"text": "..."}]` or `[{"reply": "..."}]`.
 * @param {unknown} value - one parsed array entry.
 * @returns {string | null} the cleaned reply, or null to drop it.
 */
function normalizeCandidate(value) {
  let raw = value;
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = /** @type {{text?: unknown, reply?: unknown, suggestion?: unknown, content?: unknown}} */ (raw);
    raw = obj.text ?? obj.reply ?? obj.suggestion ?? obj.content;
  }
  if (typeof raw !== "string") return null;
  // Strip the pair of quotes a model leaves on when it half-respects "array of
  // strings", and any list bullet or numbering it prefixes.
  let text = raw.trim().replace(/^[-*•]\s*/, "").replace(/^\d+[.)、]\s*/, "").trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1).trim();
  else if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) text = text.slice(1, -1).trim();
  return text === "" ? null : text;
}

/**
 * Salvage candidate replies from a model's raw reply text.
 *
 * Salvage ladder, each step falling to the next: a bare JSON array; a JSON
 * object wrapping one (`{suggestions: [...]}`); a fenced block containing an
 * array; a quoted-string scan over free prose. Every path is capped, trimmed,
 * de-duplicated and length-filtered, so the result is safe to render as ghost
 * text and to hand to `setDraft` without further checks.
 * @param {unknown} raw - the model's reply: the assistant message content
 *   string, or an already-parsed value.
 * @param {object} [options] - the salvage's limits.
 * @param {number} [options.count] - most candidates to keep.
 * @param {number} [options.maxChars] - most characters per candidate.
 * @returns {string[]} usable replies in order; empty when nothing survives.
 */
export function parseSuggestions(raw, { count = DEFAULT_SUGGEST_COUNT, maxChars = MAX_SUGGESTION_CHARS } = {}) {
  const limit = Number.isInteger(count) && count > 0 ? count : DEFAULT_SUGGEST_COUNT;
  const cap = Number.isInteger(maxChars) && maxChars > 0 ? maxChars : MAX_SUGGESTION_CHARS;

  /** @type {unknown[]} */
  let entries = [];
  let found = false;

  const fromText = (text) => {
    const arraySource = firstJsonArray(text);
    if (arraySource !== null) {
      try {
        const parsed = JSON.parse(arraySource);
        if (Array.isArray(parsed)) return { found: true, entries: parsed };
      } catch {
        // Not valid JSON — fall through to the quoted-string scan.
      }
      return { found: false, entries: [] };
    }
    // `{ "suggestions": [...] }` written across lines still contains its array.
    if (text.includes('"suggestions"') || text.includes("'suggestions'")) {
      try {
        const parsed = JSON.parse(text.slice(text.indexOf("{")));
        const obj = /** @type {{suggestions?: unknown, replies?: unknown, data?: unknown}} */ (parsed);
        const list = obj.suggestions ?? obj.replies ?? obj.data;
        if (Array.isArray(list)) return { found: true, entries: list };
      } catch {
        // Fall through to the quoted-string scan.
      }
    }
    return { found: false, entries: [] };
  };

  if (typeof raw === "string") {
    const text = raw.trim();
    const unfenced = text.replace(/^```[a-zA-Z]*\s*\n?/, "").replace(/\n?```$/, "").trim();
    const first = fromText(text);
    if (first.found) { entries = first.entries; found = true; }
    else {
      const second = fromText(unfenced);
      if (second.found) { entries = second.entries; found = true; }
    }
  } else if (Array.isArray(raw)) {
    entries = raw;
    found = true;
  } else if (raw !== null && typeof raw === "object") {
    const obj = /** @type {{suggestions?: unknown, replies?: unknown, data?: unknown}} */ (raw);
    const list = obj.suggestions ?? obj.replies ?? obj.data;
    if (Array.isArray(list)) { entries = list; found = true; }
  }

  if (!found && typeof raw === "string") {
    // Last resort: pull every double-quoted run out of free prose. Models that
    // ignored the JSON instruction still tend to quote each reply.
    const quoted = raw.match(/"([^"\n]{2,})"/g) ?? [];
    if (quoted.length > 0) entries = quoted;
  }

  const out = [];
  const seen = new Set();
  for (const entry of entries) {
    const text = normalizeCandidate(entry);
    if (text === null) continue;
    if (text.length > cap) continue;
    // Case-insensitive de-dup: "Run the tests" twice is one suggestion.
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Read the assistant text out of one OpenAI-shaped chat-completion reply.
 *
 * Tolerates the `content` being either a string or an array of content blocks,
 * which is how every "reasoning/thinking" gateway answers.
 * @param {unknown} body - the parsed reply body.
 * @returns {string} the assistant text, or "" when the body carries none.
 */
export function extractCompletionText(body) {
  if (body === null || typeof body !== "object") return "";
  // Some gateways wrap the OpenAI shape in a `data` envelope.
  const root = /** @type {{data?: unknown}} */ (body).data !== undefined
    ? /** @type {object} */ (/** @type {{data: unknown}} */ (body).data)
    : body;
  const choices = /** @type {{choices?: unknown}} */ (root).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const message = /** @type {{message?: unknown, delta?: unknown}} */ (choices[0]).message
    ?? /** @type {{message?: unknown, delta?: unknown}} */ (choices[0]).delta;
  if (message === null || typeof message !== "object") return "";
  const content = /** @type {{content?: unknown}} */ (message).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      const text = /** @type {{text?: unknown}} */ (part ?? {})?.text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}