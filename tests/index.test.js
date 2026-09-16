/**
 * Server entry tests: `index.js` (its public face and its resilience) and the
 * opencodeSession optimization end to end.
 *
 * This is the only automated coverage of `apply()`. Before it existed, deleting
 * the `globalThis.fetch` wrap — an optimization whose absence makes upstream
 * reject every OpenCode Go request with `400 MissingSessionID` — left the whole
 * suite green; the only guard was a manual live-host script.
 *
 * The plugin wraps whatever `globalThis.fetch` holds when `apply` runs, so each
 * test installs a recording fetch first and restores the real one afterwards.
 */
import test from "node:test";
import assert from "node:assert/strict";

import * as toolkit from "../index.js";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";

const realFetch = globalThis.fetch;

/** Mock Cordis context: records listeners, runs effects, ignores injections. */
function makeCtx() {
  const listeners = new Map();
  const warnings = [];
  return {
    listeners,
    warnings,
    logger: {
      info() {},
      warn(...args) { warnings.push(args.map(String).join(" ")); },
    },
    on(name, fn) { listeners.set(name, fn); },
    effect(fn) {
      const dispose = fn?.();
      return typeof dispose === "function" ? dispose : () => {};
    },
    // `installSettingsSection` and `installModelCapability` both hand their real
    // work to ctx.inject; resolving nothing keeps the host seams absent, which
    // is exactly the "dormant, not broken" path worth testing.
    inject() {},
  };
}

/**
 * Plugin config for one test. `workspacelessChat` is off so `apply` never
 * touches the filesystem, and the OpenCode toggle is explicit because
 * `apply` merges into module-level state that earlier tests also wrote.
 */
function baseConfig(opencodeSession) {
  return {
    optimizations: { workspacelessChat: false, opencodeSession },
  };
}

/**
 * Install a recording fetch, then apply the plugin over it.
 * @returns {{ctx: object, calls: Array<{url: string, headers: Headers}>}}
 */
function applyWithRecording(opencodeSession) {
  const calls = [];
  globalThis.fetch = (input, init) => {
    calls.push({
      url: typeof input === "string" ? input : String(input?.url ?? input),
      headers: new Headers(init?.headers),
    });
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  const ctx = makeCtx();
  toolkit.apply(ctx, baseConfig(opencodeSession));
  return { ctx, calls };
}

/** Restore the real fetch after a test that installed a recording one. */
function restoreFetch(t) {
  t.after(() => { globalThis.fetch = realFetch; });
}

test("the package root exports the face index.d.ts declares", () => {
  assert.equal(toolkit.name, "toolkit");
  assert.equal(toolkit.NS, "toolkit");
  assert.deepEqual(toolkit.inject, ["settings"]);
  assert.equal(typeof toolkit.apply, "function");
  assert.ok(toolkit.Config !== undefined, "Config is exported; Cordis validates it at load");
  assert.equal(
    typeof toolkit.knownRouteModels,
    "function",
    "index.d.ts declares knownRouteModels on this module, so the runtime must back it",
  );
  // The settings namespace the Web card pairs against.
  assert.equal(settingsNamespace(toolkit.NS), "toolkit");
});

test("apply degrades instead of throwing when every host seam is missing", () => {
  const ctx = makeCtx();
  assert.doesNotThrow(() => { toolkit.apply(ctx, baseConfig(true)); });
  assert.equal(typeof ctx.listeners.get("llm/stream"), "function", "the llm/stream listener still registers");
});

test("opencodeSession stamps x-opencode-session on OpenCode endpoints", async (t) => {
  restoreFetch(t);
  const { calls } = applyWithRecording(true);
  await globalThis.fetch("https://opencode.ai/zen/go/v1/models");
  assert.equal(calls.length, 1, "the wrapped fetch reaches the underlying one exactly once");
  const value = calls[0].headers.get("x-opencode-session");
  assert.ok(
    typeof value === "string" && value.startsWith("dsh-session-"),
    `a sessionless call gets the process-scoped fallback id, got ${String(value)}`,
  );
});

test("opencodeSession covers subdomains but leaves other hosts byte-identical", async (t) => {
  restoreFetch(t);
  const { calls } = applyWithRecording(true);
  await globalThis.fetch("https://api.opencode.ai/v1/models");
  await globalThis.fetch("https://api.deepseek.com/v1/models");
  await globalThis.fetch("https://notopencode.ai.example.com/v1/models");
  assert.ok(calls[0].headers.get("x-opencode-session"), "a subdomain of opencode.ai is stamped");
  assert.equal(calls[1].headers.get("x-opencode-session"), null, "another provider is left alone");
  assert.equal(calls[2].headers.get("x-opencode-session"), null, "a lookalike host is not matched");
});

test("the optimization toggle is read per request, not cached", async (t) => {
  restoreFetch(t);
  // This mirrors the documented live A/B: toggle off -> upstream rejects the
  // request, toggle on -> it succeeds. Here it is asserted on the header.
  const { calls } = applyWithRecording(false);
  await globalThis.fetch("https://opencode.ai/zen/go/v1/models");
  assert.equal(calls[0].headers.get("x-opencode-session"), null, "off: no header");

  toolkit.apply(makeCtx(), baseConfig(true));
  await globalThis.fetch("https://opencode.ai/zen/go/v1/models");
  assert.ok(calls[1].headers.get("x-opencode-session"), "on: the very next request carries it");
});

test("a caller-supplied session header is never overwritten", async (t) => {
  restoreFetch(t);
  const { calls } = applyWithRecording(true);
  await globalThis.fetch("https://opencode.ai/x", { headers: { "x-opencode-session": "caller-value" } });
  assert.equal(calls[0].headers.get("x-opencode-session"), "caller-value");
});

test("the session id carried by llm/stream reaches the request header", async (t) => {
  restoreFetch(t);
  const { ctx, calls } = applyWithRecording(true);
  const listener = ctx.listeners.get("llm/stream");
  assert.equal(typeof listener, "function", "apply registered the llm/stream listener");

  // The provider request happens deep inside the async chain that pulls the
  // stream, on a different stack from the event — which is exactly the gap the
  // AsyncLocalStorage store bridges.
  async function* stream() {
    yield await globalThis.fetch("https://opencode.ai/zen/go/v1/models");
  }
  const wrapped = listener({ sessionId: "conversation-7" }, () => stream());
  for await (const _chunk of wrapped) { /* drain the stream */ }
  assert.equal(calls[0].headers.get("x-opencode-session"), "conversation-7");
});

test("the llm/stream listener passes a sessionless stream straight through", () => {
  const { ctx } = applyWithRecording(true);
  const listener = ctx.listeners.get("llm/stream");
  const sentinel = { marker: "inner-stream" };
  let pulled = 0;
  const out = listener({}, () => { pulled += 1; return sentinel; });
  assert.equal(pulled, 1);
  assert.equal(out, sentinel, "no session id means no wrapping, not an empty stream");
});

test("repeated apply calls never stack fetch wraps", async (t) => {
  restoreFetch(t);
  const calls = [];
  globalThis.fetch = (input, init) => {
    calls.push(new Headers(init?.headers));
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  toolkit.apply(makeCtx(), baseConfig(true));
  toolkit.apply(makeCtx(), baseConfig(true));
  await globalThis.fetch("https://opencode.ai/x");
  assert.equal(calls.length, 1, "a second apply must not double-wrap the global");
  const raw = String(calls[0].get("x-opencode-session"));
  assert.ok(!raw.includes(","), `the header is set once, not appended: ${raw}`);
});
