/**
 * dsh-plugin-toolkit — reply-suggestion API (host half).
 *
 * Mounts one same-origin route for the smartReply optimization: given the last
 * assistant message, ask a cheap model what the user might say next, and answer
 * with a short list of candidate replies.
 *
 * Two deliberate design points:
 *
 *  - The suggestion call prefers the DSH llm runtime (`ctx.llm.stream`) whenever
 *    the configured route is registered with it. That runtime owns the wire
 *    protocol, endpoint, and credential, so a pi-ai catalog route such as
 *    `minimax-cn` works with its native `anthropic-messages` protocol and needs
 *    no `modelsRouteBaseURLs` entry. Only an unregistered primary route (a
 *    plugin-owned gateway such as `opencode-go`) falls back to the direct
 *    OpenAI-compatible request the model-listing probe also uses.
 *  - Every failure is a normal `{ ok: false, error }` answer, never a thrown
 *    error the client must survive: a suggestion is a convenience, and the
 *    composer must stay exactly as usable when the call fails as when the
 *    optimization is switched off entirely.
 *
 * Learning: each request carries the live session id, so the route reads the
 * real user messages already in the session log. Aggregated style stats and a
 * few short examples are persisted under <DSH_HOME>/plugins/dsh-plugin-toolkit/
 * by suggest-store.js; they only ever feed this machine's prompt.
 *
 * @license MIT
 */

import {
  tailSummary,
  buildSuggestPrompt,
  buildSuggestRequest,
  parseSuggestions,
  extractCompletionText,
  MAX_SUGGESTION_CHARS,
  MAX_SUGGEST_TOKENS,
} from "./suggest-core.js";
import { resolveRouteEndpoint, resolveRouteApiKey, modelConfig, routeModelOptions } from "./model-sync.js";
import { createHabitStore } from "./suggest-store.js";

/** Ceiling on the request body: this route only ever carries one message tail. */
const MAX_BODY_BYTES = 64 * 1024;
/** Ceiling on a reply body, matching the guard the listing probe uses. */
const MAX_REPLY_BYTES = 256 * 1024;
/** Most accepted suggestions one request may report back to the habit store. */
const MAX_ACCEPTED = 5;
/** Most recent real user messages read from one live session per request. */
const MAX_SESSION_MESSAGES = 8;
/** Longest user message text kept from one session event (prompt caps further). */
const MAX_USER_MESSAGE_CHARS = 2000;

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
    /** Whether local phrasing learning and its prompt hint are enabled. */
    learnHabits: src.suggestLearnHabits !== false,
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
 * Text of one durable message content array, ignoring non-text blocks.
 * @param {unknown} content - message content.
 * @returns {string} trimmed text.
 */
function textOfContent(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (block === null || typeof block !== "object") return "";
      const typed = /** @type {{type?: unknown, text?: unknown}} */ (block);
      return typed.type === "text" && typeof typed.text === "string" ? typed.text : "";
    })
    .join("\n")
    .trim();
}

/**
 * The most recent real user messages in one live session, oldest first.
 *
 * Injections (skill invocations, session references, compaction checkpoints)
 * share the `user/message` event type but carry a non-`user` source; they are
 * skipped so the prompt never learns scaffolding text as the user's voice.
 * @param {object | undefined} session - a live Session.
 * @param {number} [limit] - most messages to return.
 * @returns {string[]} trimmed message texts, oldest first.
 */
