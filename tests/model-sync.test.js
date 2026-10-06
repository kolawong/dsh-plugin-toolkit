/**
 * Tests for the modelCapability server core (model-sync.js): config
 * extraction, the sync cycle against a stubbed endpoint, the picker's model
 * listing, the legacy-settings migration, and the llm-pi-ai discovery wrap.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  modelConfig,
  syncModelsOnce,
  knownRouteModels,
  migrateLegacyModelSettings,
  installDiscoveryEnrichment,
  fetchLiveModelList,
  resetModelSyncCaches,
  LLM_PI_AI_NS,
} from "../model-sync.js";

/**
 * A stub endpoint reply for one `GET {baseURL}/models` probe.
 * @param {string[]} ids - ids the listing advertises.
 */
function listingResponse(ids) {
  return new Response(JSON.stringify({ object: "list", data: ids.map((id) => ({ id })) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Install a global fetch stub for the duration of one test.
 * @param {(url: string, init: object) => Response} handler - reply builder.
 * @returns {string[]} the URLs the code under test requested.
 */
function stubFetch(handler) {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    urls.push(url);
    return handler(url, init);
  };
  return {
    urls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

/**
 * A minimal model-sync context: a settings service with one llm-pi-ai section
 * (plus the toolkit's own resolved section, which drives the migration),
 * a recording update(), an llm runtime with per-route and donor models, and a
 * config thunk.
 */
function makeCtx(config, {
  stored = [],
  donors = [],
  routeModels = [],
  describe,
  toolkitValue,
  providers,
  listModelsThrows = false,
  updateThrows,
} = {}) {
  const writes = [];
  const descriptor = {
    ns: LLM_PI_AI_NS,
    revision: 7,
    user: { providers: { "opencode-go": { models: stored } } },
  };
  const resolvedToolkit = toolkitValue ?? { modelsMigratedFromQuotaBadges: true };
  const ctx = {
    logger: { info() {}, warn() {} },
    config: () => modelConfig(config),
    settings: {
      get: (ns) => (ns === "toolkit" ? resolvedToolkit : undefined),
      describe: () => (describe !== undefined ? describe : [descriptor]),
      update: async (ns, patch) => {
        if (updateThrows !== undefined) throw updateThrows;
        writes.push({ ns, patch });
      },
    },
    llm: {
      discoveries: new Map(),
      listProviders: () => providers ?? [{ id: "opencode-go" }, { id: "deepseek" }],
      // The route's own listing versus another provider's (donor) catalog.
      listModels: async (id) => {
        if (listModelsThrows) throw new Error("route is not registered");
        return id === "deepseek" ? donors : routeModels;
      },
    },
  };
  return { ctx, writes };
}

const BASE_CONFIG = {
  optimizations: { modelCapability: true },
  modelsApiKey: "sk-test",
  modelsRouteKey: "opencode-go",
  modelsBaseURL: "https://example.test/v1",
  modelsEnrichFromRegistry: false,
};

test("modelConfig: applies every default and respects overrides", () => {
  const defaults = modelConfig({});
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.apiKey, "");
  assert.equal(defaults.apiKeyEnvVar, "OPENCODE_API_KEY");
  assert.equal(defaults.routeKey, "opencode-go");
  assert.equal(defaults.baseURL, "https://opencode.ai/zen/go/v1");
  assert.equal(defaults.routeApi, "openai-completions");
  assert.equal(defaults.syncPath, "/api/toolkit/sync-models");
  assert.equal(defaults.modelsPath, "/api/toolkit/models");
  assert.equal(defaults.enrichFromRegistry, true);
  assert.equal(defaults.registryProvider, "opencode-go");
  assert.deepEqual(defaults.vision, []);
  assert.deepEqual(defaults.textOnly, []);
  assert.equal(defaults.migratedFromLegacy, false);
  assert.equal(defaults.timeoutSec, 10);
  assert.deepEqual(defaults.routeBaseURLs, {});

  const custom = modelConfig({
    optimizations: { modelCapability: false },
    modelsApiKey: "k",
    modelsApiKeyEnvVar: "OTHER_KEY",
    modelsRouteKey: "my-route",
    modelsBaseURL: "https://x.test/v2",
    modelsRouteApi: "openai-responses",
    modelsSyncPath: "/api/custom/sync",
    modelsEnrichFromRegistry: false,
    modelsRegistryProvider: "vendor",
    modelsRouteBaseURLs: {
      "kimi-coding": "https://api.moonshot.cn/v1",
      "minimax-cn": { baseURL: "https://api.minimaxi.com/anthropic", api: "anthropic-messages" },
      empty: "",
      "no-url": { api: "openai-completions" },
    },
    modelsVision: ["a"],
    modelsTextOnly: ["b"],
    modelsTimeoutSec: 3,
    modelsMigratedFromQuotaBadges: true,
  });
  assert.equal(custom.enabled, false);
  assert.equal(custom.apiKeyEnvVar, "OTHER_KEY");
  assert.equal(custom.routeKey, "my-route");
  assert.equal(custom.routeApi, "openai-responses");
  assert.equal(custom.syncPath, "/api/custom/sync");
  assert.equal(custom.enrichFromRegistry, false);
  assert.equal(custom.registryProvider, "vendor");
  assert.deepEqual(
    custom.routeBaseURLs,
    {
      "kimi-coding": "https://api.moonshot.cn/v1",
      "minimax-cn": { baseURL: "https://api.minimaxi.com/anthropic", api: "anthropic-messages" },
    },
    "empty entries are dropped; an object entry keeps its protocol",
  );
  assert.deepEqual(custom.vision, ["a"]);
  assert.deepEqual(custom.textOnly, ["b"]);
  assert.equal(custom.migratedFromLegacy, true);
  assert.equal(custom.timeoutSec, 3);
});

test("knownRouteModels: unions stored rows with the runtime view, deduped and sorted", async () => {
  const { ctx } = makeCtx(BASE_CONFIG, {
    stored: [
      { id: "z-model", name: "Z Model", contextWindow: 1000, input: ["text", "image"] },
      { id: "shared", contextWindow: 500 },
    ],
    routeModels: [
      // The runtime view repeats one stored id and adds a new one.
      { id: "shared", name: "runtime name" },
      { id: "a-model", name: "A Model", inputModalities: ["text"] },
    ],
  });
  const payload = await knownRouteModels(ctx);
  assert.equal(payload.ok, true);
  assert.equal(payload.routeKey, "opencode-go");
  assert.equal(payload.count, 3);
  assert.deepEqual(payload.models.map((model) => model.id), ["a-model", "shared", "z-model"]);
  const stored = payload.models.find((model) => model.id === "shared");
  assert.equal(stored.contextWindow, 500, "the stored row wins over the runtime view");
  assert.equal(stored.name, undefined, "an absent stored name is not invented");
  const runtime = payload.models.find((model) => model.id === "a-model");
  assert.deepEqual(runtime.input, ["text"], "inputModalities normalize to input");
  assert.deepEqual(payload.models.find((model) => model.id === "z-model").input, ["text", "image"]);
  assert.deepEqual(payload.forcedVision, [], "the payload echoes the current overrides");
  assert.deepEqual(payload.forcedTextOnly, []);
});

test("knownRouteModels: an empty route answers an empty, well-formed list", async () => {
  const { ctx } = makeCtx(BASE_CONFIG, { describe: [] });
  const payload = await knownRouteModels(ctx);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.models, []);
  assert.equal(payload.count, 0);
});

test("syncModelsOnce: answers 'disabled' without touching settings", async () => {
  const { ctx, writes } = makeCtx({ ...BASE_CONFIG, optimizations: { modelCapability: false } });
  const result = await syncModelsOnce(ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "disabled");
  assert.equal(writes.length, 0);
});

test("syncModelsOnce: answers 'unconfigured' without an API key", async () => {
  const { ctx, writes } = makeCtx({ ...BASE_CONFIG, modelsApiKey: "" });
  const previous = process.env.OPENCODE_API_KEY;
  delete process.env.OPENCODE_API_KEY;
  try {
    const result = await syncModelsOnce(ctx);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "unconfigured");
    assert.equal(writes.length, 0);
  } finally {
    if (previous !== undefined) process.env.OPENCODE_API_KEY = previous;
  }
});

test("syncModelsOnce: merges the live listing over the stored catalog and persists it", async () => {
  resetModelSyncCaches();
  const { ctx, writes } = makeCtx(BASE_CONFIG, {
    stored: [{ id: "beta", contextWindow: 1000 }],
    donors: [{ id: "alpha", inputModalities: ["text", "image"] }],
  });
  const fetchStub = stubFetch(() => listingResponse(["alpha", "beta", "gamma-2"]));
  try {
    const result = await syncModelsOnce(ctx);
    assert.equal(result.ok, true);
    assert.equal(result.routeKey, "opencode-go");
    assert.equal(result.total, 3);
    assert.deepEqual(result.added.sort(), ["alpha", "gamma-2"]);
    assert.deepEqual(result.removed, []);
    // alpha borrows image input from the cross-provider donor.
    assert.equal(result.grantedImageInput, 1);

    assert.equal(writes.length, 1);
    const written = writes[0];
    assert.equal(written.ns, LLM_PI_AI_NS);
    const route = written.patch.providers["opencode-go"];
    assert.equal(route.api, "openai-completions");
    assert.deepEqual(route.models.map((model) => model.id), ["alpha", "beta", "gamma-2"]);
    assert.equal(route.models[0].input.join(","), "text,image");
    assert.equal(route.models[1].contextWindow, 1000, "stored metadata wins per id");
  } finally {
    fetchStub.restore();
  }
});

test("syncModelsOnce: user overrides win over auto-detection", async () => {
  resetModelSyncCaches();
  const config = { ...BASE_CONFIG, modelsVision: ["alpha"], modelsTextOnly: ["beta"] };
  const { ctx, writes } = makeCtx(config, {
    stored: [{ id: "beta", contextWindow: 1000, input: ["text"] }],
    donors: [],
  });
  const fetchStub = stubFetch(() => listingResponse(["alpha", "beta"]));
  try {
    const result = await syncModelsOnce(ctx);
    assert.equal(result.ok, true);
    assert.equal(result.forcedVision, 1);
    assert.equal(result.forcedTextOnly, 1);
    const models = writes[0].patch.providers["opencode-go"].models;
    assert.deepEqual(models.find((model) => model.id === "alpha").input, ["text", "image"]);
    assert.equal("input" in models.find((model) => model.id === "beta"), false, "forced text-only strips input");
  } finally {
    fetchStub.restore();
  }
});

test("syncModelsOnce: unsized ids inherit the closest sized sibling", async () => {
  resetModelSyncCaches();
  const { ctx, writes } = makeCtx(BASE_CONFIG, {
    stored: [{ id: "base-model", contextWindow: 500, maxTokens: 100, name: "Base" }],
  });
  const fetchStub = stubFetch(() => listingResponse(["base-model", "base-model-pro"]));
  try {
    const result = await syncModelsOnce(ctx);
    assert.equal(result.ok, true);
    const models = writes[0].patch.providers["opencode-go"].models;
    const derived = models.find((model) => model.id === "base-model-pro");
    assert.equal(derived.contextWindow, 500);
    assert.equal(derived.maxTokens, 100);
    assert.equal(derived.name, "Base");
  } finally {
    fetchStub.restore();
  }
});

test("syncModelsOnce: a live probe failure keeps the stored route untouched", async () => {
  resetModelSyncCaches();
  const { ctx, writes } = makeCtx(BASE_CONFIG, { stored: [{ id: "beta" }] });
  const fetchStub = stubFetch(() => new Response("nope", { status: 500 }));
  try {
    const result = await syncModelsOnce(ctx);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "api-error");
    assert.equal(writes.length, 0);
  } finally {
    fetchStub.restore();
  }
});

test("fetchLiveModelList: unauthenticated calls are rejected before any request", async () => {
  const fetchStub = stubFetch(() => listingResponse(["a"]));
  try {
    await assert.rejects(
      () => fetchLiveModelList("https://example.test/v1", "", undefined, 5),
      (error) => error.code === "invalid-credentials",
    );
    assert.equal(fetchStub.urls.length, 0);
  } finally {
    fetchStub.restore();
  }
});

test("migrateLegacyModelSettings: adopts the former quota-badges key and lists once", async () => {
  const { ctx, writes } = makeCtx(BASE_CONFIG, {
    // The toolkit's own resolved section is what the migration reads: the key
    // is still empty and the marker is not set.
    toolkitValue: { modelsMigratedFromQuotaBadges: false, modelsApiKey: "" },
    describe: [{
      ns: "quota-badges",
      user: {
        apiKey: "sk-legacy",
        modelsVision: ["legacy-vision"],
        modelsTextOnly: ["legacy-text"],
        modelsRouteKey: "custom-route",
      },
    }],
  });
  await migrateLegacyModelSettings(ctx);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].ns, "toolkit");
  assert.deepEqual(writes[0].patch, {
    modelsMigratedFromQuotaBadges: true,
    modelsApiKey: "sk-legacy",
    modelsVision: ["legacy-vision"],
    modelsTextOnly: ["legacy-text"],
    modelsRouteKey: "custom-route",
  });
});

