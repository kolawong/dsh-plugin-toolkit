/**
 * Tests for the smartReply local habit store (suggest-store.js).
 *
 * The contract under test is resilience: a missing, corrupt, or oversized state
 * file degrades to an empty state, writes are atomic and mode 600, and only a
 * genuinely new observation touches the disk.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createHabitStore,
  readHabitState,
  writeHabitState,
  resolveHabitPath,
  HABIT_FILE,
  MAX_HABIT_FILE_BYTES,
} from "../suggest-store.js";
import { createHabitState } from "../suggest-habits.js";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "dsh-suggest-store-"));
}

test("resolveHabitPath: honours DSH_HOME and calls it the plugin's private directory", () => {
  const path = resolveHabitPath({ DSH_HOME: "/tmp/dsh-home" });
  assert.equal(path, join("/tmp/dsh-home", "plugins", "dsh-plugin-toolkit", HABIT_FILE));
  const fallback = resolveHabitPath({});
  assert.ok(fallback.endsWith(join("plugins", "dsh-plugin-toolkit", HABIT_FILE)), fallback);
});

test("createHabitStore: a missing file reads as an empty state", () => {
  const dir = tempDir();
  try {
    const store = createHabitStore(join(dir, "missing.json"));
    assert.deepEqual(store.summary(), { turns: 0, accepted: 0, languages: [] });
    assert.equal(store.styleHint("zh"), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createHabitStore: learns user messages + accepted suggestions and persists them", () => {
  const dir = tempDir();
  try {
    const file = join(dir, "habits.json");
    const first = createHabitStore(file);
    first.learn({ userMessages: ["把测试跑一下", "先给结论"], accepted: ["跑一下测试"], language: "zh" });
    assert.deepEqual(first.summary(), { turns: 2, accepted: 1, languages: ["zh"] });
    assert.match(first.styleHint("zh"), /平均长度|常用开头/);
    assert.ok(statSync(file).isFile(), "state file must exist after a real change");
    assert.equal(statSync(file).mode & 0o777, 0o600);

    // A second store (new process equivalent) sees the persisted state.
    const second = createHabitStore(file);
    assert.deepEqual(second.summary(), { turns: 2, accepted: 1, languages: ["zh"] });
    assert.match(second.styleHint("zh"), /平均长度|常用开头/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createHabitStore: learning the same message again does not rewrite the file", () => {
  const dir = tempDir();
  try {
    const file = join(dir, "habits.json");
    const store = createHabitStore(file);
    store.learn({ userMessages: ["重复的一句话"], language: "zh" });
    const before = readFileSync(file, "utf8");
    store.learn({ userMessages: ["重复的一句话"], language: "zh" });
    const after = readFileSync(file, "utf8");
    assert.equal(after, before, "an unchanged observation must not touch the disk");
    assert.deepEqual(store.summary(), { turns: 1, accepted: 0, languages: ["zh"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readHabitState: a corrupt file and an oversized file both read as empty", () => {
  const dir = tempDir();
  try {
    const corrupt = join(dir, "corrupt.json");
    writeFileSync(corrupt, "{not json");
    assert.deepEqual(readHabitState(corrupt), createHabitState());

    const huge = join(dir, "huge.json");
    writeFileSync(huge, "x".repeat(MAX_HABIT_FILE_BYTES + 1));
    assert.deepEqual(readHabitState(huge), createHabitState());

    assert.deepEqual(readHabitState(join(dir, "nope.json")), createHabitState());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeHabitState: creates the directory tree and replaces the previous document", () => {
  const dir = tempDir();
  try {
    const file = join(dir, "nested", "deeper", "habits.json");
    const state = createHabitState();
    state.languages.zh.turns = 1;
    state.languages.zh.chars = 6;
    assert.equal(writeHabitState(file, state), true);
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(parsed.languages.zh.turns, 1);
    assert.equal(writeHabitState("", state), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createHabitStore: reload observes an external edit", () => {
  const dir = tempDir();
  try {
    const file = join(dir, "habits.json");
    const store = createHabitStore(file);
    assert.deepEqual(store.summary().turns, 0);
    const external = createHabitState();
    external.languages.zh.turns = 7;
    external.languages.zh.chars = 70;
    writeHabitState(file, external);
    assert.deepEqual(store.summary().turns, 0, "cached until reload");
    store.reload();
    assert.equal(store.summary().turns, 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
