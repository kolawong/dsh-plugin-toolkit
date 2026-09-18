/**
 * Wiring test for the toolkit settings card (client.js).
 *
 * The bundle is loaded with a fake module loader and a minimal hook runtime,
 * then the registered settings card is rendered for real (no DOM, no React).
 * It guards the failure mode that shipped once: a prop referenced but never
 * destructured (`typeof toolkitModels !== "function"` on an undeclared name is
 * silently "undefined"), which made the modelCapability picker show an empty
 * candidate list even though the server route answered 36 models.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// ── a minimal React ─────────────────────────────────────────────────────────

/** Per-render hook state; `renderCard` resets the cursor on every render. */
const hookState = { index: 0, store: [], updates: [], pending: [] };

const ReactStub = {
  Fragment: Symbol("Fragment"),
  useState(initial) {
    const slot = hookState.index++;
    if (!(slot in hookState.store)) hookState.store[slot] = initial;
    return [hookState.store[slot], (next) => {
      hookState.store[slot] = typeof next === "function" ? next(hookState.store[slot]) : next;
      hookState.updates.push({ slot, next: hookState.store[slot] });
    }];
  },
  useEffect(fn) { hookState.pending.push(fn); },
  useLayoutEffect(fn) { hookState.pending.push(fn); },
  useCallback(fn) { return fn; },
  useRef() { return { current: undefined }; },
  // No reconciler here, so memo is an identity wrapper; the tests render the
  // component directly.
  memo(component) { return component; },
};

function resetHooks() {
  hookState.index = 0;
  hookState.store.length = 0;
  hookState.updates.length = 0;
  hookState.pending.length = 0;
}

function renderComponent(component, props) {
  hookState.index = 0;
  hookState.pending = [];
  return component(props);
}

/** Run the effects the last render queued (React's dep comparison is not emulated). */
async function flushEffects() {
  const batch = hookState.pending;
  hookState.pending = [];
  for (const fn of batch) await fn();
}

const jsx = (type, props, key) => ({ type, props: props ?? {}, key });

