/**
 * dsh-plugin-toolkit — modelCapability server core.
 *
 * Moved out of dsh-plugin-quota-badges, where it backed that plugin's
 * 「模型能力」 section. It keeps one llm-pi-ai route's model list current
 * against a live OpenAI-compatible endpoint:
 *
 *  1. The route's wire protocol is pre-set, so catalog-unknown models are
 *     serviceable from the very first request.
 *  2. The llm runtime's registered model discovery is wrapped: the GUI's
 *     "fetch available models" action answers with the live listing merged
 *     over the installed catalog instead of the catalog alone.
 *  3. POST <modelsSyncPath> performs one explicit sync — probe the live
 *     listing, merge it over the route's stored models, fill missing
 *     capacities from the models.dev registry and from sized siblings, borrow
 *     image input from any other registered provider that declares the same id
 *     multimodal, then persist the union into the llm-pi-ai user layer.
 *  4. Explicit user overrides (forced vision / forced text-only) always win.
 *
 * Everything happens in-process except the live probe and the registry reads;
 * the write goes through llm-pi-ai's own schema. No dsh source is touched.
 *
 * @license MIT
 */

import {
  extractModelIds,
  mergeModelLists,
  diffModelIds,
  MAX_LISTING_BYTES,
  parseModelToml,
  applyMetadata,
  collectModelMetadata,
  fillFromSiblings,
  applyCatalogModalities,
  applyVisionOverride,
} from "./models-core.js";

/** Settings namespace owned by the llm-pi-ai adapter plugin. */
export const LLM_PI_AI_NS = "llm-pi-ai";

/** The toolkit's own settings namespace (where the adopted settings land). */
export const TOOLKIT_NS = "toolkit";

/** Namespace the model-capability settings lived in before the move. */
const LEGACY_NS = "quota-badges";
/** How long the one-time legacy adoption waits for that namespace to register. */
const LEGACY_WAIT_ATTEMPTS = 20;
const LEGACY_WAIT_MS = 500;

// ── configuration ───────────────────────────────────────────────────────────

/**
 * The modelCapability slice of the merged toolkit config, with every default
 * applied. `installModelCapability` hands this shape to the ported logic, so
 * the functions below never read raw toolkit config keys.
 * @param {Record<string, unknown>} config - merged toolkit configuration.
 * @returns {object} the model-capability configuration.
 */
export function modelConfig(config) {
  const src = config ?? {};
  const timeout = src.modelsTimeoutSec;
  return {
    /** Master switch: the optimization toggle on the settings card. */
    enabled: src.optimizations?.modelCapability !== false,
    /** Explicit API key; empty falls back to the apiKeyEnvVar environment variable. */
    apiKey: typeof src.modelsApiKey === "string" ? src.modelsApiKey : "",
    /** Environment variable consulted when apiKey is empty. */
    apiKeyEnvVar: typeof src.modelsApiKeyEnvVar === "string" && src.modelsApiKeyEnvVar !== ""
      ? src.modelsApiKeyEnvVar
      : "OPENCODE_API_KEY",
    /** The llm-pi-ai provider route whose model list this plugin keeps current. */
    routeKey: typeof src.modelsRouteKey === "string" && src.modelsRouteKey !== "" ? src.modelsRouteKey : "opencode-go",
    /** Endpoint probed for the live model listing. */
    baseURL: typeof src.modelsBaseURL === "string" && src.modelsBaseURL !== ""
      ? src.modelsBaseURL
      : "https://opencode.ai/zen/go/v1",
    /** Wire protocol written onto the route so catalog-unknown models are serviceable. */
    routeApi: typeof src.modelsRouteApi === "string" && src.modelsRouteApi !== ""
      ? src.modelsRouteApi
      : "openai-completions",
    /** Same-origin route forcing one model-list sync (POST). */
    syncPath: typeof src.modelsSyncPath === "string" && src.modelsSyncPath !== ""
      ? src.modelsSyncPath
      : "/api/toolkit/sync-models",
    /** Same-origin route listing the route's known models for the picker (GET). */
    modelsPath: typeof src.modelsPath === "string" && src.modelsPath !== ""
      ? src.modelsPath
      : "/api/toolkit/models",
    /** Fill missing capacities/modalities for new models from the models.dev registry. */
    enrichFromRegistry: src.modelsEnrichFromRegistry !== false,
    /** This endpoint's provider directory inside the models.dev registry. */
    registryProvider: typeof src.modelsRegistryProvider === "string" && src.modelsRegistryProvider !== ""
      ? src.modelsRegistryProvider
      : "opencode-go",
    /** Model ids to force vision-capable, overriding any auto-detection. */
    vision: Array.isArray(src.modelsVision) ? src.modelsVision : [],
    /** Model ids to force text-only (image stripped), overriding auto-detection. */
    textOnly: Array.isArray(src.modelsTextOnly) ? src.modelsTextOnly : [],
    /** One-time marker: the former quota-badges model settings were adopted. */
    migratedFromLegacy: src.modelsMigratedFromQuotaBadges === true,
    /** Per-request upstream timeout in seconds. */
    timeoutSec: typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0 ? timeout : 10,
  };
}

