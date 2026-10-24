// Which run decides a check when one commit carries several runs of it.
// The ids, states and order of events come from runs recorded on real
// GitHub, written up on londontypescript/temple-bar#303.

import assert from "node:assert/strict";
import test from "node:test";

import { newestRunPerCheck, type WorkflowRun } from "./check-runs.ts";

// GitHub Actions' app id, as check runs report it.
const ACTIONS = 15368;
const WORKFLOW = 10;
const TITLE = "temple-bar pr-title";

function checkRun(
  id: number,
  suite: number,
  status: string,
  conclusion: string | null,
  startedAt = "2026-10-24T10:00:00Z",
): Record<string, unknown> {
  return {
    name: TITLE,
    status,
    conclusion,
    id,
    started_at: startedAt,
    suite,
    app: ACTIONS,
  };
}

function outcome(
  runs: readonly Record<string, unknown>[],
  workflowRuns: readonly WorkflowRun[],
): unknown[][] {
  return newestRunPerCheck(runs, workflowRuns).map((r) => [
    r.name,
    r.status,
    r.conclusion,
  ]);
}

void test("a newer workflow run that hasn't made the check's run yet keeps the check pending", () => {
  // A description edit a few seconds after opening the pull request. The
  // edit's workflow run waits, listed as pending, until the first run is
  // cancelled; its check run appears only after that. A read in between
  // sees the cancelled run alone.
  const runs = [checkRun(120919572397, 1, "completed", "cancelled")];
  const workflowRuns = [
    { suite: 1, workflow: WORKFLOW, run: 40110011804, status: "completed" },
    { suite: 2, workflow: WORKFLOW, run: 40110024834, status: "pending" },
  ];
  assert.deepEqual(outcome(runs, workflowRuns), [[TITLE, "pending", null]]);
});

void test("a run cancelled in an older workflow run doesn't count, even when it reports a later start", () => {
  // The shape the issue first guessed: the cancelled run reports a later
  // start than its replacement. On real GitHub it reported an earlier one,
  // but a queued run reports its creation time and resets it when it leaves
  // the queue, so start times can't be trusted either way. Ordering by
  // workflow run gets this right whatever the times say.
  const runs = [
    checkRun(120918405226, 2, "completed", "success", "2026-10-24T10:00:33Z"),
    checkRun(120918275598, 1, "completed", "cancelled", "2026-10-24T10:00:40Z"),
  ];
  const workflowRuns = [
    { suite: 1, workflow: WORKFLOW, run: 40109572401, status: "completed" },
    { suite: 2, workflow: WORKFLOW, run: 40109616026, status: "completed" },
  ];
  assert.deepEqual(outcome(runs, workflowRuns), [
    [TITLE, "completed", "success"],
  ]);
});

void test("a re-run's later attempt counts over its first", () => {
  // A re-run keeps the workflow run and its check suite; only the new
  // attempt's check run, with a higher id, tells them apart.
  const runs = [
    checkRun(113163229660, 1, "completed", "success"),
    checkRun(113161302643, 1, "completed", "cancelled"),
  ];
  const workflowRuns = [
    { suite: 1, workflow: WORKFLOW, run: 37731467421, status: "completed" },
  ];
  assert.deepEqual(outcome(runs, workflowRuns), [
    [TITLE, "completed", "success"],
  ]);
});

void test("a re-run of an older workflow run doesn't replace the newer workflow run's run", () => {
  // The re-run's check run has the highest id, being created last, but it
  // belongs to the older workflow run, so the newer workflow run's run
  // still decides.
  const runs = [
    checkRun(120918405226, 2, "completed", "success"),
    checkRun(120918676092, 1, "completed", "failure"),
  ];
  const workflowRuns = [
    { suite: 1, workflow: WORKFLOW, run: 40109572401, status: "completed" },
    { suite: 2, workflow: WORKFLOW, run: 40109616026, status: "completed" },
  ];
  assert.deepEqual(outcome(runs, workflowRuns), [
    [TITLE, "completed", "success"],
  ]);
});

