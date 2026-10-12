/**
 * dsh-plugin-toolkit — reply-suggestion API (host half).
 *
 * Mounts one same-origin route for the smartReply optimization: given the last
 * assistant message, ask a cheap model what the user might say next, and answer
 * with a short list of candidate replies.
 *
 * Two deliberate design points:
 *
 *  - The route it calls is resolved through the SAME `resolveRouteEndpoint` /
 *    `resolveRouteApiKey` pair the live model-listing probe uses (exported from
 *    model-sync.js for exactly this), so suggestions reach whatever provider the
 *    profile is already configured for and never invent a URL or probe into a
 *    guaranteed 401.
 *  - Every failure is a normal `{ ok: false, error }` answer, never a thrown
 *    error the client must survive: a suggestion is a convenience, and the
 *    composer must stay exactly as usable when the call fails as when the
 *    optimization is switched off entirely.
 *
 * @license MIT
 */

import {
  tailSummary,
  buildSuggestRequest,
  parseSuggestions,
  extractCompletionText,
  MAX_SUGGESTION_CHARS,
} from "./suggest-core.js";
import { resolveRouteEndpoint, resolveRouteApiKey, modelConfig, routeModelOptions } from "./model-sync.js";

/** Ceiling on the request body: this route only ever carries one message tail. */
const MAX_BODY_BYTES = 64 * 1024;
/** Ceiling on a reply body, matching the guard the listing probe uses. */
const MAX_REPLY_BYTES = 256 * 1024;

/**
 * The smartReply slice of the merged toolkit config, with defaults applied.
 * @param {Record<string, unknown>} config - merged toolkit configuration.
 * @returns {object} the smartReply configuration.
 */
export function suggestConfig(config) {
  const src = config ?? {};
  return {
    /** Master switch: the optimization toggle on the settings card. */
    enabled: src.optimizations?.smartReply !== false,
    /**
     * Route the suggestion call uses. Empty falls back to the modelCapability
     * primary route, so a profile that already works needs no extra setup.
     */
    routeKey: typeof src.suggestRouteKey === "string" ? src.suggestRouteKey.trim() : "",
    /** Model id to ask. Empty resolves at call time to the route's first model. */
    model: typeof src.suggestModel === "string" ? src.suggestModel.trim() : "",
    /** Same-origin route the client POSTs to; read once at registration. */
    path: typeof src.suggestPath === "string" && src.suggestPath !== ""
      ? src.suggestPath
      : "/api/toolkit/suggest-reply",
    /** Same-origin route listing the routes and models the pickers offer (GET). */
    optionsPath: typeof src.suggestOptionsPath === "string" && src.suggestOptionsPath !== ""
      ? src.suggestOptionsPath
      : "/api/toolkit/suggest-options",
    /** Reply language pin; "" follows the language the client asks for. */
    language: src.suggestLanguage === "zh" || src.suggestLanguage === "en" ? src.suggestLanguage : "",
    /** How many candidates to ask for and keep. */
    count: Number.isInteger(src.suggestCount) && src.suggestCount > 0 ? Math.min(src.suggestCount, 5) : 3,
    /** Total per-request deadline in seconds, headers AND body. */
    timeoutSec: typeof src.suggestTimeoutSec === "number" && src.suggestTimeoutSec > 0
      ? src.suggestTimeoutSec
      : 30,
  };
}

/**
 * Join a baseURL and a path without doubling or dropping the separator. The
 * stored baseURLs in the wild carry every shape: with and without a trailing
 * slash, and some with the `/v1` suffix a completion path must follow.
 * @param {string} baseURL - the resolved endpoint root.
 * @param {string} suffix - the path to append.
 * @returns {string} an absolute URL.
 */
export function joinUrl(baseURL, suffix) {
  const base = String(baseURL ?? "").trim().replace(/\/+$/, "");
  const path = String(suffix ?? "").trim().replace(/^\/+/, "");
  return path === "" ? base : base + "/" + path;
}