test("migrateLegacyModelSettings: the marker makes it one-way", async () => {
  const { ctx, writes } = makeCtx(BASE_CONFIG, {
    toolkitValue: { modelsMigratedFromQuotaBadges: true, modelsApiKey: "sk-mine" },
    describe: [{ ns: "quota-badges", user: { apiKey: "sk-legacy" } }],
  });
  await migrateLegacyModelSettings(ctx);
  assert.equal(writes.length, 0, "an already-migrated toolkit never re-adopts");
});

test("migrateLegacyModelSettings: a toolkit-side choice is never overwritten", async () => {
  const { ctx, writes } = makeCtx(BASE_CONFIG, {
    toolkitValue: { modelsMigratedFromQuotaBadges: false, modelsVision: ["mine"] },
    describe: [{ ns: "quota-badges", user: { modelsVision: ["legacy-vision"], modelsRouteKey: "custom-route" } }],
  });
  await migrateLegacyModelSettings(ctx);
  assert.equal(writes.length, 1);
  assert.equal("modelsVision" in writes[0].patch, false, "a non-empty toolkit list wins");
  assert.equal(writes[0].patch.modelsRouteKey, "custom-route", "route still at its default is adopted");
});

test("installDiscoveryEnrichment: wraps the llm-pi-ai discovery and restores it on dispose", async () => {
  resetModelSyncCaches();
  const original = async () => [{ id: "catalog-only" }];
  const discoveries = new Map([[LLM_PI_AI_NS, original]]);
  const disposers = [];
  const ctx = {
    logger: { info() {}, warn() {} },
    config: () => modelConfig({ ...BASE_CONFIG, modelsBaseURL: "https://example.test/v1" }),
    llm: { discoveries },
    effect: (fn) => { disposers.push(fn()); },
  };
  const fetchStub = stubFetch(() => listingResponse(["live-only", "catalog-only"]));
  try {
    installDiscoveryEnrichment(ctx);
    const wrapped = discoveries.get(LLM_PI_AI_NS);
    assert.notEqual(wrapped, original);
    assert.equal(wrapped.enrichedByToolkit, true);

    const answer = await wrapped({ provider: "opencode-go", baseURL: "https://example.test/v1" });
    assert.deepEqual(answer.map((model) => model.id), ["live-only", "catalog-only"]);
    assert.equal(typeof answer.liveProbedAt, "number");

    // Another provider's discovery is never touched by the wrap.
    const untouched = await wrapped({ provider: "somewhere-else" });
    assert.deepEqual(untouched, [{ id: "catalog-only" }]);

    disposers[0]();
    assert.equal(discoveries.get(LLM_PI_AI_NS), original, "dispose restores the original discovery");
  } finally {
    fetchStub.restore();
  }
});

