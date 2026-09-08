/**
 * Offline smoke for the toolkit server half: apply() against a fake cordis
 * context proves the settings namespace registers with a resolved chat path
 * base, and the chat directory gets created. Run: node scripts/smoke.mjs
 */
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { equal, ok } from "node:assert/strict";

const root = await mkdtemp(join(tmpdir(), "toolkit-smoke-"));
process.env.DSH_HOME = root;
const chatDir = join(root, "chat");

const registrations = [];
const watches = [];
/** Event listeners registered via ctx.on, by event name. */
const listeners = new Map();
/** Mutable section the fake scope reads through get() (installSettingsSection reads via get). */
let liveValue = undefined;
const ctx = {
  logger: { warn: (msg) => console.warn("ctx.logger.warn:", msg) },
  on: (name, listener) => {
    const list = listeners.get(name) ?? [];
    list.push(listener);
    listeners.set(name, list);
    return () => {};
  },
  // installSettingsSection wires cleanup through ctx.effect and consults
  // ctx.fiber.state for unload suppression; both are inert here.
  fiber: { state: 0 },
  effect: (fn) => { fn(); },
  inject: (names, cb) => {
    equal(JSON.stringify(names), '["settings"]', "inject waits on the settings service");
    cb(Object.assign({}, ctx, { settings: { register: (ns, schema, opts) => {
      registrations.push({ ns, schema, opts });
      liveValue = opts.base;
      return {
        get: () => liveValue,
        watch: (fn) => { watches.push(fn); return () => {}; },
      };
    } } }));
  },
};

const mod = await import("../index.js");
equal(mod.name, "toolkit", "plugin name");

// A recording fake fetch must be in place BEFORE apply(): the opencodeSession
// wrap captures whatever globalThis.fetch holds at install time.
const fetchCalls = [];
globalThis.fetch = async (input, init) => {
  fetchCalls.push({ input, init });
  return new Response("{}", { status: 200 });
};
equal(mod.inject.join(","), "settings", "server inject");
ok(mod.Config, "Config schema exported");

mod.apply(ctx, { optimizations: { workspacelessChat: true, editLastMessage: true, viewActivity: true, slashI18n: true, changeReport: true, opencodeSession: true }, chatWorkspacePath: "", chatWorkspaceTitle: "通用对话" });

equal(registrations.length, 1, "one namespace registration");
equal(registrations[0].ns, "toolkit", "namespace key equals the card key");
equal(registrations[0].opts.base.chatWorkspacePath, chatDir, "base carries the resolved default path");
equal(registrations[0].opts.base.optimizations.workspacelessChat, true, "base carries the toggle");
equal(registrations[0].opts.base.optimizations.editLastMessage, true, "base carries the editLastMessage toggle");
equal(registrations[0].opts.base.optimizations.viewActivity, true, "base carries the viewActivity toggle");
equal(registrations[0].opts.base.optimizations.slashI18n, true, "base carries the slashI18n toggle");
equal(registrations[0].opts.base.optimizations.changeReport, true, "base carries the changeReport toggle");
equal(registrations[0].opts.base.chatWorkspaceTitle, "通用对话", "base carries the friendly chat title");

// apply() kicks the directory creation asynchronously; wait for it.
for (let i = 0; i < 50; i += 1) {
  try {
    const info = await stat(chatDir);
    ok(info.isDirectory(), "chat directory exists after apply");
    break;
  } catch {
    if (i === 49) throw new Error("chat directory was not created");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// A settings-path edit mkdirs the new directory through the watch callback.
// installSettingsSection's watcher is payload-free: the section is committed
// before onChange, so the fake scope's live value is swapped, then the watch
// fires.
const nextDir = join(root, "chat2");
liveValue = { ...liveValue, chatWorkspacePath: nextDir };
watches[0]();
await new Promise((resolve) => setTimeout(resolve, 50));
ok((await stat(nextDir)).isDirectory(), "watch mkdirs the edited path");

// ── opencodeSession: the llm/stream listener + global fetch wrap ────────────
const streamListeners = listeners.get("llm/stream") ?? [];
equal(streamListeners.length, 1, "one llm/stream listener registered");
const wrapStream = streamListeners[0];
const WRAP_MARK = Symbol.for("dsh-plugin-toolkit.opencodeSession.fetchWrap");
ok(globalThis.fetch[WRAP_MARK] === true, "global fetch is wrapped once");

/** A fake adapter stream whose body hits the wire mid-iteration, like an SDK. */
function fakeAdapterStream(url, init) {
  return (async function* () {
    await globalThis.fetch(url, init);
    yield { type: "text-delta", delta: "hi" };
  })() ;
}

/** Consume the wrapped stream for one request and return the fetch calls seen. */
async function drive(sessionId, url, init) {
  const before = fetchCalls.length;
  const stream = wrapStream(sessionId === undefined ? {} : { sessionId }, () => fakeAdapterStream(url, init));
  for await (const _chunk of stream) { /* drain */ }
  return fetchCalls.slice(before);
}

const GO_URL = "https://opencode.ai/zen/go/v1/chat/completions";
let calls = await drive("session-7", GO_URL, { method: "POST" });
equal(new Headers(calls[0].init.headers).get("x-opencode-session"), "session-7", "opencode.ai request gets the conversation's session id");
calls = await drive("session-8", "https://api.opencode.ai/v1/chat/completions", { method: "POST" });
equal(new Headers(calls[0].init.headers).get("x-opencode-session"), "session-8", "opencode.ai subdomain matches too");
calls = await drive(undefined, GO_URL, { method: "POST" });
const fallback = new Headers(calls[0].init.headers).get("x-opencode-session");
ok(typeof fallback === "string" && fallback.startsWith("dsh-session-"), "sessionless call gets the per-process fallback id");
calls = await drive(undefined, GO_URL, { method: "POST" });
equal(new Headers(calls[0].init.headers).get("x-opencode-session"), fallback, "fallback id is stable within the process");
calls = await drive("session-9", GO_URL, { method: "POST", headers: { "x-opencode-session": "keep-me" } });
equal(new Headers(calls[0].init.headers).get("x-opencode-session"), "keep-me", "an existing header is never overwritten");
calls = await drive("session-9", "https://api.deepseek.com/v1/chat/completions", { method: "POST" });
equal(new Headers(calls[0].init.headers).get("x-opencode-session"), null, "non-OpenCode endpoints are untouched");
calls = await drive("session-9", "https://evilopencode.ai/v1/chat/completions", { method: "POST" });
equal(new Headers(calls[0].init.headers).get("x-opencode-session"), null, "lookalike hosts do not match");

liveValue = { ...liveValue, optimizations: { ...liveValue.optimizations, opencodeSession: false } };
calls = await drive("session-7", GO_URL, { method: "POST" });
equal(new Headers(calls[0].init.headers).get("x-opencode-session"), null, "toggle off stamps nothing");
liveValue = { ...liveValue, optimizations: { ...liveValue.optimizations, opencodeSession: true } };
calls = await drive("session-7", GO_URL, { method: "POST" });
equal(new Headers(calls[0].init.headers).get("x-opencode-session"), "session-7", "toggle back on resumes stamping");

console.log("toolkit server smoke: OK");