function sendJson(res, body, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function methodNotAllowed(allowed) {
  return {
    ok: false,
    error: { code: "method-not-allowed", message: "only " + allowed + " is allowed on this route" },
  };
}

/**
 * Read a JSON request body under a hard byte cap. A cap matters here because
 * this is a same-origin route the browser posts to on every settled turn: an
 * unbounded read is a free memory knob for any page that can reach it.
 * @param {object} req - the Node request.
 * @returns {Promise<object>} the parsed body, or {} for an empty one.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("invalid JSON payload"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * POST one chat completion under a total deadline covering headers AND body.
 * @param {string} url - the absolute completions URL.
 * @param {string} apiKey - the bearer credential.
 * @param {Record<string, string>} headers - deployment headers the route carries.
 * @param {object} body - the OpenAI-shaped request body.
 * @param {number} timeoutMs - the total budget.
 * @returns {Promise<object>} the parsed reply body.
 */
async function postCompletion(fetchImpl, url, apiKey, headers, body, timeoutMs) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    // The body can carry the gateway's own reason; read it bounded so a 5xx
    // HTML error page cannot turn into an unbounded string.
    let detail = "";
    try {
      detail = (await response.text()).slice(0, 500);
    } catch {
      // A body that cannot be read tells us nothing the status did not.
    }
    const error = new Error("model endpoint replied " + response.status);
    error.code = "endpoint-error";
    error.status = response.status;
    error.detail = detail;
    throw error;
  }
  const text = await response.text();
  if (text.length > MAX_REPLY_BYTES) {
    const error = new Error("model reply too large");
    error.code = "reply-too-large";
    throw error;
  }
  return JSON.parse(text);
}

/**
 * Ask one route for candidate replies.
 *
 * A route whose stored protocol is not OpenAI-compatible is declined outright
 * rather than guessed at: speaking `anthropic-messages` to an Anthropic-shaped
 * endpoint would 400 on every turn, which is worse than showing no suggestion.
 * @param {object} ctx - the model-capability context (shared resolver shape).
 * @param {object} config - the smartReply configuration.
 * @param {string} summary - the assistant message tail.
 * @param {"zh" | "en"} language - the requested reply language.
 * @param {typeof fetch} [fetchImpl] - the fetch to call, for tests.
 * @returns {Promise<string[]>} the salvaged candidates; empty on any failure.
 */
export async function requestSuggestions(ctx, config, summary, language, fetchImpl = fetch) {
  // `ctx.config()` is ALREADY the normalized modelCapability shape (the caller
  // wraps the raw toolkit config exactly as installModelCapability does), so it
  // is read directly — normalizing it a second time would silently reset every
  // value to its schema default and point the call at the wrong route.
  const modelCfg = ctx.config();
  const routeKey = config.routeKey !== "" ? config.routeKey : modelCfg.routeKey;
  const endpoint = resolveRouteEndpoint(ctx, routeKey);
  if (endpoint === undefined) {
    const error = new Error("no endpoint resolves for route '" + routeKey + "'");
    error.code = "no-endpoint";
    throw error;
  }
  if (endpoint.api !== "openai-completions") {
    const error = new Error("route '" + routeKey + "' speaks '" + endpoint.api + "', not OpenAI-compatible");
    error.code = "unsupported-api";
    throw error;
  }
  const apiKey = await resolveRouteApiKey(ctx, routeKey);
  if (apiKey === "") {
    // No credential means a guaranteed 401. Say so instead of asking.
    const error = new Error("no credential resolves for route '" + routeKey + "'");
    error.code = "no-credential";
    throw error;
  }
  let model = config.model !== "" ? config.model : await firstModelOf(ctx, routeKey);
  // Normalise a bare id to the "modelType/model" form the endpoint expects.
  // The model picker reads the runtime cache, which holds bare names
  // ("deepseek-v4.1-flash"); the endpoint requires the prefixed form the
  // stored profile carries ("cline-pass/deepseek-v4.1-flash").
  if (model !== "" && !model.includes("/")) {
    try {
      const { models } = await routeModelOptions(ctx, routeKey);
      const prefixed = models.find((row) => typeof row?.id === "string" && row.id.endsWith("/" + model));
      if (prefixed) model = prefixed.id;
    } catch { /* keep the bare name and let the endpoint decide */ }
  }
  if (model === "") {
    const error = new Error("no model id configured for suggestions");
    error.code = "no-model";
    throw error;
  }
  const body = buildSuggestRequest({ model, summary, language, count: config.count });
  console.log("[suggest-api] calling:", joinUrl(endpoint.baseURL, "chat/completions"), "model:", model);
  const reply = await postCompletion(
    fetchImpl,
    joinUrl(endpoint.baseURL, "chat/completions"),
    apiKey,
    endpoint.headers,
    body,
    config.timeoutSec * 1000,
  );
  return parseSuggestions(extractCompletionText(reply), {
    count: config.count,
    maxChars: MAX_SUGGESTION_CHARS,
  });
}

