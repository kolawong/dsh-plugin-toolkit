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
  };
  /**
   * Host-side directory the default chat workspace registers. Empty resolves
   * to <DSH_HOME>/chat before the settings namespace is registered.
   */
  chatWorkspacePath: string;
  /** Display title of the default no-project chat workspace (default 通用对话). */
  chatWorkspaceTitle: string;
}

/** Merged configuration the server reads after settings registration. */
export interface ToolkitRuntimeConfig extends ToolkitConfig {}
