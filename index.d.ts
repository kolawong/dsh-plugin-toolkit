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
     * Keep one llm-pi-ai route's model list current: wrap the runtime's model
     * discovery, mount the POST sync route, merge the live listing with the
     * stored catalog, enrich capacities from models.dev, and apply the forced
     * vision / text-only overrides (default true).
     */
    modelCapability: boolean;
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
}

/** Merged configuration the server reads after settings registration. */
export interface ToolkitRuntimeConfig extends ToolkitConfig {}

/** One picker candidate served by the GET models route. */
export interface RouteModelOption {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  /** Declared input modalities (`["text"]`, `["text","image"]`). */
  input?: string[];
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

/**
 * The route's known model ids for the settings-card picker: stored llm-pi-ai
 * rows unioned with the runtime's own view, deduped by id and sorted.
 */
export declare function knownRouteModels(ctx: unknown): Promise<RouteModelsPayload>;
