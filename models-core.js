/**
 * dsh-plugin-toolkit — model-list sync core.
 *
 * Pure, dependency-free functions behind the modelCapability optimization:
 * parsing an OpenAI-shaped `GET /models` reply, merging the live listing with
 * the route's installed catalog metadata, and diffing two id lists for status
 * reporting. No network and no settings access here — model-sync.js owns both.
 *
 * Moved here from dsh-plugin-quota-badges, where it backed that plugin's
 * 「模型能力」 section; the logic is unchanged.
 *
 * @license MIT
 */

/** Ceiling on a listing reply body, mirroring dsh llm-pi-ai's own discovery guard. */
export const MAX_LISTING_BYTES = 4 * 1024 * 1024;

/**
 * Extract model ids from a parsed listing reply. Both shapes the host's own
 * discovery accepts are understood: the OpenAI-style `{ data: [{ id }] }` and
 * the enriched `{ models: { <id>: {...} } }` map (where the key is the id and
 * an `id` field may override it). Entries without a usable id are skipped
 * rather than failing the whole listing; duplicates keep their first position.
 * @param {unknown} body - the parsed JSON body of a listing reply.
 * @returns {string[] | null} unique non-empty ids in endpoint order, or null
 *   when the body carries neither shape.
 */
export function extractModelIds(body) {
  if (body === null || typeof body !== "object") return null;
  const listing = /** @type {{data?: unknown, models?: unknown}} */ (body);
  const data = listing.data;
  if (Array.isArray(data)) {
    const ids = [];
    const seen = new Set();
    for (const entry of data) {
      const id = /** @type {{id?: unknown} | null} */ (entry)?.id;
      if (typeof id !== "string" || id === "" || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }
  const models = listing.models;
  if (models !== null && typeof models === "object" && !Array.isArray(models)) {
    const ids = [];
    const seen = new Set();
    for (const [key, entry] of Object.entries(models)) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
      const declared = /** @type {{id?: unknown}} */ (entry).id;
      const id = typeof declared === "string" && declared !== "" ? declared : key;
      if (id === "" || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }
  return null;
}

/**
 * The per-model profile fields dsh's llm-pi-ai schema understands. Kept in
 * step with the host's own `modelFields` set by
 * `tests/models-core.test.js` → "cleanEntry preserves every profile field the
 * host schema defines": a field that exists on a stored row but not here is
 * silently deleted the next time the row travels through a sync, which is how
 * hand-tuned `reasoningEfforts` / `compat` were being lost.
 */
export const MODEL_PROFILE_FIELDS = ["name", "contextWindow", "maxTokens", "input", "reasoningEfforts", "compat"];

/** A plain JSON object (not null, not an array). */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Keep only the fields dsh's llm-pi-ai model profile understands, dropping
 * junk so a catalog entry can be written back into settings verbatim.
 *
 * Every value is either re-emitted verbatim (the shapes below come from rows
 * the host already validated, so they cannot be junk) or dropped — never
 * converted, so a round trip through a sync is lossless for the fields the
 * schema defines.
 * @param {Record<string, unknown> & {id: string}} model
 * @returns {Record<string, unknown> & {id: string}}
 */
function cleanEntry(model) {
  const entry = { id: model.id };
  if (typeof model.name === "string" && model.name !== "") entry.name = model.name;
  if (typeof model.contextWindow === "number" && Number.isInteger(model.contextWindow) && model.contextWindow > 0) {
    entry.contextWindow = model.contextWindow;
  }
  if (typeof model.maxTokens === "number" && Number.isInteger(model.maxTokens) && model.maxTokens > 0) {
    entry.maxTokens = model.maxTokens;
  }
  // Preserve a declared modality list verbatim. The stored profile may carry
  // hand-tuned input (e.g. ["text","image"]) that dsh's own schema
  // understands; dropping it here would silently strip image support from a
  // model the user explicitly enabled. An empty list is dropped on purpose:
  // the host reads `[]` as "no answer here", which is exactly what an absent
  // field means, and keeping it would stop the registry from filling it in.
  if (Array.isArray(model.input)) {
    const input = model.input.filter((value) => typeof value === "string");
    if (input.length > 0) entry.input = input;
  }
  // `false` disables reasoning for this model; a dict overrides its effort
  // table. Both are legal profile values — dropping either silently restores
  // the inherited default and changes how the model is driven.
  if (model.reasoningEfforts === false) entry.reasoningEfforts = false;
  else if (isPlainObject(model.reasoningEfforts)) entry.reasoningEfforts = model.reasoningEfforts;
  // The request-compatibility overrides (developer role, thinking format,
  // cache control, ...) are hand-tuned per model for the same reason.
  if (isPlainObject(model.compat)) entry.compat = model.compat;
  return entry;
}

/**
 * Union one live endpoint listing with the route's current models. Live ids
 * lead in endpoint order; each carries its matching catalog entry's metadata
 * when one exists, otherwise only the id (dsh then applies its defaults).
 * Catalog-only ids follow, preserving metadata the endpoint no longer lists.
 * @param {{catalog?: Array<Record<string, unknown>> | null, live?: string[] | null}} input
 * @returns {Array<Record<string, unknown>>} merged entries safe to write as a
 *   llm-pi-ai `models` profile list.
 */
export function mergeModelLists({ catalog, live }) {
  const byId = new Map();
  for (const model of Array.isArray(catalog) ? catalog : []) {
    if (model !== null && typeof model === "object") {
      const id = model.id;
      if (typeof id === "string" && id !== "" && !byId.has(id)) byId.set(id, model);
    }
  }
  const merged = [];
  const seen = new Set();
  for (const id of Array.isArray(live) ? live : []) {
    if (typeof id !== "string" || id === "" || seen.has(id)) continue;
    seen.add(id);
    const hit = byId.get(id);
    merged.push(hit ? cleanEntry(hit) : { id });
  }
  for (const [id, model] of byId) {
    if (!seen.has(id)) merged.push(cleanEntry(model));
  }
  return merged;
}

/**
 * Compare two id lists for status reporting.
 * @param {string[]} previous - ids as they stood before the write.
 * @param {string[]} next - ids as they stand now.
 * @returns {{added: string[], removed: string[]}}
 */
export function diffModelIds(previous, next) {
  const before = new Set(Array.isArray(previous) ? previous : []);
  const now = new Set(Array.isArray(next) ? next : []);
  return {
    added: [...now].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !now.has(id)),
  };
}

// ── models.dev metadata ─────────────────────────────────────────────────────

/**
 * Parse the small subset of a models.dev provider TOML file this plugin needs.
 * The files are flat two-level TOML (`[limit]`, `[modalities]`, top-level
 * strings), so a line scanner covers them without a TOML dependency.
 * @param {string} text - one models.dev model file's content.
 * @returns {{name?: string, contextWindow?: number, maxTokens?: number, wantsImage?: boolean}}
 */
export function parseModelToml(text) {
  const result = {};
  let section = "";
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const heading = /^\[([^\]]+)\]$/.exec(line);
    if (heading) {
      section = heading[1];
      continue;
    }
    const pair = /^([A-Za-z_][\w-]*)\s*=\s*(.+)$/.exec(line);
    if (!pair) continue;
    const key = pair[1];
    const valueText = pair[2].trim();
    if (section === "") {
      if (key === "name") {
        const name = parseTomlString(valueText);
        if (name !== undefined) result.name = name;
      } else if (key === "base_model") {
        // Alias entries carry no limits of their own; the canonical
        // vendor/model file named here does.
        const base = parseTomlString(valueText);
        if (base !== undefined && /^[\w.-]+\/[\w.-]+$/.test(base)) result.baseModel = base;
      }
      continue;
    }
    if (section === "limit") {
      const value = parseTomlInt(valueText);
      if (value !== undefined) {
        if (key === "context") result.contextWindow = value;
        else if (key === "output") result.maxTokens = value;
      }
      continue;
    }
    if (section === "modalities" && key === "input") {
      result.wantsImage = /["']image["']/.test(valueText);
    }
  }
  return result;
}

/** Parse a quoted TOML string, or undefined for anything else. */
function parseTomlString(valueText) {
  const match = /^"([^"]*)"$/.exec(valueText) || /^'([^']*)'$/.exec(valueText);
  return match ? match[1] : undefined;
}