/** The i18n face the card receives: keys survive so assertions can name them. */
const t = (key, params) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`);

// ── bundle + card capture ───────────────────────────────────────────────────

/** Load the browser bundle and return its factory (the module table entry). */
function loadFactory() {
  const source = readFileSync(join(here, "..", "client.js"), "utf8");
  let factory = null;
  const window = { __ModuleLoader__: { load: (entry) => { factory = entry.factory; } } };
  new Function("window", source)(window);
  assert.equal(typeof factory, "function", "client bundle registers a factory");
  return factory;
}

/** The document face ensureStyles() touches during apply(). */
function stubDocument() {
  globalThis.document = {
    getElementById: () => null,
    createElement: () => ({ id: "", textContent: "" }),
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
  };
}

/**
 * Boot the exported apply() just far enough to capture the settings card
 * component and the props the slot injects into it.
 * @returns {{ component: Function, injected: object, snapshot: object }}
 */
function captureCard() {
  stubDocument();
  const captured = [];
  const snapshot = {
    status: "ready",
    writable: true,
    mode: "file",
    revision: 3,
    value: {
      chatWorkspacePath: "",
      chatWorkspaceTitle: "通用对话",
      optimizations: { modelCapability: true },
      modelsApiKey: "",
      modelsApiKeyEnvVar: "OPENCODE_API_KEY",
      modelsRouteKey: "opencode-go",
      modelsVision: [],
      modelsTextOnly: [],
    },
  };
  const scope = {
    getSnapshot: () => snapshot,
    set: async () => {},
    subscribe: () => () => {},
  };
  const ctx = {
    locale: { register() {} },
    on() {},
    effect(fn) { fn?.(); },
    inject() {},
    settingsScope: { bind: () => scope },
    slots: {
      inject(name, generator) {
        if (name !== "settings.plugin.item") return;
        const iterator = generator();
        for (let step = iterator.next(); !step.done; step = iterator.next()) void step.value;
      },
      register(spec, component) {
        captured.push({ spec, component });
        return () => {};
      },
    },
  };
  const require = (name) => {
    if (name === "react") return ReactStub;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "@deepseek-ai/dsh-client-ui-primitives") {
      return new Proxy({}, { get: () => (props) => ({ type: "stub", props: props ?? {} }) });
    }
    throw new Error("unexpected require: " + name);
  };
  const exportsObj = loadFactory()(require);
  exportsObj.apply(ctx);
  assert.equal(captured.length, 1, "the settings card registers exactly once");
  return { component: captured[0].component, injected: captured[0].spec.inject(), snapshot };
}

/** Depth-first search for the props of the node carrying one aria-label. */
function propsByAriaLabel(node, label) {
  if (node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = propsByAriaLabel(child, label);
      if (hit !== null) return hit;
    }
    return null;
  }
  const props = node.props ?? {};
  if (props["aria-label"] === label && typeof props.onClick === "function") return props;
  return propsByAriaLabel(props.children, label);
}

/**
 * Render the card, expand it, open the modelCapability dialog, and flush the
 * effects that dialog queues.
 */
async function openModelCapabilityDialog(toolkitModels) {
  resetHooks();
  const { component, injected, snapshot } = captureCard();
  // `injected` carries the bundle's own fetch-based loader; the test double
  // replaces it so the card runs without a server.
  const props = { ...injected, t, useToolkitSettings: () => snapshot, toolkitModels };

  let tree = renderComponent(component, props);
  await flushEffects();

  const expand = propsByAriaLabel(tree, "cardOpen");
  assert.ok(expand, "the toolkit card renders an expand affordance");
  expand.onClick();
  tree = renderComponent(component, props);
  await flushEffects();

  const openDialog = propsByAriaLabel(tree, "optModelsTitle");
  assert.ok(openDialog, "the modelCapability sub-card is rendered while expanded");
  openDialog.onClick();
  renderComponent(component, props);
  await flushEffects();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("every React hook the bundle calls is actually destructured from React", () => {
  // Destructuring a missing React property yields undefined (no throw at load),
  // so a hook that is called but never destructured only explodes when the
  // component first renders — exactly how useLayoutEffect broke the model
  // dialog with a blank modal. Guard it statically.
  const source = readFileSync(join(here, "..", "client.js"), "utf8");
  const fromReact = /const \{([^}]*)\} = React;/.exec(source);
  assert.ok(fromReact, "the bundle destructures React");
  const provided = new Set(fromReact[1].split(",").map((name) => name.trim()).filter(Boolean));

  /** Names bound anywhere in the bundle (destructuring, function, const/let). */
  const bound = new Set();
  for (const match of source.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const name of match[1].split(",")) {
      const clean = name.split(":").pop().trim().replace(/\.\.\./, "");
      if (/^[A-Za-z_$][\w$]*$/.test(clean)) bound.add(clean);
    }
  }
  for (const match of source.matchAll(/(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/g)) {
    bound.add(match[1] ?? match[2]);
  }

  const called = new Set([...source.matchAll(/\b(use[A-Z][A-Za-z0-9]*)\s*\(/g)].map((match) => match[1]));
  const missing = [...called].filter((name) => !provided.has(name) && !bound.has(name));
  assert.deepEqual(missing, [], `hooks called but never bound: ${missing.join(", ")}`);
});

test("modelCapability dialog asks the injected loader for candidates", async () => {
  let loaderCalls = 0;
  await openModelCapabilityDialog(async () => {
    loaderCalls += 1;
    return { ok: true, routeKey: "opencode-go", count: 1, models: [{ id: "alpha", name: "Alpha" }] };
  });

  assert.equal(loaderCalls, 1, "opening the dialog calls the injected toolkitModels loader");
  assert.ok(
    hookState.updates.some((update) => Array.isArray(update.next) && update.next[0]?.id === "alpha"),
    "the loaded candidates reach the picker state",
  );
  assert.equal(
    hookState.updates.some((update) => update.next === "modelsPickUnavailable"),
    false,
    "a wired loader is never reported as missing",
  );
});

test("a failing loader surfaces the failure instead of an empty list", async () => {
  await openModelCapabilityDialog(async () => { throw new Error("HTTP 404"); });
  const reported = hookState.updates.find(
    (update) => typeof update.next === "string" && update.next.startsWith("modelsPickFailed"),
  );
  assert.ok(reported, "the failure is shown with the modelsPickFailed copy");
  assert.ok(reported.next.includes("HTTP 404"), "the failure keeps the underlying message");
  assert.equal(
    hookState.updates.some((update) => update.next === "modelsPickUnavailable"),
    false,
    "a throwing loader is a fetch failure, not a missing loader",
  );
});
test("every Tooltip call passes the label prop the primitive expects", () => {
  // The primitive is Tooltip({ label, side, ... }); passing `content` renders
  // an empty bubble without any error, so guard it statically.
  const source = readFileSync(join(here, "..", "client.js"), "utf8");
  const calls = [...source.matchAll(/jsx\(Tooltip,\s*\{/g)];
  assert.ok(calls.length > 0, "the bundle uses Tooltip");
  for (const call of calls) {
    const snippet = source.slice(call.index, call.index + 320);
    assert.match(snippet, /label:/, "Tooltip must pass label");
    assert.doesNotMatch(snippet, /\bcontent:/, "Tooltip must not pass content");
  }
});

test("registers into plugins.bundle.config, plugins.row.config, and settings.plugin.item", () => {
  stubDocument();
  const captured = [];
  const scope = {
    getSnapshot: () => ({ status: "ready", writable: true, value: {} }),
    set: async () => {},
    subscribe: () => () => {},
  };
  const ctx = {
    locale: { register() {} },
    on() {},
    effect(fn) { fn?.(); },
    inject() {},
    settingsScope: { bind: () => scope },
    slots: {
      inject(name, generator) {
        const iterator = generator();
        for (let step = iterator.next(); !step.done; step = iterator.next()) void step.value;
      },
      register(spec, component) {
        captured.push({ spec, component });
        return () => {};
      },
    },
  };
  const require = (name) => {
    if (name === "react") return ReactStub;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "@deepseek-ai/dsh-client-ui-primitives") {
      return new Proxy({}, { get: () => (props) => ({ type: "stub", props: props ?? {} }) });
    }
    throw new Error("unexpected require: " + name);
  };
  const exportsObj = loadFactory()(require);
  exportsObj.apply(ctx);

  const bundleConfig = captured.find((entry) => entry.spec.name === "plugins.bundle.config");
  assert.ok(bundleConfig, "registers plugins.bundle.config slot");
  assert.equal(bundleConfig.spec.key, "dsh-plugin-toolkit", "bundle config keyed by bundle name");

  const rowConfig = captured.find((entry) => entry.spec.name === "plugins.row.config");
  assert.ok(rowConfig, "registers plugins.row.config slot");
  assert.equal(rowConfig.spec.key, "dsh-plugin-toolkit#toolkit", "row config keyed by <bundle>#<rowId>");

  const legacyItem = captured.find((entry) => entry.spec.name === "settings.plugin.item");
  assert.ok(legacyItem, "registers legacy settings.plugin.item slot");
  assert.equal(legacyItem.spec.key, "toolkit");

  // Summary view returns one-liner string
  resetHooks();
  const summary = bundleConfig.component({ t, view: "summary" });
  assert.equal(summary, "cardDesc", "summary view returns cardDesc");

  // Page view is expanded by default
  resetHooks();
  const pageTree = renderComponent(bundleConfig.component, {
    ...bundleConfig.spec.inject(),
    t,
    view: "page",
    useToolkitSettings: () => ({ status: "ready", writable: true, value: { optimizations: { modelCapability: true } } }),
  });
  const modelSubCard = propsByAriaLabel(pageTree, "optModelsTitle");
  assert.ok(modelSubCard, "page view starts expanded with subcards visible");
});

