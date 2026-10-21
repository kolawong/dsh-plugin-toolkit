/**
 * Tests for the reply-suggestion host route (suggest-api.js).
 *
 * Two rules are encoded here:
 *
 *  - A registered llm route is called through `ctx.llm.stream`, so the adapter
 *    owns protocol/endpoint/credential and a catalog route such as minimax-cn
 *    works without any endpoint override.
 *  - An unregistered route keeps the legacy endpoint path and its decline
 *    ladder: no invented URL, no unsupported protocol, no guaranteed-401 probe.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import {
  suggestConfig,
  joinUrl,
  requestSuggestions,
  requestSuggestionsViaRuntime,
  recentUserMessages,
  sanitizeAccepted,
  routeRegistered,
  suggestOptions,
  installSmartReply,
} from "../suggest-api.js";

// ── joinUrl: every baseURL shape in the wild ────────────────────────────────

test("joinUrl: normalizes separators without doubling or dropping them", () => {
  assert.equal(joinUrl("https://x.dev/v1", "chat/completions"), "https://x.dev/v1/chat/completions");
  assert.equal(joinUrl("https://x.dev/v1/", "chat/completions"), "https://x.dev/v1/chat/completions");
  assert.equal(joinUrl("https://x.dev/v1///", "/chat/completions"), "https://x.dev/v1/chat/completions");
  assert.equal(joinUrl("  https://x.dev/v1  ", "chat/completions"), "https://x.dev/v1/chat/completions");
  assert.equal(joinUrl("https://x.dev/v1", ""), "https://x.dev/v1");
});

// ── suggestConfig: defaults, and the "" fallbacks that keep it dormant ──────

test("suggestConfig: defaults are on, three candidates, 30s, habits on, empty model", () => {
  const config = suggestConfig({});
  assert.equal(config.enabled, true);
  assert.equal(config.routeKey, "");
  assert.equal(config.model, "");
  assert.equal(config.path, "/api/toolkit/suggest-reply");
  assert.equal(config.language, "");
  assert.equal(config.count, 3);
  assert.equal(config.timeoutSec, 30);
  assert.equal(config.learnHabits, true);
});

test("suggestConfig: the toggle, language, and habit switch are honoured", () => {
  assert.equal(suggestConfig({ optimizations: { smartReply: false } }).enabled, false);
  assert.equal(suggestConfig({ suggestLanguage: "zh" }).language, "zh");
  assert.equal(suggestConfig({ suggestLanguage: "en" }).language, "en");
  // A language nobody speaks must fall back to "follow the UI", not pass through.
  assert.equal(suggestConfig({ suggestLanguage: "fr" }).language, "");
  assert.equal(suggestConfig({ suggestLearnHabits: false }).learnHabits, false);
});

test("suggestConfig: count and timeout are clamped to usable ranges", () => {
  assert.equal(suggestConfig({ suggestCount: 99 }).count, 5);
  assert.equal(suggestConfig({ suggestCount: 0 }).count, 3);
  assert.equal(suggestConfig({ suggestTimeoutSec: 0 }).timeoutSec, 30);
  assert.equal(suggestConfig({ suggestTimeoutSec: 12 }).timeoutSec, 12);
});

test("suggestConfig: an empty path falls back to the default, never to a blank route", () => {
  assert.equal(suggestConfig({ suggestPath: "" }).path, "/api/toolkit/suggest-reply");
});

// ── shared fakes ────────────────────────────────────────────────────────────

const PRIMARY = {
  routeKey: "primary",
  apiKey: "sk-test",
  apiKeyEnvVar: "TEST_KEY",
  baseURL: "https://stored/v1",
  routeApi: "openai-completions",
  routeBaseURLs: {},
  routeExtraModels: {},
  enabled: false,
  timeoutSec: 10,
  registryProvider: "primary",
  vision: [],
  textOnly: [],
  migratedFromLegacy: false,
};

/**
 * A resolver stand-in shaped like the modelCapability context.
 * @param {object} over - endpoint/credential/llm overrides.
 * @returns {object} a ctx the resolvers accept.
 */