test("installDiscoveryEnrichment: a probe failure falls back to the catalog answer", async () => {
  resetModelSyncCaches();
  const discoveries = new Map([[LLM_PI_AI_NS, async () => [{ id: "catalog-only" }]]]);
  const ctx = {
    logger: { info() {}, warn() {} },
    config: () => modelConfig({ ...BASE_CONFIG, modelsBaseURL: "https://example.test/v1" }),
    llm: { discoveries },
    effect: (fn) => { fn(); },
  };
  const fetchStub = stubFetch(() => new Response("boom", { status: 500 }));
  try {
    installDiscoveryEnrichment(ctx);
    const answer = await discoveries.get(LLM_PI_AI_NS)({ provider: "opencode-go" });
    assert.deepEqual(answer, [{ id: "catalog-only" }]);
    assert.equal(answer.liveProbedAt, undefined, "a fallback answer must not claim a live probe");
  } finally {
    fetchStub.restore();
  }
});
// ── multi-route discovery enrichment ────────────────────────────────────────

/**
 * A discovery-enrichment context: the llm discoveries map plus an optional
 * llm-pi-ai settings descriptor and credentials service, matching the shape
 * `installModelCapability` hands to `installDiscoveryEnrichment`.
 * @param {Map<string, Function>} discoveries - the runtime's discovery map.
 * @param {{config?: object, describe?: Function, credentials?: object}} [options]
 * @returns {object} the context under test.
 */
function makeEnrichmentCtx(discoveries, { config, describe, credentials } = {}) {
  const disposers = [];
  const ctx = {
    logger: { info() {}, warn() {} },
    config: () => modelConfig(config ?? BASE_CONFIG),
    llm: { discoveries },
    effect: (fn) => { disposers.push(fn()); },
    get: (name) => (name === "credentials" ? credentials : undefined),
  };
  if (describe !== undefined) {
    ctx.settings = { describe };
  }
  return { ctx, disposers };
}

