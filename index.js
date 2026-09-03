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
 * @license MIT
 */

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";

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
  }).default({ workspacelessChat: true, editLastMessage: true, viewActivity: true, slashI18n: true, changeReport: true }),
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

  try {
    installSettingsSection(ctx, settingsNamespace(NS), Config, {
      ...pluginConfig,
      chatWorkspacePath: chatPath(pluginConfig),
    }, {
      setSource: (current) => { source = current; },
      onChange: () => { void ensureChatDir(currentConfig(), logger); },
    });
  } catch (error) {
    logger?.warn?.("[toolkit] settings registration:", error);
  }

  // The no-settings-provider path: ensure the chat directory against the
  // composition entry (the scope attach also triggers this via onChange).
  void ensureChatDir(currentConfig(), logger);
}