function ctxWith(over = {}) {
  const { apiKey = "sk-test", discoveries, llm } = over;
  return {
    config: () => ({ ...PRIMARY, apiKey, apiKeyEnvVar: "TEST_KEY" }),
    get: async (name) => (name === "credentials" ? { resolve: async () => ({ value: apiKey }) } : undefined),
    llm: llm ?? { discoveries },
    settings: { describe: () => [] },
  };
}

const CONFIG = suggestConfig({ suggestModel: "cheap-1" });

/** A modelCapability config for a plugin-owned primary route. */
const PLUGIN_PRIMARY = {
  ...PRIMARY,
  routeKey: "opencode-go",
};

/**
 * ctx whose registered runtime owns `minimax-cn`, with no stored endpoint for
 * that catalog route — the exact configuration that failed before this change.
 * @returns {object} a ctx.
 */
function runtimeCtx() {
  const seen = [];
  return {
    seen,
    config: () => PLUGIN_PRIMARY,
    get: async () => undefined,
    settings: { describe: () => [] },
    llm: {
      listProviders: () => [{ id: "minimax-cn", name: "MiniMax CN" }],
      listModels: async () => [],
      stream: async function* (options) {
        seen.push(options);
        yield { type: "block-start", index: 0, blockType: "reasoning" };
        yield { type: "reasoning-delta", index: 0, text: "let me think" };
        yield { type: "block-start", index: 1, blockType: "text" };
        yield { type: "text-delta", index: 1, text: '{"suggestions":["继续，把第二个' };
        yield { type: "text-delta", index: 1, text: '方案也写出来","先只给结论"]}' };
        yield { type: "finish", reason: { kind: "stop" } };
      },
    },
  };
}

// ── requestSuggestions: the runtime path ───────────────────────────────────

test("requestSuggestions: a registered catalog route goes through the llm runtime, not an endpoint", async () => {
  const ctx = runtimeCtx();
  const config = suggestConfig({
    suggestRouteKey: "minimax-cn",
    suggestModel: "MiniMax-M3.1-Flash-Preview",
  });
  // minimax-cn has no stored baseURL and no modelsRouteBaseURLs override here:
  // the legacy path would answer no-endpoint; the runtime path needs neither
  // (this exact configuration was the regression that motivated the refactor).
  const out = await requestSuggestions(
    ctx,
    config,
    "已经定位到两处问题，并给出了修法。",
    "zh",
    async () => { throw new Error("the legacy fetch must not run for a registered route"); },
    { lastUserText: "帮我看一下建议回复", habitHint: "用户平均 12 字，偏直接。" },
  );
  assert.deepEqual(out, ["继续，把第二个方案也写出来", "先只给结论"]);
  assert.equal(ctx.seen.length, 1);
  const call = ctx.seen[0];
  assert.equal(call.provider, "minimax-cn");
  assert.equal(call.model, "MiniMax-M3.1-Flash-Preview");
  assert.match(call.system, /用户下一句预测引擎/);
  assert.match(call.system, /表达习惯/);
  assert.equal(call.messages.length, 1);
  assert.equal(call.messages[0].role, "user");
  assert.match(call.messages[0].content[0].text, /帮我看一下建议回复/);
  assert.match(call.messages[0].content[0].text, /已经定位到两处问题/);
  assert.equal(call.temperature, 0.7);
  assert.ok(call.maxTokens >= 2000);
  assert.ok(call.signal instanceof AbortSignal);
});

test("requestSuggestions: a runtime finish error is surfaced with its code", async () => {
  const ctx = {
    ...ctxWith({ llm: { listProviders: () => [{ id: "primary" }] } }),
    llm: {
      listProviders: () => [{ id: "primary" }],
      stream: async function* () {
        yield { type: "finish", reason: { kind: "error", failure: { code: "QUOTA", message: "quota exhausted" } } };
      },
    },
  };
  await assert.rejects(
    () => requestSuggestions(ctx, { ...CONFIG, routeKey: "primary" }, "s", "zh", async () => { throw new Error("no fetch"); }),
    (error) => {
      assert.equal(error.code, "QUOTA");
      assert.match(error.message, /quota exhausted/);
      return true;
    },
  );
});

