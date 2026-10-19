/**
 * Tests for the pure local phrasing-habit learner (suggest-habits.js).
 *
 * These tests treat the module as the whole world: no fs, no settings, no
 * runtime. Every case feeds it data a corrupt file or a long-lived profile
 * could realistically produce.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  HABIT_VERSION,
  createHabitState,
  normalizeHabitState,
  detectLanguage,
  learnFromUserMessages,
  learnFromAccepted,
  habitStyleHint,
  habitSummary,
} from "../suggest-habits.js";

const EMPTY_LANG = { turns: 0, chars: 0, openings: {}, examples: [], accepted: [], acceptedCount: 0 };

/** Assert that a state has the complete, bounded shape the rest of the system relies on. */
function assertShaped(state) {
  assert.equal(state.version, HABIT_VERSION);
  assert.equal(typeof state.updatedAt, "number");
  assert.ok(state.updatedAt >= 0);
  assert.deepEqual(Object.keys(state.languages).sort(), ["en", "zh"]);
  for (const code of ["zh", "en"]) {
    const lang = state.languages[code];
    assert.equal(typeof lang.turns, "number");
    assert.equal(typeof lang.chars, "number");
    assert.equal(typeof lang.acceptedCount, "number");
    assert.ok(Array.isArray(lang.examples));
    assert.ok(Array.isArray(lang.accepted));
    assert.equal(typeof lang.openings, "object");
    assert.ok(!Array.isArray(lang.openings));
    assert.ok(lang.examples.length <= 5);
    assert.ok(lang.accepted.length <= 5);
    assert.ok(Object.keys(lang.openings).length <= 32);
  }
  assert.ok(Array.isArray(state.learned));
  assert.ok(state.learned.length <= 200);
}

// ── shape ────────────────────────────────────────────────────────────────────

test("createHabitState: a complete v1 state with both language slices", () => {
  const state = createHabitState();
  assert.equal(state.version, 1);
  assert.equal(state.updatedAt, 0);
  assert.deepEqual(state.learned, []);
  assert.deepEqual(state.languages.zh, EMPTY_LANG);
  assert.deepEqual(state.languages.en, EMPTY_LANG);
  assertShaped(state);
});

// ── language detection ───────────────────────────────────────────────────────

test("detectLanguage: CJK is zh, Latin is en, nothing else is empty", () => {
  assert.equal(detectLanguage("帮我跑一下测试"), "zh");
  assert.equal(detectLanguage("run the tests"), "en");
  assert.equal(detectLanguage("用 TypeScript 重写这个模块"), "zh");
  assert.equal(detectLanguage("   "), "");
  assert.equal(detectLanguage(""), "");
  assert.equal(detectLanguage("12345 !!!"), "");
  assert.equal(detectLanguage(null), "");
  assert.equal(detectLanguage(42), "");
  assert.equal(detectLanguage(["明明"]), "");
});

// ── learning real user messages ──────────────────────────────────────────────

test("learnFromUserMessages: counts turns/chars, openings and examples per language", () => {
  const state = createHabitState();
  const returned = learnFromUserMessages(state, ["帮我看看这个方案", "run the tests"]);
  assert.equal(returned, state, "a well-shaped state is mutated in place");
  assert.equal(state.languages.zh.turns, 1);
  assert.equal(state.languages.zh.chars, "帮我看看这个方案".length);
  assert.equal(state.languages.zh.openings["帮我"], 1);
  assert.deepEqual(state.languages.zh.examples, ["帮我看看这个方案"]);
  assert.equal(state.languages.en.turns, 1);
  assert.equal(state.languages.en.openings.run, 1);
  assert.deepEqual(state.languages.en.examples, ["run the tests"]);
  assert.equal(state.learned.length, 2);
  assertShaped(state);
});

test("learnFromUserMessages: dedupes across calls and within one call", () => {
  const state = createHabitState();
  learnFromUserMessages(state, ["继续跑测试", "继续跑测试"]);
  learnFromUserMessages(state, ["继续跑测试"]);
  assert.equal(state.languages.zh.turns, 1);
  assert.equal(state.languages.zh.chars, "继续跑测试".length);
  assert.deepEqual(state.languages.zh.examples, ["继续跑测试"]);
  assert.equal(state.languages.zh.openings["继续"], 1);
  assert.equal(state.learned.length, 1);

  // Latin dedupe is case-insensitive and whitespace-collapsed.
  learnFromUserMessages(state, ["Run the tests"]);
  learnFromUserMessages(state, ["run   the\ttests"]);
  assert.equal(state.languages.en.turns, 1);
  assert.equal(state.languages.en.chars, "Run the tests".length);
});

