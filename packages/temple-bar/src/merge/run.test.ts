// The paths where `temple-bar merge` goes ahead: what it sends GitHub, what
// it tidies up, and what it reports.

import assert from "node:assert/strict";
import test from "node:test";

import { createMergeCommand } from "./command.ts";
import { defaultWorld, harness, HEAD, MERGED_IN } from "./testing/world.ts";

function mergeCall(h: ReturnType<typeof harness>): readonly string[] {
  const call = h.gh.calls.find(
    (c) => c.args[0] === "pr" && c.args[1] === "merge",
  );
  assert.ok(call, "gh pr merge was called");
  return call.args;
}

void test("merges with a written squash message pinned to the checked head", async () => {
  const h = harness(defaultWorld());
  const code = await createMergeCommand(h.deps).run(["7"], h.ctx);
  assert.equal(code, 0, h.err());
  assert.deepEqual(mergeCall(h), [
    "pr",
    "merge",
    "7",
    "--squash",
    "--match-head-commit",
    HEAD,
    "--subject",
    "feat(x): add x (#7)",
    "--body",
    "- add the x command\n- document x\n\nCo-Authored-By: Ada <ada@example.com>\nCo-Authored-By: Bob <bob@example.com>",
  ]);
});

void test("never bypasses a ruleset or forces a push", async () => {
  const world = defaultWorld();
  world.behind = true;
  world.heads = [HEAD, MERGED_IN];
  world.remoteBranchAfterMerge = true;
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  const everything = [...h.git.calls, ...h.gh.calls].flatMap((c) => c.args);
  for (const flag of ["--admin", "--force", "-f", "--force-with-lease"]) {
    assert.equal(everything.includes(flag), false, flag);
  }
  assert.ok(!everything.some((arg) => arg.startsWith("+")), "no +refspec");
});

void test("a branch behind main gets main merged in and pushed, then merges at the new head", async () => {
  const world = defaultWorld();
  world.behind = true;
  world.heads = [HEAD, MERGED_IN];
  const h = harness(world);
  const code = await createMergeCommand(h.deps).run(["7"], h.ctx);
  assert.equal(code, 0, h.err());
  const merge = h.git.calls.find(
    (c) => c.args[0] === "merge" && c.args.includes("--no-ff"),
  );
  assert.deepEqual(merge?.args, [
    "merge",
    "--no-edit",
    "--no-ff",
    "origin/main",
  ]);
  assert.equal(merge.cwd, "/wt/x");
  const push = h.git.calls.find((c) => c.args[0] === "push");
  assert.deepEqual(push?.args, [
    "push",
    "origin",
    "refs/heads/feat/x:refs/heads/feat/x",
  ]);
  assert.equal(mergeCall(h)[5], MERGED_IN);
  assert.match(
    h.out(),
    /feat\/x is behind; merging origin\/main into it and pushing/,
  );
});

void test("waits for GitHub to sync the head before trusting checks", async () => {
  const world = defaultWorld();
  world.heads = ["f".repeat(40), "f".repeat(40), HEAD];
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  const checkReads = h.gh.calls.filter((c) =>
    c.args.some((a) => a.includes("check-runs")),
  );
  assert.ok(
    checkReads.every((c) =>
      c.args.some((a) => a.includes(`/commits/${HEAD}/`)),
    ),
  );
});

void test("waits for pending checks, then merges", async () => {
  const world = defaultWorld();
  world.required = ["gate"];
  world.checkRuns = [
    [],
    [{ name: "gate", status: "queued", conclusion: null }],
    [{ name: "gate", status: "completed", conclusion: "success" }],
  ];
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  assert.match(h.out(), /waiting for gate \(not started\)/);
  assert.match(h.out(), /waiting for gate\n/);
  assert.match(h.out(), /all 1 checks passed/);
});

void test("--maintainer-approved lets a change to AGENTS.md merge, and says so", async () => {
  const world = defaultWorld();
  world.changedFiles = ["AGENTS.md"];
  const h = harness(world);
  const code = await createMergeCommand(h.deps).run(
    ["7", "--maintainer-approved"],
    h.ctx,
  );
  assert.equal(code, 0, h.err());
  assert.match(h.out(), /maintainer approved: it changes AGENTS\.md/);
});

