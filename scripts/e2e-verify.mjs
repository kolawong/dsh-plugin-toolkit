/**
 * End-to-end verify of dsh-plugin-toolkit in the live web profile.
 * Run: node scripts/e2e-verify.mjs (needs DSH_AUTH_USER / DSH_AUTH_PASS in env)
 * NOTE: `import "playwright"` must resolve from the working directory - run
 * from the harness repo (e.g. /root/deepseek-harness) where playwright is a
 * dev dependency, not from this package (which keeps no runtime deps).
 *
 * Required env: DSH_AUTH_PASS.
 * Optional env: DSH_AUTH_USER (default "admin"), TOOLKIT_VERIFY_URL
 * (default http://127.0.0.1:3080), TOOLKIT_CHROME (default: let Playwright
 * resolve its own browser; set it only to pin a specific build).
 */
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.TOOLKIT_VERIFY_URL ?? "http://127.0.0.1:3080";
const user = process.env.DSH_AUTH_USER ?? "admin";
const pass = process.env.DSH_AUTH_PASS;
if (!pass) throw new Error("DSH_AUTH_PASS required");

// Default to Playwright's own browser resolution. A hardcoded chromium build
// path broke this script on every Playwright upgrade; if TOOLKIT_CHROME is set
// it must at least point at something real, so a typo fails loudly here rather
// than as an opaque launch error.
const EXE = process.env.TOOLKIT_CHROME;
if (EXE !== undefined && EXE !== "" && !existsSync(EXE)) {
  throw new Error(`TOOLKIT_CHROME does not exist: ${EXE}`);
}
const browser = await chromium.launch(EXE === undefined || EXE === "" ? {} : { executablePath: EXE });
const page = await browser.newPage();
const errors = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text().slice(0, 200)); });
page.on("pageerror", (err) => errors.push(`pageerror: ${String(err).slice(0, 300)}`));

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });

// Login via the auth-webserver form.
const passInput = page.locator('input[type="password"]').first();
await passInput.waitFor({ state: "visible", timeout: 20000 });
const userInput = page.locator('input[type="text"]').first();
await userInput.fill(user);
await passInput.fill(pass);
// The page's first <button> is the password eye toggle; submit by id or Enter.
const submitBtn = page.locator("#submitBtn");
if (await submitBtn.count()) await submitBtn.click();
else await passInput.press("Enter");
console.log("login submitted");

// Wait for the app shell to boot; the login page disappears on success.
let onLogin = true;
for (let i = 0; i < 20; i += 1) {
  await page.waitForTimeout(1000);
  const body = await page.locator("body").innerText().catch(() => "");
  if (!/登录|登 录/.test(body)) { onLogin = false; break; }
}
if (onLogin) {
  console.log("STILL ON LOGIN PAGE");
  console.log((await page.locator("body").innerText()).slice(0, 300));
} else {
  console.log("app shell booted");
  await page.waitForTimeout(4000);
  const textareas = page.locator("textarea");
  const taCount = await textareas.count();
  let composerEnabled = false;
  for (let i = 0; i < taCount; i += 1) {
    const ta = textareas.nth(i);
    if (await ta.isVisible() && !(await ta.isDisabled())) { composerEnabled = true; break; }
  }
  console.log(`textareas: ${taCount}, composer enabled: ${composerEnabled}`);

  // Settings panel via the sidebar foot trigger (aria-haspopup=dialog).
  const settingsBtns = page.locator('button[aria-haspopup="dialog"]');
  console.log("settings candidates:", await settingsBtns.count());
  if (await settingsBtns.count()) {
    await settingsBtns.first().click();
    await page.waitForTimeout(1500);
    const nav = page.locator('[role="dialog"] button');
    const navCount = await nav.count();
    let clickedPlugins = false;
    for (let i = 0; i < navCount; i += 1) {
      const text = ((await nav.nth(i).textContent()) ?? "").trim();
      if (text === "插件") { await nav.nth(i).click(); clickedPlugins = true; break; }
    }
    console.log("plugins tab clicked:", clickedPlugins);
    await page.waitForTimeout(2500);

    // The toolkit card must be a compact summary (no inline toggle rows).
    const body = await page.locator("body").innerText();
    const tk = body.split("\n").filter((l) => /Toolkit/.test(l));
    console.log("card mentions:", tk.slice(0, 4));

    // Click the card -> it EXPANDS (no modal yet), showing sub-cards.
    const card = page.locator('[role="dialog"] li', { hasText: /Toolkit/ }).first();
    console.log("toolkit card count:", await card.count());
    if (await card.count()) {
      await card.locator("button").first().click();
      await page.waitForTimeout(1000);
      const beforeModal = await page.locator('[aria-modal="true"]').count();
      console.log("modal count before sub-card click:", beforeModal);
      const expandedText = (await card.innerText()).replace(/\s+/g, " ");
      console.log("expanded card text:", expandedText.slice(0, 300));

      // While the card is expanded, both sub-cards must be present.
      const editSub = card.locator("button", { hasText: /编辑上一条|编辑/ }).first();
      console.log("edit sub-card count (expanded):", await editSub.count());

      // Click the workspacelessChat sub-card -> its settings modal opens.
      const subCard = card.locator("button", { hasText: /免选工作区|免选/ }).first();
      console.log("sub-card count:", await subCard.count());
      if (await subCard.count()) {
        await subCard.click();
        await page.waitForTimeout(1000);
        const modal = page.locator('[aria-modal="true"]').last();
        console.log("modal count after sub-card click:", await modal.count());
        const modalText = (await modal.innerText()).replace(/\s+/g, " ");
        console.log("modal text:", modalText.slice(0, 400));
        const sw = modal.locator('[role="switch"]');
        console.log("modal switch rows:", await sw.count());
        if (await sw.count()) {
          const before = await sw.first().getAttribute("aria-checked");
          await sw.first().click();
          await page.waitForTimeout(1200);
          const after = await sw.first().getAttribute("aria-checked");
          console.log("switch toggle:", before, "->", after);
          if (after === "false") {
            await sw.first().click();
            await page.waitForTimeout(1200);
          }
        }
      } else {
        console.log("SUB-CARD NOT FOUND");
      }

      // Close any open modal before the next sub-card interaction.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(600);

      // Re-expand the card if the Escape collapsed it.
      if (await editSub.count() === 0) {
        await card.locator("button").first().click();
        await page.waitForTimeout(900);
      }

      // The second optimization sub-card (editLastMessage) must open its
      // settings modal with a live switch.
      if (await editSub.count()) {
        await editSub.click();
        await page.waitForTimeout(900);
        const modal = page.locator('[aria-modal="true"]').last();
        const modalText = (await modal.innerText()).replace(/\s+/g, " ");
        console.log("edit modal text:", modalText.slice(0, 300));
        const sw = modal.locator('[role="switch"]');
        console.log("edit modal switch rows:", await sw.count());
        if (await sw.count()) {
          const before = await sw.first().getAttribute("aria-checked");
          await sw.first().click();
          await page.waitForTimeout(1000);
          const after = await sw.first().getAttribute("aria-checked");
          console.log("edit switch toggle:", before, "->", after);
          if (after === "false") {
            await sw.first().click();
            await page.waitForTimeout(1000);
          }
        }
        await page.keyboard.press("Escape");
        await page.waitForTimeout(600);
      } else {
        console.log("EDIT SUB-CARD NOT FOUND");
      }
    }
  }
}

await page.screenshot({ path: "/tmp/toolkit-e2e.png" });
console.log("console errors:", errors.slice(0, 8));
await browser.close();