test("learnFromUserMessages: normalizes whitespace, caps messages at 200 chars", () => {
  const state = createHabitState();
  learnFromUserMessages(state, ["  hello   world \n\t again  "]);
  assert.deepEqual(state.languages.en.examples, ["hello world again"]);
  assert.equal(state.languages.en.chars, "hello world again".length);

  const huge = "甲".repeat(500);
  learnFromUserMessages(state, [huge]);
  assert.equal(state.languages.zh.turns, 1);
  assert.equal(state.languages.zh.chars, 200);
  assert.equal(state.languages.zh.examples[0].length, 120);
});

test("learnFromUserMessages: a message with no letters uses the fallback language", () => {
  const state = createHabitState();
  learnFromUserMessages(state, ["12345"], "en");
  assert.equal(state.languages.en.turns, 1);
  assert.equal(state.languages.zh.turns, 0);

  learnFromUserMessages(state, ["67890"]);
  assert.equal(state.languages.zh.turns, 1);
});

test("learnFromUserMessages: keeps at most 32 distinct openings per language", () => {
  const state = createHabitState();
  const messages = Array.from({ length: 40 }, (_, index) => {
    const opening = String.fromCharCode(0x4e00 + index) + String.fromCharCode(0x4e01 + index);
    return `${opening}测试`;
  });
  learnFromUserMessages(state, messages);
  assert.equal(state.languages.zh.turns, 40);
  assert.equal(Object.keys(state.languages.zh.openings).length, 32);
  const lastOpening = messages.at(-1).slice(0, 2);
  assert.ok(lastOpening in state.languages.zh.openings, "the newest opening survives eviction");
  assert.ok(!("一丁" in state.languages.zh.openings), "the least frequent, oldest opening was evicted");
});

test("learnFromUserMessages: keeps only the last five examples", () => {
  const state = createHabitState();
  learnFromUserMessages(state, ["消息一", "消息二", "消息三", "消息四", "消息五", "消息六"]);
  assert.deepEqual(state.languages.zh.examples, ["消息二", "消息三", "消息四", "消息五", "消息六"]);
});

test("learnFromUserMessages: learned hashes are FIFO-capped at 200", () => {
  const state = createHabitState();
  const messages = Array.from({ length: 205 }, (_, index) => `第 ${index} 条消息`);
  learnFromUserMessages(state, messages);
  assert.equal(state.learned.length, 200);
  assert.equal(state.languages.zh.turns, 205);
  assert.equal(state.languages.zh.examples.length, 5);

  // The oldest hash fell out of the FIFO, so that message would count again.
  learnFromUserMessages(state, ["第 0 条消息"]);
  assert.equal(state.languages.zh.turns, 206);
});

test("learnFromUserMessages: tolerates missing or garbage state and non-array input", () => {
  assert.doesNotThrow(() => learnFromUserMessages(null, ["继续跑测试"]));
  assert.doesNotThrow(() => learnFromUserMessages(undefined, ["继续跑测试"]));
  assert.doesNotThrow(() => learnFromUserMessages("junk", ["继续跑测试"]));

  const fromUndefined = learnFromUserMessages(undefined, ["继续跑测试"]);
  assertShaped(fromUndefined);
  assert.equal(fromUndefined.languages.zh.turns, 1);

  const partial = learnFromUserMessages(
    { version: 1, languages: { zh: { turns: 2 } } },
    ["继续跑测试"],
  );
  assertShaped(partial);
  assert.equal(partial.languages.zh.turns, 3);
  assert.equal(partial.languages.zh.chars, 2 + "继续跑测试".length);

  const untouched = createHabitState();
  assert.equal(learnFromUserMessages(untouched, "not an array"), untouched);
  assert.equal(learnFromUserMessages(untouched, [null, 42, "", "   "]).languages.zh.turns, 0);
});

// ── learning accepted suggestions ────────────────────────────────────────────

test("learnFromAccepted: dedupes per language and counts only new entries", () => {
  const state = createHabitState();
  learnFromAccepted(state, ["继续跑测试", "继续跑测试", "   "]);
  assert.deepEqual(state.languages.zh.accepted, ["继续跑测试"]);
  assert.equal(state.languages.zh.acceptedCount, 1);

  learnFromAccepted(state, ["继续跑测试"]);
  assert.equal(state.languages.zh.acceptedCount, 1);

  // Latin accepted text dedupes case-insensitively.
  learnFromAccepted(state, ["go ahead", "Go Ahead"]);
  assert.deepEqual(state.languages.en.accepted, ["go ahead"]);
  assert.equal(state.languages.en.acceptedCount, 1);
});

