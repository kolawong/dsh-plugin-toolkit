/**
 * dsh-plugin-toolkit — local phrasing-habit learning for smartReply.
 *
 * Everything here is pure and dependency-free: no `fs`, no `process.env`, no
 * network, no clock. The host's suggest-store.js owns where the state is read
 * from and written to; this module only knows how to grow, sanitize, sum up and
 * describe that state. That split is what makes the learning unit-testable
 * without a DSH runtime, and it keeps personal data handling in one auditable
 * place.
 *
 * What is learned is deliberately shallow: aggregate counts (turns, characters,
 * openings) plus a handful of short examples. It is enough for the prompt to
 * imitate how a user writes — length, tone, opening words — and never enough to
 * reconstruct a conversation.
 *
 * @license MIT
 */

/** Shape version of the persisted state. Bump only with a migration path. */
export const HABIT_VERSION = 1;

/** Languages the learner distinguishes. Duplicated from suggest-core so this
 *  module stays import-free and testable on its own. */
const LANGUAGES = /** @type {const} */ (["zh", "en"]);

/** One learned message is capped at this length before it is counted. */
const MAX_MESSAGE_CHARS = 200;
/** One stored user example is capped at this length. */
const MAX_EXAMPLE_CHARS = 120;
/** One stored accepted suggestion is capped at this length. */
const MAX_ACCEPTED_CHARS = 160;
/** Stored real-user examples kept per language (most recent last). */
const MAX_EXAMPLES = 5;
/** Stored accepted suggestions kept per language (most recent last). */
const MAX_ACCEPTED = 5;
/** Distinct opening keys tracked per language. */
const MAX_OPENINGS = 32;
/** Dedupe hashes remembered across calls (FIFO). */
const MAX_LEARNED = 200;
/** Character ceiling on one habit hint handed to the prompt builder. */
const MAX_HINT_CHARS = 800;
/** Sanity ceilings so corrupt input cannot produce absurd counters. */
const MAX_TURNS = 1_000_000;
const MAX_CHARS = 100_000_000;

const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/;
const LATIN_RE = /[A-Za-z\u00C0-\u024F]/;

/**
 * One language's aggregate slice.
 * @typedef {object} HabitLang
 * @property {number} turns - how many distinct real messages were learned.
 * @property {number} chars - total characters of those messages.
 * @property {Record<string, number>} openings - opening key -> count.
 * @property {string[]} examples - up to five recent real messages.
 * @property {string[]} accepted - up to five accepted suggestion texts.
 * @property {number} acceptedCount - lifetime count of accepted suggestions.
 */

/**
 * One language's aggregate slice.
 * @returns {HabitLang} a fresh slice.
 */
function emptyLang() {
  return { turns: 0, chars: 0, openings: {}, examples: [], accepted: [], acceptedCount: 0 };
}

/**
 * A fresh, empty habit state.
 * @returns {object} the state every learner starts from.
 */
export function createHabitState() {
  return {
    version: HABIT_VERSION,
    updatedAt: 0,
    languages: { zh: emptyLang(), en: emptyLang() },
    learned: [],
  };
}

/**
 * Coerce a value into a bounded non-negative integer.
 * @param {unknown} value - candidate counter.
 * @param {number} cap - inclusive upper bound.
 * @returns {number} a safe counter.
 */
function toCount(value, cap) {
  const num = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
  return num <= 0 ? 0 : Math.min(num, cap);
}

/**
 * Collapse whitespace, trim and clip text. Used for every string that can come
 * from a persisted file, so a corrupted entry degrades to fewer characters
 * instead of throwing.
 * @param {unknown} value - candidate text.
 * @param {number} maxChars - character budget after normalization.
 * @returns {string} the normalized text, or "" when there is nothing usable.
 */
function normalizeText(value, maxChars) {
  if (typeof value !== "string") return "";
  const collapsed = value.replace(/\s+/gu, " ").trim();
  if (collapsed === "") return "";
  if (collapsed.length <= maxChars) return collapsed;
  return collapsed.slice(0, maxChars).trim();
}

/**
 * FNV-1a over the lowercased text. A short, stable dedupe key is all this is
 * for — collisions would at worst drop one duplicate example, and the hash
 * never leaves the local file.
 * @param {string} text - normalized message text.
 * @returns {string} a base-36 hash.
 */
function hashText(text) {
  const key = text.toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Normalize and cap a list of short strings, keeping the most recent entries
 * and dropping exact duplicates.
 * @param {unknown} value - candidate list from persisted state.
 * @param {number} maxItems - how many entries to keep.
 * @param {number} maxChars - per-entry character budget.
 * @returns {string[]} the cleaned list, oldest first.
 */
function toTextList(value, maxItems, maxChars) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of value) {
    const text = normalizeText(entry, maxChars);
    if (text === "" || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length > maxItems) out.shift();
  }
  return out;
}

