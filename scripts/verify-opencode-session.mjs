/**
 * Live A/B verification of the opencodeSession optimization against the real
 * OpenCode Go endpoint, driving the same built artifacts the web service
 * loads (dsh-llm + dsh-llm-pi-ai from the harness checkout, this package's
 * index.js):
 *
 *   A) opencodeSession disabled -> the gateway rejects with 400
 *      MissingSessionID (the failure this optimization exists to fix);
 *   B) opencodeSession enabled  -> the request carries x-opencode-session
 *      (the conversation's session id) and completes.
 *
 * Run from the harness checkout so workspace deps resolve:
 *   cd /root/deepseek-harness && node /root/dsh-plugin-toolkit/scripts/verify-opencode-session.mjs
 * Needs OPENCODE_GO_API_KEY in the environment (the script reads the harness
 * credentials store when the variable is absent).
 */
import { readFile } from "node:fs/promises";
import { Context } from "@deepseek-ai/cordis";
import LlmRuntime from "/root/deepseek-harness/packages/llm/llm/lib/index.js";
import * as LlmPiAi from "/root/deepseek-harness/packages/llm/llm-pi-ai/lib/index.js";
import * as toolkit from "../index.js";

const MODEL = "minimax-m2.5";
const SESSION_ID = "dsh-e2e-opencode-probe";

async function loadKey() {
  if (process.env.OPENCODE_GO_API_KEY) return process.env.OPENCODE_GO_API_KEY;
  const raw = await readFile("/root/.dsh/.credentials.yaml", "utf8").catch(() => "");
  const match = raw.match(/OPENCODE_GO_API_KEY:\s*["']?(sk-[A-Za-z0-9_-]+)/);
  if (match === null) throw new Error("OPENCODE_GO_API_KEY not found in env or ~/.dsh/.credentials.yaml");
  return match[1];
}

/** Boot one cordis context with the llm seam, the pi-ai adapter, and the toolkit listener. */
async function boot(opencodeSession) {
  const ctx = new Context();
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(LlmPiAi, {
    providers: {
      "opencode-go": {
        displayName: "OpenCode Go",
        apiKeyEnv: "OPENCODE_GO_API_KEY",
        api: "openai-completions",
        baseURL: "https://opencode.ai/zen/go/v1",
        models: [{ id: MODEL, name: "MiniMax M2.5", contextWindow: 204800, maxTokens: 65536 }],
      },
    },
  });
  toolkit.apply(ctx, {
    optimizations: { opencodeSession },
    chatWorkspacePath: "/tmp/toolkit-verify-chat",
    chatWorkspaceTitle: "verify",
  });
  return ctx;
}

/** Drive one tiny request; resolves to the terminal outcome summary. */
async function probe(ctx) {
  let text = "";
  let failure = undefined;
  for await (const chunk of ctx.llm.stream({
    provider: "opencode-go",
    model: MODEL,
    messages: [{ role: "user", content: [{ type: "text", text: "say ok" }] }],
    maxTokens: 8,
    sessionId: SESSION_ID,
  })) {
    if (chunk.type === "text-delta") text += chunk.delta;
    if (chunk.type === "finish" && chunk.reason.kind === "error") failure = chunk.reason.failure;
  }
  return { text, failure };
}

process.env.OPENCODE_GO_API_KEY = await loadKey();

const offCtx = await boot(false);
const off = await probe(offCtx);
const offRejected = off.failure !== undefined && String(off.failure.message).includes("MissingSessionID");
console.log("A) toggle OFF ->", off.failure === undefined ? "unexpected success (" + JSON.stringify(off.text) + ")" : String(off.failure.message).slice(0, 100));
if (!offRejected) throw new Error("control run should fail with MissingSessionID");

const onCtx = await boot(true);
const on = await probe(onCtx);
console.log("B) toggle ON  ->", on.failure === undefined ? "200, content: " + JSON.stringify(on.text) : "FAILED: " + on.failure.message);
if (on.failure !== undefined) throw new Error("enabled run failed: " + on.failure.message);

console.log("opencodeSession live verification: OK");
process.exit(0);

