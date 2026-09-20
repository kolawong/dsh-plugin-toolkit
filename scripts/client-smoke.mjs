/**
 * Offline smoke for the toolkit client half: loads client.js through a fake
 * module-loader facade, then applies it against a fake cordis context whose
 * remote namespace services mirror the stock accessor shape.
 * Verifies slashI18n (dictionary rewrite of commands.list / skills.list
 * results, name immutability, the settings + locale gates, miss fallback,
 * wrap idempotence) and changeReport (turn-data accumulation over wire
 * events, per-file aggregation, seq filtering, the settings gate, chain
 * priority, and definition registration idempotence).
 * Run: node scripts/client-smoke.mjs
 */
import { equal, ok, deepEqual } from "node:assert/strict";

// ── fake module table facade ───────────────────────────────────────────────
let factory = undefined;
globalThis.window = {
  __ModuleLoader__: {
    load: (row) => { factory = row.factory; },
  },
};
// Minimal DOM stub for ensureStyles().
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({}),
  head: { appendChild: () => {} },
};
const fakePrimitives = {
  Modal: () => null,
  Tooltip: () => null,
  projectUserText: () => null,
  JsonBlock: () => null,
  IconChevronDownOutline14: () => null,
  IconCopyOutline16: () => null,
  IconCheckOutline16: () => null,
  IconPersonalizationOutline16: () => null,
  IconNewChatOutline16: () => null,
  IconEditOutline16: () => null,
  IconClockOutline16: () => null,
  IconGlobeOutline14: () => null,
  IconBranchOutline16: () => null,
  DiffBlock: () => null,
  // Mirror the primitives' block-level counting (old block = removed lines,
  // new block = added lines), matching what the review DiffBlock renders.
  diffTotals: (diffs) => {
    const contentLines = (text) => {
      if (text === "") return [];
      const body = text.endsWith("\n") ? text.slice(0, -1) : text;
      return body.split("\n");
    };
    let added = 0;
    let removed = 0;
    for (const diff of diffs) {
      if (diff.oldText !== null) removed += contentLines(diff.oldText).length;
      added += contentLines(diff.newText).length;
    }
    return { added, removed };
  },
};
await import("../client.js");
ok(factory, "client factory registered through __ModuleLoader__");
const exports = factory((name) => (name === "react"
  ? {
    useState: () => [undefined, () => {}],
    useEffect: () => {},
    useLayoutEffect: () => {},
    useRef: () => ({ current: null }),
    memo: (component) => component,
  }
  : name === "react/jsx-runtime"
    ? { jsx: () => null, jsxs: () => null }
    : fakePrimitives));

// ── fake context ───────────────────────────────────────────────────────────
let localeActive = "zh";
const registeredDictionaries = [];
const injected = [];
const slotInjects = [];
const registeredSlots = [];
const registeredDefinitions = [];
const settingsValue = { optimizations: { slashI18n: true } };
const scope = {
  getSnapshot: () => ({ status: "ready", value: settingsValue }),
  subscribe: () => () => {},
};
const ctx = {
  locale: {
    register: (ns, dict) => registeredDictionaries.push({ ns, dict }),
    getSnapshot: () => ({ active: localeActive }),
  },
  settingsScope: { bind: () => scope },
  slots: {
    inject: (name, gen) => { slotInjects.push({ name, gen }); const it = gen(); it.next(); },
    register: (options, component) => { registeredSlots.push({ options, component }); return {}; },
  },
  // Cordis runs an effect's callback immediately and keeps its return value as
  // the disposer. Ignoring the callback (as this stub used to) silently skipped
  // every installer that is now registered through ctx.effect.
  effect: (fn) => {
    const dispose = fn();
    return () => { if (typeof dispose === "function") dispose(); };
  },
  on: () => () => {},
  inject: (names, cb) => { injected.push({ names, cb }); },
};

exports.apply(ctx);
equal(registeredDictionaries.length, 1, "locale namespace registered");
ok(registeredDictionaries[0].dict.zh.optI18nTitle, "slashI18n card strings present (zh)");
ok(registeredDictionaries[0].dict.en.optI18nTitle, "slashI18n card strings present (en)");