/**
 * Normalize and cap an openings map: positive counts only, highest counts kept,
 * ties broken by insertion order (Array.prototype.sort is stable).
 * @param {unknown} value - candidate map from persisted state.
 * @returns {Record<string, number>} the cleaned map.
 */
function toOpenings(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = [];
  for (const [rawKey, rawCount] of Object.entries(value)) {
    const key = normalizeText(rawKey, 24);
    const count = toCount(rawCount, MAX_TURNS);
    if (key === "" || count === 0) continue;
    entries.push([key, count]);
  }
  entries.sort((a, b) => b[1] - a[1]);
  /** @type {Record<string, number>} */
  const out = {};
  for (const [key, count] of entries.slice(0, MAX_OPENINGS)) out[key] = count;
  return out;
}

/**
 * Validate, trim and cap an arbitrary persisted value into a usable state.
 *
 * Tolerates `undefined`, primitives, truncated JSON-shaped garbage, wrong
 * field types and oversized lists. Never throws: worst case it returns a fresh
 * empty state, which the feature treats as "nothing learned yet".
 * @param {unknown} raw - whatever was read from disk (or nothing).
 * @returns {object} a safe state with every field present and bounded.
 */
export function normalizeHabitState(raw) {
  const state = createHabitState();
  try {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return state;
    const src = /** @type {Record<string, unknown>} */ (raw);
    state.updatedAt = toCount(src.updatedAt, Number.MAX_SAFE_INTEGER);
    const langs = src.languages;
    if (langs !== null && typeof langs === "object" && !Array.isArray(langs)) {
      for (const code of LANGUAGES) {
        const srcLang = /** @type {Record<string, unknown>} */ (langs)[code];
        if (srcLang === null || typeof srcLang !== "object" || Array.isArray(srcLang)) continue;
        const dst = state.languages[code];
        const source = /** @type {Record<string, unknown>} */ (srcLang);
        dst.turns = toCount(source.turns, MAX_TURNS);
        dst.chars = toCount(source.chars, MAX_CHARS);
        dst.openings = toOpenings(source.openings);
        dst.examples = toTextList(source.examples, MAX_EXAMPLES, MAX_EXAMPLE_CHARS);
        dst.accepted = toTextList(source.accepted, MAX_ACCEPTED, MAX_ACCEPTED_CHARS);
        dst.acceptedCount = toCount(source.acceptedCount, MAX_TURNS);
        // Cross-field sanity: the preserved list is a lower bound on the count,
        // and a character total only makes sense alongside at least one turn.
        if (dst.acceptedCount < dst.accepted.length) dst.acceptedCount = dst.accepted.length;
        if (dst.turns === 0) dst.chars = 0;
        else {
          if (dst.chars < dst.turns) dst.chars = dst.turns;
          if (dst.chars > dst.turns * MAX_MESSAGE_CHARS) dst.chars = dst.turns * MAX_MESSAGE_CHARS;
        }
      }
    }
    state.learned = toTextList(src.learned, MAX_LEARNED, 64);
  } catch {
    // A hostile getter or an exotic object: an empty state is the safe answer.
    return createHabitState();
  }
  return state;
}

/**
 * Detect the writing language of one message.
 * @param {unknown} text - candidate message.
 * @returns {"zh" | "en" | ""} `"zh"` when any CJK character is present, `"en"`
 *   for Latin text, and `""` for empty or letter-free input.
 */
export function detectLanguage(text) {
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  if (trimmed === "") return "";
  if (CJK_RE.test(trimmed)) return "zh";
  if (LATIN_RE.test(trimmed)) return "en";
  return "";
}

/**
 * The opening habit key for one message: the first two characters in Chinese,
 * the first lowercased word in English.
 * @param {string} text - normalized message text.
 * @param {"zh" | "en"} language - the slice the opening belongs to.
 * @returns {string} the opening key, or "" when there is none.
 */
function openingOf(text, language) {
  if (language === "en") {
    const first = text.toLowerCase().split(/\s+/u)[0] ?? "";
    const word = first.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    return word.slice(0, 24);
  }
  return Array.from(text).slice(0, 2).join("");
}

/**
 * Increment one opening's count, evicting the least frequent opening when the
 * cap is reached. Ties go to the earliest inserted key.
 * @param {Record<string, number>} openings - the language's opening counts.
 * @param {string} key - the opening to bump.
 */
