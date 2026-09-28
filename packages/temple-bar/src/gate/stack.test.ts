import assert from "node:assert/strict";
import test from "node:test";

import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
  createFakeProc,
} from "../testing/fakes.ts";
import {
  codeExists,
  detectPackageManager,
  missingRequiredScripts,
  readPackageManifest,
  REQUIRED_SCRIPTS,
  runRequiredScripts,
} from "./stack.ts";

void test("readPackageManifest returns undefined with no package.json, and parses one that exists", async () => {
  const empty = createFakeContext({ fs: createFakeFs() });
  assert.equal(await readPackageManifest(empty), undefined);

  const withPkg = createFakeContext({
    fs: createFakeFs({
      "/repo/package.json": JSON.stringify({
        scripts: { test: "node --test" },
      }),
    }),
  });
  assert.deepEqual(await readPackageManifest(withPkg), {
    scripts: { test: "node --test" },
  });
});

void test("readPackageManifest treats invalid JSON as absent", async () => {
  const ctx = createFakeContext({
    fs: createFakeFs({ "/repo/package.json": "{ not json" }),
  });
  assert.equal(await readPackageManifest(ctx), undefined);
});

void test("missingRequiredScripts: none missing when all three are present", () => {
  assert.deepEqual(
    missingRequiredScripts({
      scripts: { typecheck: "tsc", lint: "eslint .", test: "node --test" },
    }),
    [],
  );
});

void test("missingRequiredScripts: names each missing script, in the fixed order", () => {
  assert.deepEqual(
    missingRequiredScripts({ scripts: { test: "node --test" } }),
    ["typecheck", "lint"],
  );
});

void test("missingRequiredScripts: every script is missing when there is no manifest at all", () => {
  assert.deepEqual(missingRequiredScripts(undefined), [...REQUIRED_SCRIPTS]);
});

void test("codeExists: true when a git-tracked-or-trackable path has a code extension", async () => {
  const git = createFakeGit(() => ({
    code: 0,
    stdout: "README.md\nsrc/index.ts\n",
    stderr: "",
  }));
  const ctx = createFakeContext({ git });
  assert.equal(await codeExists(ctx), true);
});

void test("codeExists: false for a docs-only project", async () => {
  const git = createFakeGit(() => ({
    code: 0,
    stdout: "README.md\ndocs/plan.md\n",
    stderr: "",
  }));
  const ctx = createFakeContext({ git });
  assert.equal(await codeExists(ctx), false);
});

void test("codeExists: a nested worktree's code doesn't count (P3.7), because git lists it as a directory entry", async () => {
  const git = createFakeGit(() => ({
    code: 0,
    stdout: "README.md\nnested-worktree/\n",
    stderr: "",
  }));
  const ctx = createFakeContext({ git });
  assert.equal(await codeExists(ctx), false);
});

void test("detectPackageManager: pnpm from packageManager field, without running anything", async () => {
  const proc = createFakeProc();
  const ctx = createFakeContext({ fs: createFakeFs(), proc });

  const manager = await detectPackageManager(ctx, {
    packageManager: "pnpm@10.34.5",
  });

  assert.equal(manager, "pnpm");
  assert.equal(proc.calls.length, 0);
});

void test("detectPackageManager: pnpm from a pnpm-lock.yaml with no packageManager field", async () => {
  const ctx = createFakeContext({
    fs: createFakeFs({ "/repo/pnpm-lock.yaml": "lockfileVersion: 9\n" }),
  });
  assert.equal(await detectPackageManager(ctx, {}), "pnpm");
});

void test("detectPackageManager: npm otherwise", async () => {
  const ctx = createFakeContext({ fs: createFakeFs() });
  assert.equal(await detectPackageManager(ctx, {}), "npm");
  assert.equal(
    await detectPackageManager(ctx, { packageManager: "npm@11.0.0" }),
    "npm",
  );
});

void test("runRequiredScripts: runs every script in order, all with CI=true, even after a failure", async () => {
  const calls: string[] = [];
  const proc = createFakeProc((call) => {
    calls.push(call.args[1] ?? "");
    return call.args[1] === "lint" ? 1 : 0;
  });
  const ctx = createFakeContext({ proc, env: { PATH: "/usr/bin" } });

  const results = await runRequiredScripts(ctx, "npm", REQUIRED_SCRIPTS);

  assert.deepEqual(calls, ["typecheck", "lint", "test"]);
  assert.deepEqual(
    results.map((r) => [r.script, r.exitCode]),
    [
      ["typecheck", 0],
      ["lint", 1],
      ["test", 0],
    ],
  );
  for (const call of proc.calls) {
    assert.equal(call.command, "npm");
    assert.deepEqual(call.args.slice(0, 1), ["run"]);
    assert.equal(call.env.CI, "true");
    assert.equal(call.env.PATH, "/usr/bin");
  }
});
