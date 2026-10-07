// The order cleanUp does things in, scripted: anything that runs a git hook
// must happen while the merged branch's worktree (and its temple-bar) still
// exists.

import assert from "node:assert/strict";
import test from "node:test";

import { createFakeContext, createFakeGit } from "../testing/fakes.ts";
import { cleanUp } from "./local.ts";

const MERGED = "a".repeat(40);

function scripted(options: { readonly primaryOnBranch: boolean }) {
  let branch = options.primaryOnBranch ? "feat/x" : "main";
  const git = createFakeGit((args) => {
    const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
    switch (args[0]) {
      case "worktree":
        if (args[1] === "list") {
          return ok(
            `worktree /repo\nHEAD ${MERGED}\nbranch refs/heads/${branch}\n` +
              (options.primaryOnBranch
                ? ""
                : `\nworktree /wt/x\nHEAD ${MERGED}\nbranch refs/heads/feat/x\n`),
          );
        }
        return ok();
      case "switch":
        branch = "main";
        return ok();
      case "rev-parse":
        return ok(`${MERGED}\n`);
      case "ls-remote":
        return ok("");
      default:
        return ok();
    }
  });
  const ctx = createFakeContext({ git, cwd: "/repo" });
  const run = () =>
    cleanUp(ctx, {
      primaryPath: "/repo",
      branch: "feat/x",
      defaultBranch: "main",
      mergedSha: MERGED,
    });
  const at = (...prefix: string[]) =>
    git.calls.findIndex((call) => prefix.every((p, i) => call.args[i] === p));
  return { run, at };
}

void test("cleanUp: main moves and the remote branch is settled before the worktree goes", async () => {
  const s = scripted({ primaryOnBranch: false });
  const report = await s.run();
  assert.deepEqual(report.problems, []);
  const forward = s.at("merge", "--ff-only");
  const remote = s.at("ls-remote");
  const remove = s.at("worktree", "remove");
  const del = s.at("branch", "-D");
  assert.ok(forward >= 0 && remote >= 0 && remove >= 0 && del >= 0);
  assert.ok(forward < remove, "fast-forward before removing the worktree");
  assert.ok(remote < remove, "remote branch before removing the worktree");
  assert.ok(remove < del, "the local branch goes last");
});

void test("cleanUp: a primary checkout on the merged branch switches to main, then fast-forwards, then the branch goes", async () => {
  const s = scripted({ primaryOnBranch: true });
  const report = await s.run();
  assert.deepEqual(report.problems, []);
  const order = [
    s.at("switch", "main"),
    s.at("merge", "--ff-only"),
    s.at("branch", "-D"),
  ];
  assert.ok(order.every((i) => i >= 0));
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
  assert.equal(s.at("worktree", "remove"), -1, "the primary is never removed");
});
