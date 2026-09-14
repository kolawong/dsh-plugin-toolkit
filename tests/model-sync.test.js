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
function makeCtx(config, { stored = [], donors = [], routeModels = [], describe, toolkitValue } = {}) {
  const writes = [];
  const descriptor = {
    ns: LLM_PI_AI_NS,
    user: { providers: { "opencode-go": { models: stored } } },
  };
  const resolvedToolkit = toolkitValue ?? { modelsMigratedFromQuotaBadges: true };
  const ctx = {
    logger: { info() {}, warn() {} },
    config: () => modelConfig(config),
    settings: {
      get: (ns) => (ns === "toolkit" ? resolvedToolkit : undefined),
      describe: () => (describe !== undefined ? describe : [descriptor]),
      update: async (ns, patch) => { writes.push({ ns, patch }); },
    },
    llm: {
      discoveries: new Map(),
      listProviders: () => [{ id: "opencode-go" }, { id: "deepseek" }],
      // The route's own listing versus another provider's (donor) catalog.
      listModels: async (id) => (id === "deepseek" ? donors : routeModels),
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
test("fetchLiveModelList: an oversized streamed listing is refused without waiting for the whole body", async () => {
  const chunk = new Uint8Array(1024 * 1024);
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