test("requestSuggestions: a stream that ignores the deadline is aborted as a timeout", async () => {
  const ctx = {
    ...ctxWith({ llm: { listProviders: () => [{ id: "primary" }] } }),
    llm: {
      listProviders: () => [{ id: "primary" }],
      stream: async function* (options) {
        await new Promise((resolve) => options.signal.addEventListener("abort", resolve, { once: true }));
        yield { type: "finish", reason: { kind: "aborted", failure: { code: "ABORTED", message: "aborted" } } };
      },
    },
  };
  const started = Date.now();
  await assert.rejects(
    () => requestSuggestions(ctx, { ...CONFIG, routeKey: "primary", timeoutSec: 0.05 }, "s", "zh"),
    (error) => { assert.equal(error.code, "timeout"); return true; },
  );
  assert.ok(Date.now() - started < 2000, "the deadline must win over a stalled stream");
});

test("requestSuggestions: a stream that never settles cannot hold the route past its deadline", async () => {
  // Regression: the timeout path used to `await iterator.return?.()`, so an
  // adapter that ignores the abort (or a generator blocked inside next()) left
  // the HTTP route pending forever even though the deadline promise had fired.
  const ctx = {
    ...ctxWith({ llm: { listProviders: () => [{ id: "primary" }] } }),
    llm: {
      listProviders: () => [{ id: "primary" }],
      stream: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise(() => {}),
          return: () => new Promise(() => {}),
        }),
      }),
    },
  };
  const started = Date.now();
  await assert.rejects(
    () => requestSuggestions(ctx, { ...CONFIG, routeKey: "primary", timeoutSec: 0.05 }, "s", "zh"),
    (error) => { assert.equal(error.code, "timeout"); return true; },
  );
  assert.ok(Date.now() - started < 1500, "the route must answer at the deadline, not wait for the adapter");
});

test("requestSuggestions: a thenable stream is refused without leaking a timer or a rejection", async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const ctx = {
      ...ctxWith({ llm: { listProviders: () => [{ id: "primary" }] } }),
      llm: {
        listProviders: () => [{ id: "primary" }],
        stream: () => ({
          then(_resolve, reject) { reject(new Error("adapter rejected")); },
        }),
      },
    };
    const started = Date.now();
    await assert.rejects(
      () => requestSuggestions(ctx, { ...CONFIG, routeKey: "primary", timeoutSec: 0.05 }, "s", "zh"),
      (error) => { assert.equal(error.code, "runtime-stream"); return true; },
    );
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.deepEqual(unhandled, [], "the deadline timer must be cleared and the thenable rejection observed");
    assert.ok(Date.now() - started < 1500);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("requestSuggestions: a throwing asyncIterator getter is a clean runtime error", async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const ctx = {
      ...ctxWith({ llm: { listProviders: () => [{ id: "primary" }] } }),
      llm: {
        listProviders: () => [{ id: "primary" }],
        stream: () => ({
          get [Symbol.asyncIterator]() { throw new Error("bad iterator"); },
        }),
      },
    };
    await assert.rejects(
      () => requestSuggestions(ctx, { ...CONFIG, routeKey: "primary", timeoutSec: 0.05 }, "s", "zh"),
      /bad iterator/,
    );
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("requestSuggestions: a runtime that throws is not swallowed", async () => {
  const ctx = {
    ...ctxWith({ llm: { listProviders: () => [{ id: "primary" }] } }),
    llm: {
      listProviders: () => [{ id: "primary" }],
      stream: () => { throw Object.assign(new Error("no adapter"), { code: "NO_ADAPTER" }); },
    },
  };
  await assert.rejects(
    () => requestSuggestions(ctx, { ...CONFIG, routeKey: "primary" }, "s", "zh"),
    (error) => { assert.equal(error.code, "NO_ADAPTER"); return true; },
  );
});

test("requestSuggestionsViaRuntime: ignores reasoning deltas and keeps text deltas", async () => {
  const ctx = runtimeCtx();
  const out = await requestSuggestionsViaRuntime(
    ctx,
    CONFIG,
    "minimax-cn",
    "MiniMax-M3.1-Flash-Preview",
    { system: "sys", user: "user" },
  );
  assert.deepEqual(out, ["继续，把第二个方案也写出来", "先只给结论"]);
});

// ── requestSuggestions: the legacy endpoint path and its decline ladder ────

test("requestSuggestions: an unregistered route falls back to the endpoint", async () => {
  const calls = [];
  const ctx = ctxWith({ llm: { listProviders: () => [{ id: "something-else" }] } });
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '["继续跑测试"]' } }] }) };
  };
  const out = await requestSuggestions(ctx, CONFIG, "已完成两处修改。", "zh", fetchImpl);
  assert.deepEqual(out, ["继续跑测试"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://stored/v1/chat/completions");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk-test");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "cheap-1");
  assert.equal(body.messages.length, 2);
  assert.match(body.messages[1].content, /已完成两处修改。/);
});

