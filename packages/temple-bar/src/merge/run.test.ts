// The paths where `temple-bar merge` goes ahead: what it sends GitHub, what
// it tidies up, and what it reports.

import assert from "node:assert/strict";
import test from "node:test";

import { readOwnVersion } from "../package-info.ts";
import { createMergeCommand } from "./command.ts";
import {
  defaultWorld,
  harness,
  HEAD,
  LOCAL_NEWER,
  MERGED_IN,
  REMOTE_NEWER,
} from "./testing/world.ts";

// The ready mark in the branch's worktree.
const MARK = "/wt/x/.git/temple-bar-ready";

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

void test("reports bypass merges already on the default branch, and still merges", async () => {
  const world = defaultWorld();
  world.bypasses = `${JSON.stringify({
    id: 1,
    after_sha: "4bd23a923cfde9e247195c391aa44e9709f5f8af",
    actor_name: "maintainer",
    pushed_at: "2026-10-04T03:35:02+01:00",
  })}\n`;
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  assert.match(
    h.out(),
    /merge: bypass merges on main in the past month: 1\. .*\nmerge: {3}4bd23a9 by maintainer at 2026-10-04T03:35:02\+01:00, past main: the judge \(required_status_checks\)\n/,
  );

  const quiet = harness(defaultWorld());
  assert.equal(await createMergeCommand(quiet.deps).run(["7"], quiet.ctx), 0);
  assert.match(quiet.out(), /bypass merges on main in the past month: none/);
});

void test("never bypasses a ruleset or forces a push", async () => {
  const world = defaultWorld();
  world.behind = true;
  world.heads = [HEAD, MERGED_IN];
  world.remoteAfterMerge = "accepted";
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  const everything = [...h.git.calls, ...h.gh.calls].flatMap((c) => c.args);
  for (const flag of ["--admin", "--force", "-f", "--force-with-lease"]) {
    assert.equal(everything.includes(flag), false, flag);
  }
  assert.ok(!everything.some((arg) => arg.startsWith("+")), "no +refspec");
  // The one lease narrows deleting the merged branch to the head GitHub
  // accepted, here the commit that brought it up to date.
  const leased = h.git.calls.filter((c) =>
    c.args.some((arg) => arg.startsWith("--force-with-lease")),
  );
  assert.deepEqual(
    leased.map((c) => c.args),
    [
      [
        "push",
        `--force-with-lease=refs/heads/feat/x:${MERGED_IN}`,
        "origin",
        ":refs/heads/feat/x",
      ],
    ],
  );
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
  assert.match(h.out(), /maintainer approved: changes AGENTS\.md/);
  // The claim lands on main, readable in git log, before the co-authors.
  assert.equal(
    mergeCall(h).at(-1),
    "- add the x command\n- document x\n\nMaintainer-Approved: changes AGENTS.md\nCo-Authored-By: Ada <ada@example.com>\nCo-Authored-By: Bob <bob@example.com>",
  );
});

