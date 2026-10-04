// How merge reads the checks on a commit when GitHub has run them more than
// once: after a description edit, a re-run, or a run that started after
// merge first looked.

import assert from "node:assert/strict";
import test from "node:test";

import { createMergeCommand } from "./command.ts";
import { newestRunPerCheck } from "./check-runs.ts";
import { defaultWorld, harness, HEAD, type CheckRun } from "./testing/world.ts";

function run(
  name: string,
  conclusion: string | null,
  id: number,
  minute: number,
): CheckRun {
  return {
    name,
    status: conclusion === null ? "in_progress" : "completed",
    conclusion,
    id,
    started_at: `2026-10-03T10:${String(minute).padStart(2, "0")}:00Z`,
  };
}

void test("judges each check by its newest run, so a superseded cancelled run doesn't fail the merge", async () => {
  // A description edit started a second CI run on the same commit, which
  // cancelled the first; the second passed. GitHub lists both runs, in no
  // promised order.
  const world = defaultWorld();
  world.checkRuns = [
    [
      run("check (ubuntu)", "success", 20, 5),
      run("check (ubuntu)", "cancelled", 10, 0),
      run("CodeQL", "success", 11, 0),
    ],
  ];
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  assert.match(h.out(), /all 2 checks passed/);
});

void test("refuses when a check's newest run failed, though an older run of it passed", async () => {
  const world = defaultWorld();
  world.checkRuns = [
    [run("gate", "success", 1, 0), run("gate", "failure", 2, 5)],
  ];
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 1);
  assert.match(
    h.err(),
    new RegExp(`checks failed on ${HEAD}: gate \\(failure\\)\\n`),
  );
  assert.equal(h.ran("gh", "pr", "merge"), false);
});

void test("a run that hasn't started yet is told apart by its id", () => {
  const newest = newestRunPerCheck([
    { name: "gate", conclusion: "success", id: 3, started_at: null },
    { name: "gate", conclusion: null, id: 9, started_at: null },
    { name: "lint", conclusion: "success", id: 4 },
  ]);
  assert.deepEqual(
    newest.map((r) => [r.name, r.id]),
    [
      ["gate", 9],
      ["lint", 4],
    ],
  );
});

void test("waits for a check's newest run while an older run of it has passed", async () => {
  const world = defaultWorld();
  world.checkRuns = [
    [run("gate", "success", 1, 0), run("gate", null, 2, 5)],
    [run("gate", "success", 1, 0), run("gate", "success", 2, 5)],
  ];
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  assert.match(h.out(), /waiting for gate\n/);
  assert.match(h.out(), /all 1 checks passed/);
});

// A description edit starts new CI runs, but GitHub takes a moment to
// create them. Merge run straight after the edit sees only the finished
// runs from before it, all green, while GitHub's ruleset is already
// waiting on the new ones and refuses the merge.
const OLD = run("gate", "success", 1, 0);
const NEW_RUNNING = run("gate", null, 2, 5);

void test("when GitHub refuses because it started new runs, waits for them and merges", async () => {
  const world = defaultWorld();
  world.mergeRefusals = 1;
  world.checkRuns = [
    [OLD],
    [OLD, NEW_RUNNING],
    [OLD, NEW_RUNNING],
    [OLD, run("gate", "success", 2, 5)],
  ];
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  assert.match(
    h.out(),
    /GitHub refused the merge while checks it started after merge read them were running: gate \(in_progress\)\. Waiting for them, then trying again/,
  );
  assert.match(h.out(), /merged #7/);
  const merges = h.gh.calls.filter(
    (c) => c.args[0] === "pr" && c.args[1] === "merge",
  );
  assert.equal(merges.length, 2);
});

void test("when the new run fails, refuses naming it", async () => {
  const world = defaultWorld();
  world.mergeRefusals = 1;
  world.checkRuns = [
    [OLD],
    [OLD, NEW_RUNNING],
    [OLD, run("gate", "failure", 2, 5)],
  ];
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 1);
  assert.match(h.err(), /checks failed on a+: gate \(failure\)/);
});

void test("a refusal with no new runs in sight is reported as GitHub gave it", async () => {
  const world = defaultWorld();
  world.mergeRefusals = 1;
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 1);
  assert.match(
    h.err(),
    /refused: GitHub refused the merge: Repository rule violations found\n/,
  );
  const merges = h.gh.calls.filter(
    (c) => c.args[0] === "pr" && c.args[1] === "merge",
  );
  assert.equal(merges.length, 1, "no retry without new runs");
});

void test("stops after a bounded number of tries, naming the checks still running", async () => {
  const world = defaultWorld();
  world.mergeRefusals = Number.POSITIVE_INFINITY;
  // Every wait ends green, but each refusal shows another new run.
  let id = 1;
  world.checkRuns = Array.from({ length: 12 }, (_, i) =>
    i % 2 === 0
      ? [run("gate", "success", id++, i)]
      : [run("gate", null, id++, i)],
  );
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 1);
  assert.match(
    h.err(),
    /GitHub refused the merge: Repository rule violations found\. GitHub is still running checks it started after merge read them: gate \(in_progress\)\. Run merge again once they finish\./,
  );
  const merges = h.gh.calls.filter(
    (c) => c.args[0] === "pr" && c.args[1] === "merge",
  );
  assert.equal(merges.length, 3);
});

void test("a job in another workflow that copies a check's name can't replace its failure", async () => {
  // Seen on a real repository: a pull request added a workflow whose job is
  // named like the judge and passed after the real judge failed. GitHub
  // still blocks the merge, so merge must report the failure too.
  const world = defaultWorld();
  world.checkRuns = [
    [
      { ...run("temple-bar judge", "failure", 1, 0), suite: 100 },
      { ...run("temple-bar judge", "success", 2, 5), suite: 200 },
    ],
  ];
  world.workflowRuns = [
    { suite: 100, workflow: 10 },
    { suite: 200, workflow: 20 },
  ];
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 1);
  assert.match(h.err(), /checks failed on .*temple-bar judge \(failure\)/);
  assert.equal(h.ran("gh", "pr", "merge"), false);
});

void test("a re-run in the same workflow still replaces the run before it", () => {
  const newest = newestRunPerCheck(
    [
      { name: "gate", conclusion: "cancelled", id: 1, suite: 100 },
      { name: "gate", conclusion: "success", id: 2, suite: 200 },
    ],
    new Map([
      [100, 10],
      [200, 10],
    ]),
  );
  assert.deepEqual(
    newest.map((r) => r.conclusion),
    ["success"],
  );
});