// ── fake namespace services with the stock accessor shape ──────────────────
const commandsResult = {
  ok: true,
  value: [
    { name: "compact", description: "Compact older conversation history" },
    { name: "feedback", description: "record feedback about this session", input: { hint: "<text>", images: false } },
    { name: "mystery", description: "Brand new command description", input: { hint: "<unknown>" } },
  ],
};
const skillsResult = {
  ok: true,
  value: { skills: [
    { name: "manage-taskboard", description: "Manage DSH Taskboard / DeepSeek Harness work with taskctl. Use for taskboard issue IDs, status sync, comments, or project task tracking.", modelInvocable: true },
    { name: "brand-new", description: "Never seen before skill.", modelInvocable: false },
  ] },
};

/**
 * Mirror RemoteNamespaceService: a getter accessor whose closure re-reads the
 * method table per access and routes through invokeRemote.
 */
function makeNamespaceService(result) {
  const svc = {
    invokeRemote: () => Promise.resolve(result),
  };
  Object.defineProperty(svc, "list", {
    configurable: true,
    enumerable: true,
    get: function () {
      const self = this;
      return (...args) => self.invokeRemote(args);
    },
  });
  return svc;
}

const commandsSvc = makeNamespaceService(commandsResult);
const skillsSvc = makeNamespaceService(skillsResult);

// Drive the two ctx.inject callbacks.
const workspaceCallback = injected.find((row) => row.names.includes("workspaces") && row.names.includes("sessions"));
ok(workspaceCallback, "workspacelessChat wiring present");
workspaceCallback.cb({ workspaces: {}, sessions: {}, uiWorkspace: { openSession: () => {} } });
const remoteCallback = injected.find((row) => row.names.join() === "remote.commands,remote.skills");
ok(remoteCallback, "slashI18n wiring present");
remoteCallback.cb({ "remote.commands": commandsSvc, "remote.skills": skillsSvc });

// ── rewritten responses ────────────────────────────────────────────────────
const zhCommands = await commandsSvc.list("s1");
ok(zhCommands.ok, "commands result ok flag preserved");
equal(zhCommands.value[0].description, "压缩更早的对话历史", "command description translated");
equal(zhCommands.value[0].name, "compact", "command name untouched");
equal(zhCommands.value[1].description, "记录对本会话的反馈", "second command description translated");
equal(zhCommands.value[1].input.hint, "<反馈内容>", "input hint translated");
equal(zhCommands.value[1].input.images, false, "input.images preserved");
equal(zhCommands.value[2].description, "Brand new command description", "dictionary miss falls back to English");
equal(zhCommands.value[2].input.hint, "<unknown>", "unknown hint falls back");
ok(zhCommands.value !== commandsResult.value, "result value is a fresh array (no aliasing)");

const zhSkills = await skillsSvc.list("s1");
equal(zhSkills.value.skills[0].description, "用 taskctl 管理 DSH Taskboard / DeepSeek Harness 的任务。适用于任务板 issue 编号、状态同步、评论或项目任务跟踪。", "skill description translated");
equal(zhSkills.value.skills[0].name, "manage-taskboard", "skill name untouched");
equal(zhSkills.value.skills[0].modelInvocable, true, "modelInvocable preserved");
equal(zhSkills.value.skills[1].description, "Never seen before skill.", "unknown skill falls back");

// The original wire result must be untouched (fresh row objects).
equal(commandsResult.value[0].description, "Compact older conversation history", "original result not mutated");
equal(commandsResult.value[1].input.hint, "<text>", "original hint not mutated");

// ── gates ──────────────────────────────────────────────────────────────────
settingsValue.optimizations.slashI18n = false;
const offCommands = await commandsSvc.list("s1");
equal(offCommands.value[0].description, "Compact older conversation history", "settings off = passthrough");
settingsValue.optimizations.slashI18n = true;

localeActive = "en";
const enCommands = await commandsSvc.list("s1");
equal(enCommands.value[0].description, "Compact older conversation history", "non-zh locale = passthrough");
localeActive = "zh";

// ── failure containment ────────────────────────────────────────────────────
const failingSvc = { invokeRemote: () => Promise.reject(new Error("carrier down")) };
Object.defineProperty(failingSvc, "list", {
  configurable: true, enumerable: true,
  get: function () { const self = this; return (...args) => self.invokeRemote(args); },
});
remoteCallback.cb({ "remote.commands": failingSvc, "remote.skills": skillsSvc });
await failingSvc.list("s1").then(
  () => ok(false, "rejection must propagate"),
  (error) => equal(error.message, "carrier down", "rejections pass through unwrapped"),
);

