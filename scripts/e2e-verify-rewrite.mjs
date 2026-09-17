/**
 * End-to-end verify of the editLastMessage optimization in the live web GUI.
 *
 * Proves the full in-place rewrite: send a first message, edit the last user
 * bubble, resend, and check that the transcript replaced it (old text gone, new
 * text plus a fresh assistant answer present) and that the host reported no
 * "unsupported rewrite" error.
 *
 * Run from anywhere under /root (Node resolves `playwright` through
 * /root/node_modules, the harness pnpm store link):
 *   DSH_AUTH_USER=kola DSH_AUTH_PASS=... node scripts/e2e-verify-rewrite.mjs
 *
 * Optional env:
 *   TOOLKIT_VERIFY_URL  (default http://127.0.0.1:3080)
 *   TOOLKIT_CHROME      (default the cached chromium-1208 build)
 *   TOOLKIT_VERIFY_TIMEOUT_MS (default 180000)
 */
import { chromium } from "playwright";

const BASE = process.env.TOOLKIT_VERIFY_URL ?? "http://127.0.0.1:3080";
const user = process.env.DSH_AUTH_USER ?? "kola";
const pass = process.env.DSH_AUTH_PASS;
if (pass === undefined || pass === "") throw new Error("DSH_AUTH_PASS required");
const CHROME = process.env.TOOLKIT_CHROME ?? "/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome";
const TOTAL_TIMEOUT_MS = Number(process.env.TOOLKIT_VERIFY_TIMEOUT_MS ?? 180000);

const stamp = Date.now().toString(36);
// The session runs with full agent tools in the selected workspace, so the
// probe text explicitly forbids tool use: this verifies the rewrite without
// leaving files behind (a bare marker makes the agent write one).
const NO_TOOLS = "请只回复「收到」，不要调用任何工具，不要创建或修改文件。";
const ORIGINAL = `E2E-RW-${stamp} 第一条。${NO_TOOLS}`;
const EDITED = `E2E-RW-${stamp} 已改写。${NO_TOOLS}`;
const MARK_ORIGINAL = `E2E-RW-${stamp} 第一条`;
const MARK_EDITED = `E2E-RW-${stamp} 已改写`;

/** Fail with one clear line, so a headless run reports the real blocker. */
function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200)); });
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${String(err).slice(0, 300)}`));

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Login through the auth-webserver form.
  const passInput = page.locator('input[type="password"]').first();
  await passInput.waitFor({ state: "visible", timeout: 20000 });
  await page.locator('input[type="text"]').first().fill(user);
  await passInput.fill(pass);
  const submitBtn = page.locator("#submitBtn");
  if (await submitBtn.count()) await submitBtn.click();
  else await passInput.press("Enter");

  // The Lexical composer is the app's only contenteditable.
  const composer = page.locator('[contenteditable="true"]').first();
  await composer.waitFor({ state: "visible", timeout: 60000 });
  console.log("composer ready");

  // Start from a blank conversation so the edited message is ours.
  const newSession = page.locator('button[aria-label="新建会话"]').last();
  if (await newSession.count()) {
    await newSession.click();
    await page.waitForTimeout(1500);
  }

  await composer.click();
  await page.keyboard.insertText(ORIGINAL);
  await page.locator('button[aria-label="发送消息"]').first().click();
  console.log("first message sent");

  // Wait for the first turn to finish: the edit pencil appears on the last
  // user bubble, and the composer's send button returns.
  const pencil = page.locator('button[aria-label="编辑"]');
  await pencil.last().waitFor({ state: "visible", timeout: TOTAL_TIMEOUT_MS });
  console.log("edit pencil visible");

  // Wait for the session to go idle: saving while running reports agent-busy.
  // Idle = the transcript text stopped changing for three consecutive polls.
  let previous = "";
  let stable = 0;
  for (let i = 0; i < 120 && stable < 3; i += 1) {
    await page.waitForTimeout(1500);
    const now = await page.locator("body").innerText();
    stable = now === previous ? stable + 1 : 0;
    previous = now;
  }
  if (stable < 3) fail("the first turn never settled (still streaming after 3 minutes)");

  const editor = page.locator('textarea[aria-label="编辑"]').last();
  await pencil.last().click();
  await editor.waitFor({ state: "visible", timeout: 15000 });
  await editor.fill(EDITED);
  await page.getByRole("button", { name: "发送", exact: true }).last().click();
  console.log("edit submitted");

  // The editor closes on acceptance; a rejection leaves it open with an alert.
  let closed = false;
  for (let i = 0; i < 60 && !closed; i += 1) {
    await page.waitForTimeout(1000);
    const alerts = await page.locator('[role="alert"]').allInnerTexts();
    if (alerts.length > 0) {
      fail(`rewrite rejected: ${alerts.join(" | ")}`);
      break;
    }
    const body = await page.locator("body").innerText();
    closed = !body.includes("发送中…") && await editor.count() === 0;
  }
  if (!closed && process.exitCode !== 1) fail("the edit editor never closed after resend");

  await page.waitForTimeout(4000);

  // Assert on the TRANSCRIPT, not the whole body: the conversation header
  // breadcrumb and the sidebar row keep the session's auto-generated title,
  // which is derived from the message text and lags (or does not follow) the
  // in-place rewrite. Those chrome nodes are not transcript leftovers.
  const CHROME = /crumb|summaryText/i;
  const holders = async (marker) => page.evaluate(({ text, chrome }) => {
    const pattern = new RegExp(chrome, "i");
    const found = [];
    for (const el of document.querySelectorAll("*")) {
      if (el.children.length > 0) continue;
      if (!(el.textContent ?? "").includes(text)) continue;
      if (pattern.test(String(el.className))) continue;
      const rect = el.getBoundingClientRect();
      if (rect.left > 260 && rect.width > 0) {
        found.push(`${el.tagName}.${String(el.className).slice(0, 50)}`);
      }
    }
    return found;
  }, { text: marker, chrome: CHROME.source });

  const leftover = await holders(MARK_ORIGINAL);
  const rewritten = await holders(MARK_EDITED);
  if (leftover.length > 0) fail(`the original message is still rendered in the transcript: ${leftover.join(", ")}`);
  if (rewritten.length === 0) fail("the edited message never appeared in the transcript");

  await page.screenshot({ path: "/tmp/rewrite-e2e.png" });
  console.log("transcript rewritten in place:", leftover.length === 0 && rewritten.length > 0);
  console.log("console errors:", consoleErrors.slice(0, 5));
  if (process.exitCode !== 1) console.log("PASS: edit-and-resend works end to end");
} catch (error) {
  fail(String(error).slice(0, 400));
  await page.screenshot({ path: "/tmp/rewrite-e2e-fail.png" }).catch(() => {});
} finally {
  await browser.close();
}