/** Parse a TOML integer that may carry `_` separators, or undefined. */
function parseTomlInt(valueText) {
  if (!/^\d[\d_]*$/.test(valueText)) return undefined;
  const value = Number(valueText.replace(/_/g, ""));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * Whether an entry already answers the modality question. The host reads an
 * absent array — and, thanks to schemastery, an empty one — as "no answer
 * here, inherit the catalog's", so both count as unanswered and stay eligible
 * for enrichment. Only a non-empty list is a real declaration.
 */
function declaresInput(entry) {
  return Array.isArray(entry.input) && entry.input.length > 0;
}

/**
 * Fill missing fields on merged model entries from parsed models.dev metadata.
 * Values already present on an entry win — the installed catalog and any hand
 * edit stay authoritative; metadata only fills the gaps and adds image input
 * where the registry reports it (dsh supports text/image only).
 * @param {Array<Record<string, unknown>>} entries - merged model entries.
 * @param {Map<string, {name?: string, contextWindow?: number, maxTokens?: number, wantsImage?: boolean}>} metadata
 * @returns {Array<Record<string, unknown>>} the same entries, mutated in place.
 */
export function applyMetadata(entries, metadata) {
  for (const entry of entries) {
    const meta = metadata.get(entry.id);
    if (!meta) continue;
    if (entry.contextWindow === undefined && meta.contextWindow !== undefined) entry.contextWindow = meta.contextWindow;
    if (entry.maxTokens === undefined && meta.maxTokens !== undefined) entry.maxTokens = meta.maxTokens;
    if (entry.name === undefined && meta.name !== undefined) entry.name = meta.name;
    if (meta.wantsImage === true && !declaresInput(entry)) {
      entry.input = ["text", "image"];
    }
  }
  return entries;
}

/** Run an async worker over items with a fixed concurrency cap. */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function lane() {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, lane));
  return results;
}

