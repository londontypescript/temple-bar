import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { runRemote } from "./remote/runner.ts";
import {
  fakeSys,
  lastRecord,
  RUN_ID,
  SHA,
  tempDir,
  type FakeSysOptions,
} from "./testing.ts";

const ROOT = "temple-bar-windows-run";
const FILE = "scripts/windows-run/verdict.test.ts";

async function targeted(home: string, options: Partial<FakeSysOptions> = {}) {
  const sys = fakeSys({ home, ...options });
  const code = await runRemote(RUN_ID, SHA, sys, { mode: "only", file: FILE });
  return { sys, code, record: lastRecord(sys.printed) };
}

/** The git commands that throw away changes in a folder. */
const destructive = (sys: { gitCalls: { args: readonly string[] }[] }) =>
  sys.gitCalls
    .map((call) => call.args.join(" "))
    .filter((args) => / (?:checkout|clean) /.test(`${args} `));

void test("a kept worktree that is a link is removed as a link and made again, leaving what it pointed at alone", async (t) => {
  const home = tempDir(t);
  // Another checkout, which a link (a junction on Windows) stands in for
  // the kept worktree.
  const other = path.join(tempDir(t), "other-checkout");
  mkdirSync(other, { recursive: true });
  writeFileSync(path.join(other, ".git"), "gitdir: elsewhere\n");
  writeFileSync(path.join(other, "work.txt"), "uncommitted\n");
  mkdirSync(path.join(home, ROOT), { recursive: true });
  const only = path.join(home, ROOT, "only");
  symlinkSync(other, only, "junction");
  writeFileSync(path.join(home, ROOT, "only-install.json"), "stale\n");

  const { sys, code } = await targeted(home);
  assert.equal(code, 0);
  assert.deepEqual(destructive(sys), []);
  assert.equal(
    readFileSync(path.join(other, "work.txt"), "utf8"),
    "uncommitted\n",
  );
  assert.equal(lstatSync(only).isSymbolicLink(), false);
  assert.ok(sys.gitCalls.some((call) => call.args.includes("add")));
  assert.deepEqual(sys.stepsRun, ["install", "test"]);
});

void test("a kept worktree git does not see as its own top folder is made again, before any checkout or clean", async (t) => {
  const home = tempDir(t);
  await targeted(home);
  const { sys, code } = await targeted(home, {
    toplevel: path.join(home, "elsewhere"),
  });
  assert.equal(code, 0);
  assert.deepEqual(destructive(sys), []);
  assert.match(sys.printed, /kept worktree could not be updated/);
  assert.ok(sys.gitCalls.some((call) => call.args.includes("add")));
  // Made again, so the record of its last install is forgotten.
  assert.deepEqual(sys.stepsRun, ["install", "test"]);
});

void test("a matching record installs again when node_modules has gone", async (t) => {
  const home = tempDir(t);
  await targeted(home);
  assert.deepEqual((await targeted(home)).sys.stepsRun, ["test"]);
  rmSync(path.join(home, ROOT, "only", "node_modules"), {
    recursive: true,
    force: true,
  });
  const again = await targeted(home);
  assert.deepEqual(again.sys.stepsRun, ["install", "test"]);
  assert.equal(again.record.steps[0]?.status, "passed");
  assert.ok(
    existsSync(path.join(home, ROOT, "only", "node_modules", ".modules.yaml")),
  );
});

void test("pnpm's version for the install key is asked from inside the kept worktree", async (t) => {
  const home = tempDir(t);
  const { sys } = await targeted(home);
  const only = path.join(home, ROOT, "only");
  // The first pnpm probe is the key's; the environment report's comes later.
  const first = sys.probes.find((probe) => probe.command === "pnpm");
  assert.deepEqual(first, { command: "pnpm", cwd: only });
});
