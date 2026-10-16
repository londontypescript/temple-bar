// The unused-code check over a whole pnpm workspace, with the real knip,
// the real pnpm and git, through the whole gate: knip runs once at the
// root, finds each app's entry with no config of temple-bar's, and the
// report names the packages that hold its findings.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { initTestRepo } from "../testing/git-repo.ts";
import { createGateCommand } from "./command.ts";
import { installCore } from "./testing/core-fixture.ts";
import {
  entriesWorkspace,
  type EntriesOptions,
} from "./testing/entries-fixture.ts";
import { realContext } from "./testing/real-repo.ts";
import { createRealGateTools } from "./tools.ts";

const gate = createGateCommand(createRealGateTools());

/** The pnpm running this suite: in a workspace the gate lists the packages
 * through the pnpm that started it, as `pnpm gate` would. */
function suitePnpm(): string {
  const execPath = process.env.npm_execpath ?? "";
  if (!path.basename(execPath).startsWith("pnpm")) {
    throw new Error(
      "these tests need the pnpm that runs them: run the suite with `pnpm test`",
    );
  }
  return execPath;
}

/** Writes the fixture, with `extra` files added or replaced, into a new
 * repo set up as temple-bar's setup leaves one, runs the gate there, and
 * removes the repo. */
async function gateOn(
  options: EntriesOptions,
  extra: Readonly<Record<string, string>> = {},
): Promise<{ code: number; out: string; err: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-entries-"));
  try {
    initTestRepo(dir);
    for (const [relative, text] of Object.entries({
      ...entriesWorkspace(options),
      ...extra,
    })) {
      const file = path.join(dir, ...relative.split("/"));
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    await installCore(dir);
    execFileSync("git", ["add", "-A"], { cwd: dir });
    const { ctx, stdout, stderr } = realContext(dir);
    const code = await gate.run([], {
      ...ctx,
      env: { ...ctx.env, npm_execpath: suitePnpm() },
    });
    return { code, out: stdout.lines.join(""), err: stderr.lines.join("") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const PASSED = /^ {2}passed {3}unused code \(knip\)$/m;

function failedIn(names: string): RegExp {
  return new RegExp(
    `^ {2}failed {3}unused code \\(knip\\) \\(unused files or exports in ${names}\\)$`,
    "m",
  );
}

void test("with no knip config, the Vite, Ink, Electron and shared entries are found and the workspace passes", async () => {
  const run = await gateOn({});
  assert.equal(run.code, 0, run.err);
  assert.match(run.out, PASSED);
  assert.match(run.out, /passed {3}workspace packages \(the root and 4/);
});

void test("a custom Vitest config and a noncanonical Electron entry each fail until the project's knip config names them", async () => {
  const [neither, vitestOnly, hostOnly, both] = await Promise.all([
    gateOn({ rootVitestConfig: "undeclared", hostEntry: "undeclared" }),
    gateOn({ rootVitestConfig: "declared", hostEntry: "undeclared" }),
    gateOn({ rootVitestConfig: "undeclared", hostEntry: "declared" }),
    gateOn({ rootVitestConfig: "declared", hostEntry: "declared" }),
  ]);
  assert.equal(neither.code, 1, neither.err);
  assert.match(neither.err, failedIn("the root, apps/desktop"));
  assert.match(
    neither.err,
    / {2}the root:\n {4}vitest\.root\.config\.ts\n {2}apps\/desktop:\n {4}apps\/desktop\/src\/host\.ts\n/,
  );
  assert.equal(vitestOnly.code, 1, vitestOnly.err);
  assert.match(vitestOnly.err, failedIn("apps/desktop"));
  assert.equal(hostOnly.code, 1, hostOnly.err);
  assert.match(hostOnly.err, failedIn("the root"));
  assert.equal(both.code, 0, both.err);
  assert.match(both.out, PASSED);
});

void test("an unused file, value export and type export in packages are each found, and both packages named in the inventory's order", async () => {
  const run = await gateOn(
    {},
    {
      // An entry's own exports are its interface and aren't reported, so
      // the unused ones sit in a module the entry imports.
      "packages/shared/src/index.ts":
        'import { shout } from "./format.ts";\n\nexport function greet(name: string): string {\n  return shout(`hello ${name}`);\n}\n\nexport interface Theme {\n  readonly accent: string;\n}\n',
      "packages/shared/src/format.ts":
        "export function shout(text: string): string {\n  return text.toUpperCase();\n}\n\nexport const forgottenValue = 1;\n\nexport type ForgottenType = { readonly id: string };\n",
      "packages/shared/src/stale.ts": "export const stale = 1;\n",
      "apps/web/src/orphan.ts": "export const orphan = 1;\n",
    },
  );
  assert.equal(run.code, 1, run.err);
  // knip's own listing on stdout, unchanged.
  assert.match(run.out, /forgottenValue +packages\/shared\/src\/format\.ts/);
  assert.match(
    run.out,
    /ForgottenType +type +packages\/shared\/src\/format\.ts/,
  );
  assert.match(run.out, /packages\/shared\/src\/stale\.ts/);
  // Sibling-only exports are used: greet and Theme are never listed.
  assert.doesNotMatch(run.out, /\bgreet\b|\bTheme\b/);
  assert.match(run.err, failedIn("apps/web, packages/shared"));
  assert.match(
    run.err,
    / {2}apps\/web:\n {4}apps\/web\/src\/orphan\.ts\n {2}packages\/shared:\n {4}packages\/shared\/src\/(format|stale)\.ts\n {4}packages\/shared\/src\/(format|stale)\.ts\n/,
  );
});

void test("with the inventory failed, unused code still fails, every finding put down to the root", async () => {
  const run = await gateOn(
    {},
    {
      // Outside pnpm-workspace.yaml's patterns, so the inventory fails.
      "tools/extra/package.json": '{ "name": "extra", "private": true }\n',
      "apps/web/src/orphan.ts": "export const orphan = 1;\n",
    },
  );
  assert.equal(run.code, 1, run.err);
  assert.match(run.err, /failed {3}workspace packages/);
  assert.match(
    run.err,
    /failed {3}unused code \(knip\) \(unused files or exports in the root; packages unknown, as the workspace inventory failed\)/,
  );
  assert.match(run.err, / {2}the root:\n {4}apps\/web\/src\/orphan\.ts\n/);
});
