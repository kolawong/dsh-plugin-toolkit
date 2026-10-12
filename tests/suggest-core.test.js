/**
 * Tests for the dependency-free reply-suggestion core (suggest-core.js).
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  tailSummary,
  buildSuggestMessages,
  buildSuggestRequest,
  parseSuggestions,
  extractCompletionText,
  MAX_SUGGESTION_CHARS,
  MAX_SUGGEST_TOKENS,
} from "../suggest-core.js";

test("tailSummary: passes short text through, trimmed", () => {
  assert.equal(tailSummary("  已完成修改。  "), "已完成修改。");
  assert.equal(tailSummary(null), "");
  assert.equal(tailSummary("   "), "");
  assert.equal(tailSummary(42), "");
});

test("tailSummary: keeps the TAIL, because a turn's conclusion lives at its end", () => {
  const text = "START" + "x".repeat(200) + "THE-END";
  const tail = tailSummary(text, 50);
  assert.ok(tail.endsWith("THE-END"), `expected the tail, got ${JSON.stringify(tail)}`);
  assert.ok(!tail.startsWith("START"));
});

test("tailSummary: resumes on a nearby line boundary so no half-line opens the prompt", () => {
  const text = "noise\n".repeat(50) + "first real line\nsecond real line";
  const tail = tailSummary(text, 60);
  assert.ok(!tail.startsWith("ne"), `got ${JSON.stringify(tail)}`);
  assert.ok(tail.endsWith("second real line"));
});

test("buildSuggestMessages: pins the language and the count in the instruction", () => {
  const zh = buildSuggestMessages({ summary: "总结", language: "zh", count: 3 });
  assert.equal(zh.length, 2);
  assert.equal(zh[0].role, "system");
  assert.equal(zh[1].role, "user");
  assert.equal(zh[1].content, "总结");
  assert.match(zh[0].content, /3 条/);
  assert.match(zh[0].content, /JSON/);

  const en = buildSuggestMessages({ summary: "summary", language: "en", count: 2 });
  assert.match(en[0].content, /Draft 2 short messages/);
  assert.match(en[0].content, /JSON object/);
});

test("buildSuggestMessages: an unknown language falls back to Chinese, never to an empty prompt", () => {
  const prompt = buildSuggestMessages({ summary: "x", language: "fr" })[0].content;
  assert.match(prompt, /JSON/);
  assert.match(prompt, /用户/);
});

test("buildSuggestMessages: count is clamped to a sane range", () => {
  assert.match(buildSuggestMessages({ summary: "x", count: 99 })[0].content, /5 条/);
  assert.match(buildSuggestMessages({ summary: "x", count: 0 })[0].content, /3 条/);
  assert.match(buildSuggestMessages({ summary: "x", count: -2 })[0].content, /3 条/);
});

test("buildSuggestRequest: an OpenAI-shaped, non-streaming body", () => {
  const body = buildSuggestRequest({ model: "cheap-1", summary: "总结", language: "zh", count: 2 });
  assert.equal(body.model, "cheap-1");
  
  assert.equal(body.max_tokens, MAX_SUGGEST_TOKENS);
  assert.ok(MAX_SUGGEST_TOKENS >= 2000, "a reasoning model must not exhaust the budget before emitting content");
  assert.equal(typeof body.temperature, "number");
  assert.equal(body.messages.length, 2);
});

// ── the salvage ladder ───────────────────────────────────────────────────────

test("parseSuggestions: reads a bare JSON array", () => {
  assert.deepEqual(parseSuggestions('["继续跑测试","把第二个方案写出来"]'), ["继续跑测试", "把第二个方案写出来"]);
});

test("parseSuggestions: reads an array wrapped in a code fence", () => {
  const fenced = '```json\n["a","b"]\n```';
  assert.deepEqual(parseSuggestions(fenced), ["a", "b"]);
});

test("parseSuggestions: reads an array that follows prose", () => {
  const prose = 'Here are the suggestions:\n["keep going","show the diff"]\nHope that helps!';
  assert.deepEqual(parseSuggestions(prose), ["keep going", "show the diff"]);
});

test("parseSuggestions: reads an object that wraps the array", () => {
  assert.deepEqual(parseSuggestions('{"suggestions":["a","b"]}'), ["a", "b"]);
});

test("parseSuggestions: a ']' inside a string cannot close the scan early", () => {
  assert.deepEqual(parseSuggestions('["fix ] in parser","second"]'), ["fix ] in parser", "second"]);
});

test("parseSuggestions: accepts an already-parsed array and object entries", () => {
  assert.deepEqual(parseSuggestions(["a", "b"]), ["a", "b"]);
  assert.deepEqual(parseSuggestions([{ text: "a" }, { reply: "b" }, { suggestion: "c" }]), ["a", "b", "c"]);
});

test("parseSuggestions: accepts chat-completion content-block replies", () => {
  const body = { choices: [{ message: { content: [{ type: "text", text: '["a","b"]' }] } }] };
  assert.deepEqual(parseSuggestions(extractCompletionText(body)), ["a", "b"]);
});

test("parseSuggestions: strips list bullets, numbering and stray quotes", () => {
  assert.deepEqual(parseSuggestions('["- run tests","2. show the diff","\\"quote me\\""]'), [
    "run tests",
    "show the diff",
    "quote me",
  ]);
});

test("parseSuggestions: falls back to a quoted-string scan over free prose", () => {
  const prose = 'Sure! You could "run the tests now" or "show me the second option".';
  assert.deepEqual(parseSuggestions(prose), ["run the tests now", "show me the second option"]);
});

test("parseSuggestions: drops blanks, over-long entries and case-insensitive duplicates", () => {
  const raw = JSON.stringify(["ok", "   ", "OK", null, 42, "x".repeat(MAX_SUGGESTION_CHARS + 1), { nope: 1 }, "fine"]);
  assert.deepEqual(parseSuggestions(raw), ["ok", "fine"]);
});

test("parseSuggestions: honours the count cap", () => {
  assert.deepEqual(parseSuggestions('["a","b","c","d","e"]', { count: 2 }), ["a", "b"]);
});

test("parseSuggestions: unsalvageable input yields [], never throws", () => {
  for (const bad of ["", "   ", "no json here at all", null, undefined, 42, {}, [], "```\n\n```"]) {
    assert.deepEqual(parseSuggestions(bad), [], `input ${JSON.stringify(bad)}`);
  }
});

test("extractCompletionText: string and block content, and a missing choice", () => {
  assert.equal(extractCompletionText({ choices: [{ message: { content: "hi" } }] }), "hi");
  assert.equal(
    extractCompletionText({ choices: [{ message: { content: [{ text: "a" }, { text: "b" }] } }] }),
    "ab",
  );
  assert.equal(extractCompletionText({ choices: [] }), "");
  assert.equal(extractCompletionText({ error: "boom" }), "");
  assert.equal(extractCompletionText(null), "");
});

// The gate smartReply's host route leans on: whatever the endpoint answered,
// the reply either salvages into usable candidates or into none. It must never
// surface a half-parsed value into the composer's setDraft path.
test("parseSuggestions never returns a non-string or an unbounded entry", () => {
  const raw = JSON.stringify([
    { text: "ok" },
    [1, 2],
    { nested: { deep: true } },
    0,
    false,
    "keep",
  ]);
  const out = parseSuggestions(raw);
  for (const entry of out) {
    assert.equal(typeof entry, "string");
    assert.ok(entry.length > 0);
    assert.ok(entry.length <= MAX_SUGGESTION_CHARS);
  }
  assert.deepEqual(out, ["ok", "keep"]);
});