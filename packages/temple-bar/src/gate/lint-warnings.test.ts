// Which lint scripts let warnings pass. The first test is the issue's own
// table of examples (#496), row by row with its verdict; the rest pin the
// grammar's edges and the message.

import assert from "node:assert/strict";
import test from "node:test";

import {
  formatLintFindings,
  lintScriptFindings,
  type LintFinding,
} from "./lint-warnings.ts";

type Verdict = "pass" | "no-flag" | "unreadable" | "too-deep";

function verdict(findings: readonly LintFinding[]): Verdict {
  const [first] = findings;
  return first === undefined ? "pass" : first.kind;
}

function check(
  lint: string,
  others: Readonly<Record<string, unknown>> = {},
): LintFinding[] {
  return lintScriptFindings({ ...others, lint });
}

const TABLE: readonly (readonly [
  string,
  Readonly<Record<string, string>>,
  Verdict,
])[] = [
  ["eslint . --max-warnings 0", {}, "pass"],
  ["eslint --max-warnings=0 .", {}, "pass"],
  ['eslint "src/**/*.{ts,tsx}" --max-warnings 0', {}, "pass"],
  ["pnpm exec eslint . --max-warnings 0 && tsc -p .", {}, "pass"],
  ["npx --yes eslint . --max-warnings 0", {}, "pass"],
  ["cross-env CI=true eslint . --max-warnings 0", {}, "pass"],
  ["oxlint --deny-warnings", {}, "pass"],
  ["biome check --error-on-warnings .", {}, "pass"],
  ["pnpm run lint:js", { "lint:js": "eslint . --max-warnings 0" }, "pass"],
  ["cargo clippy", {}, "pass"],
  ["eslint .", {}, "no-flag"],
  ["eslint . --max-warnings 0 --max-warnings 5", {}, "no-flag"],
  ["eslint . -- --max-warnings 0", {}, "no-flag"],
  ["echo --max-warnings 0 && eslint .", {}, "no-flag"],
  ["oxlint && eslint . --max-warnings 0", {}, "no-flag"],
  ["eslint . --max-warnings 0; true", {}, "unreadable"],
  ["eslint . --max-warnings 0 || true", {}, "unreadable"],
  ["eslint . # --max-warnings 0", {}, "unreadable"],
  ["node scripts/eslint.js", {}, "unreadable"],
  ["pnpm run a", { a: "pnpm run b", b: "eslint ." }, "too-deep"],
];

void test("lintScriptFindings: every example in the issue has its verdict", () => {
  for (const [lint, others, expected] of TABLE) {
    assert.equal(verdict(check(lint, others)), expected, lint);
  }
});

void test("lintScriptFindings: a missing flag names the tool, the command and the script holding it", () => {
  assert.deepEqual(check("eslint ."), [
    { kind: "no-flag", tool: "eslint", command: "eslint .", from: "lint" },
  ]);
  assert.deepEqual(check("oxlint && eslint . --max-warnings 0"), [
    { kind: "no-flag", tool: "oxlint", command: "oxlint", from: "lint" },
  ]);
  assert.deepEqual(
    check("pnpm run lint:js && pnpm lint:css", {
      "lint:js": "eslint .",
      "lint:css": "biome lint",
    }),
    [
      { kind: "no-flag", tool: "eslint", command: "eslint .", from: "lint:js" },
      {
        kind: "no-flag",
        tool: "biome",
        command: "biome lint",
        from: "lint:css",
      },
    ],
  );
});

void test("lintScriptFindings: each tool's own flag, by bare name or from node_modules/.bin, through each runner", () => {
  for (const lint of [
    "eslint . --max-warnings 0 --max-warnings 0",
    "eslint . --max-warnings 5 --max-warnings=0",
    "eslint . --max-warnings='0'",
    "node_modules/.bin/eslint . --max-warnings 0",
    "./node_modules/.bin/oxlint --deny-warnings",
    "../../node_modules/.bin/biome ci --error-on-warnings",
    "biome lint --error-on-warnings",
    "pnpm dlx oxlint --deny-warnings src",
    "npx -y --yes eslint . --max-warnings 0",
    "npx eslint . --max-warnings 0",
    "NODE_OPTIONS=--max-old-space-size=4096 eslint . --max-warnings 0",
    'A=1 B="x y" cross-env C=2 pnpm exec eslint . --max-warnings 0',
    "  eslint\t.  --max-warnings 0  ",
    "tsc -p . && oxlint --deny-warnings && prettier --check .",
    "npm run lint:js",
    "pnpm lint:js",
  ]) {
    assert.deepEqual(
      check(lint, { "lint:js": "eslint . --max-warnings 0" }),
      [],
      lint,
    );
  }
});