/**
 * The route's own first known model id, used when no model is configured for
 * suggestions. This is an in-process read of the catalog — no network — so a
 * profile with no explicit `suggestModel` still works without an extra probe.
 * @param {object} ctx - the model-capability context.
 * @param {string} routeKey - the route to read.
 * @returns {Promise<string>} a model id, or "" when none is known.
 */
async function firstModelOf(ctx, routeKey) {
  // Read from the STORED route profile, not the runtime's discovery cache.
  // The cache holds bare ids (e.g. "deepseek-v4.1-flash") while the endpoint
  // expects the prefixed form the profile stores ("cline-pass/deepseek-v4.1-flash").
  try {
    const { models } = await routeModelOptions(ctx, routeKey);
    // Prefer ids in "modelType/model" form: the runtime cache holds bare names
    // ("deepseek-v4.1-flash") while the endpoint expects the prefixed form the
    // profile stores ("cline-pass/deepseek-v4.1-flash"). A bare name is only
    // accepted when no prefixed id exists.
    const prefixed = models.find((row) => typeof row?.id === "string" && row.id.includes("/"));
    if (prefixed) return prefixed.id.trim();
    for (const row of models) {
      const id = typeof row?.id === "string" ? row.id.trim() : "";
      if (id !== "") return id;
    }
  } catch {
    // A route with no stored models is simply "no model to suggest with".
  }
  return "";
}

/**
 * The routes and models the settings pickers offer.
 *
 * Routes come from the runtime's own provider registry (`llm.listProviders`),
 * so the list is exactly what the profile has configured — never a hardcoded
 * set. Models come from the same stored-rows ∪ runtime-view union the
 * modelCapability picker uses, parameterized by the route the user is looking
 * at rather than only the primary one. Both reads are in-process, so opening
 * the dialog stays instant even when an endpoint is down.
 *
 * The primary route is flagged so the client can pre-select it and label the
 * "use the default" entry; a route with no resolvable endpoint is still listed
 * (the user may be about to give it one) but marked, so the picker can say why
 * a suggestion would not run on it.
 * @param {object} ctx - the model-capability context (shared resolver shape).
 * @param {string} [routeKey] - the route whose models to list; empty resolves to
 *   the modelCapability primary route.
 * @returns {Promise<object>} `{ ok, primaryRoute, route, routes, models }`.
 */