/** Resolve the Bearer key: explicit config wins, then the configured env var. */
function resolveApiKey(config) {
  const explicit = String(config.apiKey ?? "").trim();
  if (explicit !== "") return explicit;
  const fromEnv = process.env[config.apiKeyEnvVar];
  return typeof fromEnv === "string" ? fromEnv.trim() : "";
}

// ── errors ──────────────────────────────────────────────────────────────────

/** One classified model-sync failure; `code` is the machine-readable class. */
export class ModelSyncError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ModelSyncError";
    this.code = code;
  }
}

// ── upstream access ─────────────────────────────────────────────────────────

/** Fetch helper with an optional Bearer auth, JSON accept, and a timeout. */
async function upstreamFetch(url, apiKey, signal, timeoutMs, timeoutSec) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("timeout")),
    typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : (timeoutSec ?? 10) * 1000,
  );
  // A pending timeout must never hold the event loop open on its own.
  timer.unref?.();
  // An external signal aborts through the internal controller as well.
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(url, {
      method: "GET",
      headers: {
        // An empty key means an unauthenticated call (the models.dev registry).
        ...(apiKey === "" ? {} : { Authorization: "Bearer " + apiKey }),
        Accept: "application/json, text/plain;q=0.9",
        "User-Agent": "dsh-plugin-toolkit",
      },
      signal: controller.signal,
      redirect: "error",
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Read a reply body, refusing one that outgrows MAX_LISTING_BYTES. The body is
 * consumed as a stream so the bound holds on bytes actually read, not just on a
 * declared Content-Length the URL's owner may omit.
 */
async function readBounded(response) {
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > MAX_LISTING_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new ModelSyncError("parse-failed", "model listing exceeds " + MAX_LISTING_BYTES + " bytes");
  }
  const body = response.body;
  if (body === null || body === undefined) return "";
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > MAX_LISTING_BYTES) {
        throw new ModelSyncError("parse-failed", "model listing exceeds " + MAX_LISTING_BYTES + " bytes");
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock?.();
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buffer);
}

/** Pull a human-readable message out of an error body (JSON fields or title tag). */
function extractServerErrorMessage(text) {
  try {
    const object = JSON.parse(text);
    for (const key of ["message", "error", "detail"]) {
      const value = object?.[key];
      if (typeof value === "string" && value !== "") return value;
      if (typeof value?.message === "string" && value.message !== "") return value.message;
    }
  } catch {
    // fall through to the title scan below
  }
  const match = /<title>([^<]+)<\/title>/i.exec(text);
  return match ? match[1].trim() : undefined;
}

/**
 * Probe one OpenAI-compatible listing endpoint and extract its model ids.
 * @returns {Promise<string[]>} unique ids in endpoint order.
 * @throws {ModelSyncError} classified as invalid-credentials | api-error |
 *   parse-failed | network-error.
 */
export async function fetchLiveModelList(baseURL, apiKey, signal, timeoutSec) {
  if (apiKey === "") {
    throw new ModelSyncError("invalid-credentials", "OpenCode API key is missing, invalid, or expired");
  }
  const url = baseURL.replace(/\/+$/, "") + "/models";
  let response;
  try {
    response = await upstreamFetch(url, apiKey, signal, undefined, timeoutSec);
  } catch (error) {
    throw new ModelSyncError("network-error", "OpenCode network error: " + (error?.message ?? String(error)));
  }
  if (response.status === 401 || response.status === 403) {
    throw new ModelSyncError("invalid-credentials", "OpenCode API key is missing, invalid, or expired");
  }
  let text;
  try {
    text = await readBounded(response);
  } catch (error) {
    if (error instanceof ModelSyncError) throw error;
    throw new ModelSyncError("network-error", "OpenCode network error: " + (error?.message ?? String(error)));
  }
  if (!response.ok) {
    throw new ModelSyncError(
      "api-error",
      "OpenCode API error (HTTP " + response.status + "): " + (extractServerErrorMessage(text) ?? ""),
    );
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ModelSyncError("parse-failed", "model listing did not answer with JSON");
  }
  const ids = extractModelIds(body);
  if (ids === null) throw new ModelSyncError("parse-failed", 'model listing has no "data" array');
  return ids;
}

// ── models.dev metadata ─────────────────────────────────────────────────────