export function recentUserMessages(session, limit = MAX_SESSION_MESSAGES) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : MAX_SESSION_MESSAGES;

  // Preferred reader: the runtime's derived model history, which is
  // incrementally cached and is the supported production read (the synchronous
  // `snapshotEvents`/`ownEvents` readers are deprecated). Falls back to the
  // event log for an older or test Session shape.
  const fromDerivedMessages = () => {
    const messages = typeof session?.deriveMessages === "function" ? session.deriveMessages() : undefined;
    if (!Array.isArray(messages)) return undefined;
    const texts = [];
    for (const message of messages) {
      if (message?.role !== "user") continue;
      if (message.source?.kind !== "user") continue;
      const text = textOfContent(message.content);
      if (text !== "") texts.push(text.slice(0, MAX_USER_MESSAGE_CHARS));
    }
    return texts;
  };

  const fromEvents = () => {
    let events;
    try {
      events = typeof session?.snapshotEvents === "function" ? session.snapshotEvents() : [];
    } catch {
      return [];
    }
    if (!Array.isArray(events)) return [];
    const texts = [];
    for (const event of events) {
      if (event?.type !== "user/message") continue;
      if (event.data?.source?.kind !== "user") continue;
      const text = textOfContent(event.data?.content).slice(0, MAX_USER_MESSAGE_CHARS);
      if (text !== "") texts.push(text);
    }
    return texts;
  };

  let texts;
  try {
    texts = fromDerivedMessages();
  } catch {
    texts = undefined;
  }
  if (texts === undefined) texts = fromEvents();
  return texts.slice(Math.max(0, texts.length - cap));
}

/**
 * Keep only the accepted suggestions a client may report back.
 * @param {unknown} value - the request body's `accepted` field.
 * @returns {string[]} trimmed unique texts.
 */
export function sanitizeAccepted(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (text === "" || text.length > 400) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= MAX_ACCEPTED) break;
  }
  return out;
}

/**
 * POST one chat completion under a total deadline covering headers AND body.
 * @param {string} url - the absolute completions URL.
 * @param {string} apiKey - the bearer credential.
 * @param {Record<string, string>} headers - deployment headers the route carries.
 * @param {object} body - the OpenAI-shaped request body.
 * @param {number} timeoutMs - the total budget.
 * @param {typeof fetch} fetchImpl - fetch implementation.
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
 * Whether the llm runtime has an adapter registered for one route.
 * @param {object} ctx - the route context.
 * @param {string} routeKey - route to test.
 * @returns {boolean} true when `ctx.llm.listProviders()` names it.
 */