/**
 * Fetch and assemble registry metadata for the given model ids. Alias entries
 * (`base_model = "vendor/model"` without limits of their own) follow their
 * chain — up to three hops, cycle-safe — to the canonical file that carries
 * the capacities. Ids the registry does not describe are simply absent from
 * the answer; individual fetch failures never fail the call.
 * @param {string[]} ids - live model ids to describe.
 * @param {string} provider - the registry provider directory holding the ids.
 * @param {(provider: string, id: string) => Promise<object | null>} fetchToml -
 *   fetches and parses one registry file; null when absent or unreadable.
 * @returns {Promise<Map<string, object>>} parsed metadata by model id.
 */
export async function collectModelMetadata(ids, provider, fetchToml, { concurrency = 5 } = {}) {
  const meta = new Map();
  const deferred = [];
  await mapWithConcurrency(ids, concurrency, async (id) => {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return;
    const parsed = await fetchToml(provider, id);
    if (parsed === null || Object.keys(parsed).length === 0) return;
    if (parsed.baseModel !== undefined && parsed.contextWindow === undefined && parsed.maxTokens === undefined) {
      deferred.push({ id, parsed });
      return;
    }
    meta.set(id, parsed);
  });
  await mapWithConcurrency(deferred, concurrency, async ({ id, parsed }) => {
    const resolved = await resolveAliasChain(id, provider, parsed, fetchToml);
    if (Object.keys(resolved).length > 0) meta.set(id, resolved);
  });
  return meta;
}

/**
 * Follow one alias entry's base_model chain until limits appear, the chain
 * repeats, or the registry runs out — whichever comes first.
 */
async function resolveAliasChain(id, provider, first, fetchToml) {
  let current = first;
  const visited = new Set([provider + "/" + id]);
  for (let depth = 0; current.baseModel !== undefined && current.contextWindow === undefined
    && current.maxTokens === undefined && depth < 3; depth++) {
    const target = current.baseModel;
    if (visited.has(target)) break;
    visited.add(target);
    const slash = target.indexOf("/");
    if (slash <= 0 || slash === target.length - 1) break;
    const next = await fetchToml(target.slice(0, slash), target.slice(slash + 1));
    if (next === null) break;
    current = { ...next, name: current.name ?? next.name };
  }
  const resolved = { ...current };
  delete resolved.baseModel;
  if (resolved.name === undefined) delete resolved.name;
  return resolved;
}