/**
 * One llm-pi-ai descriptor with the given route profiles. The default layer is
 * `value`, which is what the host really exposes: a route declared in the
 * profile's `providers:` map lives in the composition layer, so it shows up in
 * the effective section and NOT in `user` — that one carries only what the
 * settings surface itself wrote.
 */
function storedRoutes(providers, layer = "value") {
  return () => [{ ns: LLM_PI_AI_NS, revision: 3, [layer]: { providers } }];
}

test("installDiscoveryEnrichment: a profile-declared route is read from the effective section, not the user layer", async () => {
  // The real shape: `providers:` lives in cordis.patch.yml (the composition
  // layer), so describe() reports it under `value` while `user` is absent. A
  // route read from `user` alone would look unconfigured, resolve no credential,
  // and silently keep the catalog answer.
  resetModelSyncCaches();
  process.env.MINIMAX_CN_API_KEY = "sk-minimax";
  const discoveries = new Map([[LLM_PI_AI_NS, async () => [{ id: "MiniMax-M3" }]]]);
  const { ctx } = makeEnrichmentCtx(discoveries, {
    config: {
      ...BASE_CONFIG,
      modelsRouteBaseURLs: {
        "minimax-cn": { baseURL: "https://api.minimaxi.com/anthropic", api: "anthropic-messages" },
      },
    },
    describe: () => [{
      ns: LLM_PI_AI_NS,
      revision: 3,
      value: { providers: { "minimax-cn": { apiKeyEnv: "MINIMAX_CN_API_KEY" } } },
      // base carries the same composition entry; user is empty because nothing
      // was written from the settings surface.
      base: { providers: { "minimax-cn": { apiKeyEnv: "MINIMAX_CN_API_KEY" } } },
    }],
  });
  const seen = [];
  const fetchStub = stubFetch((url, init) => {
    seen.push({ url, init });
    return listingResponse(["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.5"]);
  });
  try {
    installDiscoveryEnrichment(ctx);
    const answer = await discoveries.get(LLM_PI_AI_NS)({ provider: "minimax-cn" });
    assert.deepEqual(answer.map((model) => model.id), ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.5"]);
    assert.equal(answer.liveProbedAt !== undefined, true, "the probe really ran");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "https://api.minimaxi.com/anthropic/v1/models?limit=1000");
    // The credential resolved from the route's apiKeyEnv, and the Anthropic
    // protocol carries it as x-api-key rather than a Bearer token.
    assert.equal(seen[0].init.headers["x-api-key"], "sk-minimax");
    assert.equal(seen[0].init.headers.Authorization, undefined);
  } finally {
    fetchStub.restore();
    delete process.env.MINIMAX_CN_API_KEY;
  }
});

test("installDiscoveryEnrichment: a settings-surface route is still found in the user layer", async () => {
  resetModelSyncCaches();
  const discoveries = new Map([[LLM_PI_AI_NS, async () => [{ id: "catalog-only" }]]]);
  const { ctx } = makeEnrichmentCtx(discoveries, {
    describe: storedRoutes({ "kimi-coding": { baseURL: "https://api.kimi.com/coding", apiKeyEnv: "KIMI_CODING_API_KEY" } }, "user"),
  });
  process.env.KIMI_CODING_API_KEY = "sk-kimi";
  const fetchStub = stubFetch(() => listingResponse(["k3", "k3-256k"]));
  try {
    installDiscoveryEnrichment(ctx);
    const answer = await discoveries.get(LLM_PI_AI_NS)({ provider: "kimi-coding" });
    assert.deepEqual(answer.map((model) => model.id), ["k3", "k3-256k", "catalog-only"]);
  } finally {
    fetchStub.restore();
    delete process.env.KIMI_CODING_API_KEY;
  }
});

test("installDiscoveryEnrichment: a non-primary route with a draft endpoint is probed and merged", async () => {
  resetModelSyncCaches();
  const discoveries = new Map([[LLM_PI_AI_NS, async () => [{ id: "cline-pass/glm-5.3" }]]]);
  const { ctx } = makeEnrichmentCtx(discoveries);
  const seen = [];
  const fetchStub = stubFetch((url, init) => {
    seen.push({ url, init });
    return listingResponse(["cline-pass/glm-5.3", "cline-pass/new-model"]);
  });
  try {
    installDiscoveryEnrichment(ctx);
    const answer = await discoveries.get(LLM_PI_AI_NS)({
      provider: "clinepass",
      baseURL: "https://api.cline.bot/api/v1",
      api: "openai-completions",
      apiKey: "sk-draft",
    });
    // The live-only id joins the catalog answer, and the tag proves the probe
    // really happened (the sync route refuses an untagged answer).
    assert.deepEqual(answer.map((model) => model.id), ["cline-pass/glm-5.3", "cline-pass/new-model"]);
    assert.equal(typeof answer.liveProbedAt, "number");
    assert.equal(seen[0].url, "https://api.cline.bot/api/v1/models");
    assert.equal(seen[0].init.headers.Authorization, "Bearer sk-draft");
  } finally {
    fetchStub.restore();
  }
});

test("installDiscoveryEnrichment: a non-primary route resolves its stored endpoint and apiKeyEnv credential", async () => {
  resetModelSyncCaches();
  process.env.CLINEPASS_API_KEY = "sk-from-env";
  const discoveries = new Map([[LLM_PI_AI_NS, async () => [{ id: "cline-pass/glm-5.3" }]]]);
  const { ctx } = makeEnrichmentCtx(discoveries, {
    describe: storedRoutes({
      clinepass: { baseURL: "https://api.cline.bot/api/v1", api: "openai-completions", apiKeyEnv: "CLINEPASS_API_KEY" },
    }),
  });
  const seen = [];
  const fetchStub = stubFetch((url, init) => {
    seen.push({ url, init });
    return listingResponse(["cline-pass/new-model"]);
  });
  try {
    installDiscoveryEnrichment(ctx);
    // The request carries no baseURL and no key: both come from the stored
    // route profile, the same way llm-pi-ai resolves them for its own calls.
    // Live ids lead in endpoint order; catalog-only ids follow.
    const answer = await discoveries.get(LLM_PI_AI_NS)({ provider: "clinepass" });
    assert.deepEqual(answer.map((model) => model.id), ["cline-pass/new-model", "cline-pass/glm-5.3"]);
    assert.equal(seen[0].url, "https://api.cline.bot/api/v1/models");
    assert.equal(seen[0].init.headers.Authorization, "Bearer sk-from-env");
  } finally {
    fetchStub.restore();
    delete process.env.CLINEPASS_API_KEY;
  }
});

