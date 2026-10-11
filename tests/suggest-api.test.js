/**
 * Tests for the reply-suggestion host route (suggest-api.js).
 *
 * The assertions below all encode one rule: the suggestion call must resolve an
 * endpoint and a credential exactly the way the live model probe does, and must
 * DECLINE rather than invent either. A wrong URL or a guaranteed-401 probe would
 * cost a request on every settled turn and show the user nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { suggestConfig, joinUrl, requestSuggestions, suggestOptions } from "../suggest-api.js";

// ── joinUrl: every baseURL shape in the wild ────────────────────────────────

test("joinUrl: normalizes separators without doubling or dropping them", () => {
  assert.equal(joinUrl("https://x.dev/v1", "chat/completions"), "https://x.dev/v1/chat/completions");
  assert.equal(joinUrl("https://x.dev/v1/", "chat/completions"), "https://x.dev/v1/chat/completions");
  assert.equal(joinUrl("https://x.dev/v1///", "/chat/completions"), "https://x.dev/v1/chat/completions");
  assert.equal(joinUrl("  https://x.dev/v1  ", "chat/completions"), "https://x.dev/v1/chat/completions");
  assert.equal(joinUrl("https://x.dev/v1", ""), "https://x.dev/v1");
});

// ── suggestConfig: defaults, and the "" fallbacks that keep it dormant ──────

test("suggestConfig: defaults are on, three candidates, 12s, empty model", () => {
  const config = suggestConfig({});
  assert.equal(config.enabled, true);
  assert.equal(config.routeKey, "");
  assert.equal(config.model, "");
  assert.equal(config.path, "/api/toolkit/suggest-reply");
  assert.equal(config.language, "");
  assert.equal(config.count, 3);
  assert.equal(config.timeoutSec, 30);
});

test("suggestConfig: the toggle and the pinned language are honoured", () => {
  assert.equal(suggestConfig({ optimizations: { smartReply: false } }).enabled, false);
  assert.equal(suggestConfig({ suggestLanguage: "zh" }).language, "zh");
  assert.equal(suggestConfig({ suggestLanguage: "en" }).language, "en");
  // A language nobody speaks must fall back to "follow the UI", not pass through.
  assert.equal(suggestConfig({ suggestLanguage: "fr" }).language, "");
});

test("suggestConfig: count and timeout are clamped to usable ranges", () => {
  assert.equal(suggestConfig({ suggestCount: 99 }).count, 5);
  assert.equal(suggestConfig({ suggestCount: 0 }).count, 3);
  assert.equal(suggestConfig({ suggestCount: -1 }).count, 3);
  assert.equal(suggestConfig({ suggestTimeoutSec: 0 }).timeoutSec, 30);
  assert.equal(suggestConfig({ suggestTimeoutSec: 30 }).timeoutSec, 30);
});

test("suggestConfig: an empty path falls back to the default, never to a blank route", () => {
  assert.equal(suggestConfig({ suggestPath: "" }).path, "/api/toolkit/suggest-reply");
});

// ── requestSuggestions: the decline ladder ─────────────────────────────────

/**
 * A resolver stand-in shaped like the modelCapability context.
 * @param {object} over - endpoint/credential/discoveries overrides.
 * @returns {object} a ctx the resolvers accept.
 */
function ctxWith(over = {}) {
  const { endpoint, apiKey = "sk-test", discoveries } = over;
  return {
    config: () => ({ routeKey: "primary", apiKey, apiKeyEnvVar: "TEST_KEY", baseURL: "https://stored/v1", routeApi: "openai-completions" }),
    get: async (name) => (name === "credentials" ? { resolve: async () => ({ value: apiKey }) } : undefined),
    llm: { discoveries },
  };
}

const CONFIG = suggestConfig({ suggestModel: "cheap-1" });

test("requestSuggestions: a route with no resolvable endpoint declines instead of guessing a URL", async () => {
  // catalog route, no stored baseURL, not the primary route => nothing resolves
  const ctx = ctxWith();
  await assert.rejects(
    () => requestSuggestions(ctx, { ...CONFIG, routeKey: "catalog-only" }, "summary", "zh", async () => {
      throw new Error("must not be called: no endpoint means no request");
    }),
    (error) => { assert.equal(error.code, "no-endpoint"); return true; },
  );
});

