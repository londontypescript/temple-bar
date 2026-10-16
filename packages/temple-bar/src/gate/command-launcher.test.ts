// The gate with each launcher form: pnpm's standalone executable runs the
// listing and every script directly, and a launcher it can't start runs
// nothing, fails, and still reports every other check. launcher.test.ts
// covers which shapes are which.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { route } from "../router.ts";
import { CommandRegistry } from "../registry.ts";
import type { Context } from "../context.ts";
import { testGateCommand as gateCommand } from "./testing/fake-tools.ts";
import {
  ALL_SCRIPTS,
  scriptRuns,
  workspace,
  type WorkspaceOptions,
} from "./testing/workspace-fixture.ts";

function runGate(ctx: Context): Promise<number> {
  const registry = new CommandRegistry();
  registry.register(gateCommand);
  return route(["gate"], ctx, registry);
}

const EVERY_SCRIPT = ["typecheck", "lint", "format:check", "test"];

/** pnpm's standalone executable, named as on the platform running this. */
const NATIVE = path.join(
  "/tools",
  "pnpm",
  process.platform === "win32" ? "pnpm.exe" : "pnpm",
);
const SHIM = path.join("/tools", "pnpm", "pnpm.cmd");

function started(execPath: string, options: WorkspaceOptions = {}) {
  return workspace({
    ...options,
    env: { npm_execpath: execPath },
    untracked: { [execPath]: "" },
  });
}

void test("gate: pnpm's standalone executable runs the listing and every script directly, with no Node in front", async () => {
  const { ctx, proc } = started(NATIVE);

  assert.equal(await runGate(ctx), 0);
  assert.equal(proc.calls.length, 1 + 3 * EVERY_SCRIPT.length);
  const [listing, ...scripts] = proc.calls;
  assert.equal(listing?.command, path.normalize(NATIVE));
  assert.deepEqual(listing.args, [
    "list",
    "--recursive",
    "--depth",
    "-1",
    "--json",
  ]);
  for (const call of scripts) {
    assert.equal(call.command, path.normalize(NATIVE));
    assert.equal(call.args[0], "run");
  }
});

void test("gate: a standalone executable that can't start fails each script with its exit code", async () => {
  const { ctx, stderr } = started(NATIVE, {
    workspaceFile: false,
    packages: {},
    exitCode: () => 127,
  });

  assert.equal(await runGate(ctx), 1);
  assert.match(
    stderr.lines.join(""),
    /^ {2}failed {3}typecheck \(exit 127\)$/m,
  );
});

for (const [kind, options] of [
  ["workspace", {}],
  ["standalone project", { workspaceFile: false, packages: {} }],
] as const) {
  void test(`gate: in a ${kind}, a launcher it can't start runs nothing, marks the root's scripts not run and says how to install pnpm`, async () => {
    const { ctx, proc, stderr } = started(SHIM, options);

    assert.equal(await runGate(ctx), 1);
    assert.equal(proc.calls.length, 0);
    const text = stderr.lines.join("");
    assert.match(
      text,
      /^ {2}failed {3}workspace packages \(the package manager that started the gate can't be started again without a shell: .*pnpm\.cmd, which can't be started without a shell; install pnpm .*; no script was run\)$/m,
    );
    for (const script of EVERY_SCRIPT) {
      assert.match(
        text,
        new RegExp(
          `^ {2}not-run {2}${script} \\(the gate can't start its package manager\\)$`,
          "m",
        ),
      );
    }
    // The other checks still run and report.
    assert.match(text, /^ {2}passed {3}file-length cap /m);
    assert.equal(text.match(/install pnpm with npm/g)?.length, 2);
  });
}

void test("gate: a launcher it can't start still names a missing script, which makes it exit 2", async () => {
  const { ctx, proc, stderr } = started(SHIM, {
    workspaceFile: false,
    packages: {},
    // Content of its own, so a missing script counts.
    extraTracked: ["src/index.ts"],
    rootScripts: Object.fromEntries(
      Object.entries(ALL_SCRIPTS).filter(([name]) => name !== "lint"),
    ),
  });

  assert.equal(await runGate(ctx), 2);
  assert.equal(proc.calls.length, 0);
  const text = stderr.lines.join("");
  assert.match(text, /^ {2}missing {2}lint /m);
  assert.match(text, /^ {2}not-run {2}typecheck /m);
  assert.deepEqual(scriptRuns(proc), []);
});
