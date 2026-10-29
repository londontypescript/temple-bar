// `ready`'s size warning: after a passing gate, a branch over the pull
// request size limits is warned about, with its numbers, and never refused.

import assert from "node:assert/strict";
import test from "node:test";

import { HEAD, setup } from "./testing/ready-world.ts";

const ADVICE =
  "A squash merge makes each pull request one commit on main, so keep one concern per pull request: split it into pull requests that each hold one concern, or add a line to the description starting `One concern:` that says why it is one change.\n" +
  "`temple-bar merge` requires that line for a pull request over the size limits or closing several issues.\n";

function sizeWarning(...overages: string[]): string {
  return (
    "pr-size: warning: this pull request may be too big or mix concerns:\n" +
    overages.map((overage) => `  - ${overage}\n`).join("") +
    ADVICE
  );
}

/** `count` source files, one line changed in each. */
function manyFiles(count: number): Record<string, number> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`src/f${String(i)}.ts`, 1]),
  );
}

void test("ready: a branch over the source line limit is marked, with a warning giving its numbers", async () => {
  const t = setup({ lines: { "src/a.ts": 612 } });
  assert.equal(await t.run(), 0);
  assert.equal(t.mark(), `${HEAD}\n`);
  assert.equal(
    t.stderr.lines.join(""),
    sizeWarning("612 lines of source changed, limit 500"),
  );
});

void test("ready: a branch over the test line limit is warned about, saying so", async () => {
  const t = setup({ lines: { "src/a.test.ts": 1_200 } });
  assert.equal(await t.run(), 0);
  assert.equal(
    t.stderr.lines.join(""),
    sizeWarning("1,200 lines of tests changed, limit 1,000"),
  );
});

void test("ready: a branch over the file limit is warned about, saying so", async () => {
  const t = setup({ lines: manyFiles(16) });
  assert.equal(await t.run(), 0);
  assert.equal(t.mark(), `${HEAD}\n`);
  assert.equal(
    t.stderr.lines.join(""),
    sizeWarning("16 files touched, limit 15"),
  );
});

void test("ready: a branch over every limit names each one", async () => {
  const t = setup({
    lines: { ...manyFiles(15), "src/big.ts": 600, "src/big.test.ts": 1_001 },
  });
  assert.equal(await t.run(), 0);
  assert.equal(
    t.stderr.lines.join(""),
    sizeWarning(
      "615 lines of source changed, limit 500",
      "1,001 lines of tests changed, limit 1,000",
      "17 files touched, limit 15",
    ),
  );
});

void test("ready: the limits come from the project's config", async () => {
  const t = setup({
    lines: { "src/a.ts": 11 },
    config: { maxPullRequestLines: 10 },
  });
  assert.equal(await t.run(), 0);
  assert.equal(
    t.stderr.lines.join(""),
    sizeWarning("11 lines of source changed, limit 10"),
  );
});

void test("ready: a branch within the limits prints nothing about its size", async () => {
  const t = setup({ lines: { "src/a.ts": 500, "src/a.test.ts": 1_000 } });
  assert.equal(await t.run(), 0);
  assert.equal(t.stderr.lines.length, 0);
  assert.doesNotMatch(t.stdout.lines.join(""), /pr-size/);
});

void test("ready: measured from origin's default branch, as merge measures it", async () => {
  const t = setup({ defaultBranch: "master" });
  assert.equal(await t.run(), 0);
  const measured = t
    .gitCalls("diff")
    .filter((args) => args.includes("--numstat"));
  assert.deepEqual(measured, [
    [
      "diff",
      "--numstat",
      "-z",
      "--find-renames",
      `refs/remotes/origin/master...${HEAD}`,
      "--",
    ],
  ]);
});

void test("ready: a size that can't be measured is a warning, and ready still marks and exits 0", async () => {
  const t = setup({ measureError: "fatal: bad object" });
  assert.equal(await t.run(), 0);
  assert.equal(t.mark(), `${HEAD}\n`);
  assert.match(t.stdout.lines.join(""), /passed the gate and is marked/);
  assert.equal(
    t.stderr.lines.join(""),
    "ready: warning: could not measure this branch against the pull request size limits, so it isn't checked: " +
      `git diff refs/remotes/origin/main...${HEAD} failed: fatal: bad object\n`,
  );
});

void test("ready: a failing gate prints no size warning and measures nothing", async () => {
  const t = setup({ lines: { "src/a.ts": 612 }, gate: 1 });
  assert.equal(await t.run(), 1);
  assert.doesNotMatch(t.stderr.lines.join(""), /pr-size/);
  assert.equal(
    t.gitCalls("diff").filter((args) => args.includes("--numstat")).length,
    0,
  );
});

void test("ready: the maintainer warning stays last, after the size warning", async () => {
  const t = setup({
    changed: ["AGENTS.md"],
    lines: { "AGENTS.md": 612 },
  });
  assert.equal(await t.run(), 0);
  assert.equal(
    t.stderr.lines.join(""),
    sizeWarning("612 lines of source changed, limit 500") +
      "ready: warning: ccccccc needs the maintainer's yes before it is pushed: changes AGENTS.md.\n" +
      "Ask the maintainer in chat, and push only once they say yes.\n",
  );
});
