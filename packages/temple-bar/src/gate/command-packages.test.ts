// The gate in a pnpm workspace: the root's scripts first, then every
// package's, each through the pnpm that started the gate; the report and
// exit code cover every package and the inventory.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { route } from "../router.ts";
import { CommandRegistry } from "../registry.ts";
import type { Context } from "../context.ts";
import { testGateCommand as gateCommand } from "./testing/fake-tools.ts";
import {
  ALL_SCRIPTS,
  NPM_EXEC,
  PNPM_EXEC,
  pnpmListing,
  scriptRuns,
  workspace,
} from "./testing/workspace-fixture.ts";

function runGate(ctx: Context): Promise<number> {
  const registry = new CommandRegistry();
  registry.register(gateCommand);
  return route(["gate"], ctx, registry);
}

const EVERY_SCRIPT = ["typecheck", "lint", "format:check", "test"];

function each(folder: string, scripts = EVERY_SCRIPT): string[] {
  return scripts.map((script) => `${folder}:${script}`);
}

void test("gate: in a workspace, the root's scripts run first, then each package's in path order, every one with CI=true", async () => {
  const { ctx, proc, stdout } = workspace({
    packages: { "packages/b": ALL_SCRIPTS, "apps/web": ALL_SCRIPTS },
    listing: { stdout: pnpmListing(["", "packages/b", "apps/web"]) },
  });

  assert.equal(await runGate(ctx), 0);
  assert.deepEqual(scriptRuns(proc), [
    ...each(""),
    ...each("apps/web"),
    ...each("packages/b"),
  ]);
  for (const call of proc.calls) {
    if (call.args.includes("run")) {
      assert.equal(call.env.CI, "true");
    }
  }
  const text = stdout.lines.join("");
  assert.match(text, /^gate: running typecheck in apps\/web$/m);
  assert.doesNotMatch(text, /^gate: running typecheck in $/m);
  assert.match(
    text,
    /^ {2}passed {3}workspace packages \(the root and 2 package\(s\)\)$/m,
  );
  assert.match(text, /^ {2}passed {3}typecheck$/m);
  assert.match(text, /^ {2}passed {3}test \(packages\/b\)$/m);
});

void test("gate: every script runs after failures, and a failed package script exits 1 with its exit code", async () => {
  const { ctx, proc, stderr } = workspace({
    exitCode: (folder, script) =>
      folder === "packages/a" && script === "lint"
        ? 3
        : script === "typecheck"
          ? 1
          : 0,
  });

  assert.equal(await runGate(ctx), 1);
  assert.deepEqual(scriptRuns(proc), [
    ...each(""),
    ...each("packages/a"),
    ...each("packages/b"),
  ]);
  const text = stderr.lines.join("");
  assert.match(text, /^ {2}failed {3}lint \(packages\/a\) \(exit 3\)$/m);
  assert.match(text, /^ {2}failed {3}typecheck \(packages\/b\) \(exit 1\)$/m);
  assert.match(text, /^ {2}passed {3}lint \(packages\/b\)$/m);
});

void test("gate: a package with no scripts exits 2, naming its package.json, and the other package still runs", async () => {
  const { ctx, proc, stderr } = workspace({
    packages: { "packages/a": undefined, "packages/b": ALL_SCRIPTS },
  });

  assert.equal(await runGate(ctx), 2);
  assert.deepEqual(scriptRuns(proc), [...each(""), ...each("packages/b")]);
  const text = stderr.lines.join("");
  assert.match(
    text,
    /^gate: packages\/a\/package\.json is missing script\(s\): typecheck, lint, format:check, test$/m,
  );
  assert.match(
    text,
    /^ {2}add "typecheck" to "scripts" in packages\/a\/package\.json: a command that type-checks the project$/m,
  );
  assert.match(
    text,
    /^ {2}missing {2}typecheck \(packages\/a\) \(not in packages\/a\/package\.json\)$/m,
  );
});

void test("gate: a package whose scripts field isn't an object exits 2 with every script missing, and the other package still runs", async () => {
  const fixture = workspace();
  fixture.fs.files.set(
    path.join("/repo", "packages", "a", "package.json"),
    JSON.stringify({ name: "pkg-a", scripts: false }),
  );

  assert.equal(await runGate(fixture.ctx), 2);
  assert.deepEqual(scriptRuns(fixture.proc), [
    ...each(""),
    ...each("packages/b"),
  ]);
  const text = fixture.stderr.lines.join("");
  assert.match(
    text,
    /^gate: packages\/a\/package\.json is missing script\(s\): typecheck, lint, format:check, test$/m,
  );
  assert.match(text, /^gate: failed: typecheck \(packages\/a\)/m);
});

void test("gate: a package's removed typecheck, or one that does nothing, exits 2 and names the package", async () => {
  const withoutTypecheck = Object.fromEntries(
    Object.entries(ALL_SCRIPTS).filter(([name]) => name !== "typecheck"),
  );
  const { ctx, proc, stderr } = workspace({
    packages: {
      "packages/a": withoutTypecheck,
      "packages/b": { ...ALL_SCRIPTS, lint: "echo ok" },
    },
  });

  assert.equal(await runGate(ctx), 2);
  assert.deepEqual(scriptRuns(proc), [
    ...each(""),
    ...each("packages/a", ["lint", "format:check", "test"]),
    ...each("packages/b", ["typecheck", "format:check", "test"]),
  ]);
  const text = stderr.lines.join("");
  assert.match(
    text,
    /^gate: packages\/a\/package\.json is missing script\(s\): typecheck$/m,
  );
  assert.match(
    text,
    /^gate: packages\/b\/package\.json has script\(s\) that check nothing: lint$/m,
  );
  assert.match(text, /^ {2}no-op {4}lint \(packages\/b\) \("echo ok"\)$/m);
  assert.match(
    text,
    /^gate: failed: typecheck \(packages\/a\), lint \(packages\/b\)$/m,
  );
});

