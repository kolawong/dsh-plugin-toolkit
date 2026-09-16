/**
 * Offline smoke for the toolkit server half: apply() against a fake cordis
 * context proves the settings namespace registers with a resolved chat path
 * base, the chat directory gets created, the opencodeSession fetch wrap works,
 * and the modelCapability feature mounts its sync route. Run:
 * node scripts/smoke.mjs
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
/** Every model-sync route spec the plugin registered. */
const routes = [];
/** Cross-namespace writes the modelCapability feature performed. */
const serviceWrites = [];
/** Services each ctx.inject call waited on. */
const injectCalls = [];

/** Registered sections, keyed by namespace (the toolkit's own one included). */
const sections = new Map();
/**
 * Namespaces this plugin does not own but reads/writes through the settings
 * service: llm-pi-ai is pre-healed (api already set, models empty) so the
 * startup healing returns immediately instead of polling.
 */
const externalNamespaces = {
  "llm-pi-ai": { providers: { "opencode-go": { api: "openai-completions" } } },
};

const settingsService = {
  register: (ns, schema, opts) => {
    // The real Settings.register resolves the section through the schema
    // (defaults applied) before handing back a scope; mirror that.
    liveValue = schema(opts.base);
    registrations.push({ ns, schema, opts, resolved: liveValue });
    sections.set(ns, opts.base);
    return {
      get: () => liveValue,
      watch: (fn) => { watches.push(fn); return () => {}; },
      update: async (patch) => { Object.assign(liveValue, patch); },
      replace: async (next) => {
        for (const key of Object.keys(liveValue)) delete liveValue[key];
        Object.assign(liveValue, next);
      },
    };
  },
  get: (ns) => externalNamespaces[ns] ?? sections.get(ns),
  describe: () => [
    { ns: "llm-pi-ai", user: { providers: { "opencode-go": { models: [] } } } },
    // The legacy namespace is present with an empty user layer, so the
    // one-time adoption completes at once instead of waiting for it.
    { ns: "quota-badges", user: {} },
  ],
  update: async (ns, patch) => { serviceWrites.push({ ns, patch }); },
};

/** The llm runtime face: a registered discovery + one donor provider. */
const llmService = {
  discoveries: new Map([["llm-pi-ai", async () => []]]),
  listProviders: () => [{ id: "opencode-go" }],
  listModels: async () => [{ id: "deepseek-v4-flash", contextWindow: 1000000 }],
};

const webServerService = {
  register: (spec) => { routes.push(spec); return () => {}; },
};

const ctx = {
  logger: { info: () => {}, warn: (msg) => console.warn("ctx.logger.warn:", msg) },
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
    injectCalls.push(names);
    const child = {
      ...ctx,
      settings: settingsService,
      llm: llmService,
      webServer: webServerService,
      effect: (fn) => { fn(); },
    };
    cb(child);
  },
};

// index.js imports the @deepseek-ai/schemastery and @deepseek-ai/dsh-settings
// peers, which are HOST packages rather than dependencies of this repo. A bare
// `npm install` here cannot resolve them, so explain that instead of surfacing
// a raw ERR_MODULE_NOT_FOUND.
let mod;
try {
  mod = await import("../index.js");
} catch (error) {
  if (error?.code === "ERR_MODULE_NOT_FOUND") {
    console.error(
      "toolkit server smoke: cannot load index.js because a host peer package is missing.\n"
      + "  This script imports index.js, which imports @deepseek-ai/schemastery and\n"
      + "  @deepseek-ai/dsh-settings. Run it from a checkout where those resolve, e.g.\n"
      + "      cd /root/deepseek-harness && node /root/dsh-plugin-toolkit/scripts/smoke.mjs\n"
      + "  (`npm test` and `npm run smoke:client` are self-contained and always run.)\n"
      + `  Underlying error: ${String(error?.message ?? error)}`,
    );
    process.exit(2);
  }
  throw error;
}
equal(mod.name, "toolkit", "plugin name");

