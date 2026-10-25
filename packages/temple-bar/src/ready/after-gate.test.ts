// The shared after-gate operation's one promise beyond its checks: when the
// mark itself can't be written, it says so as a reason instead of throwing,
// because merge turns anything thrown into a crash rather than a refusal.
// Its checks are covered through both callers, in command.test.ts and
// ../merge/run.test.ts.

import assert from "node:assert/strict";
import test from "node:test";

import type { GitResult } from "../seams/git.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
} from "../testing/fakes.ts";
import { clearOldMark, markAfterGate } from "./after-gate.ts";

const HEAD = "c".repeat(40);

/** A clean worktree at HEAD, where git can't name its folder when
 * `noGitPath` is set, and every file write fails with ENOSPC otherwise. */
function setup(noGitPath = false) {
  const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "" });
  const git = createFakeGit((args) => {
    if (args[0] === "rev-parse" && args[1] === "--git-path") {
      return noGitPath
        ? { code: 128, stdout: "", stderr: "fatal: not a git repository\n" }
        : ok(".git/temple-bar-ready\n");
    }
    return args[0] === "rev-parse" ? ok(`${HEAD}\n`) : ok();
  });
  const fs = createFakeFs();
  fs.writeText = () =>
    Promise.reject(new Error("ENOSPC: no space left on device"));
  return createFakeContext({ git, fs });
}

void test("after the gate: a mark that can't be written is a reason, not a throw", async () => {
  assert.deepEqual(await markAfterGate(setup(), "/repo", HEAD), {
    problem: "unwritable",
    reason: "could not write the ready mark: ENOSPC: no space left on device",
  });
  assert.deepEqual(await markAfterGate(setup(true), "/repo", HEAD), {
    problem: "unwritable",
    reason:
      "could not write the ready mark: could not find this worktree's git folder: fatal: not a git repository",
  });
});

void test("before the gate: an old mark that can't be cleared is a reason, not a throw", async () => {
  assert.deepEqual(await clearOldMark(setup(), "/repo"), {
    problem: "unwritable",
    reason:
      "could not clear the old ready mark: ENOSPC: no space left on device",
  });
});