void test("a later Actions run whose workflow run isn't listed yet keeps a check of its name pending", () => {
  // GitHub listed the replacement's check run about two seconds before it
  // listed the workflow run that made it.
  const runs = [
    checkRun(120918275598, 1, "completed", "cancelled"),
    checkRun(120918405226, 2, "queued", null),
  ];
  const workflowRuns = [
    { suite: 1, workflow: WORKFLOW, run: 40109572401, status: "completed" },
  ];
  assert.deepEqual(outcome(runs, workflowRuns), [
    [TITLE, "queued", null],
    // The unplaced run itself is still judged on its own, within its suite.
    [TITLE, "queued", null],
  ]);
});

void test("an unlisted Actions run that finished still only makes the check pending", () => {
  const runs = [
    checkRun(120918275598, 1, "completed", "cancelled"),
    checkRun(120918405226, 2, "completed", "success"),
  ];
  const workflowRuns = [
    { suite: 1, workflow: WORKFLOW, run: 40109572401, status: "completed" },
  ];
  assert.deepEqual(outcome(runs, workflowRuns), [
    [TITLE, "pending", null],
    [TITLE, "completed", "success"],
  ]);
});

void test("an unlisted Actions run older than the check's newest run changes nothing", () => {
  const runs = [
    checkRun(120918405226, 2, "completed", "cancelled"),
    checkRun(120918275598, 1, "completed", "success"),
  ];
  const workflowRuns = [
    { suite: 2, workflow: WORKFLOW, run: 40109616026, status: "completed" },
  ];
  assert.deepEqual(outcome(runs, workflowRuns), [
    [TITLE, "completed", "cancelled"],
    [TITLE, "completed", "success"],
  ]);
});

void test("a later run from an app outside GitHub Actions doesn't hold a check back", () => {
  const runs = [
    checkRun(120918275598, 1, "completed", "cancelled"),
    { ...checkRun(120918405226, 2, "queued", null), app: 999 },
  ];
  const workflowRuns = [
    { suite: 1, workflow: WORKFLOW, run: 40109572401, status: "completed" },
  ];
  assert.deepEqual(outcome(runs, workflowRuns), [
    [TITLE, "completed", "cancelled"],
    [TITLE, "queued", null],
  ]);
});

void test("a newer workflow run that finished without the check changes nothing", () => {
  // A newer run that failed to start, or left the job out, will never make
  // a run of this check.
  const runs = [checkRun(120919572397, 1, "completed", "cancelled")];
  const workflowRuns = [
    { suite: 1, workflow: WORKFLOW, run: 40110011804, status: "completed" },
    { suite: 2, workflow: WORKFLOW, run: 40110024834, status: "completed" },
  ];
  assert.deepEqual(outcome(runs, workflowRuns), [
    [TITLE, "completed", "cancelled"],
  ]);
});

void test("a newer workflow run of a different workflow doesn't hold a check back", () => {
  const runs = [checkRun(120919572397, 1, "completed", "cancelled")];
  const workflowRuns = [
    { suite: 1, workflow: WORKFLOW, run: 40110011804, status: "completed" },
    { suite: 2, workflow: WORKFLOW + 1, run: 40110024834, status: "pending" },
  ];
  assert.deepEqual(outcome(runs, workflowRuns), [
    [TITLE, "completed", "cancelled"],
  ]);
});

void test("unlisted runs in different check suites never replace each other", () => {
  // With no workflow run listed, which workflow a run belongs to isn't
  // known. A copycat workflow's passing run, created later, must not hide
  // the real check's failure in another suite.
  const runs = [
    checkRun(120918275598, 1, "completed", "failure"),
    checkRun(120918405226, 2, "completed", "success"),
  ];
  assert.deepEqual(outcome(runs, []), [
    [TITLE, "completed", "failure"],
    [TITLE, "completed", "success"],
  ]);
});

void test("a re-run from an app outside GitHub Actions replaces its earlier run in the same suite", () => {
  const runs = [
    { ...checkRun(120918275598, 1, "completed", "failure"), app: 999 },
    { ...checkRun(120918405226, 1, "completed", "success"), app: 999 },
  ];
  assert.deepEqual(outcome(runs, []), [[TITLE, "completed", "success"]]);
});
