/**
 * dsh-plugin-toolkit - public type face of the server half.
 * The client half is plain browser JS loaded through the dsh module table.
 */

export declare const name: "toolkit";
export declare const inject: string[];

/** Settings namespace name; the Web plugins page pairs the card by this key. */
export declare const NS: "toolkit";

export interface ToolkitConfig {
  /** Per-optimization switches; each maps to one row on the settings card. */
  optimizations: {
    /** Auto-connect a default chat workspace at cold start (default true). */
    workspacelessChat: boolean;
    /** Edit-and-resend button on the last user message (default true). */
    editLastMessage: boolean;
    /** Workspace-header activity icon + running-first/by-day overlay (default true). */
    viewActivity: boolean;
    /** Chinese descriptions for the '/' menu, client-side list rewrite (default true). */
    slashI18n: boolean;
    /** Codex-style per-turn change report card at the turn tail (default true). */
    changeReport: boolean;
    /**
     * Stamp the stable per-conversation x-opencode-session header on requests
     * OpenCode (Go/Zen) endpoints serve — plugin-side via an llm/stream
     * listener plus a globalThis.fetch wrap, no dsh source changes (default true).
     */
    opencodeSession: boolean;
    /**
     * Keep llm-pi-ai routes' model lists current: wrap the runtime's model
     * discovery so "fetch available models" merges each route's live endpoint
     * listing over its catalog answer, mount the POST sync route, enrich
     * capacities from models.dev, and apply the forced vision / text-only
     * overrides to the primary route (default true).
     */
    modelCapability: boolean;
    /**
     * Suggested reply as gray ghost text in the composer, filled with Tab.
     * Routes registered with the DSH llm runtime are called through it with
     * their own protocol; an unregistered primary route falls back to a direct
     * OpenAI-compatible request (default true).
     */
    smartReply: boolean;
  };
  /**
   * Host-side directory the default chat workspace registers. Empty resolves
   * to <DSH_HOME>/chat before the settings namespace is registered.
   */
  chatWorkspacePath: string;
  /** Display title of the default no-project chat workspace (default 通用对话). */
  chatWorkspaceTitle: string;
  /** Explicit API key for the modelCapability probe; empty uses modelsApiKeyEnvVar. */
  modelsApiKey: string;
  /** Environment variable consulted when modelsApiKey is empty (default OPENCODE_API_KEY). */
  modelsApiKeyEnvVar: string;
  /** The llm-pi-ai route whose model list is kept current (default opencode-go). */
  modelsRouteKey: string;
  /** Endpoint probed for the live model listing (default the OpenCode Go API). */
  modelsBaseURL: string;
  /** Wire protocol written onto the route (default openai-completions). */
  modelsRouteApi: string;
  /** Same-origin route forcing one model-list sync (POST). */
  modelsSyncPath: string;
  /** Same-origin route listing the route's known models for the picker (GET). */
  modelsPath: string;
  /**
   * Per-route endpoint overrides for the discovery enrichment, keyed by
   * llm-pi-ai route key (default {}): either the endpoint string, or
   * `{ baseURL, api }` when the route's protocol is not stated in its profile.
   * Consulted after the route's own stored baseURL, so a catalog route with no
   * configured endpoint can still be probed.
   */
  modelsRouteBaseURLs: Record<string, string | { baseURL: string; api?: string }>;
  /**
   * Per-route model ids the endpoint serves without listing them (default {}),
   * e.g. `{ 'minimax-cn': ['MiniMax-M3.1-Flash-Preview'] }`. Appended to that
   * route's discovery answer whether or not the live probe ran.
   */
  modelsRouteExtraModels: Record<string, string[]>;
  /** Fill missing capacities/modalities from the models.dev registry (default true). */
  modelsEnrichFromRegistry: boolean;
  /** Provider directory inside the models.dev registry (default opencode-go). */
  modelsRegistryProvider: string;
  /** Model ids to force vision-capable, overriding auto-detection. */
  modelsVision: string[];
  /** Model ids to force text-only (image stripped), overriding auto-detection. */
  modelsTextOnly: string[];
  /** Per-request upstream timeout in seconds (default 10). */
  modelsTimeoutSec: number;
  /** One-time marker: the former quota-badges model settings were adopted. */
  modelsMigratedFromQuotaBadges: boolean;
  /**
   * llm-pi-ai route the suggestion call uses (default ""). Empty reuses
   * modelsRouteKey. When the route is registered with the llm runtime the call
   * goes through `ctx.llm.stream`, so catalog routes and non-OpenAI protocols
   * (e.g. minimax-cn's anthropic-messages) work without an endpoint override.
   */
  suggestRouteKey: string;
  /**
   * Model asked to draft the candidates (default ""). Empty resolves at call
   * time to the route's own first known id; a cheap, fast model is the right
   * choice because the call runs once per settled turn.
   */
  suggestModel: string;
  /** Same-origin route the client POSTs a suggestion request to. */
  suggestPath: string;
  /** Same-origin route listing the routes and models the pickers offer (GET). */
  suggestOptionsPath: string;
  /** Reply-language pin: "" follows the UI, otherwise "zh" or "en". */
  suggestLanguage: string;
  /** Candidate replies kept per turn (default 3, clamped to 1..5). */
  suggestCount: number;
  /** Total per-request deadline in seconds for the suggestion call (default 30). */
  suggestTimeoutSec: number;
  /**
   * Learn this user's phrasing locally — aggregate length/opening words, up to
   * five short real-user examples, and accepted suggestions — under
   * <DSH_HOME>/plugins/dsh-plugin-toolkit/suggest-habits.json (default true).
   * The file stays local; a short aggregate hint rides in the suggestion
   * prompt sent to the configured model.
   */
  suggestLearnHabits: boolean;
}

