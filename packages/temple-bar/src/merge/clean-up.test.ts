// What cleanUp does once a pull request has merged, on a scripted git: the
// default branch moves first, then the remote branch goes, but only while
// its tip is still the merged commit. The worktree and the local branch are
// never removed, wherever the branch is checked out, and the report says
// where they are.

import assert from "node:assert/strict";
import test from "node:test";

import { createFakeContext, createFakeGit } from "../testing/fakes.ts";
import { createMergeCommand } from "./command.ts";
import { cleanUp } from "./local.ts";
import { defaultWorld, harness } from "./testing/world.ts";

const MERGED = "a".repeat(40);
const NEWER = "b".repeat(40);
const LEASE = `--force-with-lease=refs/heads/feat/x:${MERGED}`;
const STALE =
  " ! [rejected]        (delete) -> feat/x (stale info)\nerror: failed to push some refs to 'origin'";

interface Script {
  /** Which checkout has the merged branch: a worktree of its own, the
   * primary checkout, or none. */
  readonly holder: "worktree" | "primary" | "none";
  readonly switchFails?: boolean;
  readonly localTip?: string;
  /** origin's tip on each read, the last one repeating: "absent" when it
   * has no such branch, "unreadable" when the read fails. */
  readonly remote?: readonly string[];
  /** The deletion push's stderr when it fails; it succeeds without one. */
  readonly pushError?: string;
}