/** models.dev registry mirrors, tried in order: a CDN first, raw fallback. */
const REGISTRY_SOURCES = [
  "https://cdn.jsdelivr.net/gh/sst/models.dev@dev/providers/",
  "https://raw.githubusercontent.com/sst/models.dev/dev/providers/",
];
/** Concurrent registry fetches; small enough to stay under CDN abuse limits. */
const REGISTRY_CONCURRENCY = 5;
/** How long a non-empty registry answer stays fresh. */
const REGISTRY_CACHE_MS = 6 * 60 * 60 * 1000;
/** How long an empty (every source failed) answer stays fresh before a retry. */
const REGISTRY_EMPTY_TTL_MS = 60 * 1000;
/** Per-request timeout for the tiny registry TOML files. */
const REGISTRY_TIMEOUT_MS = 4000;
/** In-flight registry scans by provider; deduplicates concurrent callers. */
const registryInflight = new Map();
/** Latest registry scan per provider: when it ran and the metadata it produced. */
let registryCache = { provider: "", at: 0, meta: new Map() };

/** Fetch and parse one registry TOML across the source mirrors; null on total failure. */
async function fetchRegistryToml(provider, id) {
  for (const source of REGISTRY_SOURCES) {
    try {
      const response = await upstreamFetch(source + provider + "/models/" + id + ".toml", "", undefined, REGISTRY_TIMEOUT_MS);
      if (response.ok) return parseModelToml(await response.text());
      // A 404 is the registry saying "no such model"; the mirrors serve one
      // repository, so asking the next one would only burn its timeout on
      // ids that are simply absent. Only a transport failure (timeout, 5xx)
      // falls through to the next mirror.
      if (response.status === 404) return null;
    } catch {
      // Try the next mirror; a dead source must not fail the whole listing.
    }
  }
  return null;
}

/**
 * Capacities and modalities for the given ids from the models.dev registry
 * (the endpoint vendor's own model database), via collectModelMetadata: alias
 * chains resolve toward their canonical files, ids the registry does not
 * describe stay absent from the answer, and individual failures never fail the
 * call. A non-empty answer caches for six hours, an empty one (every source
 * down) for one minute, and one in-flight scan per provider serves every
 * concurrent caller. Cached entries are reused per id, so a newly listed id is
 * still scanned while the rest of the answer stays fresh.
 * @param {string[]} ids - live model ids to describe.
 * @param {string} provider - the registry provider directory holding the ids.
 */
async function fetchModelMetadata(ids, provider) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string" && id !== ""))];
  const sameProvider = registryCache.provider === provider;
  const cacheFresh = sameProvider
    && registryCache.at + (registryCache.meta.size > 0 ? REGISTRY_CACHE_MS : REGISTRY_EMPTY_TTL_MS) > Date.now();
  // Reuse the cached scan only when it already describes EVERY requested id; a
  // newly listed model must still reach the registry instead of inheriting a
  // stale "everything is fresh" answer for up to six hours.
  if (cacheFresh && wanted.every((id) => registryCache.meta.has(id))) return registryCache.meta;
  const missing = cacheFresh ? wanted.filter((id) => !registryCache.meta.has(id)) : wanted;
  if (missing.length === 0) return registryCache.meta;
  const inflight = registryInflight.get(provider);
  if (inflight !== undefined) return inflight;
  const scan = collectModelMetadata(missing, provider, fetchRegistryToml, {
    concurrency: REGISTRY_CONCURRENCY,
  })
    .catch(() => new Map())
    .then((scanned) => {
      const base = registryCache.provider === provider ? registryCache.meta : new Map();
      const meta = new Map([...base, ...scanned]);
      registryCache = { provider, at: Date.now(), meta };
      return meta;
    })
    .finally(() => {
      registryInflight.delete(provider);
    });
  registryInflight.set(provider, scan);
  return scan;
}

/** Cross-provider model info cache (in-process reads, refreshed once a minute). */
let donorCache = { at: 0, models: [] };

/**
 * Every model every registered provider route serves, for exact-id modality
 * borrowing: when another provider in this process (e.g. the official
 * DeepSeek route) declares a model multimodal, that is authoritative for the
 * same id here. Reads are in-process service calls, never network.
 * @returns {Promise<Array<{id: string, inputModalities?: string[]}>>}
 */
async function crossProviderModels(llm) {
  if (donorCache.at + 60 * 1000 > Date.now()) return donorCache.models;
  const models = [];
  try {
    for (const provider of llm.listProviders()) {
      try {
        models.push(...(await llm.listModels(provider.id)));
      } catch {
        // One route failing to list never blocks the rest.
      }
    }
  } catch {
    // Runtime absent or moved: no donors, entries stay text-only.
  }
  donorCache = { at: Date.now(), models };
  return models;
}

