import assert from "node:assert/strict";
import test from "node:test";

import {
  ensurePackageJsonScripts,
  GATE_SCRIPT,
  PREPARE_SCRIPT,
} from "./package-json.ts";
import { createFakeContext, createFakeFs } from "../testing/fakes.ts";

void test("ensurePackageJsonScripts creates a minimal package.json when none exists", async () => {
  const fs = createFakeFs();
  const ctx = createFakeContext({ fs, cwd: "/repo" });
  const outcome = await ensurePackageJsonScripts(ctx, "/repo/my-app");
  assert.equal(outcome.wrote, true);
  assert.deepEqual(outcome.conflicts, []);
  const written = JSON.parse(
    fs.files.get("/repo/my-app/package.json") ?? "{}",
  ) as {
    name: string;
    private: boolean;
    scripts: Record<string, string>;
  };
  assert.equal(written.name, "my-app");
  assert.equal(written.private, true);
  assert.equal(written.scripts.prepare, PREPARE_SCRIPT);
  assert.equal(written.scripts.gate, GATE_SCRIPT);
});

void test("ensurePackageJsonScripts adds the scripts to an existing package.json", async () => {
  const fs = createFakeFs({
    "/repo/package.json": JSON.stringify({
      name: "existing",
      scripts: { test: "vitest" },
    }),
  });
  const ctx = createFakeContext({ fs });
  const outcome = await ensurePackageJsonScripts(ctx, "/repo");
  assert.equal(outcome.wrote, true);
  assert.deepEqual(outcome.conflicts, []);
  const written = JSON.parse(fs.files.get("/repo/package.json") ?? "{}") as {
    scripts: Record<string, string>;
  };
  assert.equal(written.scripts.test, "vitest");
  assert.equal(written.scripts.prepare, PREPARE_SCRIPT);
  assert.equal(written.scripts.gate, GATE_SCRIPT);
});

void test("ensurePackageJsonScripts leaves a different `prepare` script alone and reports it", async () => {
  const fs = createFakeFs({
    "/repo/package.json": JSON.stringify({
      name: "existing",
      scripts: { prepare: "husky install" },
    }),
  });
  const ctx = createFakeContext({ fs });
  const outcome = await ensurePackageJsonScripts(ctx, "/repo");
  assert.deepEqual(outcome.conflicts, [
    { name: "prepare", expected: PREPARE_SCRIPT },
  ]);
  const written = JSON.parse(fs.files.get("/repo/package.json") ?? "{}") as {
    scripts: Record<string, string>;
  };
  assert.equal(written.scripts.prepare, "husky install", "must not overwrite");
  assert.equal(written.scripts.gate, GATE_SCRIPT, "gate still gets added");
});

void test("ensurePackageJsonScripts is a no-op the second time (idempotent)", async () => {
  const fs = createFakeFs({
    "/repo/package.json": JSON.stringify(
      {
        name: "existing",
        scripts: { prepare: PREPARE_SCRIPT, gate: GATE_SCRIPT },
      },
      null,
      2,
    ),
  });
  const ctx = createFakeContext({ fs });
  const outcome = await ensurePackageJsonScripts(ctx, "/repo");
  assert.equal(outcome.wrote, false);
  assert.deepEqual(outcome.conflicts, []);
  assert.equal(fs.writes.length, 0);
});

void test("ensurePackageJsonScripts keeps the file's indent and final newline", async () => {
  for (const [indent, newline] of [
    ["\t", "\n"],
    ["    ", "\n"],
    ["  ", ""],
  ] as const) {
    const original = `${JSON.stringify({ name: "x" }, null, indent)}${newline}`;
    const fs = createFakeFs({ "/repo/package.json": original });
    const ctx = createFakeContext({ fs });
    await ensurePackageJsonScripts(ctx, "/repo");
    const after = fs.files.get("/repo/package.json") ?? "";
    assert.ok(after.includes(`\n${indent}"scripts": {`), JSON.stringify(after));
    assert.equal(after.endsWith("\n"), newline === "\n");
  }
});
