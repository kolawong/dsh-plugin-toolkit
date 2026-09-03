/**
 * Offline smoke for the toolkit server half: apply() against a fake cordis
 * context proves the settings namespace registers with a resolved chat path
 * base, and the chat directory gets created. Run: node scripts/smoke.mjs
 */
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { equal, ok } from "node:assert/strict";

const root = await mkdtemp(join(tmpdir(), "toolkit-smoke-"));
process.env.DSH_HOME = root;
const chatDir = join(root, "chat");

const registrations = [];
const watches = [];
/** Mutable section the fake scope reads through get() (installSettingsSection reads via get). */
let liveValue = undefined;
const ctx = {
  logger: { warn: (msg) => console.warn("ctx.logger.warn:", msg) },
  // installSettingsSection wires cleanup through ctx.effect and consults
  // ctx.fiber.state for unload suppression; both are inert here.
  fiber: { state: 0 },
  effect: (fn) => { fn(); },
  inject: (names, cb) => {
    equal(JSON.stringify(names), '["settings"]', "inject waits on the settings service");
    cb(Object.assign({}, ctx, { settings: { register: (ns, schema, opts) => {
      registrations.push({ ns, schema, opts });
      liveValue = opts.base;
      return {
        get: () => liveValue,
        watch: (fn) => { watches.push(fn); return () => {}; },
      };
    } } }));
  },
};

const mod = await import("../index.js");
equal(mod.name, "toolkit", "plugin name");
equal(mod.inject.join(","), "settings", "server inject");
ok(mod.Config, "Config schema exported");

mod.apply(ctx, { optimizations: { workspacelessChat: true, editLastMessage: true, viewActivity: true, slashI18n: true, changeReport: true }, chatWorkspacePath: "", chatWorkspaceTitle: "通用对话" });

equal(registrations.length, 1, "one namespace registration");
equal(registrations[0].ns, "toolkit", "namespace key equals the card key");
equal(registrations[0].opts.base.chatWorkspacePath, chatDir, "base carries the resolved default path");
equal(registrations[0].opts.base.optimizations.workspacelessChat, true, "base carries the toggle");
equal(registrations[0].opts.base.optimizations.editLastMessage, true, "base carries the editLastMessage toggle");
equal(registrations[0].opts.base.optimizations.viewActivity, true, "base carries the viewActivity toggle");
equal(registrations[0].opts.base.optimizations.slashI18n, true, "base carries the slashI18n toggle");
equal(registrations[0].opts.base.optimizations.changeReport, true, "base carries the changeReport toggle");
equal(registrations[0].opts.base.chatWorkspaceTitle, "通用对话", "base carries the friendly chat title");

// apply() kicks the directory creation asynchronously; wait for it.
for (let i = 0; i < 50; i += 1) {
  try {
    const info = await stat(chatDir);
    ok(info.isDirectory(), "chat directory exists after apply");
    break;
  } catch {
    if (i === 49) throw new Error("chat directory was not created");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// A settings-path edit mkdirs the new directory through the watch callback.
// installSettingsSection's watcher is payload-free: the section is committed
// before onChange, so the fake scope's live value is swapped, then the watch
// fires.
const nextDir = join(root, "chat2");
liveValue = { ...liveValue, chatWorkspacePath: nextDir };
watches[0]();
await new Promise((resolve) => setTimeout(resolve, 50));
ok((await stat(nextDir)).isDirectory(), "watch mkdirs the edited path");

console.log("toolkit server smoke: OK");