export function routeRegistered(ctx, routeKey) {
  try {
    const listed = ctx?.llm?.listProviders?.();
    return Array.isArray(listed) && listed.some((provider) => provider?.id === routeKey);
  } catch {
    return false;
  }
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
  try {
    const { models } = await routeModelOptions(ctx, routeKey);
    // Prefer ids in "modelType/model" form: the runtime cache holds bare names
    // ("deepseek-v4.1-flash") while the profile stores the prefixed form the
    // endpoint expects ("cline-pass/deepseek-v4.1-flash"). A bare name is only
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
 * Resolve the route and model one suggestion call targets.
 * @param {object} ctx - the model-capability context.
 * @param {object} config - the smartReply configuration.
 * @param {object} modelCfg - normalized modelCapability configuration.
 * @returns {Promise<{routeKey: string, model: string}>} the target.
 */
async function resolveTarget(ctx, config, modelCfg) {
  const routeKey = config.routeKey !== "" ? config.routeKey : modelCfg.routeKey;
  let model = config.model !== "" ? config.model : await firstModelOf(ctx, routeKey);
  if (model !== "" && !model.includes("/")) {
    try {
      const { models } = await routeModelOptions(ctx, routeKey);
      const prefixed = models.find((row) => typeof row?.id === "string" && row.id.endsWith("/" + model));
      if (prefixed) model = prefixed.id;
    } catch {
      // Keep the bare name and let the transport decide.
    }
  }
  if (model === "") {
    const error = new Error("no model id configured for suggestions");
    error.code = "no-model";
    throw error;
  }
  return { routeKey, model };
}

/**
 * Turn one runtime failure into an Error the route can report.
 * @param {{code?: string, message?: string, status?: number} | undefined} failure - adapter failure.
 * @param {boolean} aborted - whether our own deadline aborted the call.
 * @returns {Error} the error to throw.
 */
function runtimeFailure(failure, aborted) {
  const error = new Error(
    failure?.message ?? (aborted ? "suggestion call timed out" : "suggestion call failed"),
  );
  error.code = aborted ? "timeout" : (failure?.code ?? "runtime-error");
  if (typeof failure?.status === "number") error.status = failure.status;
  return error;
}

/**
 * Ask the llm runtime for candidates. Protocol, endpoint, and credential all
 * belong to the adapter, so a catalog route speaking `anthropic-messages`
 * works exactly like an OpenAI-compatible one.
 * @param {object} ctx - the route context carrying the llm service.
 * @param {object} config - the smartReply configuration.
 * @param {string} routeKey - registered provider route.
 * @param {string} model - exact model id.
 * @param {{system: string, user: string}} prompt - the built prompt pair.
 * @returns {Promise<string[]>} the salvaged candidates.
 */
export async function requestSuggestionsViaRuntime(ctx, config, routeKey, model, prompt) {
  const timeoutMs = Math.max(1, Math.round(config.timeoutSec * 1000));
  const controller = new AbortController();
  let timer;
  let timedOut = false;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(Object.assign(new Error("suggestion call timed out"), { code: "timeout" }));
    }, timeoutMs);
  });

  try {
    let stream;
    try {
      stream = ctx.llm.stream({
        provider: routeKey,
        model,
        system: prompt.system,
        messages: [{ role: "user", content: [{ type: "text", text: prompt.user }] }],
        temperature: 0.7,
        maxTokens: MAX_SUGGEST_TOKENS,
        signal: controller.signal,
      });
    } catch (error) {
      throw error;
    }
    // GenerateOptions.stream is an AsyncIterable; a thenable is a contract
    // violation. Observe its rejection so a broken adapter cannot surface as an
    // unhandled rejection after the route already answered.
    if (stream !== null && stream !== undefined && typeof stream.then === "function") {
      Promise.resolve(stream).catch(() => {});
      throw Object.assign(new Error("llm runtime returned a promise instead of a chunk stream"), { code: "runtime-stream" });
    }
    const iterator = stream?.[Symbol.asyncIterator]?.();
    if (iterator === undefined) {
      throw Object.assign(new Error("llm runtime returned no chunk stream"), { code: "runtime-stream" });
    }

    let text = "";
    let failure;
    let runtimeThrew;
    const collect = (async () => {
      try {
        for (;;) {
          const step = await iterator.next();
          if (step?.done === true) break;
          const chunk = step?.value;
          if (chunk === null || typeof chunk !== "object") continue;
          if (chunk.type === "text-delta" && typeof chunk.text === "string") {
            text += chunk.text;
            // The legacy transport guards its reply body at MAX_REPLY_BYTES;
            // mirror that ceiling so a runaway adapter cannot grow the route's
            // memory without bound.
            if (text.length > MAX_REPLY_BYTES) {
              runtimeThrew = Object.assign(new Error("model reply too large"), { code: "reply-too-large" });
              break;
            }
          } else if (chunk.type === "finish") {
            const reason = chunk.reason;
            if (reason?.kind === "error") {
              failure = reason.failure ?? { code: "runtime-error", message: "suggestion call failed" };
            } else if (reason?.kind === "aborted") {
              failure = reason.failure ?? {
                code: timedOut ? "timeout" : "aborted",
                message: timedOut ? "suggestion call timed out" : "suggestion call aborted",
              };
            }
          }
        }
      } catch (error) {
        runtimeThrew = error;
      }
      return text;
    })();

    try {
      const result = await Promise.race([collect, deadline]);
      if (runtimeThrew !== undefined) throw runtimeThrew;
      if (failure !== undefined && !timedOut) throw runtimeFailure(failure, false);
      if (timedOut) throw Object.assign(new Error("suggestion call timed out"), { code: "timeout" });
      return parseSuggestions(result, { count: config.count, maxChars: MAX_SUGGESTION_CHARS });
    } catch (error) {
      // Ask the stream to stop, but never await it: an adapter that ignores the
      // abort signal (or a generator blocked inside next()) must not hold the
      // HTTP route open past its deadline. Any rejection is observed
      // fire-and-forget so it cannot become an unhandled rejection.
      if (typeof iterator.return === "function") {
        try {
          const closing = iterator.return();
          if (closing !== null && typeof closing === "object" && typeof closing.then === "function") {
            closing.catch(() => {});
          }
        } catch {
          // Cancellation is best-effort.
        }
      }
      collect.catch(() => {});
      throw error;
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The legacy transport: one direct OpenAI-compatible chat completion against
 * the route's resolved endpoint. Used only when the runtime does not own the
 * route (or a host predates `llm.stream`), preserving the original decline
 * ladder rather than guessing a URL or protocol.
 * @param {object} ctx - the model-capability context.
 * @param {object} config - the smartReply configuration.
 * @param {string} routeKey - route to call.
 * @param {string} model - exact model id.
 * @param {object} evidence - prompt evidence plus the fetch implementation.
 * @returns {Promise<string[]>} the salvaged candidates.
 */
async function requestSuggestionsViaEndpoint(ctx, config, routeKey, model, evidence) {
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
  const body = buildSuggestRequest({
    model,
    summary: evidence.summary,
    language: evidence.language,
    count: config.count,
    lastUserText: evidence.lastUserText,
    habitHint: evidence.habitHint,
  });
  const reply = await postCompletion(
    evidence.fetchImpl,
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
 * Ask one route for candidate replies.
 *
 * Registered routes go through `ctx.llm.stream`; everything else keeps the
 * original endpoint/credential resolution and decline ladder.
 * @param {object} ctx - the model-capability context (shared resolver shape).
 * @param {object} config - the smartReply configuration.
 * @param {string} summary - the assistant message tail.
 * @param {"zh" | "en"} language - the requested reply language.
 * @param {typeof fetch} [fetchImpl] - the fetch to call, for tests.
 * @param {{lastUserText?: string, habitHint?: string}} [evidence] - prompt evidence.
 * @returns {Promise<string[]>} the salvaged candidates; empty on any failure.
 */
export async function requestSuggestions(ctx, config, summary, language, fetchImpl = fetch, evidence = {}) {
  // `ctx.config()` is ALREADY the normalized modelCapability shape (the caller
  // wraps the raw toolkit config exactly as installModelCapability does), so it
  // is read directly — normalizing it a second time would silently reset every
  // value to its schema default and point the call at the wrong route.
  const modelCfg = ctx.config();
  const target = await resolveTarget(ctx, config, modelCfg);
  const prompt = buildSuggestPrompt({
    summary,
    language,
    count: config.count,
    lastUserText: evidence.lastUserText ?? "",
    habitHint: evidence.habitHint ?? "",
  });
  if (typeof ctx.llm?.stream === "function" && routeRegistered(ctx, target.routeKey)) {
    return requestSuggestionsViaRuntime(ctx, config, target.routeKey, target.model, prompt);
  }
  return requestSuggestionsViaEndpoint(ctx, config, target.routeKey, target.model, {
    summary,
    language,
    lastUserText: evidence.lastUserText ?? "",
    habitHint: evidence.habitHint ?? "",
    fetchImpl,
  });
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
 * `runtime` tells the client whether the host can call any registered route
 * through `ctx.llm.stream`; when it can, every listed route is available
 * regardless of protocol or a stored endpoint. `available` is the per-route
 * answer the picker greys out.
 * @param {object} ctx - the model-capability context (shared resolver shape).
 * @param {string} [routeKey] - the route whose models to list; empty resolves to
 *   the modelCapability primary route.
 * @returns {Promise<object>} `{ ok, primaryRoute, route, runtime, habit, routes, models }`.
 */
export async function suggestOptions(ctx, routeKey) {
  const modelCfg = ctx.config();
  const primary = modelCfg.routeKey;
  const resolved = typeof routeKey === "string" && routeKey.trim() !== "" ? routeKey.trim() : primary;
  const runtime = typeof ctx.llm?.stream === "function";

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
    const reachable = endpoint !== undefined;
    const api = endpoint?.api ?? "";
    routes.push({
      id,
      name: typeof provider?.name === "string" && provider.name !== "" ? provider.name : id,
      primary: id === primary,
      // Legacy hosts can only call a reachable OpenAI-compatible endpoint; a
      // runtime host can call anything it has an adapter for.
      reachable,
      api,
      available: runtime || (reachable && api === "openai-completions"),
    });
  }
  routes.sort((left, right) => {
    if (left.primary !== right.primary) return left.primary ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  const { models } = await routeModelOptions(ctx, resolved);
  // Prefer ids in "modelType/model" form: the runtime cache holds bare names
  // ("deepseek-v4.1-flash") while the profile stores the prefixed form the
  // endpoint expects ("cline-pass/deepseek-v4.1-flash"). If any prefixed id
  // exists, show only those — a bare name in the picker would save a value the
  // endpoint rejects.
  const hasPrefixed = models.some((m) => typeof m?.id === "string" && m.id.includes("/"));
  const filtered = hasPrefixed ? models.filter((m) => typeof m?.id === "string" && m.id.includes("/")) : models;
  const habit = ctx.habit !== null && typeof ctx.habit === "object"
    ? ctx.habit
    : { enabled: false, turns: 0, accepted: 0 };
  return { ok: true, primaryRoute: primary, route: resolved, runtime, habit, routes, models: filtered };
}

/**
 * The live Session a suggestion request belongs to, if the host has it.
 * @param {object} ctx - the route context.
 * @param {unknown} sessionId - the request body's session id.
 * @returns {object | undefined} the Session.
 */
function liveSession(ctx, sessionId) {
  if (typeof sessionId !== "string" || sessionId === "") return undefined;
  try {
    return ctx.get?.("sessions")?.get?.(sessionId);
  } catch {
    return undefined;
  }
}

/**
 * Install the smartReply routes on hostCtx.
 * @param {object} hostCtx - the plugin's root context.
 * @param {() => Record<string, unknown>} configThunk - live toolkit config reader.
 * @param {object} [deps] - test seams.
 * @returns {void}
 */
export function installSmartReply(hostCtx, configThunk, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const suggest = deps.requestSuggestions ?? requestSuggestions;
  const options = deps.suggestOptions ?? suggestOptions;
  const habitStore = deps.habitStore ?? createHabitStore(deps.habitPath);
  const logger = deps.logger;
  // `llm` is injected alongside `webServer` only so an unconfigured
  // `suggestModel` can fall back to the route's own catalog id — an in-process
  // read. A host without the llm service simply leaves the fallback empty and
  // the call declines with `no-model`, which the client renders as "no ghost
  // text"; the route itself still works for an explicitly configured model.
  hostCtx.inject(["webServer", "llm", "settings"], (sctx) => {
    const routeContext = () => ({
      config: () => modelConfig(configThunk()),
      get: (name) => sctx.get?.(name),
      llm: sctx.llm,
      get settings() { return sctx.settings; },
    });
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
            const session = liveSession(sctx, body?.sessionId);
            const userMessages = recentUserMessages(session);
            const accepted = sanitizeAccepted(body?.accepted);
            let habitHint = "";
            if (config.learnHabits) {
              try {
                habitStore.learn({ userMessages, accepted, language });
                habitHint = habitStore.styleHint(language);
              } catch (error) {
                // Learning is best-effort; a broken state file must never
                // cost this turn its suggestion.
                logger?.warn?.("[toolkit] smartReply habit learning:", error);
              }
            }
            try {
              const suggestions = await suggest(
                routeContext(),
                { ...config, count: Number.isInteger(body?.count) && body.count > 0 ? Math.min(body.count, 5) : config.count },
                summary,
                language,
                fetchImpl,
                {
                  lastUserText: userMessages.length > 0 ? userMessages[userMessages.length - 1] : "",
                  habitHint,
                },
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
              const config = suggestConfig(configThunk());
              let habit = { enabled: false, turns: 0, accepted: 0 };
              if (config.learnHabits) {
                try {
                  const summary = habitStore.summary();
                  habit = { enabled: true, turns: summary.turns, accepted: summary.accepted };
                } catch {
                  habit = { enabled: true, turns: 0, accepted: 0 };
                }
              }
              const ctx = { ...routeContext(), habit };
              sendJson(res, await options(ctx, route));
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
