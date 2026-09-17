#!/usr/bin/env node
/**
 * Re-apply the host-side `session.rewrite` extension that the toolkit's
 * editLastMessage optimization depends on.
 *
 * Why this exists: the extension lives in the dsh checkout, not in this plugin
 * (the client cannot write another session's transcript). A dsh upgrade
 * (`git pull` + rebuild) drops it, and the next restart replaces the built libs
 * with unpatched ones — the pencil then reports "当前 host 不支持改写". Keeping
 * the diff here and re-applying it after every upgrade is what makes the plugin
 * survive those upgrades.
 *
 * Usage:
 *   node scripts/apply-host-patch.mjs [harnessCheckout]
 *   DSH_CHECKOUT=/path/to/dsh node scripts/apply-host-patch.mjs --check
 *
 * The checkout defaults to $DSH_CHECKOUT, then /root/deepseek-harness.
 * Exit codes: 0 = applied (or already applied), 1 = conflicts, 2 = bad checkout.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const patch = resolve(here, "../host/session-rewrite.patch");
const check = process.argv.includes("--check");
const harnessArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const harness = resolve(harnessArg ?? process.env.DSH_CHECKOUT ?? "/root/deepseek-harness");

/** The first file the patch touches; also the already-applied probe. */
const marker = join(harness, "packages/api/session-controller/src/index.ts");
if (!existsSync(patch)) {
  console.error(`missing patch: ${patch}`);
  process.exit(2);
}
if (!existsSync(marker)) {
  console.error(`not a dsh checkout (no ${marker}); pass the checkout path as argv[2]`);
  process.exit(2);
}

if (readFileSync(marker, "utf8").includes("@Remote('rewrite')")) {
  console.log(`already applied: ${harness}`);
  process.exit(0);
}

try {
  execFileSync("git", ["apply", "--3way", ...(check ? ["--check"] : []), "--whitespace=nowarn", patch], {
    cwd: harness,
    stdio: "inherit",
  });
} catch {
  console.error(
    `\napply failed in ${harness}.\n` +
    "Resolve the conflicts (git diff) or re-port the patch onto the new upstream shape, " +
    "then run:\n" +
    `  pnpm run build:lib && pnpm run build:web\n` +
    "  systemctl restart deepseek-harness.service",
  );
  process.exit(1);
}

console.log(check ? `patch applies cleanly to ${harness}` : `applied to ${harness}`);
if (!check) {
  console.log(
    "\nNow rebuild and restart the host:\n" +
    "  cd " + harness + "\n" +
    "  pnpm run build:lib && pnpm run build:web\n" +
    "  systemctl restart deepseek-harness.service\n" +
    "Then verify: DSH_AUTH_USER=kola DSH_AUTH_PASS=... node scripts/e2e-verify-rewrite.mjs",
  );
}
