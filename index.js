/**
 * dsh-plugin-toolkit - Server half (v0.1.0)
 *
 * Personal quality-of-life toolkit for DeepSeek Harness. Every optimization is
 * small, runtime-toggleable from the Web settings page, and expected to
 * graduate into its own vertical plugin once it grows its own configuration,
 * GUI, or service surface (graduation rules live in the README).
 *
 * Current optimizations:
 *  1. workspacelessChat - the Web client auto-connects a default chat
 *     workspace at cold start, so conversation works without picking a
 *     workspace first (the default-project behavior of other agent
 *     harnesses). This half owns the settings namespace and ensures the chat
 *     directory exists on the host; the connection logic is client-side
 *     because dsh's blank-session composer requires a workspace.
 *
 *  2. editLastMessage - edit-and-resend button on the last user message
 *     (client-side renderer over the host's session.rewrite extension).
 *
 *  3. viewActivity - workspace-header activity icon re-sorting the sidebar
 *     conversation list (running first, then by day).
 *
 *  4. slashI18n - Chinese descriptions for the '/' menu, translated
 *     client-side by wrapping the commands/skills remote list responses.
 *
 *  5. changeReport - codex-style per-turn change report card at the turn
 *     tail (file list with +N -M counts and a review diff), aggregated
 *     client-side from the transcript's file-mutation tool calls.
 *
 *  6. opencodeSession - OpenCode Go (and any provider whose endpoint targets
 *     opencode.ai) rejects requests without a stable per-conversation
 *     x-opencode-session header; this half stamps the loop's own session id
 *     onto those requests entirely from the plugin side: an llm/stream
 *     listener carries the in-flight request's session identity through an
 *     AsyncLocalStorage down to a thin globalThis.fetch wrap, which adds the
 *     header only for OpenCode endpoints. Zero dsh source changes, zero
 *     upgrade friction (the user-agent requirement is already covered by the
 *     harness's attribution headers).
 *
 *  7. modelCapability - keeps one llm-pi-ai route's model list current against
 *     a live OpenAI-compatible endpoint (moved here from
 *     dsh-plugin-quota-badges' 「模型能力」 section). model-sync.js wraps the
 *     runtime's model discovery, mounts POST <modelsSyncPath>, merges the live
 *     listing over the route's stored models, fills capacities from the
 *     models.dev registry and from sized siblings, borrows image input from
 *     other registered providers, and applies the user's forced vision /
 *     text-only overrides. The API key lives in this namespace
 *     (modelsApiKey / modelsApiKeyEnvVar); the former quota-badges values are
 *     adopted once at startup.
 *
 * @license MIT
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { installModelCapability, rehealModelCapability } from "./model-sync.js";

export const name = "toolkit";
export const inject = ["settings"];

/** Settings namespace name; the Web plugins page pairs the card by this key. */
export const NS = "toolkit";

/**
 * Plugin configuration schema. Exported so Cordis validates the bundle-patch /
 * user-layer values at load time and fills these defaults; every
 * deployment-varying value lives here instead of in code.
 */
export const Config = z.object({
  optimizations: z.object({
    workspacelessChat: z.boolean().default(true),
    editLastMessage: z.boolean().default(true),
    viewActivity: z.boolean().default(true),
    slashI18n: z.boolean().default(true),
    changeReport: z.boolean().default(true),
    opencodeSession: z.boolean().default(true),
    modelCapability: z.boolean().default(true),
  }).default({ workspacelessChat: true, editLastMessage: true, viewActivity: true, slashI18n: true, changeReport: true, opencodeSession: true, modelCapability: true }),
  /**
   * Host-side directory the default chat workspace registers. Empty resolves
   * to <DSH_HOME>/chat; resolved before registration so the client always
   * reads an absolute path from the settings section.
   */
  chatWorkspacePath: z.string().default(""),
  /**
   * Display title of the default chat workspace. Renamed by the client on
   * connect so the no-project option is recognizable in the sidebar and
   * workspace picker.
   */
  chatWorkspaceTitle: z.string().default("通用对话"),
  /**
   * Explicit API key for the modelCapability probe; empty falls back to the
   * modelsApiKeyEnvVar environment variable. Adopted once from the former
   * quota-badges namespace when first empty (see modelsMigratedFromQuotaBadges).
   */
  modelsApiKey: z.string().default(""),
  /** Environment variable consulted when modelsApiKey is empty. */
  modelsApiKeyEnvVar: z.string().default("OPENCODE_API_KEY"),
  /** The llm-pi-ai provider route whose model list the optimization keeps current. */
  modelsRouteKey: z.string().default("opencode-go"),
  /** Endpoint probed for the live model listing. */
  modelsBaseURL: z.string().default("https://opencode.ai/zen/go/v1"),
  /** Wire protocol written onto the route so catalog-unknown models are serviceable. */
  modelsRouteApi: z.string().default("openai-completions"),
  /** Same-origin route forcing one model-list sync (POST). */
  modelsSyncPath: z.string().default("/api/toolkit/sync-models"),
  /** Same-origin route listing the route's known models for the picker (GET). */
  modelsPath: z.string().default("/api/toolkit/models"),
  /** Fill missing capacities/modalities for new models from the models.dev registry. */
  modelsEnrichFromRegistry: z.boolean().default(true),
  /** This endpoint's provider directory inside the models.dev registry. */
  modelsRegistryProvider: z.string().default("opencode-go"),
  /** Model ids to force vision-capable, overriding any auto-detection. */
  modelsVision: z.array(z.string()).default([]),
  /** Model ids to force text-only (image stripped), overriding auto-detection. */
  modelsTextOnly: z.array(z.string()).default([]),
  /** Per-request upstream timeout in seconds for the probe and the registry. */
  modelsTimeoutSec: z.number().default(10),
  /** One-time marker: the former quota-badges model settings were adopted here. */
  modelsMigratedFromQuotaBadges: z.boolean().default(false),
});