void test("gate: the inventory failing exits 1 even when every script passed", async () => {
  const { ctx, stderr } = workspace({
    extraTracked: ["tools/c/package.json"],
  });

  assert.equal(await runGate(ctx), 1);
  const text = stderr.lines.join("");
  assert.match(text, /^ {2}tools\/c\/package\.json$/m);
  assert.match(text, /^gate: failed: workspace packages$/m);
});

void test("gate: an inventory failure together with a missing package script exits 2, naming both", async () => {
  const { ctx, stderr } = workspace({
    packages: { "packages/a": {} },
    extraTracked: ["tools/c/package.json"],
  });

  assert.equal(await runGate(ctx), 2);
  const text = stderr.lines.join("");
  assert.match(text, /^ {2}failed {3}workspace packages /m);
  assert.match(text, /^ {2}missing {2}typecheck \(packages\/a\) /m);
});

for (const [what, breakIt] of [
  [
    "a listed folder that doesn't exist",
    (fixture: ReturnType<typeof workspace>) => {
      fixture.fs.files.delete("/repo/packages/b/package.json");
    },
  ],
  [
    "a realpath that fails",
    (fixture: ReturnType<typeof workspace>) => {
      fixture.fs.realpathErrors.set(
        path.normalize("/repo/packages/b"),
        new Error("EIO: i/o error"),
      );
    },
  ],
] as const) {
  void test(`gate: ${what} fails the inventory, and the root's scripts, the other checks and the report still happen`, async () => {
    const fixture = workspace();
    breakIt(fixture);

    assert.equal(await runGate(fixture.ctx), 1);
    assert.deepEqual(scriptRuns(fixture.proc), each(""));
    const text = fixture.stderr.lines.join("");
    assert.match(
      text,
      /^ {2}failed {3}workspace packages \(.*no package's scripts were run\)$/m,
    );
    assert.match(text, /^ {2}passed {3}typecheck$/m);
    assert.match(text, /^ {2}passed {3}file-length cap /m);
    assert.match(text, /^gate: failed: workspace packages$/m);
  });
}

void test("gate: a workspace started without npm_execpath runs the root's scripts through PATH and fails the inventory", async () => {
  const { ctx, proc, stderr } = workspace({ env: {} });

  assert.equal(await runGate(ctx), 1);
  assert.deepEqual(scriptRuns(proc), each(""));
  assert.ok(proc.calls.every((call) => call.command === "pnpm"));
  assert.ok(!proc.calls.some((call) => call.args.includes("list")));
  const text = stderr.lines.join("");
  assert.match(text, /`pnpm gate`, or `pnpm ready`/);
  assert.match(text, /^ {2}passed {3}typecheck$/m);
});

void test("gate: a workspace started by npm runs the root's scripts through npm's entry point and fails the inventory", async () => {
  const { ctx, proc, stderr } = workspace({ env: { npm_execpath: NPM_EXEC } });

  assert.equal(await runGate(ctx), 1);
  assert.deepEqual(scriptRuns(proc), each(""));
  for (const call of proc.calls) {
    assert.equal(call.command, process.execPath);
    assert.deepEqual(call.args.slice(0, 2), [NPM_EXEC, "run"]);
  }
  assert.match(
    stderr.lines.join(""),
    /which needs pnpm, but the gate was started by npm-cli\.js/,
  );
});

void test("gate: with a pnpm first on PATH, the listing and every script still run through npm_execpath", async () => {
  const { ctx, proc } = workspace({
    env: {
      npm_execpath: PNPM_EXEC,
      PATH: [path.join("/project", "bin"), "/usr/bin"].join(path.delimiter),
    },
  });

  assert.equal(await runGate(ctx), 0);
  assert.equal(proc.calls.length, 1 + 3 * EVERY_SCRIPT.length);
  for (const call of proc.calls) {
    assert.equal(call.command, process.execPath);
    assert.equal(call.args[0], PNPM_EXEC);
  }
});

for (const [manager, env, command, prefix] of [
  ["npm's", { npm_execpath: NPM_EXEC }, process.execPath, [NPM_EXEC, "run"]],
  ["pnpm's", { npm_execpath: PNPM_EXEC }, process.execPath, [PNPM_EXEC, "run"]],
  ["no", {}, "pnpm", ["run"]],
] as const) {
  void test(`gate: a standalone project with ${manager} npm_execpath runs its scripts with ${path.basename(command)}`, async () => {
    const { ctx, proc } = workspace({
      workspaceFile: false,
      packages: {},
      env,
    });

    assert.equal(await runGate(ctx), 0);
    assert.deepEqual(scriptRuns(proc), each(""));
    for (const call of proc.calls) {
      assert.equal(call.command, command);
      assert.deepEqual(call.args.slice(0, -1), prefix);
      assert.equal(call.cwd, "/repo");
    }
  });
}