// A recording fake fetch must be in place BEFORE apply(): the opencodeSession
// wrap captures whatever globalThis.fetch holds at install time, and the
// modelCapability sync probes through it.
const fetchCalls = [];
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : String(input?.url ?? input);
  fetchCalls.push({ input, init });
  if (url.endsWith("/models")) {
    return new Response(JSON.stringify({ data: [{ id: "alpha" }, { id: "deepseek-v4-flash" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.includes("models.dev")) return new Response("not found", { status: 404 });
  return new Response("{}", { status: 200 });
};
equal(mod.inject.join(","), "settings", "server inject");
ok(mod.Config, "Config schema exported");

mod.apply(ctx, {
  optimizations: {
    workspacelessChat: true,
    editLastMessage: true,
    viewActivity: true,
    slashI18n: true,
    changeReport: true,
    opencodeSession: true,
    modelCapability: true,
  },
  chatWorkspacePath: "",
  chatWorkspaceTitle: "通用对话",
  modelsApiKey: "sk-smoke-test",
});

// The modelCapability half waits on its own services, and the settings section
// keeps waiting on settings alone.
equal(injectCalls.length, 2, "two inject waits: model capability + settings section");
equal(injectCalls[0].join(","), "settings,llm,webServer", "modelCapability waits on settings+llm+webServer");
equal(injectCalls[1].join(","), "settings", "settings section waits on settings");

equal(registrations.length, 1, "one namespace registration");
equal(registrations[0].ns, "toolkit", "namespace key equals the card key");
equal(registrations[0].opts.base.chatWorkspacePath, chatDir, "base carries the resolved default path");
equal(registrations[0].opts.base.optimizations.workspacelessChat, true, "base carries the toggle");
equal(registrations[0].opts.base.optimizations.editLastMessage, true, "base carries the editLastMessage toggle");
equal(registrations[0].opts.base.optimizations.viewActivity, true, "base carries the viewActivity toggle");
equal(registrations[0].opts.base.optimizations.slashI18n, true, "base carries the slashI18n toggle");
equal(registrations[0].opts.base.optimizations.changeReport, true, "base carries the changeReport toggle");
equal(registrations[0].opts.base.optimizations.opencodeSession, true, "base carries the opencodeSession toggle");
equal(registrations[0].opts.base.optimizations.modelCapability, true, "base carries the modelCapability toggle");
equal(registrations[0].resolved.modelsRouteKey, "opencode-go", "resolved section carries the model route key");
equal(registrations[0].resolved.modelsSyncPath, "/api/toolkit/sync-models", "resolved section carries the sync route");
equal(registrations[0].resolved.modelsPath, "/api/toolkit/models", "resolved section carries the picker route");
equal(registrations[0].resolved.modelsMigratedFromQuotaBadges, false, "migration marker starts false");
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

// ── modelCapability: sync route + discovery enrichment ──────────────────────
const syncRoute = routes.find((spec) => spec.path === "/api/toolkit/sync-models");
ok(syncRoute, "POST /api/toolkit/sync-models is mounted");
equal(syncRoute.kind, "exact", "sync route is exact-kind");
equal(typeof llmService.discoveries.get("llm-pi-ai"), "function", "discovery stays a function after the wrap");
equal(llmService.discoveries.get("llm-pi-ai").enrichedByToolkit, true, "discovery is marked as toolkit-enriched");

/** Drive one sync request through the mounted route handler. */
async function postSync() {
  let body = "";
  const res = {
    writeHead() {},
    end(chunk) { body = chunk; },
  };
  await syncRoute.handler({ method: "POST" }, res);
  return JSON.parse(body);
}

const sync = await postSync();
equal(sync.ok, true, "sync succeeds against the fake endpoint");
equal(sync.total, 2, "sync reports the merged model count");
ok(sync.added.includes("alpha"), "a newly listed model is reported as added");
const write = serviceWrites.find((entry) => entry.ns === "llm-pi-ai" && entry.patch?.providers?.["opencode-go"]?.models);
ok(write, "sync persists into the llm-pi-ai namespace");
equal(write.patch.providers["opencode-go"].api, "openai-completions", "sync also stamps the route api");
ok(
  write.patch.providers["opencode-go"].models.some((model) => model.id === "deepseek-v4-flash" && model.contextWindow === 1000000),
  "stored catalog metadata survives the merge",
);

let methodStatus = 0;
await syncRoute.handler({ method: "GET" }, { writeHead(code) { methodStatus = code; }, end() {} });
equal(methodStatus, 405, "non-POST on the sync route is rejected");

// ── modelCapability: the picker's GET models route ──────────────────────────
const modelsRoute = routes.find((spec) => spec.path === "/api/toolkit/models");
ok(modelsRoute, "GET /api/toolkit/models is mounted");
equal(modelsRoute.kind, "exact", "models route is exact-kind");

async function getModels(method = "GET") {
  let body = "";
  const res = { writeHead() {}, end(chunk) { body = chunk; } };
  await modelsRoute.handler({ method }, res);
  return JSON.parse(body);
}

const listing = await getModels();
equal(listing.ok, true, "the models route answers ok");
equal(listing.routeKey, "opencode-go", "the models route names the route it describes");
ok(listing.count >= 1, "the models route lists at least the runtime's model");
ok(
  listing.models.some((model) => model.id === "deepseek-v4-flash"),
  "the models route includes the runtime model listing",
);
ok(Array.isArray(listing.forcedVision) && Array.isArray(listing.forcedTextOnly), "the payload echoes the overrides");
let modelsStatus = 0;
await modelsRoute.handler({ method: "POST" }, { writeHead(code) { modelsStatus = code; }, end() {} });
equal(modelsStatus, 405, "non-GET on the models route is rejected");

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
