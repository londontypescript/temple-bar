// `ready` and `merge` run the whole gate, never a part of it: the gate they
// call is given no arguments at all. Each is run as shipped, with the
// gate's own `run` stood in for, so the arguments it gets are seen.

import assert from "node:assert/strict";
import test from "node:test";

import { gateCommand } from "./command.ts";
import { realMergeDeps } from "../merge/command.ts";
import { readyCommand } from "../ready/command.ts";
import type { GitResult } from "../seams/git.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
  createFakeWriter,
} from "../testing/fakes.ts";
import { fakeTreeReads } from "../testing/git-trees.ts";

const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "" });

/** Each commit holds one unchanged file. */
const treeReads = fakeTreeReads(() => ({ "src/a.ts": "same\n" }));

/** A clean, caught-up worktree at /repo, as far as `ready` asks before it
 * runs the gate. */
function readyWorktree(args: readonly string[]): GitResult {
  const read = treeReads(args);
  if (read !== undefined) return read;
  const joined = args.join(" ");
  if (joined === "rev-parse --show-toplevel") return ok("/repo\n");
  if (joined === "rev-parse --git-path temple-bar-ready") {
    return ok(".git/temple-bar-ready\n");
  }
  if (joined === "rev-parse --verify --quiet HEAD^{commit}") {
    return ok(`${"c".repeat(40)}\n`);
  }
  if (joined.startsWith("rev-parse --verify --quiet refs/remotes/origin/")) {
    return ok("e".repeat(40));
  }
  if (args[0] === "symbolic-ref") return ok("refs/remotes/origin/main\n");
  if (args[0] === "merge-base") return ok(`${"b".repeat(40)}\n`);
  if (args[0] === "rev-list") return ok("0\n");
  if (["fetch", "status", "diff"].includes(args[0] ?? "")) return ok();
  return { code: 1, stdout: "", stderr: "" };
}

void test("ready runs the gate with no arguments: the whole gate", async (t) => {
  const run = t.mock.method(gateCommand, "run", () => Promise.resolve(1));
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    git: createFakeGit(readyWorktree),
    fs: createFakeFs({ "/repo/.git/temple-bar-ready": "" }),
    stderr,
  });

  assert.equal(await readyCommand.run([], ctx), 1);

  assert.equal(run.mock.callCount(), 1, stderr.lines.join(""));
  assert.deepEqual(run.mock.calls[0]?.arguments[0], []);
});

void test("merge runs the gate with no arguments: the whole gate", async (t) => {
  const run = t.mock.method(gateCommand, "run", () => Promise.resolve(0));

  assert.equal(await realMergeDeps.runGate(createFakeContext()), 0);

  assert.equal(run.mock.callCount(), 1);
  assert.deepEqual(run.mock.calls[0]?.arguments[0], []);
});