// ── startup healing ─────────────────────────────────────────────────────────

/** Sleep that never keeps the process alive on its own. */
function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * Wait briefly for the llm-pi-ai settings namespace to register and return its
 * descriptor. The route-api pre-write and the saved-modality healing share this
 * one wait instead of each polling the same namespace.
 * @param {object} settings - the settings service (or undefined).
 * @param {number} [attempts] - how many polls before giving up.
 * @param {number} [intervalMs] - delay between polls.
 * @returns {Promise<object | undefined>} the llm-pi-ai descriptor, or undefined.
 */
async function awaitLlmPiAi(settings, attempts = 30, intervalMs = 1000) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let descriptor;
    try {
      descriptor = settings?.describe?.()?.find((entry) => entry?.ns === LLM_PI_AI_NS);
    } catch {
      return undefined;
    }
    if (descriptor !== undefined) return descriptor;
    await delay(intervalMs);
  }
  return undefined;
}

/**
 * Pre-write the route's wire protocol into the llm-pi-ai user layer so that
 * ANY configuration-surface save of an adopted model listing passes
 * serviceability — not only this plugin's sync route (the GUI's own save path
 * sends no api field of its own). Idempotent: skips once the value matches,
 * and waits briefly for the namespace when this plugin starts before it.
 */
export async function ensureRouteApi(ctx) {
  const { logger } = ctx;
  const config = ctx.config();
  if (!config.enabled) return;
  const settings = ctx.settings;
  if (await awaitLlmPiAi(settings) === undefined) {
    logger?.warn?.("[toolkit] llm-pi-ai settings never registered; route api was not pre-set");
    return;
  }
  const resolved = settings?.get?.(LLM_PI_AI_NS);
  if (resolved?.providers?.[config.routeKey]?.api !== undefined) return;
  try {
    await settings.update(LLM_PI_AI_NS, {
      providers: { [config.routeKey]: { api: config.routeApi } },
    });
    logger?.info?.(
      "[toolkit] route '" + config.routeKey + "' wire protocol set to " + config.routeApi,
    );
  } catch (error) {
    logger?.warn?.("[toolkit] could not pre-set the route api:", error?.message ?? String(error));
  }
}

/** In-flight guard: a settings change can fire the healing repeatedly. */
let modalitiesInflight = null;

/**
 * Grant image input to already-saved route models whose id another registered
 * provider declares multimodal, and apply the user's forced vision / text-only
 * overrides. The configuration surface's own save path sends no per-model
 * input field, so an adopted listing loses image support until the next sync;
 * this heals it at startup (and on every settings change), before the user's
 * first attachment can be refused. Reads the raw user section through
 * settings.describe(), patches only entries gaining something, and never
 * removes any field except the overrides' own `input`. Single-flight: a burst
 * of settings changes runs one pass.
 * @returns {Promise<void>} completion of the healing pass.
 */
export function ensureModalities(ctx) {
  if (modalitiesInflight !== null) return modalitiesInflight;
  modalitiesInflight = healModalities(ctx).finally(() => {
    modalitiesInflight = null;
  });
  return modalitiesInflight;
}

/** The actual healing pass; called single-flight through ensureModalities. */
async function healModalities(ctx) {
  const { logger } = ctx;
  const config = ctx.config();
  if (!config.enabled) return;
  const settings = ctx.settings;
  const descriptor = await awaitLlmPiAi(settings);
  if (descriptor === undefined) {
    logger?.warn?.("[toolkit] llm-pi-ai settings never registered; saved modalities were not healed");
    return;
  }
  const rawModels = descriptor?.user?.providers?.[config.routeKey]?.models;
  if (!Array.isArray(rawModels) || rawModels.length === 0) return;
  const granted = applyCatalogModalities(rawModels, await crossProviderModels(ctx.llm));
  const override = applyVisionOverride(rawModels, config.vision, config.textOnly);
  if (granted === 0 && override.granted === 0 && override.stripped === 0) return;
  try {
    await settings.update(LLM_PI_AI_NS, {
      providers: { [config.routeKey]: { models: rawModels } },
    });
    logger?.info?.(
      "[toolkit] saved " + config.routeKey + " model modalities: granted " + granted
      + ", forced vision " + override.granted + ", forced text-only " + override.stripped,
    );
  } catch (error) {
    logger?.warn?.("[toolkit] could not heal saved model modalities:", error?.message ?? String(error));
  }
}