/** Merged configuration the server reads after settings registration. */
export interface ToolkitRuntimeConfig extends ToolkitConfig {}

/**
 * The Cordis config schema for this plugin: a schemastery validator that
 * Cordis runs against the composition/bundle-patch and user layers at load
 * time, filling every default.
 *
 * Typed loosely on purpose — it is a validator, and the resolved shape a
 * caller actually handles is {@link ToolkitConfig}.
 */
export declare const Config: unknown;

/**
 * Validate a settings namespace name against the Cordis grammar. Exported
 * because the plugin carries it directly (importing it from
 * `@deepseek-ai/dsh-settings` made the host build's moving export list a
 * link-time failure).
 */
export declare function settingsNamespace(value: string): string;

/**
 * Cordis plugin activation for the server half: publishes the plugin context,
 * installs the opencodeSession fetch wrap + llm/stream listener, then the
 * modelCapability subsystem, and registers the `toolkit` settings namespace.
 *
 * Never throws on a missing host seam; a degraded install is logged as a
 * warning so the rest of the toolkit keeps working.
 * @param ctx - the plugin context; `settings` is declared as an injection.
 * @param config - the resolved composition config (defaults applied by Cordis).
 */
export declare function apply(ctx: unknown, config?: Partial<ToolkitConfig>): void;

/** One picker candidate served by the GET models route. */
export interface RouteModelOption {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  /** Declared input modalities (`["text"]`, `["text","image"]`). */
  input?: string[];
}

/** One route the smartReply settings picker offers. */
export interface SuggestRouteOption {
  id: string;
  name: string;
  /** True for the modelCapability primary route (the "default" entry). */
  primary: boolean;
  /** Legacy hosts: a stored endpoint resolves for this route. */
  reachable: boolean;
  /**
   * Wire protocol resolved from the route's own profile / plugin override /
   * primary-route settings. "" when unresolved (a catalog-only route's protocol
   * is not read by the host resolver).
   */
  api: string;
  /**
   * Whether a suggestion call can reach this route on the current host:
   * always true when the host has the llm runtime, otherwise only for a
   * reachable OpenAI-compatible route.
   */
  available: boolean;
}

/** Payload of the GET suggest-options route. */
export interface SuggestOptionsPayload {
  ok: true;
  primaryRoute: string;
  route: string;
  /** The host can call any registered route through `ctx.llm.stream`. */
  runtime: boolean;
  /** Local learning state; `turns`/`accepted` are zero when disabled. */
  habit: { enabled: boolean; turns: number; accepted: number };
  routes: SuggestRouteOption[];
  models: RouteModelOption[];
}

/** Payload of the POST suggest-reply route. */
export interface SuggestReplyPayload {
  ok: boolean;
  suggestions?: string[];
  error?: { code: string; message: string };
}

/** Payload of the GET models route (in-process reads, never a live probe). */
export interface RouteModelsPayload {
  ok: boolean;
  routeKey: string;
  count: number;
  models: RouteModelOption[];
  forcedVision: string[];
  forcedTextOnly: string[];
}

/** Failure payload of the GET models route; `code` is machine-readable. */
export interface RouteModelsError {
  ok: false;
  error: { code: string; message: string };
}

/**
 * The route's known model ids for the settings-card picker: stored llm-pi-ai
 * rows unioned with the runtime's own view, deduped by id and sorted.
 *
 * Never probes the network. A failure — the optimization disabled, or the
 * configured route not registered at all — is returned as
 * {@link RouteModelsError} rather than as a successful empty list, so the card
 * can say why it is empty.
 *
 * Re-exported from the package root; the implementation lives in
 * `./model-sync.js`.
 */
export declare function knownRouteModels(ctx: unknown): Promise<RouteModelsPayload | RouteModelsError>;