function scripted(script: Script) {
  let current = script.holder === "primary" ? "feat/x" : "main";
  let reads = 0;
  const remote = script.remote ?? [MERGED];
  const git = createFakeGit((args) => {
    const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
    const fail = (stderr: string) => ({ code: 1, stdout: "", stderr });
    switch (args[0]) {
      case "worktree":
        if (args[1] === "list") {
          return ok(
            `worktree /repo\nHEAD ${MERGED}\nbranch refs/heads/${current}\n` +
              (script.holder === "worktree"
                ? `\nworktree /wt/x\nHEAD ${MERGED}\nbranch refs/heads/feat/x\n`
                : ""),
          );
        }
        return ok();
      case "switch":
        if (script.switchFails === true) {
          return fail("error: your local changes would be overwritten");
        }
        current = "main";
        return ok();
      case "rev-parse":
        return ok(`${script.localTip ?? MERGED}\n`);
      case "ls-remote": {
        const tip = remote[Math.min(reads++, remote.length - 1)];
        if (tip === "unreadable") {
          return fail("fatal: could not read from remote repository");
        }
        return ok(tip === "absent" ? "" : `${tip ?? ""}\trefs/heads/feat/x\n`);
      }
      case "push":
        return script.pushError === undefined ? ok() : fail(script.pushError);
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
  const count = (command: string) =>
    git.calls.filter((call) => call.args[0] === command).length;
  // Every call that would remove a worktree or delete a local branch,
  // spelled out so a failure names it.
  const removals = () =>
    git.calls
      .filter(
        ({ args }) =>
          (args[0] === "worktree" && args[1] === "remove") ||
          (args[0] === "branch" &&
            args.some((a) => ["-d", "-D", "--delete"].includes(a))),
      )
      .map(({ args }) => `git ${args.join(" ")}`);
  return { run, at, count, removals, calls: git.calls };
}

function assertNothingRemoved(s: ReturnType<typeof scripted>): void {
  const removals = s.removals();
  assert.deepEqual(
    removals,
    [],
    `cleanup must never remove a worktree or a local branch, but ran: ${removals.join("; ")}`,
  );
}

void test("cleanUp keeps a worktree on the merged branch: main moves, then the remote branch goes, and nothing is removed", async () => {
  const s = scripted({ holder: "worktree" });
  const report = await s.run();
  assert.deepEqual(report.problems, []);
  assertNothingRemoved(s);
  const forward = s.at("merge", "--ff-only");
  const remote = s.at("ls-remote");
  assert.ok(forward >= 0 && remote >= 0);
  assert.ok(forward < remote, "fast-forward before the remote branch");
  assert.deepEqual(report.done, [
    "fast-forwarded main in /repo",
    `deleted origin/feat/x, whose tip was still the merged ${MERGED}`,
    `kept the worktree at /wt/x on feat/x (${MERGED}); your harness removes it when it is done, or inspect it with temple-bar leftovers`,
  ]);
  assert.equal(report.keptBranch, true);
});

void test("cleanUp switches a primary checkout on the merged branch to main and keeps the branch; a failed switch names the checkout still holding it", async () => {
  const s = scripted({ holder: "primary" });
  const report = await s.run();
  assert.deepEqual(report.problems, []);
  assertNothingRemoved(s);
  const order = [
    s.at("switch", "main"),
    s.at("merge", "--ff-only"),
    s.at("ls-remote"),
  ];
  assert.ok(order.every((i) => i >= 0));
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
  assert.equal(report.done[0], "switched /repo to main");
  assert.equal(report.done.at(-1), `kept the local branch feat/x at ${MERGED}`);

  const stuck = scripted({ holder: "primary", switchFails: true });
  const failed = await stuck.run();
  assertNothingRemoved(stuck);
  assert.deepEqual(failed.problems, [
    "could not switch /repo to main: error: your local changes would be overwritten",
  ]);
  assert.equal(
    failed.done.at(-1),
    `kept the local branch feat/x at ${MERGED}, still checked out in /repo`,
  );
});

void test("cleanUp keeps a merged branch that no worktree has checked out", async () => {
  const s = scripted({ holder: "none" });
  const report = await s.run();
  assert.deepEqual(report.problems, []);
  assertNothingRemoved(s);
  assert.equal(report.done.at(-1), `kept the local branch feat/x at ${MERGED}`);
});

void test("cleanUp says when the kept branch has moved past the merged commit, as information rather than a problem", async () => {
  for (const holder of ["worktree", "none"] as const) {
    const s = scripted({ holder, localTip: NEWER });
    const report = await s.run();
    assert.deepEqual(report.problems, []);
    assertNothingRemoved(s);
    assert.match(
      report.done.at(-1) ?? "",
      new RegExp(`^kept .*${NEWER}, which is not the merged ${MERGED}`),
    );
  }
});

void test("cleanUp confirms a remote branch already gone, and pushes nothing", async () => {
  const s = scripted({ holder: "worktree", remote: ["absent"] });
  const report = await s.run();
  assert.deepEqual(report.problems, []);
  assert.ok(report.done.includes("confirmed origin/feat/x is gone"));
  assert.equal(s.count("push"), 0);
});

void test("cleanUp deletes the remote branch in one push, leased to the merged commit", async () => {
  const s = scripted({ holder: "worktree" });
  const report = await s.run();
  const pushes = s.calls.filter((call) => call.args[0] === "push");
  assert.deepEqual(
    pushes.map((call) => [call.cwd, ...call.args]),
    [["/repo", "push", LEASE, "origin", ":refs/heads/feat/x"]],
  );
  assert.ok(
    report.done.includes(
      `deleted origin/feat/x, whose tip was still the merged ${MERGED}`,
    ),
  );
});

void test("cleanUp keeps a remote branch that moved on: the lease is refused as stale, and the problem names both commits", async () => {
  const s = scripted({ holder: "worktree", remote: [NEWER], pushError: STALE });
  const report = await s.run();
  assert.deepEqual(report.problems, [
    `kept origin/feat/x: its tip is ${NEWER}, not the merged ${MERGED}, so it holds work that didn't merge. Look at it before deleting it.`,
  ]);
  assert.equal(s.count("push"), 1, "the deletion is never tried again");
  assert.equal(s.count("ls-remote"), 2, "one read before, one to explain");
});

void test("cleanUp confirms a remote branch gone when the stale lease turns out to be a branch deleted meanwhile", async () => {
  const s = scripted({
    holder: "worktree",
    remote: [MERGED, "absent"],
    pushError: STALE,
  });
  const report = await s.run();
  assert.deepEqual(report.problems, []);
  assert.ok(report.done.includes("confirmed origin/feat/x is gone"));
});

void test("cleanUp reports git's own words when the deletion fails and origin's tip can't be read afterwards", async () => {
  const error = "remote: error: GH013: Repository rule violations found";
  const s = scripted({
    holder: "worktree",
    remote: [MERGED, "unreadable"],
    pushError: error,
  });
  const report = await s.run();
  assert.equal(report.problems.length, 1);
  assert.match(report.problems[0] ?? "", /^could not delete origin\/feat\/x:/);
  assert.match(report.problems[0] ?? "", /its tip could not be read/);
  assert.ok(report.problems[0]?.endsWith(error), report.problems[0]);
  assert.doesNotMatch(report.problems[0] ?? "", /holds work/);
});

void test("a deletion refused for another reason, with the tip still the merged commit, is reported with git's words and exit code 1", async () => {
  const world = defaultWorld();
  world.remoteAfterMerge = "accepted";
  world.deletionError =
    "remote: error: GH013: Repository rule violations found for refs/heads/feat/x.";
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 1);
  const err = h.err();
  assert.match(
    err,
    /left behind: could not delete origin\/feat\/x: the push failed, and its tip now reads as the merged a{40}\. git said: remote: error: GH013: Repository rule violations found for refs\/heads\/feat\/x\./,
  );
  assert.doesNotMatch(err, /holds work/);
  assert.match(err, /cleanup is incomplete/);
  assert.match(h.out(), /merged #7/);
});