/**
 * Adopt the model settings that used to live in the quota-badges namespace:
 * the OpenCode API key and the forced vision / text-only lists (plus the route
 * shape when it was customized). One-way and one-time — the migration marker
 * lands in the same write, so clearing the key afterwards is never re-filled.
 *
 * Both settings namespaces register asynchronously, so this waits briefly for
 * the toolkit's own resolved section (the marker's home — reading the
 * composition layer instead would re-adopt on every start) and for the legacy
 * descriptor. A host that never registers the legacy namespace marks itself
 * migrated too, so the wait happens once; a read-only document retries next
 * start.
 */
export async function migrateLegacyModelSettings(ctx) {
  const settings = ctx.settings;
  if (!settings?.describe || !settings?.update || typeof settings.get !== "function") return;
  let toolkitSection;
  let descriptor;
  for (let attempt = 0; attempt < LEGACY_WAIT_ATTEMPTS; attempt++) {
    toolkitSection = settings.get(TOOLKIT_NS);
    // The marker is authoritative as soon as the namespace resolves: later
    // boots return without waiting for the legacy plugin at all.
    if (toolkitSection?.modelsMigratedFromQuotaBadges === true) return;
    try {
      descriptor = settings.describe()?.find((entry) => entry?.ns === LEGACY_NS);
    } catch {
      return;
    }
    if (toolkitSection !== undefined && descriptor !== undefined) break;
    await delay(LEGACY_WAIT_MS);
  }
  if (toolkitSection === undefined) return;
  const config = modelConfig(toolkitSection);
  if (config.migratedFromLegacy) return;
  const legacy = descriptor?.user;
  const patch = { modelsMigratedFromQuotaBadges: true };
  if (legacy !== null && typeof legacy === "object") {
    const key = typeof legacy.apiKey === "string" ? legacy.apiKey.trim() : "";
    if (String(config.apiKey ?? "").trim() === "" && key !== "") patch.modelsApiKey = key;
    if (config.vision.length === 0 && Array.isArray(legacy.modelsVision) && legacy.modelsVision.length > 0) {
      patch.modelsVision = legacy.modelsVision;
    }
    if (config.textOnly.length === 0 && Array.isArray(legacy.modelsTextOnly) && legacy.modelsTextOnly.length > 0) {
      patch.modelsTextOnly = legacy.modelsTextOnly;
    }
    // Route shape: only adopted while the toolkit still carries the defaults,
    // so a deliberate toolkit-side choice is never overwritten.
    if (config.routeKey === "opencode-go" && typeof legacy.modelsRouteKey === "string" && legacy.modelsRouteKey !== "") {
      patch.modelsRouteKey = legacy.modelsRouteKey;
    }
    if (
      config.baseURL === "https://opencode.ai/zen/go/v1"
      && typeof legacy.modelsBaseURL === "string"
      && legacy.modelsBaseURL !== ""
    ) {
      patch.modelsBaseURL = legacy.modelsBaseURL;
    }
    if (
      config.routeApi === "openai-completions"
      && typeof legacy.modelsRouteApi === "string"
      && legacy.modelsRouteApi !== ""
    ) {
      patch.modelsRouteApi = legacy.modelsRouteApi;
    }
  }
  try {
    await settings.update(TOOLKIT_NS, patch);
    const adopted = Object.keys(patch).filter((name) => name !== "modelsMigratedFromQuotaBadges");
    if (adopted.length > 0) {
      ctx.logger?.info?.("[toolkit] adopted the former quota-badges model settings: " + adopted.join(", "));
    }
  } catch (error) {
    ctx.logger?.warn?.("[toolkit] could not adopt the legacy model settings:", error?.message ?? String(error));
  }
}

// ── sync ────────────────────────────────────────────────────────────────────

/**
 * The route's stored model entries, read straight from the llm-pi-ai user
 * layer. Unlike llm.listModels() — whose LlmModelInfo shape carries only
 * id/name/inputModalities — the raw user section keeps every hand-tuned field
 * (contextWindow, maxTokens, input), so the sync merge can preserve the rows
 * the user already corrected instead of silently rewriting them.
 * @returns {Promise<Array<Record<string, unknown>>>} raw stored entries.
 */
async function storedRouteModels(ctx, routeKey) {
  const { settings, llm } = ctx;
  const usable = (models) =>
    (Array.isArray(models) ? models : []).filter(
      (model) => model !== null && typeof model === "object" && typeof model.id === "string" && model.id !== "",
    );
  try {
    const descriptor = settings?.describe?.()?.find((entry) => entry?.ns === LLM_PI_AI_NS);
    const raw = usable(descriptor?.user?.providers?.[routeKey]?.models);
    if (raw.length > 0) return raw;
  } catch {
    // Fall through to the runtime view.
  }
  try {
    return usable(await llm?.listModels?.(routeKey));
  } catch {
    // Route not registered (or the runtime moved): nothing stored yet.
    return [];
  }
}