void test("a repository without code scanning merges and says there was nothing to check", async () => {
  const world = defaultWorld();
  world.alertsForPr = "not-set-up";
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  assert.match(h.out(), /code scanning isn't set up here/);
});

void test("after merging: removes the worktree, deletes the branch, fast-forwards main, reports", async () => {
  const h = harness(defaultWorld());
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  const remove = h.git.calls.find(
    (c) => c.args[0] === "worktree" && c.args[1] === "remove",
  );
  assert.deepEqual(remove?.args, ["worktree", "remove", "/wt/x"]);
  assert.equal(remove.cwd, "/repo", "runs from the primary checkout");
  assert.ok(h.ran("git", "branch", "-D", "feat/x"));
  assert.ok(h.ran("git", "merge", "--ff-only", "--quiet", "origin/main"));
  const out = h.out();
  assert.match(out, /removed the worktree at \/wt\/x/);
  assert.match(out, /deleted the local branch feat\/x/);
  assert.match(out, /confirmed origin\/feat\/x is gone/);
  assert.match(out, /no open code-scanning alerts on main/);
  assert.match(out, /no leftover branches or worktrees/);
  assert.match(out, /incidents: 3 open issues labelled incident\n/);
  assert.match(out, /pr-size: ok/);
});

void test("deletes a remote branch gh left behind, and confirms it is gone", async () => {
  const world = defaultWorld();
  world.remoteBranchAfterMerge = true;
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  assert.ok(h.ran("git", "push", "origin", "--delete", "feat/x"));
  assert.match(h.out(), /deleted origin\/feat\/x and confirmed it is gone/);
});

void test("alerts open on main after the merge are reported and exit 1", async () => {
  const world = defaultWorld();
  const h = harness(world);
  // Clear before merging, open once the merge has landed.
  let reads = 0;
  const run = h.gh.run.bind(h.gh);
  const ctx = {
    ...h.ctx,
    gh: {
      run: async (args: readonly string[], cwd: string) => {
        if (args.some((a) => a.includes("alerts?ref="))) {
          reads++;
          if (reads > 1) {
            return {
              code: 0,
              stdout: '{"number":2,"rule":"js/xss","path":"a.ts"}',
              stderr: "",
              notFound: false,
            };
          }
        }
        return run(args, cwd);
      },
    },
  };
  assert.equal(await createMergeCommand(h.deps).run(["7"], ctx), 1);
  assert.match(
    h.err(),
    /main has open code-scanning alerts: #2 js\/xss in a\.ts/,
  );
  assert.match(h.out(), /merged #7/);
});

void test("a branch brought up to date passes the gate and is marked ready before the push", async () => {
  const world = defaultWorld();
  world.behind = true;
  world.heads = [HEAD, MERGED_IN];
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  assert.deepEqual(
    h.gateRuns,
    ["/wt/x"],
    "the gate runs in the branch's worktree",
  );
  assert.equal(
    (await h.ctx.fs.readText("/wt/x/.git/temple-bar-ready"))?.trim(),
    MERGED_IN,
    "the merge commit is marked, so the pre-push hook lets it out",
  );
  assert.ok(
    h.ran("git", "push", "origin", "refs/heads/feat/x:refs/heads/feat/x"),
  );
});

void test("a branch that fails the gate once main is merged in is not pushed or merged", async () => {
  const world = defaultWorld();
  world.behind = true;
  world.heads = [HEAD, MERGED_IN];
  world.gateExit = 1;
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 1);
  assert.match(
    h.err(),
    /with origin\/main merged in, feat\/x fails the gate, so nothing was pushed/,
  );
  assert.equal(
    h.ran("git", "push", "origin", "refs/heads/feat/x:refs/heads/feat/x"),
    false,
    "nothing is pushed after a failing gate",
  );
  assert.equal(h.ran("gh", "pr", "merge"), false);
  assert.equal(
    await h.ctx.fs.readText("/wt/x/.git/temple-bar-ready"),
    undefined,
  );
});