/** Composition-layer config as Cordis resolved it at apply time. */
let pluginConfig = {};

/**
 * The active configuration source: the resolved settings scope while a
 * settings provider is mounted, the composition entry otherwise. Swapped by
 * `installSettingsSection`'s `setSource` at attach/detach.
 */
let source = () => pluginConfig;

/** The currently authoritative merged config. */
function currentConfig() {
  return source();
}

/** Resolve the effective chat workspace path (explicit config wins). */
function chatPath(config) {
  const explicit = String(config.chatWorkspacePath ?? "").trim();
  if (explicit !== "") return explicit;
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(home, "chat");
}

/**
 * Ensure the chat workspace directory exists on the host. The workspace
 * registry rejects registration for a path that does not resolve to an
 * existing directory, so this must run before the client creates the
 * workspace. Failures warn and leave the optimization dormant: the client
 * connect attempt surfaces the error on the session list state.
 * @param {import('./index.d.ts').ToolkitRuntimeConfig} config - merged config.
 * @param {import('@deepseek-ai/cordis').Context['logger']} logger - plugin logger.
 * @returns {Promise<void>} completion of the directory check.
 */
async function ensureChatDir(config, logger) {
  const enabled = config.optimizations?.workspacelessChat !== false;
  if (!enabled) return;
  const path = chatPath(config);
  try {
    await mkdir(path, { recursive: true });
  } catch (error) {
    logger?.warn?.(`[toolkit] cannot create chat workspace directory "${path}": ${String(error)}`);
  }
}

/**
 * The header OpenCode's Go/Zen gateways require on every request.
 */
const OPENCODE_SESSION_HEADER = "x-opencode-session";

/**
 * Marks our globalThis.fetch wrap so a re-apply (HMR, remount) never stacks a
 * second wrap on top of the first.
 */
const FETCH_WRAP_MARK = Symbol.for("dsh-plugin-toolkit.opencodeSession.fetchWrap");

/**
 * Carries the in-flight request's session identity from the llm/stream seam
 * down the async chain to the fetch layer. The store is `{ sessionId }` — the
 * loop-stamped conversation identity, stable per conversation.
 */
const sessionContext = new AsyncLocalStorage();

/** Process-wide identity for requests that carry no session (rare one-shots). */
let fallbackSessionId;
function fallbackSession() {
  return (fallbackSessionId ??= `dsh-session-${randomUUID()}`);
}

/**
 * Whether one URL targets OpenCode (Go or Zen): the host must be opencode.ai
 * itself or a subdomain of it. Anything else keeps its request untouched.
 * @param {string} urlText - the request URL text.
 * @returns {boolean} whether the endpoint is an OpenCode one.
 */
function isOpenCodeUrl(urlText) {
  let host;
  try {
    host = new URL(urlText).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === "opencode.ai" || host.endsWith(".opencode.ai");
}

/** The URL one fetch call targets, whatever input shape the caller used. */
function fetchInputUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input !== null && typeof input === "object" && typeof input.url === "string") return input.url;
  return "";
}