test("installDiscoveryEnrichment: the credentials service wins over the launch environment", async () => {
  resetModelSyncCaches();
  process.env.CLINEPASS_API_KEY = "sk-from-env";
  const discoveries = new Map([[LLM_PI_AI_NS, async () => [{ id: "known" }]]]);
  const { ctx } = makeEnrichmentCtx(discoveries, {
    describe: storedRoutes({ clinepass: { baseURL: "https://api.cline.bot/api/v1", apiKeyEnv: "CLINEPASS_API_KEY" } }),
    credentials: { resolve: async (ref) => (ref === "CLINEPASS_API_KEY" ? { value: "sk-from-service" } : undefined) },
  });
  const seen = [];
  const fetchStub = stubFetch((url, init) => {
    seen.push({ url, init });
    return listingResponse(["known"]);
  });
  try {
    installDiscoveryEnrichment(ctx);
    await discoveries.get(LLM_PI_AI_NS)({ provider: "clinepass" });
    assert.equal(seen[0].init.headers.Authorization, "Bearer sk-from-service");
  } finally {
    fetchStub.restore();
    delete process.env.CLINEPASS_API_KEY;
  }
});

test("installDiscoveryEnrichment: a route with no resolvable endpoint keeps the catalog answer", async () => {
  resetModelSyncCaches();
  const discoveries = new Map([[LLM_PI_AI_NS, async () => [{ id: "k3" }]]]);
  const { ctx } = makeEnrichmentCtx(discoveries, { describe: storedRoutes({ "kimi-coding": { apiKeyEnv: "KIMI_CODING_API_KEY" } }) });
  const fetchStub = stubFetch(() => listingResponse(["live"]));
  try {
    installDiscoveryEnrichment(ctx);
    // A catalog route whose profile names no endpoint has nothing to probe:
    // guessing a URL would be worse than the catalog answer it already has.
    const answer = await discoveries.get(LLM_PI_AI_NS)({ provider: "kimi-coding" });
    assert.deepEqual(answer, [{ id: "k3" }]);
    assert.equal(fetchStub.urls.length, 0, "no network call without an endpoint");
  } finally {
    fetchStub.restore();
  }
});