export async function suggestOptions(ctx, routeKey) {
  const modelCfg = ctx.config();
  const primary = modelCfg.routeKey;
  const resolved = typeof routeKey === "string" && routeKey.trim() !== "" ? routeKey.trim() : primary;

  let providers = [];
  try {
    const listed = ctx.llm?.listProviders?.();
    if (Array.isArray(listed)) providers = listed;
  } catch {
    providers = [];
  }
  const routes = [];
  for (const provider of providers) {
    const id = typeof provider?.id === "string" ? provider.id : "";
    if (id === "") continue;
    const endpoint = resolveRouteEndpoint(ctx, id);
    routes.push({
      id,
      name: typeof provider?.name === "string" && provider.name !== "" ? provider.name : id,
      primary: id === primary,
      // Whether a suggestion call could reach this route at all. The picker
      // greys a route that has no endpoint rather than letting the user pick a
      // configuration that can only ever answer "no suggestion".
      reachable: endpoint !== undefined,
      api: endpoint?.api ?? "",
    });
  }
  routes.sort((left, right) => {
    if (left.primary !== right.primary) return left.primary ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  const { models } = await routeModelOptions(ctx, resolved);
  // Prefer ids in "modelType/model" form: the runtime cache holds bare names
  // ("deepseek-v4.1-flash") while the endpoint expects the prefixed form the
  // stored profile carries ("cline-pass/deepseek-v4.1-flash"). If any prefixed
  // id exists, show only those — a bare name in the picker would save a value
  // the endpoint rejects.
  const hasPrefixed = models.some((m) => typeof m?.id === "string" && m.id.includes("/"));
  const filtered = hasPrefixed ? models.filter((m) => typeof m?.id === "string" && m.id.includes("/")) : models;
  return { ok: true, primaryRoute: primary, route: resolved, routes, models: filtered };
}

/**
 * Install the smartReply route on hostCtx.
 * @param {object} hostCtx - the plugin's root context.
 * @param {() => Record<string, unknown>} configThunk - live toolkit config reader.
 * @param {object} [deps] - test seams.
 * @returns {void}
 */
export function installSmartReply(hostCtx, configThunk, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const suggest = deps.requestSuggestions ?? requestSuggestions;
  const options = deps.suggestOptions ?? suggestOptions;
  // `llm` is injected alongside `webServer` only so an unconfigured
  // `suggestModel` can fall back to the route's own catalog id — an in-process
  // read. A host without the llm service simply leaves the fallback empty and
  // the call declines with `no-model`, which the client renders as "no ghost
  // text"; the route itself still works for an explicitly configured model.
  hostCtx.inject(["webServer", "llm", "settings"], (sctx) => {
    // The path is read once at registration, matching every other route here:
    // changing it is a restart-level change, not a live one.
    sctx.effect(
      () =>
        sctx.webServer.register({
          kind: "exact",
          path: suggestConfig(configThunk()).path,
          handler: async (req, res) => {
            if (req.method !== "POST") {
              sendJson(res, methodNotAllowed("POST"), 405);
              return;
            }
            const config = suggestConfig(configThunk());
            if (!config.enabled) {
              sendJson(res, { ok: false, error: { code: "disabled", message: "smartReply is switched off" } }, 409);
              return;
            }
            let body;
            try {
              body = await readBody(req);
            } catch (error) {
              sendJson(res, { ok: false, error: { code: "bad-request", message: error?.message ?? String(error) } }, 400);
              return;
            }
            const summary = tailSummary(body?.summary);
            if (summary === "") {
              // Nothing to base a suggestion on. An empty list, not an error:
              // this is the ordinary "first message of a conversation" case.
              sendJson(res, { ok: true, suggestions: [] });
              return;
            }
            const language = body?.language === "en" || body?.language === "zh"
              ? body.language
              : config.language !== "" ? config.language : "zh";
            try {
              const suggestions = await suggest(
                { config: () => modelConfig(configThunk()), get: (name) => sctx.get?.(name), llm: sctx.llm, get settings() { return sctx.settings; } },
                { ...config, count: Number.isInteger(body?.count) && body.count > 0 ? Math.min(body.count, 5) : config.count },
                summary,
                language,
                fetchImpl,
              );
              sendJson(res, { ok: true, suggestions });
            } catch (error) {
              // Deliberately a 200-with-ok:false: the client treats any failure
              // as "no suggestion", and an error status would only invite a
              // console full of noise nobody can act on mid-conversation.
              sendJson(res, {
                ok: false,
                error: { code: error?.code ?? "internal", message: (error?.message ?? String(error)) + (error?.detail ? " — " + error.detail : "") },
              });
            }
          },
        }),
      "toolkit: POST suggest-reply route",
    );

    // GET suggest-options: the routes and models the settings pickers offer.
    // In-process reads only; the route param selects which route's models to
    // list, empty resolving to the primary route.
    sctx.effect(
      () =>
        sctx.webServer.register({
          kind: "exact",
          path: suggestConfig(configThunk()).optionsPath,
          handler: async (req, res) => {
            if (req.method !== "GET") {
              sendJson(res, methodNotAllowed("GET"), 405);
              return;
            }
            try {
              const url = new URL(req.url ?? "", "http://localhost");
              const route = url.searchParams.get("route") ?? "";
              sendJson(res, await options(
                { config: () => modelConfig(configThunk()), get: (name) => sctx.get?.(name), llm: sctx.llm, get settings() { return sctx.settings; } },
                route,
              ));
            } catch (error) {
              sendJson(res, {
                ok: false,
                error: { code: error?.code ?? "internal", message: (error?.message ?? String(error)) + (error?.detail ? " — " + error.detail : "") },
              });
            }
          },
        }),
      "toolkit: GET suggest-options route",
    );
  });
}