/**
 * Fill entries the registry could not size from their closest sized sibling:
 * the longest donor id that is a dash-boundary prefix of the target (so
 * `deepseek-v4-flash-vision-exp` inherits `deepseek-v4-flash`, but
 * `glm-5.3` never inherits from an unrelated `glm`). Capacities and display
 * name only — modalities are never guessed.
 * @param {Array<Record<string, unknown>>} entries - merged model entries, mutated in place.
 * @param {Array<Record<string, unknown>>} donors - sized entries to inherit from.
 * @returns {Array<Record<string, unknown>>} the same entries.
 */
export function fillFromSiblings(entries, donors) {
  const sized = donors.filter((donor) => typeof donor?.contextWindow === "number");
  for (const entry of entries) {
    if (typeof entry.id !== "string" || entry.contextWindow !== undefined) continue;
    let best = null;
    for (const donor of sized) {
      if (donor.id !== entry.id && entry.id.startsWith(donor.id + "-")) {
        if (best === null || donor.id.length > best.id.length) best = donor;
      }
    }
    if (best !== null) {
      entry.contextWindow = best.contextWindow;
      if (typeof best.maxTokens === "number") entry.maxTokens = best.maxTokens;
      if (entry.name === undefined && typeof best.name === "string") entry.name = best.name;
    }
  }
  return entries;
}

/**
 * Grant image input to entries whose exact id another registered provider in
 * the same process declares multimodal (e.g. the official DeepSeek route
 * lists deepseek-v4-flash-vision-exp with inputModalities ["text","image"]).
 * Exact-id matching across providers is data, not a guess; modalities the dsh
 * vocabulary lacks (video, pdf, ...) are ignored, and an entry that already
 * declares input is never touched.
 * @param {Array<Record<string, unknown>>} entries - merged or stored model entries.
 * @param {Array<{id: unknown, inputModalities?: unknown}>} donors - cross-provider model info.
 * @returns {number} how many entries gained image input.
 */
export function applyCatalogModalities(entries, donors) {
  const byId = new Map();
  for (const donor of Array.isArray(donors) ? donors : []) {
    if (donor !== null && typeof donor === "object" && typeof donor.id === "string" && !byId.has(donor.id)) {
      byId.set(donor.id, donor);
    }
  }
  let changed = 0;
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object" || typeof entry.id !== "string") continue;
    if (declaresInput(entry)) continue;
    const donor = byId.get(entry.id);
    const modalities = Array.isArray(donor?.inputModalities) ? donor.inputModalities : undefined;
    if (modalities === undefined || !modalities.includes("image")) continue;
    entry.input = ["text", "image"];
    changed += 1;
  }
  return changed;
}

/**
 * Apply explicit user overrides for a model's image capability, above and
 * beyond auto-detection. A model id listed in `forceVisionIds` is always made
 * text+image; one listed in `forceTextOnlyIds` is always stripped of image
 * (its `input` removed so dsh falls back to text-only). Vision wins when an
 * id appears in both. Only listed ids are touched; idempotent.
 * @param {Array<Record<string, unknown>>} entries - model entries, mutated in place.
 * @param {string[] | undefined} forceVisionIds - ids to make vision-capable.
 * @param {string[] | undefined} forceTextOnlyIds - ids to make text-only.
 * @returns {{granted: number, stripped: number}} how many entries each rule changed.
 */
export function applyVisionOverride(entries, forceVisionIds, forceTextOnlyIds) {
  const vision = new Set(Array.isArray(forceVisionIds) ? forceVisionIds : []);
  const textOnly = new Set(Array.isArray(forceTextOnlyIds) ? forceTextOnlyIds : []);
  let granted = 0;
  let stripped = 0;
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object" || typeof entry.id !== "string") continue;
    if (vision.has(entry.id)) {
      entry.input = ["text", "image"];
      granted += 1;
    } else if (textOnly.has(entry.id)) {
      delete entry.input;
      stripped += 1;
    }
  }
  return { granted, stripped };
}
