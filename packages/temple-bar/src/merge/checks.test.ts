// How merge reads the checks on a commit when GitHub has run them more than
// once: after a description edit, a re-run, or a run that started after
// merge first looked.

import assert from "node:assert/strict";
import test from "node:test";

import { createMergeCommand } from "./command.ts";
import { newestRunPerName } from "./github.ts";
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
  const newest = newestRunPerName([
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