/**
 * Wrap globalThis.fetch once: for OpenCode-bound requests that lack the
 * session header, stamp the in-flight conversation's session id (or the
 * process fallback for sessionless calls like model discovery). Provider SDKs
 * resolve the global fetch when they construct their client — which pi-ai does
 * per request — so a boot-time wrap is seen by every provider call. Anything
 * not targeting OpenCode passes through byte-identical, the wrap is inert
 * while the optimization is disabled, and a decoration failure can never break
 * the underlying request.
 * @returns {void}
 */
function installFetchWrap() {
  const original = globalThis.fetch;
  if (typeof original !== "function" || original[FETCH_WRAP_MARK] === true) return;
  const wrapped = function (input, init) {
    try {
      if (currentConfig().optimizations?.opencodeSession !== false) {
        const url = fetchInputUrl(input);
        if (url.includes("opencode.ai") && isOpenCodeUrl(url)) {
          const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          if (!headers.has(OPENCODE_SESSION_HEADER)) {
            headers.set(OPENCODE_SESSION_HEADER, sessionContext.getStore()?.sessionId ?? fallbackSession());
          }
          return original.call(globalThis, input, { ...init, headers });
        }
      }
    } catch {
      // fall through: a decoration must never break the request it decorates
    }
    return original.call(globalThis, input, init);
  };
  wrapped[FETCH_WRAP_MARK] = true;
  globalThis.fetch = wrapped;
}

/**
 * Install the opencodeSession optimization. Two cooperating halves, both
 * plugin-side:
 *  - an llm/stream listener (the seam's public waterfall) that re-enters every
 *    inner iteration inside the session's AsyncLocalStorage context, so the
 *    adapter's and SDK's downstream async work — including the provider fetch
 *    — observes the conversation's session id;
 *  - the fetch wrap above, which turns that context into the wire header.
 * The loop stamps the identity on every request it builds (the agent-loop
 * invariant requires it), so the header is stable per conversation by
 * construction. On a host without the llm/stream seam the listener simply
 * never fires and requests go out exactly as before.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @returns {void}
 */
function installOpenCodeSession(ctx) {
  installFetchWrap();
  ctx.on("llm/stream", (options, next) => {
    const sessionId = options?.sessionId === undefined ? undefined : String(options.sessionId);
    if (sessionId === undefined) return next();
    const stream = next();
    return (async function* () {
      const iterator = stream[Symbol.asyncIterator]();
      try {
        while (true) {
          // Each resume of the inner stream re-enters the session context, so
          // the whole downstream async chain (adapter, SDK, fetch) carries it.
          const result = await sessionContext.run({ sessionId }, () => iterator.next());
          if (result.done) return;
          yield result.value;
        }
      } finally {
        await iterator.return?.(undefined);
      }
    })();
  }, { global: true });
}

/**
 * Plugin activation: register the `toolkit` settings namespace via
 * `installSettingsSection` (the canonical optional-settings wiring — the Web
 * settings card reads/writes the section live, and the composition entry
 * keeps the plugin working when no settings provider is mounted), and ensure
 * the chat workspace directory exists for the workspacelessChat optimization.
 *
 * The `base` entry carries the RESOLVED absolute chat path (never the raw
 * empty default) so the client optimization reads a usable host path live.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {import('./index.d.ts').ToolkitConfig} config - resolved composition config.
 */
export function apply(ctx, config) {
  pluginConfig = { ...pluginConfig, ...(config || {}) };
  const logger = ctx.logger;

  // The OpenCode session-header fix reads its toggle live from the settings
  // scope, so switching the card applies to the very next request.
  try {
    installOpenCodeSession(ctx);
  } catch (error) {
    logger?.warn?.("[toolkit] opencodeSession listener registration:", error);
  }

  // modelCapability: own settings namespace fields, the llm-pi-ai discovery
  // wrap, the saved-model modality healing, and the POST sync-models route.
  // Dormant (never registered) on a host without the settings/llm/webServer
  // seams instead of failing the whole toolkit.
  try {
    installModelCapability(ctx, currentConfig);
  } catch (error) {
    logger?.warn?.("[toolkit] modelCapability install:", error);
  }

  try {
    installSettingsSection(ctx, settingsNamespace(NS), Config, {
      ...pluginConfig,
      chatWorkspacePath: chatPath(pluginConfig),
    }, {
      setSource: (current) => { source = current; },
      onChange: () => {
        void ensureChatDir(currentConfig(), logger);
        // Forced vision / text-only edits apply to the already-stored route
        // models immediately, without waiting for a restart or a sync.
        rehealModelCapability();
      },
    });
  } catch (error) {
    logger?.warn?.("[toolkit] settings registration:", error);
  }

  // The no-settings-provider path: ensure the chat directory against the
  // composition entry (the scope attach also triggers this via onChange).
  void ensureChatDir(currentConfig(), logger);
}
