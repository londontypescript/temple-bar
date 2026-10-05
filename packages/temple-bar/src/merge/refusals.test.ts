// Every refusal `temple-bar merge` can give, each asserting its own message
// and that nothing was merged. The world is a happy path except for the one
// thing each test breaks.

import assert from "node:assert/strict";
import test from "node:test";

import { createMergeCommand } from "./command.ts";
import { defaultWorld, harness, HEAD, type World } from "./testing/world.ts";

/** Runs merge in a world changed by `change`, and asserts the refusal's
 * own message first, so a refusal that stops happening fails on its
 * message; then that merge exited 1 and merged nothing. */
async function refusal(
  change: (world: World) => void,
  message: RegExp,
): Promise<void> {
  const world = defaultWorld();
  change(world);
  const h = harness(world);
  const code = await createMergeCommand(h.deps).run(["7"], h.ctx);
  assert.match(h.err(), message);
  assert.equal(code, 1);
  assert.equal(h.ran("gh", "pr", "merge"), false, "nothing merged");
}

void test("refuses a draft pull request", async () => {
  await refusal((w) => {
    w.pr.isDraft = true;
  }, /pull request #7 is a draft\. Mark it ready \(gh pr ready 7\)/);
});

void test("refuses a closed pull request", async () => {
  await refusal((w) => {
    w.pr.state = "CLOSED";
  }, /pull request #7 is closed\. Reopen it first/);
});

void test("refuses an already merged pull request and points at leftovers", async () => {
  await refusal((w) => {
    w.pr.state = "MERGED";
  }, /already merged\. `temple-bar leftovers` lists/);
});

void test("refuses a pull request that targets another branch", async () => {
  await refusal((w) => {
    w.pr.baseRefName = "release";
  }, /targets release, not the default branch main/);
});

void test("refuses a pull request from a fork", async () => {
  await refusal((w) => {
    w.pr.isCrossRepository = true;
  }, /comes from a fork/);
});

void test("refuses when there is no local branch", async () => {
  await refusal((w) => {
    w.localTip = undefined;
  }, /there is no local branch feat\/x/);
});

void test("refuses to update a branch that is behind when no worktree has it", async () => {
  await refusal((w) => {
    w.behind = true;
    w.worktrees = "";
  }, /feat\/x is behind main, but no worktree has feat\/x checked out/);
});

void test("refuses to update a branch that is behind when its worktree is dirty", async () => {
  await refusal((w) => {
    w.behind = true;
    w.dirty = true;
  }, /feat\/x is behind main, but the worktree at \/wt\/x has uncommitted changes/);
});

void test("refuses to update a behind branch whose local tip isn't the pull request's head", async () => {
  await refusal((w) => {
    w.behind = true;
    w.heads = ["d".repeat(40)];
  }, /behind main, and the local branch \(a+\) doesn't match the pull request's head \(d+\)/);
});

void test("refuses when GitHub's head never matches the local tip", async () => {
  const world = defaultWorld();
  world.heads = ["e".repeat(40)];
  const h = harness(world);
  const code = await createMergeCommand(h.deps).run(["7"], h.ctx);
  assert.match(
    h.err(),
    new RegExp(
      `head on GitHub is e{40}, but the local branch feat/x is at ${HEAD}.*close and reopen it`,
    ),
  );
  assert.equal(code, 1);
  // Bounded: three reads with a pause between each, then it stops.
  assert.deepEqual(h.sleeps, [1_000, 1_000]);
  assert.equal(h.ran("gh", "pr", "merge"), false);
});

void test("refuses a change to AGENTS.md without the maintainer's yes", async () => {
  await refusal((w) => {
    w.changedFiles = ["AGENTS.md", "src/x.ts"];
  }, /needs the maintainer's yes: changes AGENTS\.md\. Ask the maintainer in chat; once they say yes, run `temple-bar merge 7 --maintainer-approved`\./);
});

// The judge fails these on purpose; only the maintainer merges them, as a
// repository admin. Merge says so before the wait, and no flag gets past it.
const ADMIN_MERGE = /merge it themselves as a repository admin/;

void test("refuses a change to the pinned temple-bar, and asks for the maintainer's admin merge", async () => {
  await refusal((w) => {
    w.changedFiles = ["package.json"];
    w.packageAfter =
      '{"devDependencies":{"@londontypescript/temple-bar":"0.0.5"}}';
  }, /changes the checks that judge it: package\.json: the temple-bar version in devDependencies\["@londontypescript\/temple-bar"\] \("0\.0\.4" on the base branch, "0\.0\.5" here\)\. Ask the maintainer/);
});

void test("refuses a lockfile that points temple-bar elsewhere, but not other lockfile changes", async () => {
  const lockfile = (integrity: string, eslint = "10.0.0"): string =>
    `lockfileVersion: '9.0'\n\npackages:\n\n  '@londontypescript/temple-bar@0.0.4':\n    resolution: {integrity: ${integrity}}\n\n  eslint@${eslint}:\n    resolution: {integrity: sha512-e==}\n`;
  await refusal((w) => {
    w.changedFiles = ["pnpm-lock.yaml"];
    w.otherFiles["pnpm-lock.yaml"] = {
      before: lockfile("sha512-a=="),
      after: lockfile("sha512-b=="),
    };
  }, /changes the checks that judge it: pnpm-lock\.yaml: temple-bar's entries: packages > @londontypescript\/temple-bar@0\.0\.4 \(changed\)\. Ask the maintainer/);

  const world = defaultWorld();
  world.changedFiles = ["pnpm-lock.yaml"];
  world.otherFiles["pnpm-lock.yaml"] = {
    before: lockfile("sha512-a=="),
    after: lockfile("sha512-a==", "10.1.0"),
  };
  const h = harness(world);
  await createMergeCommand(h.deps).run(["7"], h.ctx);
  assert.doesNotMatch(h.err(), /changes the checks that judge it/);
});

void test("refuses a change to a CI workflow, before waiting for any check", async () => {
  const world = defaultWorld();
  world.changedFiles = [".github/workflows/ci.yml", "src/x.ts"];
  const h = harness(world);
  const code = await createMergeCommand(h.deps).run(["7"], h.ctx);
  assert.match(
    h.err(),
    /changes the checks that judge it: \.github\/workflows\/ci\.yml \(changed\)/,
  );
  assert.match(h.err(), ADMIN_MERGE);
  assert.equal(code, 1);
  assert.ok(
    h.gh.calls.every((call) => !call.args.join(" ").includes("/check-runs")),
    "refused before reading any check",
  );
  assert.equal(h.ran("gh", "pr", "merge"), false, "nothing merged");
});

void test("a yes in chat doesn't let merge past the judge: a changed gate script is still refused", async () => {
  const world = defaultWorld();
  world.changedFiles = ["package.json"];
  world.packageAfter = JSON.stringify({
    ...(JSON.parse(world.packageBefore) as object),
    scripts: { test: "echo ok" },
  });
  const h = harness(world);
  const code = await createMergeCommand(h.deps).run(
    ["7", "--maintainer-approved"],
    h.ctx,
  );
  assert.match(h.err(), /package\.json: the "test" script/);
  assert.match(h.err(), ADMIN_MERGE);
  assert.equal(code, 1);
  assert.equal(h.ran("gh", "pr", "merge"), false, "nothing merged");
});

void test("refuses when a check fails, naming the failed checks", async () => {
  await refusal(
    (w) => {
      w.checkRuns = [
        [
          { name: "gate", status: "completed", conclusion: "failure" },
          { name: "CodeQL", status: "completed", conclusion: "success" },
          { name: "lint", status: "completed", conclusion: "cancelled" },
        ],
      ];
    },
    new RegExp(
      `checks failed on ${HEAD}: gate \\(failure\\), lint \\(cancelled\\)`,
    ),
  );
});

void test("refuses when a commit status fails", async () => {
  await refusal((w) => {
    w.statuses = [{ context: "ci/legacy", state: "error" }];
  }, /checks failed on a+: ci\/legacy \(error\)/);
});

void test("refuses after a bounded wait when checks don't finish", async () => {
  await refusal((w) => {
    w.checkRuns = [[{ name: "gate", status: "in_progress", conclusion: null }]];
  }, /timed out after 0 minutes waiting for checks on a+: gate\. Run merge again once they finish/);
});

void test("refuses soon when no check ever appears, since the repo may have no CI", async () => {
  await refusal((w) => {
    w.checkRuns = [[]];
  }, /no checks reported on a+ after 0 minutes, and the ruleset requires none\. temple-bar merge only merges a pull request that CI has checked/);
});

void test("waits for a required check that hasn't started, then refuses naming it", async () => {
  await refusal((w) => {
    w.required = ["gate", "CodeQL"];
  }, /waiting for checks on a+: CodeQL \(not started\)/);
});

void test("refuses while the pull request has open code-scanning alerts", async () => {
  await refusal((w) => {
    w.alertsForPr = [
      { number: 4, rule: "js/sql-injection", path: "src/db.ts" },
    ];
  }, /pull request #7 has open code-scanning alerts: #4 js\/sql-injection in src\/db\.ts/);
});

void test("refuses while the default branch has open code-scanning alerts", async () => {
  await refusal((w) => {
    w.alertsOnDefault = [{ number: 9, rule: "js/xss", path: "src/page.ts" }];
  }, /main has open code-scanning alerts: #9 js\/xss in src\/page\.ts/);
});

void test("reports GitHub refusing the merge", async () => {
  const world = defaultWorld();
  world.mergeRefusals = Number.POSITIVE_INFINITY;
  const h = harness(world);
  const code = await createMergeCommand(h.deps).run(["7"], h.ctx);
  assert.match(
    h.err(),
    /GitHub refused the merge: Repository rule violations found/,
  );
  assert.equal(code, 1);
});

void test("usage mistakes exit 2", async () => {
  for (const args of [[], ["seven"], ["7", "--force"], ["7", "8"]]) {
    const h = harness(defaultWorld());
    const code = await createMergeCommand(h.deps).run(args, h.ctx);
    assert.equal(code, 2, args.join(" "));
    assert.equal(h.gh.calls.length, 0);
  }
});

void test("refuses a pull request closing two issues without a One concern line", async () => {
  await refusal((w) => {
    w.pr.body = "Fixes #1 and fixes #2.\n";
  }, /closes 2 issues \(#1, #2\) but its description has no `One concern:` line/);
});

void test("merges a pull request closing two issues that has a One concern line", async () => {
  const world = defaultWorld();
  world.pr.body = "Fixes #1 and fixes #2.\n\nOne concern: same cause.\n";
  const h = harness(world);
  const code = await createMergeCommand(h.deps).run(["7"], h.ctx);
  assert.equal(code, 0);
  assert.equal(h.ran("gh", "pr", "merge"), true);
});

void test("an empty One concern line does not count", async () => {
  await refusal((w) => {
    w.pr.body = "Fixes #1 and fixes #2.\n\nOne concern:\n";
  }, /has no `One concern:` line/);
});
