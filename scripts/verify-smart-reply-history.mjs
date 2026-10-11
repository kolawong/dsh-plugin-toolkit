/**
 * Drive the toolkit's smartReply conversation definition through the REAL dsh
 * `ConversationNodeAssembler`, on every event shape conversation history
 * actually produces — including the BACKFILL path, where a window begins
 * mid-turn and an `assistant/message` arrives with its `step/start` outside the
 * loaded window.
 *
 * This exists because the offline suite cannot see it: `npm test` and
 * `npm run smoke:client` run without a dsh checkout, so neither can catch a
 * definition that violates an assembler invariant. It did exactly that once —
 * a Location-data key that did not match the definition's kind, and a start role
 * taken from `step/start` — and both threw inside conversation rendering, which
 * is what "history won't load" looked like from the browser.
 *
 * Run it from a dsh checkout (tsx compiles the assembler's TypeScript):
 *   cd /root/deepseek-harness && \
 *     node --import /root/deepseek-harness/node_modules/.pnpm/tsx@4.23.13/node_modules/tsx/dist/loader.mjs \
 *          /root/dsh-plugin-toolkit/scripts/verify-smart-reply-history.mjs
 * or, from this package: `npm run verify:history`.
 *
 * Exits non-zero on the first violation. The definition is extracted from the
 * shipped client.js rather than copied, so this can never drift from what the
 * plugin actually registers.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");

// ── extract the real definition + its store out of client.js ────────────────
const clientSource = readFileSync(join(pkgRoot, "client.js"), "utf8");
const kindMatch = clientSource.match(/const SMART_KIND = "([^"]+)"/);
if (kindMatch === null) throw new Error("client.js no longer declares SMART_KIND");
const SMART_KIND = kindMatch[1];

function extractDefinition(source) {
  const anchor = source.indexOf("const smartReplySummaryDefinition = {");
  if (anchor < 0) throw new Error("client.js no longer declares smartReplySummaryDefinition");
  const open = source.indexOf("{", anchor);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error("could not balance smartReplySummaryDefinition");
}
const definitionSource = extractDefinition(clientSource);

const { ConversationNodeAssembler } = await import(
  "/root/deepseek-harness/packages/client/ui-conversation/src/client/conversation/assembler.ts"
);

// Evaluate the shipped definition against a tiny store, exactly as client.js does.
const smartReplyLast = {
  getSnapshot: () => smartReplyLast.value,
  subscribe: () => () => {},
  set: (next) => { smartReplyLast.value = next; },
  value: undefined,
};

function assistantTextOf(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.kind === "text" || block?.type === "text")
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("");
}

// eslint-disable-next-line no-new-func
const smartReplySummaryDefinition = new Function(
  "SMART_KIND", "smartReplyLast", "assistantTextOf",
  `return (${definitionSource});`,
)(SMART_KIND, smartReplyLast, assistantTextOf);

// ── minimal registry doubles, matching the assembler's own test bench ────────
class TestEventDefinitions {
  constructor(definitions) { this.definitions = definitions; }
  entries() { return this.definitions; }
  fallbackEntry() { return undefined; }
}
class TestViewDefinitions {
  constructor(definitions) { this.definitions = definitions; }
  entries() { return this.definitions; }
}

let seq = 0;
const at = (type, data, surfaceOp) => ({
  type: "event",
  event: { type, seq: (seq += 1), time: 1_700_000_000_000 + seq, data, ...(surfaceOp ? { surfaceOp } : {}) },
});
const assistant = (text) => ({ content: [{ kind: "text", text }] });

const failures = [];

/**
 * Drive one scenario; any throw is a conversation-rendering failure.
 * @param {string} name - the scenario label.
 * @param {() => void} body - the event sequence to append.
 */
function scenario(name, body) {
  seq = 0;
  smartReplyLast.value = undefined;
  const assembler = new ConversationNodeAssembler(
    new TestEventDefinitions([smartReplySummaryDefinition]),
    new TestViewDefinitions([]),
  );
  try {
    body(assembler);
    console.log("  ok   " + name);
  } catch (error) {
    failures.push({ name, message: error?.message ?? String(error) });
    console.log("  FAIL " + name + " -> " + (error?.message ?? error));
  }
}

console.log("smartReply definition against the real ConversationNodeAssembler");
console.log("kind =", SMART_KIND);

scenario("a live turn, step/start present", (a) => {
  a.replaceWindow([], false);
  a.append(at("turn/start", { turn: 1 }));
  a.append(at("step/start", { turn: 1, step: 1 }));
  a.append(at("assistant/message", { turn: 1, step: 1, message: assistant("done") }, "append"));
  a.flush();
});

scenario("history backfill: the window begins mid-turn (no step/start)", (a) => {
  a.replaceWindow([], true);
  a.append(at("assistant/message", { turn: 1, step: 1, message: assistant("older A") }, "append"));
  a.append(at("assistant/message", { turn: 1, step: 2, message: assistant("older B") }, "append"));
  a.append(at("step/end", { turn: 1, step: 2 }));
  a.flush();
});

scenario("load older: replaceWindow with a mid-turn prefix", (a) => {
  a.replaceWindow([
    at("assistant/message", { turn: 1, step: 1, message: assistant("prepended old") }, "append"),
    at("step/end", { turn: 1, step: 1 }),
  ], true);
  a.flush();
});

scenario("a settlement carrying no surfaceOp", (a) => {
  a.replaceWindow([], false);
  a.append(at("turn/start", { turn: 3 }));
  a.append(at("step/start", { turn: 3, step: 1 }));
  a.append(at("assistant/message", { turn: 3, step: 1, message: assistant("no surfaceOp") }));
  a.flush();
});

scenario("the streaming settle path", (a) => {
  a.replaceWindow([], false);
  a.append(at("turn/start", { turn: 4 }));
  a.append(at("step/start", { turn: 4, step: 1 }));
  a.append(at("assistant/live-chunk", { turn: 4, step: 1, attemptId: "a", chunk: { type: "text-delta", text: "hi" } }));
  a.settleAssistant("a", at("assistant/message", { turn: 4, step: 1, message: assistant("settled") }, "append"));
  a.flush();
});

scenario("a settlement arriving before its step/start", (a) => {
  a.replaceWindow([], false);
  a.append(at("assistant/message", { turn: 5, step: 1, message: assistant("orphan") }, "append"));
  a.append(at("step/start", { turn: 5, step: 1 }));
  a.flush();
});

scenario("a long backfilled history (200 steps, 5 turns)", (a) => {
  a.replaceWindow([], true);
  for (let turn = 1; turn <= 5; turn += 1) {
    for (let step = 1; step <= 40; step += 1) {
      a.append(at("assistant/message", { turn, step, message: assistant("reply " + turn + "/" + step) }, "append"));
      a.append(at("step/end", { turn, step }));
    }
    a.append(at("turn/end", { turn }));
  }
  a.flush();
});

if (failures.length > 0) {
  console.error(`\n${failures.length} scenario(s) failed — the definition violates an assembler invariant.`);
  process.exit(1);
}
console.log("\nall scenarios passed");