void test("a repository without code scanning merges and says there was nothing to check", async () => {
  const world = defaultWorld();
  world.alertsForPr = "not-set-up";
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  assert.match(h.out(), /code scanning isn't set up here/);
});

void test("after merging: fast-forwards main, keeps the worktree and the branch, and lists them as leftovers", async () => {
  const h = harness(defaultWorld());
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  assert.equal(h.ran("git", "worktree", "remove"), false, "worktree removed");
  assert.equal(h.ran("git", "branch", "-D"), false, "local branch deleted");
  assert.ok(h.ran("git", "merge", "--ff-only", "--quiet", "origin/main"));
  const out = h.out();
  assert.match(out, /confirmed origin\/feat\/x is gone/);
  assert.match(
    out,
    /merge: kept the worktree at \/wt\/x on feat\/x \(a{40}\); your harness removes it when it is done, or inspect it with temple-bar leftovers\n/,
  );
  assert.match(out, /no open code-scanning alerts on main/);
  // What merge kept on purpose is next listed for whoever removes it.
  assert.match(
    out,
    /merge: leftovers: 2 left behind \(nothing deleted; check each before removing it\):\nmerge: leftovers: {3}worktree \/wt\/x: its branch feat\/x's pull request #7 is merged \(git worktree remove \/wt\/x\)\nmerge: leftovers: {3}local branch feat\/x: pull request #7 merged \(git branch -D feat\/x\)\n/,
  );
  assert.match(out, /incidents: 3 open issues labelled incident\n/);
  assert.match(out, /pr-size: ok/);
});

void test("a commit made on the branch after the merge is kept, said so, and left out of the leftovers", async () => {
  const world = defaultWorld();
  world.localCommitAfterMerge = true;
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  const out = h.out();
  assert.match(
    out,
    new RegExp(
      `kept the worktree at /wt/x on feat/x \\(${LOCAL_NEWER}, which is not the merged ${HEAD}\\)`,
    ),
  );
  assert.match(
    out,
    /merge: leftovers: none finished, so check what merge kept above before removing it\n/,
  );
  assert.doesNotMatch(out, /local branch feat\/x:/);
});

void test("after the first merge, advises pnpm install when the primary checkout lists temple-bar but has none installed", async () => {
  const h = harness(defaultWorld());
  // The running version, which merge checks before anything else.
  await h.ctx.fs.writeText(
    "/repo/package.json",
    JSON.stringify({
      devDependencies: { "@londontypescript/temple-bar": readOwnVersion() },
    }),
  );
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  assert.match(
    h.out(),
    /merge: temple-bar is not installed in \/repo: run pnpm install there\./,
  );
});

void test("when the primary checkout does not list temple-bar yet, advises installing in a new worktree of the default branch", async () => {
  const h = harness(defaultWorld());
  await h.ctx.fs.writeText(
    "/repo/package.json",
    JSON.stringify({ name: "app" }),
  );
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  assert.match(
    h.out(),
    /does not list it yet: run pnpm install in a new worktree of origin\/main/,
  );
  assert.doesNotMatch(h.out(), /run pnpm install there/);
});

void test("no pnpm install advice when the primary checkout already has temple-bar", async () => {
  const h = harness(defaultWorld());
  await h.ctx.fs.writeText("/repo/node_modules/.bin/temple-bar", "#!/bin/sh\n");
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  assert.doesNotMatch(h.out(), /pnpm install/);
});

void test("deletes a remote branch gh left behind, leased to the merged head", async () => {
  const world = defaultWorld();
  world.remoteAfterMerge = "accepted";
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  assert.ok(
    h.ran(
      "git",
      "push",
      `--force-with-lease=refs/heads/feat/x:${HEAD}`,
      "origin",
      ":refs/heads/feat/x",
    ),
  );
  assert.match(
    h.out(),
    /deleted origin\/feat\/x, whose tip was still the merged a{40}\n/,
  );
  assert.doesNotMatch(h.out(), /remote branch origin\/feat\/x:/);
});

void test("a remote branch pushed to after the merge is kept, and merge exits 1", async () => {
  const world = defaultWorld();
  world.remoteAfterMerge = "moved";
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 1);
  assert.match(
    h.err(),
    new RegExp(
      `left behind: kept origin/feat/x: its tip is ${REMOTE_NEWER}, not the merged ${HEAD}, so it holds work that didn't merge`,
    ),
  );
  // Newer work isn't finished, so the leftovers never suggest deleting it.
  assert.doesNotMatch(h.out(), /remote branch origin\/feat\/x:/);
  assert.match(h.out(), /merged #7/);
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
    (await h.ctx.fs.readText(MARK))?.trim(),
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
  assert.equal(await h.ctx.fs.readText(MARK), "", "nothing is marked");
});

// The gate runs the project's own scripts, which can commit or change files
// as they go. Its pass then doesn't describe the merge commit as pushed.
for (const [effect, why] of [
  ["commits", /changed: the checked-out commit changed while the gate ran\n/],
  ["dirties", /aren't committed.*:\n {3}M file\.ts\n/],
] as const) {
  void test(`a gate that ${effect === "commits" ? "commits" : "changes tracked files"} while it runs leaves the caught-up branch unmarked and unpushed`, async () => {
    const world = defaultWorld();
    world.behind = true;
    world.heads = [HEAD, MERGED_IN];
    world.gateEffect = effect;
    const h = harness(world);
    await h.ctx.fs.writeText(MARK, `${HEAD}\n`);
    assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 1);
    assert.deepEqual(h.marksAtGate, [""], "an older mark is gone before it");
    assert.match(
      h.err(),
      /merge: refused: with origin\/main merged in, the gate left \/wt\/x changed: /,
    );
    assert.match(h.err(), why);
    assert.match(
      h.err(),
      /So nothing was marked or pushed\. Look at what the gate changed, commit or discard it, run `pnpm ready`, push, and run merge again\./,
    );
    assert.equal(await h.ctx.fs.readText(MARK), "", "nothing is marked");
    assert.equal(h.pushedBranch(), false, "the branch is not pushed");
    assert.equal(h.ran("gh", "pr", "merge"), false, "nothing is merged");
  });
}