test("installDiscoveryEnrichment: modelsRouteExtraModels adds an id the endpoint never lists", async () => {
  // The real case: MiniMax answers 200 for MiniMax-M3.1-Flash-Preview on the
  // same key while /anthropic/v1/models omits it, so the listing alone can
  // never surface it.
  resetModelSyncCaches();
  process.env.MINIMAX_CN_API_KEY = "sk-minimax";
  const discoveries = new Map([[LLM_PI_AI_NS, async () => [{ id: "MiniMax-M3" }]]]);
  const { ctx } = makeEnrichmentCtx(discoveries, {
    config: {
      ...BASE_CONFIG,
      modelsRouteBaseURLs: { "minimax-cn": { baseURL: "https://api.minimaxi.com/anthropic", api: "anthropic-messages" } },
      modelsRouteExtraModels: { "minimax-cn": ["MiniMax-M3.1-Flash-Preview", "MiniMax-M3"] },
    },
    describe: storedRoutes({ "minimax-cn": { apiKeyEnv: "MINIMAX_CN_API_KEY" } }),
  });
  const fetchStub = stubFetch(() => listingResponse(["MiniMax-M3", "MiniMax-M2.7"]));
  try {
    installDiscoveryEnrichment(ctx);
    const answer = await discoveries.get(LLM_PI_AI_NS)({ provider: "minimax-cn" });
    // The listing leads, the declared id follows, and the id the listing already
    // carries is not duplicated (it keeps the listing's richer row).
    assert.deepEqual(answer.map((model) => model.id), ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M3.1-Flash-Preview"]);
    assert.equal(answer.filter((model) => model.id === "MiniMax-M3").length, 1);
    assert.equal(answer.liveProbedAt !== undefined, true, "the probe still ran and tagged the answer");
  } finally {
    fetchStub.restore();
    delete process.env.MINIMAX_CN_API_KEY;
  }
});

test("installDiscoveryEnrichment: a declared id still arrives when the route cannot be probed", async () => {
  // No endpoint resolves, so the probe is skipped — but the whole point of
  // declaring the id is that the endpoint would not have mentioned it anyway.
  resetModelSyncCaches();
  const discoveries = new Map([[LLM_PI_AI_NS, async () => [{ id: "MiniMax-M3" }]]]);
  const { ctx } = makeEnrichmentCtx(discoveries, {
    config: { ...BASE_CONFIG, modelsRouteExtraModels: { "minimax-cn": ["MiniMax-M3.1-Flash-Preview"] } },
  });
  const fetchStub = stubFetch(() => listingResponse([]));
  try {
    installDiscoveryEnrichment(ctx);
    const answer = await discoveries.get(LLM_PI_AI_NS)({ provider: "minimax-cn" });
    assert.deepEqual(answer.map((model) => model.id), ["MiniMax-M3", "MiniMax-M3.1-Flash-Preview"]);
    assert.equal(fetchStub.urls.length, 0, "no endpoint means no probe");
    // The answer is NOT tagged live: the sync route must not persist it as a
    // live listing, since no endpoint answered.
    assert.equal(answer.liveProbedAt, undefined);
  } finally {
    fetchStub.restore();
  }
});

test("installDiscoveryEnrichment: declared ids are ignored for other routes", async () => {
  resetModelSyncCaches();
  const discoveries = new Map([[LLM_PI_AI_NS, async () => [{ id: "k3" }]]]);
  const { ctx } = makeEnrichmentCtx(discoveries, {
    config: { ...BASE_CONFIG, modelsRouteExtraModels: { "minimax-cn": ["MiniMax-M3.1-Flash-Preview"] } },
  });
  installDiscoveryEnrichment(ctx);
  const answer = await discoveries.get(LLM_PI_AI_NS)({ provider: "kimi-coding" });
  assert.deepEqual(answer.map((model) => model.id), ["k3"]);
});

test("installDiscoveryEnrichment: a host that refuses a catalog-less route is retried with the resolved endpoint", async () => {
  // The live case (clinepass): pi-ai ships no catalog for the provider and the
  // GUI's request names only the route, so the host's own discovery throws
  // DISCOVERY_FAILED before this wrap ever sees a listing. Resolving the
  // endpoint first and handing it back is what makes such a route fetchable.
  resetModelSyncCaches();
  const seen = [];
  const discoveries = new Map([[LLM_PI_AI_NS, async (request) => {
    seen.push(request?.baseURL ?? null);
    if (request?.baseURL === undefined) {
      throw new Error('pi-ai ships no catalog for provider "clinepass", so its models can only come from its endpoint');
    }
    // The host probed the endpoint we supplied: a real listing, no catalog.
    return [{ id: "cline-pass/glm-5.3" }, { id: "cline-pass/kimi-k3" }, { id: "openai/gpt-5.5" }];
  }]]);
  const { ctx } = makeEnrichmentCtx(discoveries, {
    config: {
      ...BASE_CONFIG,
      modelsRouteBaseURLs: { clinepass: { baseURL: "https://api.cline.bot/api/v1", api: "openai-completions" } },
    },
  });
  const fetchStub = stubFetch(() => listingResponse([]));
  try {
    installDiscoveryEnrichment(ctx);
    const answer = await discoveries.get(LLM_PI_AI_NS)({ provider: "clinepass" });
    assert.deepEqual(answer.map((model) => model.id), ["cline-pass/glm-5.3", "cline-pass/kimi-k3", "openai/gpt-5.5"]);
    assert.equal(answer.liveProbedAt !== undefined, true, "the host's listing is a live answer");
    // First call without an endpoint, then the retry that carried it.
    assert.deepEqual(seen, [null, "https://api.cline.bot/api/v1"]);
    // The host already asked the endpoint, so this wrap must not ask it again.
    assert.equal(fetchStub.urls.length, 0, "no second probe of the same endpoint");
  } finally {
    fetchStub.restore();
  }
});

test("installDiscoveryEnrichment: a host refusal is rethrown when no endpoint can be resolved", async () => {
  resetModelSyncCaches();
  const discoveries = new Map([[LLM_PI_AI_NS, async () => {
    throw new Error('pi-ai ships no catalog for provider "mystery-gateway"');
  }]]);
  const { ctx } = makeEnrichmentCtx(discoveries, { config: BASE_CONFIG });
  installDiscoveryEnrichment(ctx);
  await assert.rejects(
    () => discoveries.get(LLM_PI_AI_NS)({ provider: "mystery-gateway" }),
    /ships no catalog/,
  );
});

test("installDiscoveryEnrichment: modelsRouteBaseURLs supplies an endpoint for a catalog route", async () => {
  resetModelSyncCaches();
  process.env.KIMI_CODING_API_KEY = "sk-kimi";
  const discoveries = new Map([[LLM_PI_AI_NS, async () => [{ id: "k3" }]]]);
  const { ctx } = makeEnrichmentCtx(discoveries, {
    config: { ...BASE_CONFIG, modelsRouteBaseURLs: { "kimi-coding": "https://api.moonshot.cn/v1" } },
    describe: storedRoutes({ "kimi-coding": { apiKeyEnv: "KIMI_CODING_API_KEY" } }),
  });
  const fetchStub = stubFetch(() => listingResponse(["k3", "k3.5"]));
  try {
    installDiscoveryEnrichment(ctx);
    const answer = await discoveries.get(LLM_PI_AI_NS)({ provider: "kimi-coding" });
    assert.deepEqual(answer.map((model) => model.id), ["k3", "k3.5"]);
    assert.equal(fetchStub.urls[0], "https://api.moonshot.cn/v1/models");
  } finally {
    fetchStub.restore();
    delete process.env.KIMI_CODING_API_KEY;
  }
});

test("installDiscoveryEnrichment: an object override carries the route's protocol", async () => {
  resetModelSyncCaches();
  process.env.MINIMAX_CN_API_KEY = "sk-minimax";
  const discoveries = new Map([[LLM_PI_AI_NS, async () => [{ id: "MiniMax-M3" }]]]);
  const { ctx } = makeEnrichmentCtx(discoveries, {
    config: {
      ...BASE_CONFIG,
      modelsRouteBaseURLs: { "minimax-cn": { baseURL: "https://api.minimaxi.com/anthropic", api: "anthropic-messages" } },
    },
    describe: storedRoutes({ "minimax-cn": { apiKeyEnv: "MINIMAX_CN_API_KEY" } }),
  });
  const seen = [];
  const fetchStub = stubFetch((url, init) => {
    seen.push({ url, init });
    return listingResponse(["MiniMax-M3", "MiniMax-M4"]);
  });
  try {
    installDiscoveryEnrichment(ctx);
    const answer = await discoveries.get(LLM_PI_AI_NS)({ provider: "minimax-cn" });
    assert.deepEqual(answer.map((model) => model.id), ["MiniMax-M3", "MiniMax-M4"]);
    // The Anthropic listing URL and auth shape come from the override, since
    // the route's profile states neither.
    assert.equal(seen[0].url, "https://api.minimaxi.com/anthropic/v1/models?limit=1000");
    assert.equal(seen[0].init.headers["x-api-key"], "sk-minimax");
    assert.equal(seen[0].init.headers.Authorization, undefined);
  } finally {
    fetchStub.restore();
    delete process.env.MINIMAX_CN_API_KEY;
  }
});

test("installDiscoveryEnrichment: deployment headers authenticate a keyless route", async () => {
  resetModelSyncCaches();
  const discoveries = new Map([[LLM_PI_AI_NS, async () => [{ id: "known" }]]]);
  const { ctx } = makeEnrichmentCtx(discoveries, {
    describe: storedRoutes({
      gateway: { baseURL: "https://gateway.test/v1", headers: { Authorization: "Token gateway-owned" } },
    }),
  });
  const seen = [];
  const fetchStub = stubFetch((url, init) => {
    seen.push({ url, init });
    return listingResponse(["known", "fresh"]);
  });
  try {
    installDiscoveryEnrichment(ctx);
    const answer = await discoveries.get(LLM_PI_AI_NS)({ provider: "gateway" });
    assert.deepEqual(answer.map((model) => model.id), ["known", "fresh"]);
    assert.equal(seen[0].init.headers.Authorization, "Token gateway-owned");
  } finally {
    fetchStub.restore();
  }
});

test("installDiscoveryEnrichment: the primary route keeps its modelsBaseURL/modelsApiKey fallback", async () => {
  resetModelSyncCaches();
  const discoveries = new Map([[LLM_PI_AI_NS, async () => [{ id: "catalog-only" }]]]);
  const { ctx } = makeEnrichmentCtx(discoveries, {
    config: { ...BASE_CONFIG, modelsBaseURL: "https://primary.test/v1", modelsApiKey: "sk-primary" },
  });
  const seen = [];
  const fetchStub = stubFetch((url, init) => {
    seen.push({ url, init });
    return listingResponse(["live-only"]);
  });
  try {
    installDiscoveryEnrichment(ctx);
    // No stored profile and no draft fields: the legacy config still drives the
    // primary route, so an existing setup is untouched by the multi-route change.
    const answer = await discoveries.get(LLM_PI_AI_NS)({ provider: "opencode-go" });
    assert.deepEqual(answer.map((model) => model.id), ["live-only", "catalog-only"]);
    assert.equal(seen[0].url, "https://primary.test/v1/models");
    assert.equal(seen[0].init.headers.Authorization, "Bearer sk-primary");
  } finally {
    fetchStub.restore();
  }
});

test("installDiscoveryEnrichment: a non-primary route reads its own models.dev directory", async () => {
  resetModelSyncCaches();
  const discoveries = new Map([[LLM_PI_AI_NS, async () => [{ id: "known" }]]]);
  const { ctx } = makeEnrichmentCtx(discoveries, {
    config: { ...BASE_CONFIG, modelsEnrichFromRegistry: true, modelsRegistryProvider: "opencode-go" },
    describe: storedRoutes({ clinepass: { baseURL: "https://api.cline.bot/api/v1" } }),
  });
  const registryUrls = [];
  const fetchStub = stubFetch((url) => {
    if (url.includes("models.dev") || url.includes("jsdelivr") || url.includes("raw.githubusercontent")) {
      registryUrls.push(url);
      return new Response('name = "Model"\n[limit]\ncontext = 123\noutput = 45\n', { status: 200 });
    }
    return listingResponse(["known"]);
  });
  try {
    installDiscoveryEnrichment(ctx);
    const answer = await discoveries.get(LLM_PI_AI_NS)({ provider: "clinepass", apiKey: "sk-draft" });
    assert.deepEqual(answer.map((model) => model.id), ["known"]);
    assert.ok(
      registryUrls.some((url) => url.includes("/clinepass/models/")),
      "the route key is the models.dev directory for a non-primary route",
    );
    assert.ok(
      registryUrls.every((url) => !url.includes("/opencode-go/models/")),
      "the primary route's registry directory is not reused for another route",
    );
  } finally {
    fetchStub.restore();
  }
});

test("syncModelsOnce: a newly listed model is still enriched over a fresh registry cache", async () => {
  resetModelSyncCaches();
  const registryHits = [];
  let liveCall = 0;
  const liveSets = [["alpha"], ["alpha", "beta"]];
  const fetchStub = stubFetch((url) => {
    if (url.includes("jsdelivr") || url.includes("raw.githubusercontent")) {
      registryHits.push(url);
      return new Response('name = "Model"\n[limit]\ncontext = 100\noutput = 50\n', { status: 200 });
    }
    const ids = liveSets[Math.min(liveCall++, liveSets.length - 1)];
    return listingResponse(ids);
  });
  const { ctx, writes } = makeCtx({ ...BASE_CONFIG, modelsEnrichFromRegistry: true }, { stored: [] });
  try {
    await syncModelsOnce(ctx);
    const firstHits = registryHits.length;
    assert.ok(firstHits > 0, "the first sync scans the registry");
    await syncModelsOnce(ctx);
    assert.ok(registryHits.length > firstHits, "the second sync scans the registry for the new id");
    const beta = writes.at(-1).patch.providers["opencode-go"].models.find((model) => model.id === "beta");
    assert.equal(beta.contextWindow, 100, "the new model is enriched despite the otherwise fresh cache");
  } finally {
    fetchStub.restore();
  }
});
test("fetchLiveModelList: a host-root base URL retries {base}/v1/models after a 404", async () => {
  // A real codex gateway answers 404 on /models and 401 on /v1/models: the
  // listing lives one segment deeper than the configured base URL.
  const fetchStub = stubFetch((url) => (url.endsWith("/v1/models")
    ? listingResponse(["gpt-6-astra", "gpt-6-sol"])
    : new Response("not found", { status: 404 })));
  try {
    const ids = await fetchLiveModelList("https://gateway.test", "sk-test", undefined, 5);
    assert.deepEqual(ids, ["gpt-6-astra", "gpt-6-sol"]);
    assert.deepEqual(fetchStub.urls, ["https://gateway.test/models", "https://gateway.test/v1/models"]);
  } finally {
    fetchStub.restore();
  }
});

test("fetchLiveModelList: the fallback's credential refusal beats the original 404", async () => {
  const fetchStub = stubFetch((url) => (url.endsWith("/v1/models")
    ? new Response('{"error":"Invalid API key"}', { status: 401 })
    : new Response("not found", { status: 404 })));
  try {
    await assert.rejects(
      () => fetchLiveModelList("https://gateway.test/v2", "sk-bad", undefined, 5),
      (error) => error.code === "invalid-credentials",
    );
    assert.deepEqual(fetchStub.urls, ["https://gateway.test/v2/models", "https://gateway.test/v2/v1/models"]);
  } finally {
    fetchStub.restore();
  }
});

test("fetchLiveModelList: a /v1 base URL is never retried twice", async () => {
  const fetchStub = stubFetch(() => new Response("not found", { status: 404 }));
  try {
    await assert.rejects(
      () => fetchLiveModelList("https://gateway.test/v1", "sk-test", undefined, 5),
      (error) => error.code === "api-error",
    );
    assert.deepEqual(fetchStub.urls, ["https://gateway.test/v1/models"]);
  } finally {
    fetchStub.restore();
  }
});

test("fetchLiveModelList: an oversized streamed listing is refused without waiting for the whole body", async () => {  const chunk = new Uint8Array(1024 * 1024);
  const body = new ReadableStream({
    start(controller) {
      for (let index = 0; index < 5; index += 1) controller.enqueue(chunk);
      controller.close();
    },
  });
  const fetchStub = stubFetch(() => new Response(body, { status: 200 }));
  try {
    await assert.rejects(
      () => fetchLiveModelList("https://example.test/v1", "sk-test", undefined, 5),
      (error) => error.code === "parse-failed",
    );
  } finally {
    fetchStub.restore();
  }
});

// ── route failure reporting ─────────────────────────────────────────────────

test("knownRouteModels: an unregistered route is an error, not an empty list", async () => {
  // The card renders candidates from this payload. Reporting `ok: true, count:
  // 0` for a route that does not exist showed an unexplained empty picker while
  // the real problem (a mistyped modelsRouteKey) stayed invisible.
  const { ctx } = makeCtx(BASE_CONFIG, {
    providers: [{ id: "some-other-route" }],
    listModelsThrows: true,
  });
  const payload = await knownRouteModels(ctx);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "no-route");
  assert.match(payload.error.message, /opencode-go/);
});