test("learnFromAccepted: keeps the five most recent and caps long texts", () => {
  const state = createHabitState();
  learnFromAccepted(state, ["a1", "a2", "a3", "a4", "a5", "a6"]);
  assert.deepEqual(state.languages.en.accepted, ["a2", "a3", "a4", "a5", "a6"]);
  assert.equal(state.languages.en.acceptedCount, 6);

  learnFromAccepted(state, ["乙".repeat(400)]);
  assert.equal(state.languages.zh.accepted[0].length, 160);
  assertShaped(state);
});

test("learnFromAccepted: falls back to the given language for letter-free text", () => {
  const state = createHabitState();
  learnFromAccepted(state, ["12345"], "en");
  assert.equal(state.languages.en.acceptedCount, 1);
  assert.deepEqual(state.languages.zh.accepted, []);
  assert.doesNotThrow(() => learnFromAccepted(undefined, ["12345"]));
});

// ── normalization of persisted state ─────────────────────────────────────────

test("normalizeHabitState: undefined and garbage yield an empty valid state, never throws", () => {
  const garbage = [
    undefined,
    null,
    42,
    "garbage",
    [],
    [1, 2],
    {},
    { version: 99 },
    { languages: null },
    { languages: [] },
    { languages: { zh: "x" } },
    { languages: { zh: { turns: -5, chars: -1, openings: null, examples: "x", accepted: 7, acceptedCount: -2 } } },
    { learned: "nope" },
  ];
  for (const raw of garbage) {
    const state = normalizeHabitState(raw);
    assert.doesNotThrow(() => assertShaped(state), `garbage ${JSON.stringify(raw)}`);
  }

  const hostile = { get languages() { throw new Error("boom"); } };
  assert.doesNotThrow(() => normalizeHabitState(hostile));
  assertShaped(normalizeHabitState(hostile));
  assert.deepEqual(normalizeHabitState(hostile), createHabitState());
});

test("normalizeHabitState: trims and caps oversized persisted data", () => {
  const raw = {
    version: 2,
    updatedAt: 123,
    languages: {
      zh: {
        turns: 5,
        chars: 50,
        openings: Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`开${index}`, index + 1])),
        examples: Array.from({ length: 9 }, (_, index) => `示例${index}`),
        accepted: Array.from({ length: 9 }, (_, index) => `接受${index}`),
        acceptedCount: 2,
      },
      fr: { turns: 99, examples: ["ignored"] },
    },
    learned: Array.from({ length: 250 }, (_, index) => `h${index}`),
  };
  const state = normalizeHabitState(raw);
  assertShaped(state);
  assert.equal(state.version, 1, "the module owns the version");
  assert.equal(state.updatedAt, 123);
  assert.equal(Object.keys(state.languages.zh.openings).length, 32);
  assert.deepEqual(state.languages.zh.examples, ["示例4", "示例5", "示例6", "示例7", "示例8"]);
  assert.deepEqual(state.languages.zh.accepted, ["接受4", "接受5", "接受6", "接受7", "接受8"]);
  assert.equal(state.languages.zh.acceptedCount, 5, "the preserved list is a lower bound on the count");
  assert.equal(state.learned.length, 200);
  assert.equal(state.learned.at(-1), "h249");
  assert.deepEqual(state.languages.fr, undefined);
});

test("normalizeHabitState: caps per-entry lengths and repairs cross-field counters", () => {
  const state = normalizeHabitState({
    languages: {
      zh: {
        turns: 3,
        chars: 2,
        openings: { "开": 2, "  ": 5, "负": -1 },
        examples: ["长".repeat(300)],
        accepted: ["接".repeat(300)],
        acceptedCount: 0,
      },
    },
  });
  assert.equal(state.languages.zh.chars, 3, "each turn is at least one character");
  assert.equal(state.languages.zh.examples[0].length, 120);
  assert.equal(state.languages.zh.accepted[0].length, 160);
  assert.equal(state.languages.zh.acceptedCount, 1);
  assert.deepEqual(state.languages.zh.openings, { "开": 2 });
});

test("normalizeHabitState: is idempotent", () => {
  const state = createHabitState();
  learnFromUserMessages(state, ["继续跑测试", "run the tests", "帮我看看这个方案"]);
  learnFromAccepted(state, ["把方案二也写出来"]);
  const once = normalizeHabitState(state);
  const twice = normalizeHabitState(once);
  assert.deepEqual(twice, once);
});