/**
 * The model ids the settings-card picker may offer for this route: the stored
 * llm-pi-ai rows (which keep hand-tuned capacities) unioned with the runtime's
 * own view, deduped by id and sorted for a stable list. In-process reads only —
 * the GET route never probes the network, so opening the modal stays instant
 * even when the endpoint is down.
 * @param {object} ctx - the model-capability context.
 * @returns {Promise<object>} `{ ok, routeKey, count, models, forcedVision, forcedTextOnly }`.
 */
export async function knownRouteModels(ctx) {
  const config = ctx.config();
  const byId = new Map();
  const remember = (model) => {
    if (model === null || typeof model !== "object") return;
    const id = typeof model.id === "string" ? model.id : "";
    if (id === "" || byId.has(id)) return;
    const entry = { id };
    if (typeof model.name === "string" && model.name !== "") entry.name = model.name;
    if (typeof model.contextWindow === "number") entry.contextWindow = model.contextWindow;
    if (typeof model.maxTokens === "number") entry.maxTokens = model.maxTokens;
    const modalities = Array.isArray(model.input)
      ? model.input
      : (Array.isArray(model.inputModalities) ? model.inputModalities : undefined);
    if (modalities !== undefined) {
      const input = modalities.filter((value) => typeof value === "string");
      if (input.length > 0) entry.input = input;
    }
    byId.set(id, entry);
  };
  // Stored user-layer rows lead: they keep capacities the runtime view drops.
  for (const model of await storedRouteModels(ctx, config.routeKey)) remember(model);
  try {
    for (const model of (await ctx.llm?.listModels?.(config.routeKey)) ?? []) remember(model);
  } catch {
    // A route that cannot list still offers its stored rows.
  }
  const models = [...byId.values()].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return {
    ok: true,
    routeKey: config.routeKey,
    count: models.length,
    models,
    forcedVision: config.vision,
    forcedTextOnly: config.textOnly,
  };
}

/**
 * One sync cycle: probe the live listing, merge it over the route's current
 * models, and persist the union into the llm-pi-ai user layer. The merge base
 * is deliberately richer than the runtime's listModels view: stored user-layer
 * entries (hand-tuned capacities, modalities) pass through verbatim and win
 * per id, while the enrichment-wrapped discovery answer donates capacities for
 * ids the installed catalog already describes. The registry fills whatever is
 * still missing. The write goes through llm-pi-ai's own schema validation, and
 * the adapter re-resolves profiles per request, so new models are selectable
 * immediately.
 * @returns {Promise<object>} a JSON payload describing the outcome.
 */
export async function syncModelsOnce(ctx) {
  const { logger, settings, llm } = ctx;
  const config = ctx.config();
  if (!config.enabled) {
    return { ok: false, error: { code: "disabled", message: "model sync is disabled in plugin settings" } };
  }
  if (!settings || typeof settings.update !== "function") {
    return { ok: false, error: { code: "no-settings", message: "settings seam is unavailable" } };
  }
  const apiKey = resolveApiKey(config);
  if (apiKey === "") {
    return {
      ok: false,
      error: {
        code: "unconfigured",
        message: "No API key: set the OpenCode key on the 模型能力 card or export " + config.apiKeyEnvVar,
      },
    };
  }
  let live;
  let donors = [];
  // Prefer the enrichment-wrapped discovery answer: it already probed the
  // live endpoint (its liveProbedAt tag proves the probe did not fall back)
  // and carries catalog capacities the plain listModels view lacks. When the
  // enrichment is absent or its probe failed, fall back to probing here.
  const discover = llm?.discoveries?.get?.(LLM_PI_AI_NS);
  if (typeof discover === "function" && discover.enrichedByToolkit === true) {
    try {
      const answer = await discover({
        provider: config.routeKey,
        api: config.routeApi,
        baseURL: config.baseURL,
      });
      if (Array.isArray(answer) && answer.length > 0) {
        donors = answer;
        if (answer.liveProbedAt !== undefined) {
          live = answer.map((model) => model?.id).filter((id) => typeof id === "string" && id !== "");
        }
      }
    } catch (error) {
      logger?.warn?.("[toolkit] discovery-based sync failed; probing the endpoint directly:", error?.message ?? String(error));
    }
  }
  if (live === undefined) {
    try {
      live = await fetchLiveModelList(config.baseURL, apiKey, undefined, config.timeoutSec);
    } catch (error) {
      return { ok: false, error: { code: error?.code ?? "network-error", message: error?.message ?? String(error) } };
    }
  }
  // Merge base: stored raw entries first (hand edits win per id), then
  // discovery candidates for ids nothing stored describes.
  const stored = await storedRouteModels(ctx, config.routeKey);
  const catalog = [...stored];
  const seen = new Set(stored.map((model) => model.id));
  for (const donor of donors) {
    if (donor !== null && typeof donor === "object" && typeof donor.id === "string" && donor.id !== "" && !seen.has(donor.id)) {
      seen.add(donor.id);
      catalog.push(donor);
    }
  }
  const merged = mergeModelLists({ catalog, live });
  if (config.enrichFromRegistry) {
    try {
      applyMetadata(merged, await fetchModelMetadata(live, config.registryProvider));
    } catch {
      // Metadata is a bonus; the bare listing stays serviceable.
    }
  }
  // A sync is explicit, so it also fills unsized ids from their closest sized
  // sibling in the route's own catalog before persisting, and grants image
  // input wherever another registered provider declares the same id
  // multimodal (the official DeepSeek route does, for the vision models).
  fillFromSiblings(merged, catalog);
  const grantedVision = applyCatalogModalities(merged, await crossProviderModels(llm));
  // Explicit user overrides win over every automatic rule.
  const override = applyVisionOverride(merged, config.vision, config.textOnly);
  try {
    await settings.update(LLM_PI_AI_NS, {
      providers: { [config.routeKey]: { api: config.routeApi, models: merged } },
    });
  } catch (error) {
    return {
      ok: false,
      error: { code: "settings-write-failed", message: error?.message ?? String(error) },
    };
  }
  const diff = diffModelIds(
    stored.map((model) => model.id),
    live,
  );
  return {
    ok: true,
    routeKey: config.routeKey,
    total: merged.length,
    added: diff.added,
    removed: diff.removed,
    ...grantedVision > 0 ? { grantedImageInput: grantedVision } : {},
    ...override.granted > 0 ? { forcedVision: override.granted } : {},
    ...override.stripped > 0 ? { forcedTextOnly: override.stripped } : {},
    syncedAt: new Date().toISOString(),
  };
}

