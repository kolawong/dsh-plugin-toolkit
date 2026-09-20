import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  loadSavedData,
  saveTranslationsData,
  resolveCredentials,
  callAiTranslate,
  installSlashI18nApi,
} from "../slash-i18n-api.js";

test("slash-i18n: loadSavedData and saveTranslationsData round-trip", () => {
  const tmpFile = path.join(os.tmpdir(), `test-slash-trans-${Date.now()}.json`);
  try {
    const initial = loadSavedData(tmpFile);
    assert.deepEqual(initial.translations, {});
    assert.deepEqual(initial.discovered, []);

    const toWrite = {
      translations: { "hello world": "你好世界" },
      discovered: [{ name: "test", description: "hello world", type: "command" }]
    };
    saveTranslationsData(toWrite, tmpFile);

    const reRead = loadSavedData(tmpFile);
    assert.equal(reRead.translations["hello world"], "你好世界");
    assert.equal(reRead.discovered[0].name, "test");
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
});

test("slash-i18n: resolveCredentials returns an object", () => {
  const creds = resolveCredentials();
  assert.equal(typeof creds, "object");
});

test("slash-i18n: callAiTranslate throws when no credentials provided", async () => {
  await assert.rejects(
    async () => {
      await callAiTranslate([{ name: "test", text: "hello" }], {});
    },
    /未检测到已配置的 AI Key/
  );
});

test("slash-i18n: installSlashI18nApi registers routes onto webServer", () => {
  const routes = [];
  const fakeWebServer = {
    register: (route) => {
      routes.push(route);
      return () => {};
    }
  };
  const fakeCtx = {
    webServer: fakeWebServer,
    inject: (deps, fn) => fn(fakeCtx),
    effect: (fn) => fn()
  };

  installSlashI18nApi(fakeCtx);
  assert.equal(routes.length, 2);
  assert.ok(routes.some(r => r.path === "/api/toolkit/slash-translations"));
  assert.ok(routes.some(r => r.path === "/api/toolkit/translate-slash"));
});
