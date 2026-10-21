/**
 * dsh-plugin-toolkit — DSH home resolution.
 *
 * One rule, one place: `$DSH_HOME` when set and non-empty, else `~/.dsh`.
 * index.js (chat workspace default), slash-i18n-api.js (translations file) and
 * suggest-store.js (habit state) all resolved the home by hand before this
 * module existed.
 *
 * @license MIT
 */

import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve the DSH home directory.
 * @param {Record<string, string | undefined>} [env] - environment to read.
 * @returns {string} the absolute DSH home path.
 */
export function resolveDshHome(env = process.env) {
  const configured = typeof env?.DSH_HOME === "string" ? env.DSH_HOME.trim() : "";
  return configured !== "" ? configured : join(homedir(), ".dsh");
}