// ── hint rendering ───────────────────────────────────────────────────────────

test("habitStyleHint: empty state means no hint at all", () => {
  assert.equal(habitStyleHint(createHabitState(), "zh"), "");
  assert.equal(habitStyleHint(createHabitState(), "en"), "");
  assert.equal(habitStyleHint(null, "zh"), "");
  assert.equal(habitStyleHint("junk", "en"), "");
});

test("habitStyleHint: Chinese hint has length, openings, examples, accepted, and the copy guard", () => {
  const state = createHabitState();
  learnFromUserMessages(state, ["帮我改一下这个方案", "帮我看看测试", "再补一个用例"]);
  learnFromAccepted(state, ["继续跑测试"]);
  const hint = habitStyleHint(state, "zh");
  assert.match(hint, /平均长度约 \d+ 个字/);
  assert.match(hint, /常用开头：「帮我」「再补」/);
  assert.match(hint, /近期用户的真实表达：「帮我看看测试」「再补一个用例」/);
  assert.match(hint, /用户接受过的建议：「继续跑测试」/);
  assert.ok(hint.endsWith("不要照抄内容。"));
  assert.ok(hint.length <= 800);
});

test("habitStyleHint: English hint is English and keeps the same structure", () => {
  const state = createHabitState();
  learnFromUserMessages(state, ["run the tests", "show me the diff", "run the linter"]);
  learnFromAccepted(state, ["go ahead and run them"]);
  const hint = habitStyleHint(state, "en");
  assert.match(hint, /Typical length: about \d+ characters/);
  assert.match(hint, /Frequent openings: "run", "show"/);
  assert.match(hint, /Recent real messages from the user: "show me the diff", "run the linter"/);
  assert.match(hint, /Suggestions the user accepted before: "go ahead and run them"/);
  assert.ok(hint.endsWith("never copy the content."));
  assert.ok(hint.length <= 800);
});

test("habitStyleHint: an accepted-only state still renders a hint", () => {
  const state = createHabitState();
  learnFromAccepted(state, ["继续跑测试"]);
  const hint = habitStyleHint(state, "zh");
  assert.match(hint, /用户接受过的建议/);
  assert.ok(!hint.includes("平均长度"));
  assert.ok(hint.endsWith("不要照抄内容。"));
});

test("habitStyleHint: stays within its cap with long examples and accepted text", () => {
  const state = createHabitState();
  learnFromUserMessages(state, [
    "长句子测试".repeat(30),
    "另一个很长的句子".repeat(20),
    "再一个特别长的表达".repeat(15),
  ]);
  learnFromAccepted(state, ["接受".repeat(80)]);
  const hint = habitStyleHint(state, "zh");
  assert.ok(hint.length <= 800, `hint too long: ${hint.length}`);
  assert.ok(hint.endsWith("不要照抄内容。"), "the copy guard must survive truncation");
});

test("habitStyleHint: unknown language behaves like Chinese", () => {
  const state = createHabitState();
  learnFromUserMessages(state, ["帮我看看这个方案"]);
  assert.equal(habitStyleHint(state, "fr"), habitStyleHint(state, "zh"));
  assert.equal(habitStyleHint(state, undefined), habitStyleHint(state, "zh"));
});

// ── summary ──────────────────────────────────────────────────────────────────

test("habitSummary: sums turns and accepted across languages", () => {
  const state = createHabitState();
  learnFromUserMessages(state, ["继续跑测试", "run the tests"]);
  learnFromAccepted(state, ["继续跑测试"]);
  learnFromAccepted(state, ["go ahead"]);
  assert.deepEqual(habitSummary(state), { turns: 2, accepted: 2, languages: ["zh", "en"] });
});

test("habitSummary: empty and garbage states report zeros", () => {
  assert.deepEqual(habitSummary(createHabitState()), { turns: 0, accepted: 0, languages: [] });
  assert.deepEqual(habitSummary(null), { turns: 0, accepted: 0, languages: [] });
  assert.deepEqual(habitSummary("junk"), { turns: 0, accepted: 0, languages: [] });
});

test("habitSummary: only languages with real signal are listed", () => {
  const state = createHabitState();
  learnFromUserMessages(state, ["帮我看看这个方案"]);
  assert.deepEqual(habitSummary(state), { turns: 1, accepted: 0, languages: ["zh"] });
});