// ── discovery enrichment ────────────────────────────────────────────────────

/**
 * Wrap the llm runtime's registered llm-pi-ai discovery so the "fetch
 * available models" action returns the live endpoint listing merged over the
 * catalog answer. Best-effort by design: the registration is private state, so
 * absence disables the enrichment (with a warning) instead of breaking either
 * plugin; disposal restores the original function. Registers its own
 * ctx.effect, like the original server half.
 */
export function installDiscoveryEnrichment(ctx) {
  // Only stable values are destructured here. `llm` is read through ctx on
  // every attempt instead, so a retry loop can never poll a dead reference
  // (the picker's "fetch available models" silently degrading to
  // catalog-only). Reading lazily makes each retry see the live handle.
  const { logger, config, effect } = ctx;
  let timer = null;
  let disposed = false;
  let original = null;
  let wrapped = null;

  const install = () => {
    if (disposed || wrapped !== null) return true;
    const llm = ctx.llm;
    const map = llm?.discoveries;
    if (!(map instanceof Map)) return false;
    const inner = map.get(LLM_PI_AI_NS);
    if (typeof inner !== "function") return false;
    wrapped = async (request) => {
      const base = await inner(request);
      const current = config();
      if (!current.enabled || request?.provider !== current.routeKey) return base;
      try {
        const draftKey = typeof request.apiKey === "string" ? request.apiKey.trim() : "";
        const baseURL =
          typeof request.baseURL === "string" && request.baseURL !== ""
            ? request.baseURL
            : current.baseURL;
        const live = await fetchLiveModelList(
          baseURL,
          draftKey !== "" ? draftKey : resolveApiKey(current),
          request.signal,
          current.timeoutSec,
        );
        const merged = mergeModelLists({ catalog: base, live });
        // Tag the answer as one that truly reflects the live endpoint. The
        // model-sync route consults this marker: a fallback answer (the catch
        // below returns the bare catalog) must not be mistaken for a live
        // listing, or a transient probe failure would shrink the stored route
        // down to catalog-only ids.
        merged.liveProbedAt = Date.now();
        if (current.enrichFromRegistry) {
          // Metadata is a bonus: never let it hold the fetch answer for more
          // than three seconds. A slow scan keeps running in the background —
          // the next fetch is then served instantly from cache.
          const budget = new Promise((resolve) => {
            const timer = setTimeout(() => resolve(null), 3000);
            timer.unref?.();
          });
          const meta = await Promise.race([fetchModelMetadata(live, current.registryProvider), budget]);
          if (meta !== null) {
            applyMetadata(merged, meta);
            fillFromSiblings(merged, base);
          }
        }
        return merged;
      } catch (error) {
        logger?.warn?.("[toolkit] live model probe failed; answering from the catalog:", error?.message ?? error);
        return base;
      }
    };
    original = inner;
    // Marker consumed by syncModelsOnce: only this wrapped function's answer
    // may stand in for the live listing (see the liveProbedAt tag above).
    wrapped.enrichedByToolkit = true;
    map.set(LLM_PI_AI_NS, wrapped);
    logger?.info?.("[toolkit] discovery enrichment installed over llm-pi-ai; 'fetch available models' now returns the live listing");
    return true;
  };

  effect(() => {
    const deadline = Date.now() + 15000;
    const attempt = () => {
      if (disposed || install()) return;
      if (Date.now() < deadline) {
        timer = setTimeout(attempt, 1000);
        timer.unref?.();
      } else {
        logger?.warn?.(
          "[toolkit] llm-pi-ai model discovery never appeared; 'fetch available models' stays catalog-only (the sync button still works)",
        );
      }
    };
    attempt();
    return () => {
      disposed = true;
      clearTimeout(timer);
      let map;
      try {
        map = ctx.llm?.discoveries;
      } catch {
        map = undefined;
      }
      if (map instanceof Map && map.get(LLM_PI_AI_NS) === wrapped) map.set(LLM_PI_AI_NS, original);
    };
  }, "toolkit: llm-pi-ai discovery enrichment");
}