test("knownRouteModels: a disabled optimization is reported as such", async () => {
  const { ctx } = makeCtx({ ...BASE_CONFIG, optimizations: { modelCapability: false } });
  const payload = await knownRouteModels(ctx);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "disabled");
});

test("knownRouteModels: a route that cannot list still serves its stored rows", async () => {
  const { ctx } = makeCtx(BASE_CONFIG, { stored: [{ id: "stored-a" }], listModelsThrows: true });
  const payload = await knownRouteModels(ctx);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.models.map((model) => model.id), ["stored-a"]);
});

test("knownRouteModels: non-finite capacities never reach the picker", async () => {
  const { ctx } = makeCtx(BASE_CONFIG, {
    stored: [{ id: "nan", contextWindow: Number.NaN, maxTokens: Number.POSITIVE_INFINITY }],
  });
  const payload = await knownRouteModels(ctx);
  assert.deepEqual(payload.models, [{ id: "nan" }]);
});

// ── sync reporting ──────────────────────────────────────────────────────────

test("syncModelsOnce: added/removed describe the route, not the endpoint listing", async (t) => {
  resetModelSyncCaches();
  const fetchStub = stubFetch(() => listingResponse(["a"]));
  t.after(() => fetchStub.restore());
  // The route stores a, b, c; the endpoint now serves only a. The merge is
  // deliberately additive, so nothing is dropped — and the payload must say so
  // instead of claiming b and c were removed while writing them back.
  const { ctx, writes } = makeCtx(BASE_CONFIG, { stored: [{ id: "a" }, { id: "b" }, { id: "c" }] });
  const payload = await syncModelsOnce(ctx);
  assert.equal(payload.ok, true);
  const written = writes.at(-1).patch.providers["opencode-go"].models.map((model) => model.id);
  assert.deepEqual(written, ["a", "b", "c"], "catalog-only ids survive the merge");
  assert.deepEqual(payload.removed, [], "nothing left the route, so nothing may claim to have");
  assert.deepEqual(payload.added, []);
  assert.deepEqual(payload.endpointMissing, ["b", "c"], "the retired ids are named explicitly instead");
});

