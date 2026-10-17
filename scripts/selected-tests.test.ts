import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  isDefaultTestFile,
  selectedFiles,
  selectionProblems,
  testPatterns,
  testScripts,
  trackedTestFiles,
} from "./selected-tests.ts";

const root = path.resolve(import.meta.dirname, "..");

void test("the root and package test scripts run every tracked test file exactly once", () => {
  const tracked = trackedTestFiles(root);
  assert.ok(tracked.length > 0, "git lists no test files");
  const selections = testScripts(root).map((script) => ({
    script: `${script.folder || "the root"}'s test`,
    files: selectedFiles(root, script),
  }));
  assert.ok(selections.length > 1, "found no workspace package test scripts");
  assert.deepEqual(selectionProblems(tracked, selections), []);
});

void test("a tracked test file no script selects is named", () => {
  assert.deepEqual(
    selectionProblems(
      ["e2e/a.test.ts", "packages/x/src/b.test.ts"],
      [{ script: "the root's test", files: ["e2e/a.test.ts"] }],
    ),
    ["packages/x/src/b.test.ts is run by no test script"],
  );
});

void test("a file two selections run is named, with both scripts", () => {
  assert.deepEqual(
    selectionProblems(
      ["packages/x/src/b.test.ts"],
      [
        { script: "the root's test", files: ["packages/x/src/b.test.ts"] },
        { script: "packages/x's test", files: ["packages/x/src/b.test.ts"] },
      ],
    ),
    [
      "packages/x/src/b.test.ts is run more than once: the root's test, packages/x's test",
    ],
  );
});

void test("patterns expand from the script's own folder, nested folders included", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "selected-tests-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  for (const file of [
    "e2e/top.test.ts",
    "e2e/support/nested.test.ts",
    "packages/x/src/deep/c.test.ts",
    "packages/x/node_modules/dep/d.test.ts",
  ]) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), "");
  }
  assert.deepEqual(
    [
      ...selectedFiles(dir, {
        folder: "",
        command: 'node scripts/run-tests.ts --test "e2e/**/*.test.ts"',
      }),
    ].sort(),
    ["e2e/support/nested.test.ts", "e2e/top.test.ts"],
  );
  assert.deepEqual(
    selectedFiles(dir, {
      folder: "packages/x",
      command: 'node ../../scripts/run-tests.ts --test "**/*.test.ts"',
    }),
    ["packages/x/src/deep/c.test.ts"],
  );
});

void test("a script that doesn't name its files, or doesn't use the runner, is refused", () => {
  assert.throws(
    () =>
      testPatterns({
        folder: "packages/x",
        command: "node ../../scripts/run-tests.ts --test",
      }),
    /packages\/x's test script must name its test files after --test/,
  );
  assert.throws(
    () => testPatterns({ folder: "", command: "vitest run" }),
    /the root's test script must start with node and scripts\/run-tests.ts/,
  );
});

void test("packages come from the workspace's packages list only, never its other lists", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "selected-tests-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const command = 'node scripts/run-tests.ts --test "e2e/**/*.test.ts"';
  for (const folder of ["", "packages/x", "esbuild"]) {
    mkdirSync(path.join(dir, folder), { recursive: true });
    writeFileSync(
      path.join(dir, folder, "package.json"),
      JSON.stringify({ scripts: { test: command } }),
    );
  }
  writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    'packages:\n  - "packages/*"\nonlyBuiltDependencies:\n  - esbuild\n',
  );
  assert.deepEqual(
    testScripts(dir).map((script) => script.folder),
    ["", "packages/x"],
  );
  writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    'packages:\n  - "packages/*"\n  - "!packages/x"\n',
  );
  assert.throws(() => testScripts(dir), /with no exclusions/);
});

void test("a runner flag that could run fewer files than the patterns select is refused", () => {
  for (const command of [
    'node ../../scripts/run-tests.ts --test-shard=1/2 --test "src/**/*.test.ts"',
    'node ../../scripts/run-tests.ts --test "src/**/*.test.ts" --test-name-pattern=x',
  ]) {
    assert.throws(
      () => testPatterns({ folder: "packages/x", command }),
      /may hold only --import <file> pairs before --test|must double-quote each file pattern/,
    );
  }
  assert.deepEqual(
    testPatterns({
      folder: "",
      command:
        'node scripts/run-tests.ts --import ./a.ts --import ./b.ts --test "e2e/**/*.test.ts"',
    }),
    ["e2e/**/*.test.ts"],
  );
});

void test("a file two of one script's patterns match counts once, as the runner runs it once", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "selected-tests-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  mkdirSync(path.join(dir, "src/gate"), { recursive: true });
  writeFileSync(path.join(dir, "src/gate/a.test.ts"), "");
  assert.deepEqual(
    selectedFiles(dir, {
      folder: "",
      command:
        'node scripts/run-tests.ts --test "src/**/*.test.ts" "src/gate/**/*.test.ts"',
    }),
    ["src/gate/a.test.ts"],
  );
});

void test("the inventory takes every name Node runs by default, empty wildcards included", () => {
  for (const file of [
    "a.test.ts",
    "a-test.mts",
    "a_test.cjs",
    "test-a.js",
    "test.ts",
    "_test.ts",
    "test-.ts",
    "x/test/deep/y.ts",
  ]) {
    assert.ok(isDefaultTestFile(file), file);
  }
  for (const file of ["a.spec.ts", "x.test-entry.ts", "selected-tests.ts"]) {
    assert.ok(!isDefaultTestFile(file), file);
  }
});

void test("shell syntax, unquoted patterns and patterns that match nothing are refused", (t) => {
  for (const command of [
    "node scripts/run-tests.ts --test '--test-name-pattern=x' \"e2e/**/*.test.ts\"",
    'node scripts/run-tests.ts --test "e2e/**/*.test.ts" && node --test x.ts',
  ]) {
    assert.throws(
      () => testPatterns({ folder: "", command }),
      /may use no shell syntax but double quotes/,
    );
  }
  assert.throws(
    () =>
      testPatterns({
        folder: "",
        command: "node scripts/run-tests.ts --test e2e/a.test.ts",
      }),
    /must double-quote each file pattern/,
  );
  const dir = mkdtempSync(path.join(tmpdir(), "selected-tests-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  assert.throws(
    () =>
      selectedFiles(dir, {
        folder: "",
        command: 'node scripts/run-tests.ts --test "e2e/**/*.tset.ts"',
      }),
    /names a pattern that matches no file: e2e\/\*\*\/\*\.tset\.ts/,
  );
});

void test("two quoted parts written together, which the shell would join, are refused", () => {
  assert.throws(
    () =>
      testPatterns({
        folder: "",
        command:
          'node scripts/run-tests.ts --test "scripts/*""[se]*/**/*.test.ts"',
      }),
    /may hold only plain words and whole double-quoted patterns/,
  );
});

void test("a line break, which would start a second command, is refused", () => {
  for (const command of [
    'node scripts/run-tests.ts --test "scripts/**/*.test.ts"\n"echo" "e2e/**/*.test.ts"',
    'node scripts/run-tests.ts --test "scripts/**/*.test.ts"\t"e2e/**/*.test.ts"',
  ]) {
    assert.throws(
      () => testPatterns({ folder: "", command }),
      /may separate its words only with single spaces/,
    );
  }
});

void test("a ! in a pattern, which cmd.exe can rewrite on Windows, is refused", () => {
  assert.throws(
    () =>
      testPatterns({
        folder: "",
        command: 'node scripts/run-tests.ts --test "src/[!a]*.test.ts"',
      }),
    /may hold only plain words and whole double-quoted patterns/,
  );
});