// ── route ───────────────────────────────────────────────────────────────────

function sendJson(res, body, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

/** The latest installed capability context, for settings-change re-healing. */
let activeContext = null;

/**
 * Drop the module-level registry and cross-provider caches. Test/introspection
 * hook: the caches are process-wide by design (a registry scan is expensive),
 * so a test that needs a deterministic donor or metadata answer resets them.
 */
export function resetModelSyncCaches() {
  registryInflight.clear();
  registryCache = { provider: "", at: 0, meta: new Map() };
  donorCache = { at: 0, models: [] };
}

/**
 * Re-run the saved-model modality healing. `installSettingsSection`'s onChange
 * calls this so editing the forced vision / text-only lists applies to the
 * already-stored route models without waiting for a restart or a sync.
 */
export function rehealModelCapability() {
  if (activeContext !== null) void ensureModalities(activeContext).catch(() => {});
}

/**
 * Install the modelCapability optimization: adopt the legacy settings, wrap the
 * llm-pi-ai discovery, heal the saved route, and mount the sync route. The
 * feature is dormant — not broken — on a host without the settings, llm, or
 * web-server seams.
 * @param {import('@deepseek-ai/cordis').Context} hostCtx - the plugin context.
 * @param {() => object} configThunk - reads the merged toolkit config live.
 * @returns {void}
 */
export function installModelCapability(hostCtx, configThunk) {
  hostCtx.inject(["settings", "llm", "webServer"], (sctx) => {
    const ctx = {
      logger: hostCtx.logger,
      config: () => modelConfig(configThunk()),
      // Read through the service proxy on every access, never destructured:
      // this context outlives the install callback, and each consumer must see
      // the live handle.
      get settings() {
        return sctx.settings;
      },
      get llm() {
        return sctx.llm;
      },
      effect: (fn, label) => sctx.effect(fn, label),
    };
    activeContext = ctx;
    // Every async kick is contained: a settings/webServer seam going away must
    // never surface as an unhandled rejection from a background repair.
    void migrateLegacyModelSettings(ctx).catch(() => {});
    installDiscoveryEnrichment(ctx);
    void ensureRouteApi(ctx).catch(() => {});
    void ensureModalities(ctx).catch(() => {});

    // POST sync-models: probe the live listing, merge, persist. The path is
    // read once at registration; changing it is a restart-level change.
    sctx.effect(
      () =>
        sctx.webServer.register({
          kind: "exact",
          path: modelConfig(configThunk()).syncPath,
          handler: async (req, res) => {
            if (req.method !== "POST") {
              sendJson(res, { ok: false, error: "Method not allowed" }, 405);
              return;
            }
            try {
              sendJson(res, await syncModelsOnce(ctx));
            } catch (error) {
              sendJson(res, {
                ok: false,
                error: { code: error?.code ?? "internal", message: error?.message ?? String(error) },
              });
            }
          },
        }),
      "toolkit: POST sync-models route",
    );

    // GET models: the settings-card picker's candidates (in-process reads only).
    sctx.effect(
      () =>
        sctx.webServer.register({
          kind: "exact",
          path: modelConfig(configThunk()).modelsPath,
          handler: async (req, res) => {
            if (req.method !== "GET") {
              sendJson(res, { ok: false, error: "Method not allowed" }, 405);
              return;
            }
            try {
              sendJson(res, await knownRouteModels(ctx));
            } catch (error) {
              sendJson(res, {
                ok: false,
                error: { code: error?.code ?? "internal", message: error?.message ?? String(error) },
              });
            }
          },
        }),
      "toolkit: GET models route",
    );
  });
}