test("requestSuggestions: the legacy path declines instead of guessing", async () => {
  // Each variant is a distinct decline branch: no invented URL, no unsupported
  // protocol, no guaranteed-401 probe, no unconfigured model. The table shape
  // keeps the branches enumerable while one assertion loop covers all of them.
  const cases = [
    { name: "no resolvable endpoint", makeCtx: () => ctxWith(), config: { routeKey: "catalog-only" }, code: "no-endpoint" },
    { name: "a non-OpenAI protocol", makeCtx: () => ({ ...ctxWith(), config: () => ({ ...PRIMARY, routeApi: "anthropic-messages" }) }), config: { routeKey: "primary" }, code: "unsupported-api" },
    { name: "no credential", makeCtx: () => ctxWith({ apiKey: "" }), config: { routeKey: "primary" }, code: "no-credential" },
    { name: "no configured model and no catalog id", makeCtx: () => ({ ...ctxWith(), settings: { describe: () => [] }, llm: {} }), config: { model: "", routeKey: "primary" }, code: "no-model" },
  ];
  for (const kase of cases) {
    const forbiddenFetch = async () => { throw new Error(`must not be called: ${kase.code} means no request`); };
    await assert.rejects(
      () => requestSuggestions(kase.makeCtx(), { ...CONFIG, ...kase.config }, "summary", "zh", forbiddenFetch),
      (error) => { assert.equal(error.code, kase.code, kase.name); return true; },
    );
  }
});

test("requestSuggestions: an endpoint error surfaces with its status, never as a silent []", async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => "invalid api key" });
  await assert.rejects(
    () => requestSuggestions(ctxWith(), CONFIG, "s", "zh", fetchImpl),
    (error) => {
      assert.equal(error.code, "endpoint-error");
      assert.equal(error.status, 401);
      assert.match(error.detail, /invalid api key/);
      return true;
    },
  );
});

test("requestSuggestions: falls back to the route's own first catalog id (from stored profile)", async () => {
  const ctx = {
    config: () => ({ ...PRIMARY, baseURL: "https://p/v1" }),
    get: async () => ({ resolve: async () => ({ value: "sk" }) }),
    llm: { listProviders: () => [{ id: "primary" }], listModels: async () => [] },
    settings: {
      describe: () => [{
        ns: "llm-pi-ai",
        user: { providers: { primary: { baseURL: "https://p/v1", api: "openai-completions", models: [{ id: "cline-pass/catalog-first" }, { id: "other" }] } } },
        value: {},
        base: {},
      }],
    },
  };
  const fetchImpl = async (_url, init) => {
    assert.equal(JSON.parse(init.body).model, "cline-pass/catalog-first");
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '["ok"]' } }] }) };
  };
  const out = await requestSuggestions(ctx, { ...CONFIG, model: "" }, "s", "zh", fetchImpl);
  assert.deepEqual(out, ["ok"]);
});

test("requestSuggestions: a block-array content reply is understood", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: '["a","b"]' }] } }] }),
  });
  assert.deepEqual(await requestSuggestions(ctxWith(), CONFIG, "s", "zh", fetchImpl), ["a", "b"]);
});

// ── session context + accepted sanitizing ──────────────────────────────────

