/**
 * dsh-plugin-toolkit — local habit store for the smartReply optimization.
 *
 * The suggestion prompt learns how the user actually writes: message length,
 * opening words, recent real-user examples, and the suggestions the user
 * accepted with Tab. All of that is aggregate state plus a handful of short
 * examples, and it never leaves this machine.
 *
 * Layout and failure policy:
 *
 *  - One JSON file under `<DSH_HOME>/plugins/dsh-plugin-toolkit/`; the path is
 *    derived at call time so a changed DSH_HOME is picked up on the next boot.
 *  - Reads are tolerant: a missing, oversized, or corrupt file contributes an
 *    empty state instead of breaking the suggestion route. A habit is a
 *    convenience; a broken cache must never cost the composer a suggestion.
 *  - Writes are best-effort and atomic (temp file + rename, mode 600). A
 *    failed write leaves the previous file intact and is never thrown at the
 *    route.
 *  - `learn()` only rewrites the file when the normalized state actually
 *    changed, so a turn whose user message was already learned costs no I/O.
 *
 * The store assumes one writer process, which is how the desktop host runs.
 * Two hosts sharing one DSH_HOME would last-writer-win (the atomic rename still
 * prevents a torn file); that is an accepted limitation, not a corruption risk.
 *
 * The pure statistics live in suggest-habits.js; this module owns only the
 * filesystem and the in-process cache.
 *
 * @license MIT
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  createHabitState,
  normalizeHabitState,
  learnFromUserMessages,
  learnFromAccepted,
  habitStyleHint,
  habitSummary,
} from "./suggest-habits.js";
import { resolveDshHome } from "./dsh-home.js";

/** Directory under DSH_HOME that holds this plugin's private state. */
export const HABIT_PLUGIN_DIR = "dsh-plugin-toolkit";
/** File name of the persisted habit state. */
export const HABIT_FILE = "suggest-habits.json";
/** A runaway examples file would only slow a prompt down; ignore anything larger. */
export const MAX_HABIT_FILE_BYTES = 64 * 1024;

/**
 * Resolve the habit-state file path for one environment.
 * @param {Record<string, string | undefined>} [env] - environment to read.
 * @returns {string} absolute path of the habit state file.
 */
export function resolveHabitPath(env = process.env) {
  return join(resolveDshHome(env), "plugins", HABIT_PLUGIN_DIR, HABIT_FILE);
}

/**
 * Read one habit state from disk. Never throws: any failure is "no habits yet".
 * @param {string} path - absolute state file path.
 * @returns {object} a normalized habit state.
 */
export function readHabitState(path) {
  try {
    if (typeof path !== "string" || path === "" || !existsSync(path)) return createHabitState();
    const raw = readFileSync(path);
    if (raw.byteLength > MAX_HABIT_FILE_BYTES) return createHabitState();
    return normalizeHabitState(JSON.parse(raw.toString("utf8")));
  } catch {
    return createHabitState();
  }
}

/**
 * Write one habit state atomically, best-effort.
 * @param {string} path - absolute state file path.
 * @param {object} state - the state to persist.
 * @returns {boolean} whether the file was replaced.
 */
export function writeHabitState(path, state) {
  if (typeof path !== "string" || path === "") return false;
  let temp;
  try {
    const json = JSON.stringify(state);
    // A capped state is tiny; refusing an oversized one keeps a future bug from
    // writing an unbounded document the read side would only discard.
    if (Buffer.byteLength(json, "utf8") > MAX_HABIT_FILE_BYTES) return false;
    mkdirSync(dirname(path), { recursive: true });
    temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temp, json, { encoding: "utf8", mode: 0o600 });
    renameSync(temp, path);
    temp = undefined;
    return true;
  } catch {
    if (temp !== undefined) {
      try {
        // A left-over temp file would pollute the plugin directory; the rename
        // is the only durable step, so removing the temp is always safe.
        unlinkSync(temp);
      } catch {
        // Nothing left to clean up.
      }
    }
    return false;
  }
}

/**
 * One process-local habit store: cached state, incremental learning, and the
 * two read shapes the suggestion route and the settings page need.
 * @param {string} [path] - state file path; defaults to {@link resolveHabitPath}.
 * @returns {object} the store.
 */
export function createHabitStore(path = resolveHabitPath()) {
  let state;
  let loaded = false;

  const ensure = () => {
    if (!loaded) {
      state = readHabitState(path);
      loaded = true;
    }
    return state;
  };

  return {
    /** @returns {string} the file this store reads and writes. */
    get path() {
      return path;
    },
    /** Current state, loaded on first use. */
    state: ensure,
    /**
     * Learn from this turn's real user messages plus any accepted suggestions.
     * Persists only when the normalized state changed.
     * @param {{ userMessages?: string[], accepted?: string[], language?: "zh" | "en" | "" }} [input] - this turn's evidence.
     * @returns {object} the updated state.
     */
    learn({ userMessages = [], accepted = [], language = "" } = {}) {
      const current = ensure();
      const before = JSON.stringify(current);
      learnFromUserMessages(current, userMessages, language);
      learnFromAccepted(current, accepted, language);
      if (JSON.stringify(current) !== before) {
        current.updatedAt = Date.now();
        writeHabitState(path, current);
      }
      return current;
    },
    /**
     * The learned-style hint to inject into the prompt.
     * @param {"zh" | "en"} language - reply language the hint is written in.
     * @returns {string} an empty string when nothing has been learned yet.
     */
    styleHint(language) {
      return habitStyleHint(ensure(), language);
    },
    /** Counters for the settings card. */
    summary() {
      return habitSummary(ensure());
    },
    /** Drop the cache so the next read observes an external edit (tests). */
    reload() {
      loaded = false;
      return ensure();
    },
  };
}
