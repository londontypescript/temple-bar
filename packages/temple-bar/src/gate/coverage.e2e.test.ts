// The coverage check on a real repo, through the whole gate, with the real
// git, pnpm and tsc (linked from this repo, see typescript-link.ts) and
// Node's test runner: primrose-hill's two gaps, recreated, each fail with
// the check's own message, and the fixed project passes. knip and
// markdownlint are stand-ins: their own tests run them for real.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { initTestRepo } from "../testing/git-repo.ts";
import { installCore } from "./testing/core-fixture.ts";
import {
  coverageProject,
  type CoverageFixtureOptions,
} from "./testing/coverage-fixture.ts";
import { testGateCommand as gate } from "./testing/fake-tools.ts";
import { realContext } from "./testing/real-repo.ts";
import { linkTypeScript } from "./testing/typescript-link.ts";
import { SUPPORTED_FORMS } from "./coverage-scripts.ts";

/** The pnpm running this suite, which the gate runs every script and tool
 * through, as `pnpm gate` would. */
function suitePnpm(): string {
  const execPath = process.env.npm_execpath ?? "";
  if (!path.basename(execPath).startsWith("pnpm")) {
    throw new Error(
      "these tests need the pnpm that runs them: run the suite with `pnpm test`",
    );
  }
  return execPath;
}

/** Writes the fixture into a new repo set up as temple-bar's setup leaves
 * one, runs the gate there, and removes the repo. */
async function gateOn(
  options: CoverageFixtureOptions,
): Promise<{ code: number; out: string; err: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-coverage-"));
  try {
    initTestRepo(dir);
    for (const [relative, text] of Object.entries(coverageProject(options))) {
      const file = path.join(dir, ...relative.split("/"));
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    linkTypeScript(dir);
    await installCore(dir);
    execFileSync("git", ["add", "-A"], { cwd: dir });
    // The ruleset checks skip an origin that isn't on GitHub.
    execFileSync(
      "git",
      ["remote", "add", "origin", "https://git.example.invalid/acme/c.git"],
      { cwd: dir },
    );
    const { ctx, stdout, stderr } = realContext(dir);
    // The suite's own runner tells a child `node --test` it is a child of
    // this run; the fixture's test script must run as a runner of its own.
    const env: NodeJS.ProcessEnv = { ...ctx.env, npm_execpath: suitePnpm() };
    delete env.NODE_TEST_CONTEXT;
    const code = await gate.run([], { ...ctx, env });
    return { code, out: stdout.lines.join(""), err: stderr.lines.join("") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The check's message about uncovered files, from its first line to its
 * fix line. */
function uncovered(err: string): string {
  return (
    /^gate: \d+ (?:TypeScript|test) file\(s\) that [^]*?\n {2}fix: .*\n/m.exec(
      err,
    )?.[0] ?? ""
  );
}

void test("coverage e2e: a file outside every tsconfig fails type-check coverage, naming it and not the declaration", async () => {
  const run = await gateOn({ nodeConfig: "broken", testScript: "fixed" });
  assert.equal(run.code, 1, run.err);
  assert.equal(
    uncovered(run.err),
    [
      "gate: 2 TypeScript file(s) that no typecheck script checks:",
      "  the root:",
      "    src/root.test.ts",
      "    src/shared/util.ts",
      "  listings made: tsc -p tsconfig.json (from tsc -b), tsc -p tsconfig.web.json (from tsc -b), tsc -p tsconfig.node.json (from tsc -b)",
      '  fix: include each file in a tsconfig a typecheck script checks, or list it under "coverageExclusions" in temple-bar.config.json',
      "",
    ].join("\n"),
  );
  assert.match(
    run.err,
    /^ {2}failed {3}type-check coverage \(2 file\(s\) unchecked\)$/m,
  );
  assert.match(
    run.err,
    /^ {2}passed {3}test coverage \(all 6 test file\(s\) run by 1 listing\(s\)\)$/m,
  );
  assert.match(
    run.out,
    /^gate: listing the files tsc -p tsconfig\.node\.json checks in the root$/m,
  );
});

void test("coverage e2e: test files no pattern takes fail test coverage, naming all five", async () => {
  const run = await gateOn({ nodeConfig: "fixed", testScript: "broken" });
  assert.equal(run.code, 1, run.err);
  assert.equal(
    uncovered(run.err),
    [
      "gate: 5 test file(s) that no test script runs:",
      "  the root:",
      "    src/core/index.spec.ts",
      "    src/core/m.test.mts",
      "    src/root.test.ts",
      "    src/web/App.test.ts",
      "    src/web/Node.test.ts",
      '  listings made: node --test "src/{core,cli,server}/**/*.test.ts" (1 file(s))',
      `  fix: make a test script's run include each file, or list it under "coverageExclusions" in temple-bar.config.json`,
      "",
    ].join("\n"),
  );
  assert.match(
    run.err,
    /^ {2}passed {3}type-check coverage \(all 13 TypeScript file\(s\) checked by 3 listing\(s\)\)$/m,
  );
  assert.match(
    run.err,
    /^ {2}failed {3}test coverage \(5 file\(s\) not run\)$/m,
  );
});

void test("coverage e2e: with both halves fixed, both outcomes pass and so does the gate", async () => {
  const run = await gateOn({ nodeConfig: "fixed", testScript: "fixed" });
  assert.equal(run.code, 0, run.err);
  assert.match(
    run.out,
    /^ {2}passed {3}type-check coverage \(all 13 TypeScript file\(s\) checked by 3 listing\(s\)\)$/m,
  );
  assert.match(
    run.out,
    /^ {2}passed {3}test coverage \(all 6 test file\(s\) run by 1 listing\(s\)\)$/m,
  );
  assert.match(run.out, /^gate: passed$/m);
});

void test("coverage e2e: a typecheck the gate can't list fails, naming the forms it can", async () => {
  const run = await gateOn({
    nodeConfig: "fixed",
    testScript: "fixed",
    typecheck: "vue-tsc --noEmit",
  });
  assert.equal(run.code, 1, run.err);
  assert.ok(
    run.err.includes(
      `gate: the root's typecheck script isn't a form the gate can list: "vue-tsc --noEmit"\n  ${SUPPORTED_FORMS.typecheck}\n`,
    ),
    run.err,
  );
  assert.match(
    run.err,
    /^ {2}failed {3}type-check coverage \(unsupported script form\)$/m,
  );
});

void test("coverage e2e: a test pattern that matches no file is a failed listing, not a pass", async () => {
  const run = await gateOn({ nodeConfig: "fixed", testScript: "unmatched" });
  assert.equal(run.code, 1, run.err);
  assert.match(
    run.err,
    /^gate: listing the files node --test "tests\/\*\*\/\*\.test\.ts" runs in the root failed: it names a pattern that matches no file: "tests\/\*\*\/\*\.test\.ts"$/m,
  );
  assert.match(run.err, /^ {2}failed {3}test coverage \(listing failed\)$/m);
  // Node itself runs nothing for it and passes.
  assert.match(run.err, /^ {2}passed {3}test$/m);
});