// ── changeReport: turn-data accumulator + tail chain entry ─────────────────
const changeReportCallback = injected.find((row) => row.names.join() === 'uiConversation,remote,remote.session');
ok(changeReportCallback, "changeReport wiring present");
changeReportCallback.cb({
  uiConversation: { events: { register: (def) => registeredDefinitions.push(def) } },
  remote: {
    $host: { isLoopback: true },
    session: { canOpenWorkspacePath: () => Promise.resolve({ ok: true, value: true }) },
  },
  "remote.session": {},
});
equal(registeredDefinitions.length, 1, "turn-data definition registered once");

const def = registeredDefinitions[0];
let defCtx = { state: def.start({}, { event: { type: 'turn/start', data: { turn: 7 } } }) };
const feedEvent = (event) => { defCtx = { state: def.update(defCtx, { event }) }; };
feedEvent({ type: 'tool/call', data: { turn: 7, callId: 'c1', name: 'edit', arguments: JSON.stringify({ file_path: '/x/a.ts', old_string: 'l1\nl2', new_string: 'L1' }) } });
feedEvent({ type: 'tool/call', data: { turn: 7, callId: 'c2', name: 'write', arguments: JSON.stringify({ file_path: '/x/b.ts', content: 'x\ny\nz\n' }) } });
feedEvent({ type: 'tool/call', data: { turn: 7, callId: 'c3', name: 'edit', arguments: JSON.stringify({ file_path: '/x/c.ts', old_string: 'a', new_string: 'b' }) } });
feedEvent({ type: 'tool/call', data: { turn: 7, callId: 'c4', name: 'bash', arguments: JSON.stringify({ command: 'ls' }) } });
feedEvent({ type: 'tool/result', seq: 10, data: { turn: 7, message: { content: [{ isError: false }], source: { callId: 'c1' } } } });
feedEvent({ type: 'tool/result', seq: 11, data: { turn: 7, message: { content: [{ isError: true }], source: { callId: 'c3' } } } });
feedEvent({ type: 'tool/result', seq: 12, data: { turn: 7, message: { content: [{ isError: false }], source: { callId: 'c2' } } } });
feedEvent({ type: 'tool/result', seq: 13, data: { turn: 7, message: { content: [{ isError: false }], source: { callId: 'zz' } } } });

const location = def.buildLocationData(defCtx, 'turn', undefined);
ok(location, "turn location data built");
equal(location.key, "changeReport", "location data keyed for the selector");
equal(location.value.hunks.length, 2, "failed + unknown results contribute nothing");
const repeated = def.buildLocationData(defCtx, 'turn', location);
equal(repeated, location, "unchanged state reuses the previous location data");

const tail = registeredSlots.find((row) => row.options.name === 'conversation.chat.turnTail');
ok(tail, "turnTail slot registered");
ok(typeof tail.options.select === "function", "chain selector present");
equal(tail.options.priority, -10, "chain priority runs ahead of ui-deliverables");
ok(typeof tail.component === "function", "card component registered");

const turnData = { get: (key) => (key === "changeReport" ? location.value : undefined) };
const model = tail.options.select({ turn: { data: turnData }, seq: 12 });
ok(model, "selector accepts a mutating turn");
equal(model.files.length, 2, "one entry per file");
equal(model.added, 4, "aggregate added = a.ts 1 + b.ts 3");
equal(model.removed, 2, "aggregate removed = a.ts 2");
const fileA = model.files.find((file) => file.path === "/x/a.ts");
const fileB = model.files.find((file) => file.path === "/x/b.ts");
ok(fileA && fileB, "both files present");
equal(fileA.added, 1, "a.ts added");
equal(fileA.removed, 2, "a.ts removed");
equal(fileB.added, 3, "b.ts added (trailing newline not a line)");
equal(fileB.removed, 0, "b.ts create removes nothing");

// Closing-seq filter: settlements after the closing assistant are excluded.
const earlyModel = tail.options.select({ turn: { data: turnData }, seq: 10 });
equal(earlyModel.files.length, 1, "seq filter drops later settlements");
equal(earlyModel.files[0].path, "/x/a.ts", "only the early settlement remains");