function bumpOpening(openings, key) {
  if (key === "") return;
  if (Object.prototype.hasOwnProperty.call(openings, key)) {
    openings[key] = Math.min(toCount(openings[key], MAX_TURNS) + 1, MAX_TURNS);
    return;
  }
  const keys = Object.keys(openings);
  if (keys.length >= MAX_OPENINGS) {
    let victim = keys[0];
    let lowest = Number.POSITIVE_INFINITY;
    for (const candidate of keys) {
      const count = toCount(openings[candidate], MAX_TURNS);
      if (count < lowest) {
        lowest = count;
        victim = candidate;
      }
    }
    delete openings[victim];
  }
  openings[key] = 1;
}

/**
 * True when a value already has the shape the learners mutate in place.
 * @param {unknown} state - candidate state.
 * @returns {boolean} whether it is safe to mutate directly.
 */
function isUsableState(state) {
  if (state === null || typeof state !== "object") return false;
  try {
    const src = /** @type {Record<string, unknown>} */ (state);
    const langs = src.languages;
    if (langs === null || typeof langs !== "object") return false;
    if (!Array.isArray(src.learned)) return false;
    for (const code of LANGUAGES) {
      const lang = /** @type {Record<string, unknown>} */ (langs)[code];
      if (lang === null || typeof lang !== "object") return false;
      if (typeof lang.turns !== "number") return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Fill any missing language fields in place so the learners cannot trip over a
 * partially valid state.
 * @param {HabitLang} lang - one slice to repair.
 */
function repairLang(lang) {
  lang.turns = toCount(lang.turns, MAX_TURNS);
  lang.chars = toCount(lang.chars, MAX_CHARS);
  lang.acceptedCount = toCount(lang.acceptedCount, MAX_TURNS);
  if (!Array.isArray(lang.examples)) lang.examples = [];
  if (!Array.isArray(lang.accepted)) lang.accepted = [];
  if (lang.openings === null || typeof lang.openings !== "object" || Array.isArray(lang.openings)) lang.openings = {};
}

/**
 * Pick the state a learner mutates: the caller's own object when it already has
 * the right shape (so callers can ignore the return value), otherwise a
 * normalized replacement.
 * @param {unknown} state - caller-provided state.
 * @returns {object} a state safe to mutate.
 */
function prepareState(state) {
  if (!isUsableState(state)) return normalizeHabitState(state);
  const usable = /** @type {{languages: Record<string, HabitLang>, learned: string[]}} */ (state);
  repairLang(usable.languages.zh);
  repairLang(usable.languages.en);
  return usable;
}

/**
 * Collapse a fallback language argument to a supported code.
 * @param {unknown} language - caller-provided language.
 * @returns {"zh" | "en"} a supported code.
 */
function resolveFallback(language) {
  return LANGUAGES.includes(/** @type {"zh" | "en"} */ (language)) ? /** @type {"zh" | "en"} */ (language) : "zh";
}

/**
 * Learn from the user's real messages: turns, character totals, opening habits
 * and up to five short examples.
 *
 * Idempotent across calls: every accepted message is hashed into `learned`, so
 * re-scanning the same session history (which the host does on each request)
 * never double-counts. `learned` is FIFO-capped at 200, so only very old
 * messages can be counted twice again after heavy use.
 * @param {unknown} state - habit state; mutated in place when it is well-shaped.
 * @param {unknown} messages - real user message texts, oldest first.
 * @param {"zh" | "en"} [fallbackLanguage] - language used when a message carries
 *   neither CJK nor Latin characters.
 * @returns {object} the state that was mutated (or its normalized replacement).
 */
export function learnFromUserMessages(state, messages, fallbackLanguage = "zh") {
  const target = prepareState(state);
  const fallback = resolveFallback(fallbackLanguage);
  if (!Array.isArray(messages)) return target;
  for (const message of messages) {
    const text = normalizeText(message, MAX_MESSAGE_CHARS);
    if (text === "") continue;
    const hash = hashText(text);
    if (target.learned.includes(hash)) continue;
    target.learned.push(hash);
    while (target.learned.length > MAX_LEARNED) target.learned.shift();

    const language = detectLanguage(text) || fallback;
    const lang = target.languages[language];
    lang.turns = Math.min(lang.turns + 1, MAX_TURNS);
    lang.chars = Math.min(lang.chars + text.length, MAX_CHARS);
    bumpOpening(lang.openings, openingOf(text, language));

    const example = text.length <= MAX_EXAMPLE_CHARS ? text : text.slice(0, MAX_EXAMPLE_CHARS).trim();
    lang.examples.push(example);
    while (lang.examples.length > MAX_EXAMPLES) lang.examples.shift();
  }
  return target;
}

/**
 * Learn from suggestions the user actually accepted (Tab-filled and sent).
 *
 * Accepted text is the strongest signal available — it is a real message the
 * user chose to send — so it is kept verbatim (capped) alongside the user's own
 * messages, de-duplicated per language and counted only once.
 * @param {unknown} state - habit state; mutated in place when it is well-shaped.
 * @param {unknown} acceptedTexts - accepted suggestion texts, oldest first.
 * @param {"zh" | "en"} [fallbackLanguage] - language used when the text carries
 *   neither CJK nor Latin characters.
 * @returns {object} the state that was mutated (or its normalized replacement).
 */
export function learnFromAccepted(state, acceptedTexts, fallbackLanguage = "zh") {
  const target = prepareState(state);
  const fallback = resolveFallback(fallbackLanguage);
  if (!Array.isArray(acceptedTexts)) return target;
  for (const entry of acceptedTexts) {
    const text = normalizeText(entry, MAX_ACCEPTED_CHARS);
    if (text === "") continue;
    const lang = target.languages[detectLanguage(text) || fallback];
    const key = text.toLowerCase();
    if (lang.accepted.some((existing) => existing.toLowerCase() === key)) continue;
    lang.accepted.push(text);
    while (lang.accepted.length > MAX_ACCEPTED) lang.accepted.shift();
    lang.acceptedCount = Math.min(lang.acceptedCount + 1, MAX_TURNS);
  }
  return target;
}

/**
 * The most frequent opening keys.
 * @param {Record<string, number>} openings - one language's opening counts.
 * @param {number} limit - how many keys to return.
 * @returns {string[]} keys, most frequent first.
 */
function topOpenings(openings, limit) {
  return Object.entries(openings)
    .map(([key, count]) => /** @type {[string, number]} */ ([key, toCount(count, MAX_TURNS)]))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key);
}

/**
 * Render the local habit state as a short, human-readable hint for the prompt
 * builder: average length, frequent openings, a couple of real examples and a
 * couple of accepted suggestions. Always ends with the "imitate, never copy"
 * instruction, and always fits {@link MAX_HINT_CHARS}.
 * @param {unknown} state - habit state (normalized defensively here).
 * @param {"zh" | "en"} [language] - which language's slice to describe.
 * @returns {string} the hint, or "" when nothing has been learned yet.
 */
export function habitStyleHint(state, language = "zh") {
  const lang = resolveFallback(language);
  const normalized = normalizeHabitState(state);
  const data = normalized.languages[lang];
  if (data.turns === 0 && data.accepted.length === 0) return "";

  const zh = lang === "zh";
  const ending = zh
    ? "只模仿长度、语气与习惯，不要照抄内容。"
    : "Only imitate length, tone, and habits; never copy the content.";

  const lines = [];
  if (data.turns > 0) {
    const avg = Math.max(1, Math.round(data.chars / data.turns));
    lines.push(zh ? `平均长度约 ${avg} 个字。` : `Typical length: about ${avg} characters.`);

    const openings = topOpenings(data.openings, 2);
    if (openings.length > 0) {
      lines.push(zh
        ? `常用开头：${openings.map((opening) => `「${opening}」`).join("")}。`
        : `Frequent openings: ${openings.map((opening) => `"${opening}"`).join(", ")}.`);
    }

    const examples = data.examples.slice(-2);
    if (examples.length > 0) {
      lines.push(zh
        ? `近期用户的真实表达：${examples.map((example) => `「${example}」`).join("")}。`
        : `Recent real messages from the user: ${examples.map((example) => `"${example}"`).join(", ")}.`);
    }
  }

  const accepted = data.accepted.slice(-2);
  if (accepted.length > 0) {
    lines.push(zh
      ? `用户接受过的建议：${accepted.map((example) => `「${example}」`).join("")}。`
      : `Suggestions the user accepted before: ${accepted.map((example) => `"${example}"`).join(", ")}.`);
  }

  // Reserve room for the ending first, then add lines while the whole hint
  // still fits. The ending is the part that must never be truncated away.
  const bodyBudget = Math.max(0, MAX_HINT_CHARS - ending.length - 1);
  const body = [];
  for (const line of lines) {
    if ([...body, line].join("\n").length > bodyBudget) break;
    body.push(line);
  }
  const hint = [...body, ending].join("\n");
  return hint.length <= MAX_HINT_CHARS ? hint : hint.slice(0, MAX_HINT_CHARS);
}

/**
 * Compact totals for the settings UI's "learned N turns" line.
 * @param {unknown} state - habit state (normalized defensively here).
 * @returns {{turns: number, accepted: number, languages: string[]}} summed
 *   turns, accepted suggestions, and the languages that have any signal.
 */
export function habitSummary(state) {
  const normalized = normalizeHabitState(state);
  let turns = 0;
  let accepted = 0;
  const languages = [];
  for (const code of LANGUAGES) {
    const lang = normalized.languages[code];
    turns += lang.turns;
    accepted += lang.acceptedCount;
    if (lang.turns > 0 || lang.accepted.length > 0) languages.push(code);
  }
  return { turns, accepted, languages };
}