test("syncModelsOnce: a newly listed model is reported as added", async (t) => {
  resetModelSyncCaches();
  const fetchStub = stubFetch(() => listingResponse(["a", "b"]));
  t.after(() => fetchStub.restore());
  const { ctx } = makeCtx(BASE_CONFIG, { stored: [{ id: "a" }] });
  const payload = await syncModelsOnce(ctx);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.added, ["b"]);
  assert.deepEqual(payload.removed, []);
  assert.equal("endpointMissing" in payload, false, "nothing was missing from the endpoint");
});

test("syncModelsOnce: a write conflict re-reads and rebuilds instead of reverting", async (t) => {
  resetModelSyncCaches();
  const fetchStub = stubFetch(() => listingResponse(["a", "b"]));
  t.after(() => fetchStub.restore());
  // First write hits a stale revision; the retry must succeed on fresh rows.
  let attempts = 0;
  const conflict = Object.assign(new Error("settings namespace changed since it was read"), {
    name: "SettingsConflictError",
  });
  const { ctx, writes } = makeCtx(BASE_CONFIG, {
    stored: [{ id: "a" }],
    updateThrows: undefined,
  });
  const realUpdate = ctx.settings.update;
  ctx.settings.update = async (ns, patch, revision) => {
    attempts += 1;
    if (attempts === 1) throw conflict;
    // The revision read for the retry must come from a fresh describe().
    assert.equal(revision, 7, "the retry writes under the revision it just read");
    return realUpdate(ns, patch, revision);
  };
  const payload = await syncModelsOnce(ctx);
  assert.equal(payload.ok, true, "the retry succeeds");
  assert.equal(attempts, 2, "exactly one retry");
  assert.deepEqual(writes.at(-1).patch.providers["opencode-go"].models.map((model) => model.id), ["a", "b"]);
});