test("recentUserMessages: reads real user messages oldest-first and skips injections", () => {
  const events = [
    { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "first" }] } },
    { type: "user/message", data: { source: { kind: "skill-invocation" }, content: [{ type: "text", text: "injected" }] } },
    { type: "assistant/message", data: {} },
    { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "second" }] } },
  ];
  const session = { snapshotEvents: () => events };
  assert.deepEqual(recentUserMessages(session), ["first", "second"]);
  assert.deepEqual(recentUserMessages(session, 1), ["second"]);
  assert.deepEqual(recentUserMessages(undefined), []);
  assert.deepEqual(recentUserMessages({ snapshotEvents: () => { throw new Error("boom"); } }), []);
});

test("recentUserMessages: prefers derived model history and skips injection sources", () => {
  const session = {
    deriveMessages: () => [
      { role: "user", source: { kind: "user" }, content: [{ type: "text", text: "derived-one" }] },
      { role: "user", source: { kind: "skill-invocation" }, content: [{ type: "text", text: "injected" }] },
      { role: "assistant", source: { kind: "model" }, content: [] },
      { role: "user", source: { kind: "user" }, content: [{ type: "text", text: "derived-two" }] },
    ],
    snapshotEvents: () => { throw new Error("the derived path must win when it exists"); },
  };
  assert.deepEqual(recentUserMessages(session), ["derived-one", "derived-two"]);
});

test("sanitizeAccepted: trims, dedupes, caps, and drops non-strings", () => {
  assert.deepEqual(sanitizeAccepted(["a", " a ", "b", 42, "", "c", "d", "e", "f"]), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(sanitizeAccepted(null), []);
});

test("routeRegistered: tolerant of a missing or throwing registry", () => {
  assert.equal(routeRegistered({}, "x"), false);
  assert.equal(routeRegistered({ llm: { listProviders: () => [{ id: "x" }] } }, "x"), true);
  assert.equal(routeRegistered({ llm: { listProviders: () => { throw new Error("boom"); } } }, "x"), false);
});

// ── suggestOptions: the picker's route/model list ───────────────────────────

test("suggestOptions: lists routes with the primary first, availability, and runtime flag", async () => {
  const ctx = {
    config: () => ({ ...PRIMARY, baseURL: "https://p/v1" }),
    get: async () => ({ resolve: async () => ({ value: "sk" }) }),
    llm: {
      listProviders: () => [{ id: "primary", name: "Primary" }, { id: "other", name: "Other" }],
      listModels: async () => [{ id: "model-a" }],
    },
    habit: { enabled: true, turns: 4, accepted: 2 },
  };
  const out = await suggestOptions(ctx, "");
  assert.equal(out.ok, true);
  assert.equal(out.primaryRoute, "primary");
  assert.equal(out.route, "primary");
  assert.equal(out.runtime, false);
  assert.deepEqual(out.habit, { enabled: true, turns: 4, accepted: 2 });
  assert.equal(out.routes.length, 2);
  assert.equal(out.routes[0].id, "primary");
  assert.equal(out.routes[0].primary, true);
  assert.equal(out.routes[0].available, true);
  assert.equal(out.routes[1].id, "other");
  assert.equal(out.routes[1].primary, false);
  assert.equal(out.routes[1].available, false);
  assert.ok(Array.isArray(out.models));
});

test("suggestOptions: a runtime host marks every registered route available", async () => {
  const ctx = {
    config: () => PLUGIN_PRIMARY,
    get: async () => undefined,
    llm: {
      listProviders: () => [{ id: "minimax-cn" }, { id: "kimi-coding" }],
      stream: async function* () {},
    },
    settings: { describe: () => [] },
  };
  const out = await suggestOptions(ctx, "minimax-cn");
  assert.equal(out.runtime, true);
  assert.equal(out.route, "minimax-cn");
  for (const route of out.routes) assert.equal(route.available, true, `${route.id} should be available`);
  assert.deepEqual(out.habit, { enabled: false, turns: 0, accepted: 0 });
});

// ── installSmartReply: route wiring ────────────────────────────────────────

/**
 * Install the smartReply routes over a tiny fake host.
 * @param {object} [options] - config/llm/deps overrides.
 * @returns {object} harness with the registered routes and captured calls.
 */
function hostHarness({ config, llm, deps = {}, sessions } = {}) {
  const routes = new Map();
  const captured = { suggest: [], learned: [] };
  const rawConfig = config ?? {
    optimizations: { smartReply: true },
    suggestModel: "cheap-1",
    suggestRouteKey: "",
  };
  const habitStore = deps.habitStore ?? {
    learn(input) { captured.learned.push(input); },
    styleHint: () => "hint",
    summary: () => ({ turns: 3, accepted: 1 }),
  };
  const sctx = {
    effect: (run) => run(),
    webServer: { register: (route) => { routes.set(route.path, route); return () => {}; } },
    settings: {},
    llm: llm ?? {},
    get: (name) => (name === "sessions" ? sessions : undefined),
  };
  const hostCtx = { inject: (_names, run) => run(sctx) };
  installSmartReply(hostCtx, () => rawConfig, {
    ...deps,
    habitStore,
    requestSuggestions: deps.requestSuggestions ?? (async (...args) => { captured.suggest.push(args); return ["candidate"]; }),
    logger: { warn() {} },
  });
  return { routes, captured };
}

test("installSmartReply: POST route feeds session context and accepted habits into the call", async () => {
  const session = {
    snapshotEvents: () => [
      { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "把测试跑一下" }] } },
      { type: "assistant/message", data: {} },
    ],
  };
  const { routes, captured } = hostHarness({ sessions: new Map([["session-1", session]]) });
  const route = routes.get("/api/toolkit/suggest-reply");
  assert.ok(route, "POST route must be registered");
  const req = Readable.from([Buffer.from(JSON.stringify({
    summary: "测试已经全部通过。",
    language: "zh",
    sessionId: "session-1",
    accepted: ["跑一下测试", "跑一下测试"],
  }))]);
  req.method = "POST";
  const res = { status: 0, body: "", writeHead(status) { this.status = status; }, end(payload) { this.body = payload; } };
  await route.handler(req, res);
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.deepEqual(payload, { ok: true, suggestions: ["candidate"] });
  const [, config, summary, language, , evidence] = captured.suggest[0];
  assert.equal(summary, "测试已经全部通过。");
  assert.equal(language, "zh");
  assert.equal(evidence.lastUserText, "把测试跑一下");
  assert.equal(evidence.habitHint, "hint");
  assert.equal(captured.learned.length, 1);
  assert.deepEqual(captured.learned[0].userMessages, ["把测试跑一下"]);
  assert.deepEqual(captured.learned[0].accepted, ["跑一下测试"]);
});