void test("lintScriptFindings: a flag that isn't the tool's own, or isn't 0, or is cut off, is no flag", () => {
  for (const lint of [
    "eslint . --max-warnings 1",
    "eslint . --max-warnings",
    "eslint . --max-warnings=",
    'eslint . --max-warnings ""',
    "eslint . --max-warnings -- 0",
    "eslint . --deny-warnings",
    "oxlint --max-warnings 0",
    "oxlint -- --deny-warnings",
    "biome check --deny-warnings",
    "biome check . -- --error-on-warnings",
    "eslint . && eslint --max-warnings 0 .",
    "npx eslint .",
  ]) {
    assert.equal(verdict(check(lint)), "no-flag", lint);
  }
});

void test("lintScriptFindings: anything outside the grammar that names a tool can't be read", () => {
  for (const lint of [
    "eslint . --max-warnings 0\n",
    "eslint . --max-warnings 0\r",
    "eslint . --max-warnings 0 | cat",
    "eslint . --max-warnings 0 &",
    "eslint . --max-warnings 0 &&& true",
    "eslint . --max-warnings 0 &&",
    "&& eslint . --max-warnings 0",
    "eslint . --max-warnings 0 && && true",
    "eslint . --max-warnings $LIMIT",
    "eslint . --max-warnings `echo 0`",
    "eslint . --max-warnings \\0",
    "eslint . --max-warnings 0 > out.txt",
    "eslint . --max-warnings 0 < /dev/null",
    'eslint "src --max-warnings 0',
    "eslint 'a&&b' --max-warnings 0",
    "biome format --error-on-warnings",
    "biome --error-on-warnings",
    "pnpm --filter a exec eslint . --max-warnings 0",
    "npx --no-install eslint . --max-warnings 0",
    "cross-env-shell eslint . --max-warnings 0",
    "pnpm exec -c eslint . --max-warnings 0",
    "echo eslint",
    "pnpm run lint:eslint",
  ]) {
    assert.equal(verdict(check(lint)), "unreadable", JSON.stringify(lint));
  }
});

void test("lintScriptFindings: a script that names no tool is the project's own, however it is written", () => {
  for (const lint of [
    "turbo run lint",
    "nx run-many -t lint; go vet ./...",
    "cargo clippy -- -D warnings | tee out.txt",
    "next lint",
    "pnpm run lint:rs",
    "pnpm run missing",
  ]) {
    assert.deepEqual(check(lint, { "lint:rs": "cargo clippy" }), [], lint);
  }
});

void test("lintScriptFindings: other scripts are read only one level down", () => {
  // One level down, the referenced script's commands are read as the
  // lint script's own, so a gap there is a finding with that script named.
  assert.deepEqual(check("pnpm run a", { a: "oxlint" }), [
    { kind: "no-flag", tool: "oxlint", command: "oxlint", from: "a" },
  ]);
  assert.equal(
    verdict(check("pnpm run a", { a: "eslint . --max-warnings 0; true" })),
    "unreadable",
  );
  // Any deeper is a finding, even when the deeper call has its flag, and
  // even next to a call that reads cleanly.
  assert.deepEqual(
    check("pnpm run a", { a: "npm run b", b: "pnpm c", c: "biome ci" }),
    [{ kind: "too-deep", tool: "biome", chain: ["lint", "a", "b", "c"] }],
  );
  assert.equal(
    verdict(
      check("pnpm run a", {
        a: "eslint . --max-warnings 0 && pnpm run b",
        b: "oxlint --deny-warnings",
      }),
    ),
    "too-deep",
  );
});

void test("lintScriptFindings: a loop of scripts ends, and a name that isn't a string script is never followed", () => {
  assert.deepEqual(check("pnpm lint"), []);
  assert.deepEqual(
    check("pnpm run a", { a: "pnpm run b", b: "pnpm run a" }),
    [],
  );
  assert.deepEqual(check("pnpm run a", { a: 5 }), []);
  assert.deepEqual(check("pnpm run constructor"), []);
  assert.deepEqual(lintScriptFindings({}), []);
  assert.deepEqual(lintScriptFindings({ lint: ["eslint ."] }), []);
});

void test("formatLintFindings: names the manifest, the script, the tool and the flag to add", () => {
  const label = "packages/a/package.json";
  assert.equal(
    formatLintFindings(label, check("eslint . && pnpm run b", { b: "oxlint" })),
    `gate: ${label} has a "lint" script that lets warnings pass\n` +
      `  "eslint ." runs eslint without --max-warnings 0: add --max-warnings 0 to it\n` +
      `  "oxlint" (in "b") runs oxlint without --deny-warnings: add --deny-warnings to it\n`,
  );
  assert.match(
    formatLintFindings(label, check("biome ci; oxlint")),
    /calls oxlint, biome, but the gate can't read it: it holds ";"\n.*each oxlint call with --deny-warnings, each biome call with --error-on-warnings\n$/,
  );
  assert.match(
    formatLintFindings(
      label,
      check("pnpm run a", { a: "pnpm run b", b: "eslint ." }),
    ),
    /reaches eslint too deep, through "lint" > "a" > "b"\n {2}call eslint from "lint" or a script "lint" runs directly, with --max-warnings 0\n$/,
  );
});