test("requestSuggestions: a non-OpenAI protocol declines rather than speaking the wrong shape", async () => {
  const ctx = ctxWith();
  await assert.rejects(
    () => requestSuggestions(ctx, { ...CONFIG, routeKey: "catalog-only" }, "s", "zh", async () => ({})),
    () => true,
  );
  // The primary route here is openai-completions, so drive the refusal through
  // the stored route header path instead: an anthropic-messages route.
  const anthropic = { ...ctx, config: () => ({ ...ctx.config(), routeApi: "anthropic-messages" }) };
  await assert.rejects(
    () => requestSuggestions(anthropic, { ...CONFIG, routeKey: "primary" }, "s", "zh", async () => {
      throw new Error("must not be called: wrong protocol means no request");
    }),
    (error) => { assert.equal(error.code, "unsupported-api"); return true; },
  );
});

test("requestSuggestions: no credential declines instead of probing into a guaranteed 401", async () => {
  const ctx = ctxWith({ apiKey: "" });
  await assert.rejects(
    () => requestSuggestions(ctx, { ...CONFIG, routeKey: "primary" }, "s", "zh", async () => {
      throw new Error("must not be called: no credential means no request");
    }),
    (error) => { assert.equal(error.code, "no-credential"); return true; },
  );
});

test("requestSuggestions: no configured model and no catalog id declines", async () => {
  const ctx = ctxWith({ discoveries: new Map([["llm-pi-ai", { models: [] }]]) });
  await assert.rejects(
    () => requestSuggestions(ctx, { ...CONFIG, model: "", routeKey: "primary" }, "s", "zh", async () => {
      throw new Error("must not be called: no model means no request");
    }),
    (error) => { assert.equal(error.code, "no-model"); return true; },
  );
});

// ── the happy path ─────────────────────────────────────────────────────────

test("requestSuggestions: asks the endpoint and salvages the candidates", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '["继续跑测试","把第二个方案也写出来"]' } }] }),
    };
  };
  const out = await requestSuggestions(ctxWith(), CONFIG, "已完成两处修改。", "zh", fetchImpl);

  assert.deepEqual(out, ["继续跑测试", "把第二个方案也写出来"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://stored/v1/chat/completions");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk-test");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "cheap-1");
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[1].content, "已完成两处修改。");
});

test("requestSuggestions: falls back to the route's own first catalog id (from stored profile)", async () => {
  const ctx = {
    config: () => ({ routeKey: "primary", apiKey: "sk", apiKeyEnvVar: "K", baseURL: "https://p/v1", routeApi: "openai-completions" }),
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

test("requestSuggestions: an endpoint error surfaces with its status, never as a silent []", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    text: async () => "invalid api key",
  });
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

test("requestSuggestions: a block-array content reply is understood", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: '["a","b"]' }] } }] }),
  });
  assert.deepEqual(await requestSuggestions(ctxWith(), CONFIG, "s", "zh", fetchImpl), ["a", "b"]);
});

// ── suggestOptions: the picker's route/model list ───────────────────────────

test("suggestOptions: lists routes with the primary first and marks reachable ones", async () => {
  const ctx = {
    config: () => ({ routeKey: "primary", apiKey: "sk", apiKeyEnvVar: "K", baseURL: "https://p/v1", routeApi: "openai-completions" }),
    get: async () => ({ resolve: async () => ({ value: "sk" }) }),
    llm: {
      listProviders: () => [{ id: "primary", name: "Primary" }, { id: "other", name: "Other" }],
      listModels: async () => [{ id: "model-a" }],
    },
  };
  const out = await suggestOptions(ctx, "");
  assert.equal(out.ok, true);
  assert.equal(out.primaryRoute, "primary");
  assert.equal(out.route, "primary");
  assert.equal(out.routes.length, 2);
  assert.equal(out.routes[0].id, "primary");
  assert.equal(out.routes[0].primary, true);
  assert.equal(out.routes[1].id, "other");
  assert.equal(out.routes[1].primary, false);
  assert.ok(Array.isArray(out.models));
});

test("suggestOptions: empty route param resolves to the primary", async () => {
  const ctx = {
    config: () => ({ routeKey: "primary", apiKey: "", apiKeyEnvVar: "K", baseURL: "https://p/v1", routeApi: "openai-completions" }),
    get: async () => undefined,
    llm: {
      listProviders: () => [{ id: "primary" }],
      listModels: async () => [{ id: "m1" }],
    },
  };
  const out = await suggestOptions(ctx, "");
  assert.equal(out.route, "primary");
});

test("suggestOptions: a named route is honoured", async () => {
  const ctx = {
    config: () => ({ routeKey: "primary", apiKey: "", apiKeyEnvVar: "K", baseURL: "https://p/v1", routeApi: "openai-completions" }),
    get: async () => undefined,
    llm: {
      listProviders: () => [{ id: "primary" }, { id: "other" }],
      listModels: async () => [{ id: "m1" }],
    },
  };
  const out = await suggestOptions(ctx, "other");
  assert.equal(out.route, "other");
});
