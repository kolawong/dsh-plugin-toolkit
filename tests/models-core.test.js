/**
 * Tests for the dependency-free model-list sync core (models-core.js).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { extractModelIds, mergeModelLists, diffModelIds, MAX_LISTING_BYTES } from "../models-core.js";

test("extractModelIds: reads OpenAI-shaped listing in endpoint order", () => {
  assert.deepEqual(
    extractModelIds({ object: "list", data: [{ id: "b" }, { id: "a" }] }),
    ["b", "a"],
  );
});

test("extractModelIds: skips unusable rows and duplicate ids", () => {
  assert.deepEqual(
    extractModelIds({ data: [{ id: "a" }, { id: "" }, {}, { id: 42 }, null, { id: "a" }, { id: "c" }] }),
    ["a", "c"],
  );
});

test("extractModelIds: null when the data array is missing", () => {
  assert.equal(extractModelIds({ models: [] }), null);
  assert.equal(extractModelIds(null), null);
  assert.equal(extractModelIds(undefined), null);
  assert.equal(extractModelIds({ data: "nope" }), null);
});

const CATALOG = [
  { id: "known-a", name: "Known A", contextWindow: 262144, maxTokens: 32768 },
  { id: "known-b", contextWindow: 128000 },
  { id: "extra", contextWindow: -5, maxTokens: "junk", name: "" },
];

test("mergeModelLists: live leads with catalog metadata; catalog-only appended", () => {
  const merged = mergeModelLists({ catalog: CATALOG, live: ["fresh", "known-b", "known-a"] });
  assert.deepEqual(merged, [
    { id: "fresh" },
    { id: "known-b", contextWindow: 128000 },
    { id: "known-a", name: "Known A", contextWindow: 262144, maxTokens: 32768 },
    { id: "extra" },
  ]);
});

test("mergeModelLists: junk metadata fields are dropped from entries", () => {
  const merged = mergeModelLists({ catalog: CATALOG, live: ["extra"] });
  assert.deepEqual(merged, [
    { id: "extra" },
    { id: "known-a", name: "Known A", contextWindow: 262144, maxTokens: 32768 },
    { id: "known-b", contextWindow: 128000 },
  ]);
});

test("mergeModelLists: dedupes live ids and tolerates empty inputs", () => {
  assert.deepEqual(mergeModelLists({ catalog: CATALOG, live: ["known-a", "known-a"] }).length, 1 + 2);
  assert.deepEqual(mergeModelLists({ catalog: CATALOG, live: null }), [
    { id: "known-a", name: "Known A", contextWindow: 262144, maxTokens: 32768 },
    { id: "known-b", contextWindow: 128000 },
    { id: "extra" },
  ]);
  assert.deepEqual(mergeModelLists({ catalog: [], live: ["x", "y"] }), [{ id: "x" }, { id: "y" }]);
  assert.deepEqual(mergeModelLists({}), []);
});

test("diffModelIds: reports additions and removals", () => {
  assert.deepEqual(diffModelIds(["a", "b"], ["b", "c"]), { added: ["c"], removed: ["a"] });
  assert.deepEqual(diffModelIds(null, ["x"]), { added: ["x"], removed: [] });
  assert.deepEqual(diffModelIds(["x"], undefined), { added: [], removed: ["x"] });
});

test("MAX_LISTING_BYTES matches the dsh discovery ceiling", () => {
  assert.equal(MAX_LISTING_BYTES, 4 * 1024 * 1024);
});

import { parseModelToml, applyMetadata } from "../models-core.js";

const SAMPLE_TOML = [
  'name = "Ox Alpha Free (Unlimited)"',
  'description = "Stealth reasoning model"',
  "[interleaved]",
  'field = "reasoning_content"',
  "[limit]",
  "context = 1_000_000",
  "output = 131_072",
  "[modalities]",
  'input = ["text", "image", "video"]',
  'output = ["text"]',
].join("\n");

test("parseModelToml: reads name, limits, and image modality", () => {
  assert.deepEqual(parseModelToml(SAMPLE_TOML), {
    name: "Ox Alpha Free (Unlimited)",
    contextWindow: 1000000,
    maxTokens: 131072,
    wantsImage: true,
  });
});

test("parseModelToml: text-only input and missing sections", () => {
  const textOnly = parseModelToml('name = "X"\n[modalities]\ninput = ["text"]\n');
  assert.deepEqual(textOnly, { name: "X", wantsImage: false });
  assert.deepEqual(parseModelToml(""), {});
  assert.deepEqual(parseModelToml("garbage ="), {});
});

test("applyMetadata: fills gaps only and adds image input", () => {
  const entries = [
    { id: "a", contextWindow: 5 },
    { id: "b" },
  ];
  const metadata = new Map([
    ["a", { contextWindow: 999, maxTokens: 7, name: "A" }],
    ["b", { contextWindow: 10, maxTokens: 20, name: "B", wantsImage: true }],
    ["c", { contextWindow: 1 }],
  ]);
  applyMetadata(entries, metadata);
  assert.deepEqual(entries, [
    { id: "a", contextWindow: 5, maxTokens: 7, name: "A" },
    { id: "b", contextWindow: 10, maxTokens: 20, name: "B", input: ["text", "image"] },
  ]);
});

import { collectModelMetadata, fillFromSiblings } from "../models-core.js";

test("collectModelMetadata: resolves alias chains to canonical limits", async () => {
  const files = {
    "opencode-go/a": { baseModel: "vendor/a" },
    "vendor/a": { contextWindow: 1000, maxTokens: 200 },
  };
  const meta = await collectModelMetadata(["a"], "opencode-go", async (provider, id) => files[provider + "/" + id] ?? null);
  assert.deepEqual(meta.get("a"), { contextWindow: 1000, maxTokens: 200 });
});

test("collectModelMetadata: self-referential alias dead-ends without limits", async () => {
  const files = {
    "opencode-go/s": { baseModel: "v/s" },
    "v/s": { baseModel: "v/s" },
  };
  const meta = await collectModelMetadata(["s"], "opencode-go", async (provider, id) => files[provider + "/" + id] ?? null);
  assert.equal(meta.has("s"), false);
});

test("collectModelMetadata: keeps the alias's own display name", async () => {
  const files = {
    "opencode-go/b": { name: "Route B", baseModel: "v/b" },
    "v/b": { name: "Canonical B", contextWindow: 5 },
  };
  const meta = await collectModelMetadata(["b"], "opencode-go", async (p, id) => files[p + "/" + id] ?? null);
  assert.deepEqual(meta.get("b"), { name: "Route B", contextWindow: 5 });
});

test("fillFromSiblings: longest dash-boundary prefix wins; modalities untouched", () => {
  const donors = [
    { id: "deepseek-v4-flash", contextWindow: 1000000, maxTokens: 384000, input: ["text"] },
    { id: "deepseek-v4-flash-vision", contextWindow: 1 },
    { id: "kimi-k3", contextWindow: 262144 },
  ];
  const entries = [
    { id: "deepseek-v4-flash-vision-exp" },
    { id: "kimi-k3-preview", contextWindow: 999 },
    { id: "glm-5.3" },
  ];
  fillFromSiblings(entries, donors);
  assert.deepEqual(entries[0], {
    id: "deepseek-v4-flash-vision-exp",
    contextWindow: 1,
  });
  assert.equal(entries[1].contextWindow, 999);
  assert.deepEqual(entries[2], { id: "glm-5.3" });
});

test("fillFromSiblings: falls back to the only available prefix", () => {
  const entries = [{ id: "deepseek-v4-flash-vision-exp" }];
  fillFromSiblings(entries, [{ id: "deepseek-v4-flash", contextWindow: 1000000, maxTokens: 384000 }]);
  assert.deepEqual(entries[0], { id: "deepseek-v4-flash-vision-exp", contextWindow: 1000000, maxTokens: 384000 });
});

test("mapWithConcurrency: runs every item exactly once", async () => {
  const { mapWithConcurrency } = await import("../models-core.js");
  const seen = [];
  await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
    seen.push(n);
  });
  assert.deepEqual(seen.slice().sort(), [1, 2, 3, 4, 5]);
});

import { applyCatalogModalities } from "../models-core.js";

test("applyCatalogModalities: exact-id image donor grants input; never overwrites", () => {
  const entries = [
    { id: "deepseek-v4-flash-vision-exp" },
    { id: "ox-alpha-free", input: ["text"] },
    { id: "text-only-model" },
  ];
  const donors = [
    { id: "deepseek-v4-flash-vision-exp", inputModalities: ["text", "image"] },
    { id: "text-only-model", inputModalities: ["text"] },
    { id: "video-model", inputModalities: ["text", "video"] },
  ];
  const changed = applyCatalogModalities(entries, donors);
  assert.equal(changed, 1);
  assert.deepEqual(entries[0].input, ["text", "image"]);
  assert.deepEqual(entries[1].input, ["text"]);
  assert.equal("input" in entries[2], false);
});

test("applyCatalogModalities: absent or malformed donors change nothing", () => {
  const entries = [{ id: "m" }];
  assert.equal(applyCatalogModalities(entries, null), 0);
  assert.equal(applyCatalogModalities(entries, [{ nope: 1 }, "junk", null]), 0);
  assert.equal("input" in entries[0], false);
});

import { applyVisionOverride } from "../models-core.js";

test("applyVisionOverride: force vision, force text-only, vision precedence", () => {
  const entries = [
    { id: "may-be-vision" },
    { id: "user-said-text" },
    { id: "both-listed" },
    { id: "untouched" },
  ];
  const result = applyVisionOverride(
    entries,
    ["may-be-vision", "both-listed"],
    ["user-said-text", "both-listed"],
  );
  assert.deepEqual(result, { granted: 2, stripped: 1 });
  assert.deepEqual(entries[0].input, ["text", "image"]);
  assert.equal("input" in entries[1], false);
  assert.deepEqual(entries[2].input, ["text", "image"], "vision wins over text-only");
  assert.equal("input" in entries[3], false);
});

test("applyVisionOverride: strips existing image when forced text-only", () => {
  const entries = [{ id: "auto-vision", input: ["text", "image"] }];
  applyVisionOverride(entries, [], ["auto-vision"]);
  assert.equal("input" in entries[0], false);
});

test("applyVisionOverride: empty overrides change nothing", () => {
  const entries = [{ id: "x", input: ["text"] }];
  assert.deepEqual(applyVisionOverride(entries, [], []), { granted: 0, stripped: 0 });
  assert.deepEqual(entries[0].input, ["text"]);
});

test("mergeModelLists preserves catalog input modalities through cleanEntry", () => {
  const merged = mergeModelLists({
    catalog: [{ id: "a", name: "A", contextWindow: 1000, input: ["text", "image"] }],
    live: ["a", "b"],
  });
  assert.deepEqual(merged[0].input, ["text", "image"], "hand-tuned input must survive the merge");
  assert.equal(merged[0].contextWindow, 1000);
  assert.equal(merged[0].name, "A");
  assert.deepEqual(merged[1], { id: "b" });
});
