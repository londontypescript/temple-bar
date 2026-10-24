import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  PACKAGE_TEST_FOLDERS,
  ROOT_TEST_FOLDERS,
  runnerArgs,
  TEST_FILE_SUFFIX,
  testTarget,
} from "./remote/only-target.ts";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function testScript(folder: string): unknown {
  const manifest: unknown = JSON.parse(
    readFileSync(path.join(repo, folder, "package.json"), "utf8"),
  );
  return typeof manifest === "object" &&
    manifest !== null &&
    "scripts" in manifest &&
    typeof manifest.scripts === "object" &&
    manifest.scripts !== null &&
    "test" in manifest.scripts
    ? manifest.scripts.test
    : undefined;
}

void test("every test script is the command a targeted run builds, over the folders its path rule accepts", () => {
  // A targeted run builds `pnpm test`'s command itself, and accepts a file
  // only under the folders these globs cover: if a script changes, this
  // fails here rather than on the Windows machine.
  const expected = (workspace: string, folders: readonly string[]): string =>
    [
      "node",
      ...runnerArgs(workspace),
      ...folders.map((folder) => `"${folder}/**/*${TEST_FILE_SUFFIX}"`),
    ].join(" ");
  assert.equal(testScript(""), expected("", ROOT_TEST_FOLDERS));
  const packages = readdirSync(path.join(repo, "packages"));
  assert.ok(packages.length > 0);
  for (const name of packages) {
    const workspace = `packages/${name}`;
    assert.equal(
      testScript(workspace),
      expected(workspace, PACKAGE_TEST_FOLDERS),
      workspace,
    );
  }
});

void test("the path rule maps a test file to its workspace, and refuses anything else", () => {
  assert.deepEqual(testTarget("scripts/windows-run/verdict.test.ts"), {
    workspace: "",
    file: "scripts/windows-run/verdict.test.ts",
  });
  assert.deepEqual(testTarget("e2e/runtime.e2e.test.ts"), {
    workspace: "",
    file: "e2e/runtime.e2e.test.ts",
  });
  assert.deepEqual(testTarget("packages/temple-bar/src/gate/core.test.ts"), {
    workspace: "packages/temple-bar",
    file: "src/gate/core.test.ts",
  });
  for (const bad of [
    "scripts/a.ts",
    "e2e/release/publish.release.ts",
    "docs/a.test.ts",
    "a.test.ts",
    "scripts.test.ts",
    "packages/p/a.test.ts",
    "packages/p/test/a.test.ts",
    "packages/src/a.test.ts",
    "/scripts/a.test.ts",
    "scripts//a.test.ts",
    "scripts/./a.test.ts",
    "scripts/../e2e/a.test.ts",
    "scripts/.hidden/a.test.ts",
    "scripts\\a.test.ts",
    "scripts/a b.test.ts",
    "scripts/a&b.test.ts",
    "scripts/a%PATH%.test.ts",
    'scripts/a".test.ts',
    "",
  ]) {
    assert.equal(testTarget(bad), undefined, bad);
  }
});
