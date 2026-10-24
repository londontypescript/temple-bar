// Reading typecheck and test scripts into listings: every supported form
// gives the listing its tool would make, and every other form is refused,
// since a guessed listing could credit files the script never checks.

import assert from "node:assert/strict";
import test from "node:test";

import {
  readTestScript,
  readTypecheckScript,
  SUPPORTED_FORMS,
  unsupportedFormMessage,
} from "./coverage-scripts.ts";

void test("coverage scripts: each supported typecheck form reads as the programs tsc checks, its flags left out", () => {
  const forms: [string, unknown][] = [
    ["tsc", [{ tool: "tsc", project: undefined }]],
    ["tsc -p x", [{ tool: "tsc", project: "x" }]],
    ["tsc --project x", [{ tool: "tsc", project: "x" }]],
    ["tsc --noEmit -p x", [{ tool: "tsc", project: "x" }]],
    ['tsc -p "x.json"', [{ tool: "tsc", project: "x.json" }]],
    ["tsc --pretty false", [{ tool: "tsc", project: undefined }]],
    ["tsc -b", [{ tool: "tsc-build", projects: [] }]],
    ["tsc --build", [{ tool: "tsc-build", projects: [] }]],
    ["tsc -b a b", [{ tool: "tsc-build", projects: ["a", "b"] }]],
    ["tsc -b --force --verbose", [{ tool: "tsc-build", projects: [] }]],
    ["tsc -b -v --pretty true a", [{ tool: "tsc-build", projects: ["a"] }]],
    [
      "tsc -p a && tsc -p b",
      [
        { tool: "tsc", project: "a" },
        { tool: "tsc", project: "b" },
      ],
    ],
  ];
  for (const [script, plan] of forms) {
    assert.deepEqual(readTypecheckScript(script), plan, script);
  }
});

void test("coverage scripts: each supported test form reads as the run's own arguments or Node's patterns", () => {
  const forms: [string, unknown][] = [
    ["vitest run", [{ tool: "vitest", args: [], text: "vitest run" }]],
    ["vitest", [{ tool: "vitest", args: [], text: "vitest" }]],
    [
      "vitest run --config x --root .",
      [
        {
          tool: "vitest",
          args: ["--config", "x", "--root", "."],
          text: "vitest run --config x --root .",
        },
      ],
    ],
    [
      'vitest --run "src/web"',
      [
        {
          tool: "vitest",
          args: ["--run", "src/web"],
          text: 'vitest --run "src/web"',
        },
      ],
    ],
    [
      'node --test "a/**"',
      [{ tool: "node", patterns: ["a/**"], text: 'node --test "a/**"' }],
    ],
    [
      'node --import ./x.ts --test-reporter=tap --test "a/**"',
      [
        {
          tool: "node",
          patterns: ["a/**"],
          text: 'node --import ./x.ts --test-reporter=tap --test "a/**"',
        },
      ],
    ],
    [
      "node --test-reporter spec --test-force-exit --test",
      [
        {
          tool: "node",
          patterns: [],
          text: "node --test-reporter spec --test-force-exit --test",
        },
      ],
    ],
    // Unquoted, a file name with no glob in it is read as a plain word.
    [
      "node --test src/a.test.ts",
      [
        {
          tool: "node",
          patterns: ["src/a.test.ts"],
          text: "node --test src/a.test.ts",
        },
      ],
    ],
  ];
  for (const [script, plan] of forms) {
    assert.deepEqual(readTestScript(script), plan, script);
  }
});

void test("coverage scripts: a typecheck the gate can't list as written is refused", () => {
  for (const script of [
    "vue-tsc --noEmit",
    "svelte-check",
    "tsc --listFiles",
    "tsc --watch",
    "tsc --outDir x",
    "tsc src/a.ts",
    "tsc -p a -p b",
    "tsc -p",
    "tsc --noEmit -b",
    // Outside build mode, -v is --version: it checks nothing and passes.
    "tsc -v",
    "tsc -p x -v",
    "tsc --force",
    "tsc -p 'x'",
    "tsc -p x; true",
    "tsc -p x || true",
    "tsc -p x | cat",
    "tsc -p $CONFIG",
    "tsc  -p x",
    "tsc -p x &&",
    "tsc\t-p x",
    "tsc -p x\ntrue",
    'tsc -p "x y"',
    "",
  ]) {
    assert.equal(readTypecheckScript(script), undefined, script);
  }
});

void test("coverage scripts: a test script that could run fewer files or tests than it names, or more than the gate can see, is refused", () => {
  for (const script of [
    "jest",
    "vitest watch",
    "vitest list",
    "vitest bench",
    "vitest run -t x",
    "vitest run -ut",
    "vitest run --testNamePattern=x",
    "vitest run --test-name-pattern x",
    "vitest run --shard 1/2",
    "vitest run --shard=1/2",
    "vitest run --changed",
    "vitest --related src/a.ts",
    'node --test-shard=1/2 --test "a/**"',
    'node --test --test-only "a/**"',
    'node --test-name-pattern=x --test "a/**"',
    'node --experimental-test-coverage --test "a/**"',
    // An entry script gets --test and the patterns as its own arguments.
    'node scripts/run.js --test "a/**"',
    'node --test-force-exit scripts/run.js --test "a/**"',
    'node --import ./x.ts scripts/run.js --test "a/**"',
    'node --test "a/**" --test "b/**"',
    "node a.test.js",
    "node --test 'a/**'",
    // Unquoted, a glob is expanded by the shell before Node sees it, and sh
    // reads `**` as `*`: the run takes fewer files than the pattern names.
    "node --test src/**/*.test.ts",
    'node --test "src/**" src/*.test.ts',
    "node --test src/a?.test.ts",
    "node --test src/[ab].test.ts",
    "node --test src/{a,b}.test.ts",
    'node --test "a/**"; true',
    'node --test "a/**" | cat',
    'node --test "a/(b|c)/**"',
    "echo tests && node --test",
  ]) {
    assert.equal(readTestScript(script), undefined, script);
  }
});

void test("coverage scripts: the message names the package, the script as written and the supported forms, as listed", () => {
  assert.equal(
    unsupportedFormMessage("typecheck", "apps/web", "vue-tsc --noEmit"),
    `gate: apps/web's typecheck script isn't a form the gate can list: "vue-tsc --noEmit"\n  ${SUPPORTED_FORMS.typecheck}\n`,
  );
  assert.equal(
    unsupportedFormMessage("test", "the root", 'node run.js --test "a"'),
    `gate: the root's test script isn't a form the gate can list: "node run.js --test \\"a\\""\n  ${SUPPORTED_FORMS.test}\n`,
  );
  assert.equal(
    SUPPORTED_FORMS.typecheck,
    "supported: tsc [-p <config>] [flags], tsc -b [<project>...] [flags], joined with &&; flags: --noEmit, --pretty [true|false], --incremental, --skipLibCheck, --noCheck, and after -b also --force, -f, --verbose, -v; no shell syntax but && and double quotes around words",
  );
  assert.match(SUPPORTED_FORMS.test, /no entry script before --test/);
  assert.match(SUPPORTED_FORMS.test, /globs double-quoted/);
  assert.match(SUPPORTED_FORMS.test, /vitest without -t, --testNamePattern/);
});