test("installSmartReply: a failing suggestion still answers 200 with ok:false", async () => {
  const { routes } = hostHarness({
    deps: { requestSuggestions: async () => { throw Object.assign(new Error("boom"), { code: "QUOTA" }); } },
  });
  const route = routes.get("/api/toolkit/suggest-reply");
  const req = Readable.from([Buffer.from(JSON.stringify({ summary: "done" }))]);
  req.method = "POST";
  const res = { status: 0, body: "", writeHead(status) { this.status = status; }, end(payload) { this.body = payload; } };
  await route.handler(req, res);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: false, error: { code: "QUOTA", message: "boom" } });
});

test("installSmartReply: GET options exposes runtime, availability, and habit counters", async () => {
  const { routes } = hostHarness({
    llm: { listProviders: () => [{ id: "minimax-cn" }], stream: async function* () {} },
    deps: { suggestOptions: undefined },
  });
  const route = routes.get("/api/toolkit/suggest-options");
  assert.ok(route, "GET route must be registered");
  const req = { method: "GET", url: "/api/toolkit/suggest-options?route=minimax-cn" };
  const res = { status: 0, body: "", writeHead(status) { this.status = status; }, end(payload) { this.body = payload; } };
  await route.handler(req, res);
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.runtime, true);
  assert.equal(payload.route, "minimax-cn");
  assert.deepEqual(payload.habit, { enabled: true, turns: 3, accepted: 1 });
});