// A non-mutating turn declines.
const emptyModel = tail.options.select({ turn: { data: { get: () => ({ hunks: [] }) } }, seq: 12 });
equal(emptyModel, null, "no mutations = decline");

// Settings gate: off declines (and the stock tail renders instead).
settingsValue.optimizations.changeReport = false;
equal(tail.options.select({ turn: { data: turnData }, seq: 12 }), null, "settings off = decline");
settingsValue.optimizations.changeReport = true;
ok(tail.options.select({ turn: { data: turnData }, seq: 12 }), "settings back on = accept");

// ── Code Dispatch grammar: run_code's nested write/edit sub-calls ──────────
// Nested tool calls inside a root run_code call never produce root tool/call
// events; they arrive as tool/code-dispatch events carrying rootCallId.
equal(def.match({ type: 'tool/call', data: { turn: 8, callId: 'rc9', name: 'run_code', arguments: '{}' } }).id, '8', 'root call matches its turn');
let defCtx8 = { state: def.start({}, { event: { type: 'turn/start', data: { turn: 8 } } }) };
const feed8 = (event) => { defCtx8 = { state: def.update(defCtx8, { event }) }; };
feed8({ type: 'tool/call', data: { turn: 8, callId: 'rc9', name: 'run_code', arguments: '{}' } });
feed8({ type: 'tool/code-dispatch', seq: 20, data: { rootCallId: 'rc9', parentCallId: 'rc9', subCallId: 'rc9:code:0', name: 'write', arguments: { file_path: '/x/d.ts', content: 'a\nb\n' }, isError: false, content: [] } });
feed8({ type: 'tool/code-dispatch', seq: 21, data: { rootCallId: 'rc9', parentCallId: 'rc9', subCallId: 'rc9:code:1', name: 'edit', arguments: { file_path: '/x/d.ts', old_string: 'a', new_string: 'A' }, isError: false, content: [] } });
feed8({ type: 'tool/code-dispatch', seq: 22, data: { rootCallId: 'rc9', parentCallId: 'rc9', subCallId: 'rc9:code:2', name: 'bash', arguments: { command: 'ls' }, isError: false, content: [] } });
feed8({ type: 'tool/code-dispatch', seq: 23, data: { rootCallId: 'rc9', parentCallId: 'rc9', subCallId: 'rc9:code:3', name: 'edit', arguments: { file_path: '/x/e.ts', old_string: 'x', new_string: 'y' }, isError: true, content: [] } });
const location8 = def.buildLocationData(defCtx8, 'turn', undefined);
ok(location8, 'turn 8 location data built');
equal(location8.value.hunks.length, 2, 'dispatch write+edit accumulate; bash and failed edits do not');

const routedDispatch = def.match({ type: 'tool/code-dispatch', data: { rootCallId: 'rc9' } });
ok(routedDispatch, 'dispatch event matches');
equal(routedDispatch.id, '8', 'dispatch routes via the rootCallId to turn map');
equal(def.match({ type: 'tool/code-dispatch', data: { rootCallId: 'never-seen' } }), null, 'unknown root declines');

const model8 = tail.options.select({ turn: { data: { get: (k) => (k === 'changeReport' ? location8.value : undefined) } }, seq: 21 });
ok(model8, 'turn 8 selector accepts');
equal(model8.files.length, 1, 'turn 8 aggregates into one file');
equal(model8.added, 3, 'd.ts: write 2 lines + edit 1 line');
equal(model8.removed, 1, 'd.ts: edit removes 1 line');

// ── idempotence: re-apply the whole plugin ─────────────────────────────────
exports.apply(ctx);
const again = await commandsSvc.list("s1");
equal(again.value[0].description, "压缩更早的对话历史", "double apply stays translated (no double wrap)");

// Non-promise outcomes pass through untouched.
commandsSvc.invokeRemote = () => ({ ok: false, error: { code: "x", message: "y" } });
const errResult = await commandsSvc.list("s1");
deepEqual(errResult, { ok: false, error: { code: "x", message: "y" } }, "error results pass through");
equal(registeredDefinitions.length, 1, "re-apply does not double-register the definition");

console.log("toolkit client smoke: OK");
