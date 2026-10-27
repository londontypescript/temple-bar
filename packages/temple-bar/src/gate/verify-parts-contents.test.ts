// `gate --verify-parts`, on each report's contents: it must come from this
// run, commit, leg, Node, pnpm and gate; every outcome must be one the whole
// gate accepts; and the outcomes must be exactly the part's, from the check
// plan, never from the reports.

import assert from "node:assert/strict";
import test from "node:test";

import { readOwnVersion } from "../package-info.ts";
import { HEAD } from "./testing/parts-fixture.ts";
import { edit, everyPartReported } from "./testing/verify-fixture.ts";

function problems(stderr: { lines: string[] }): string[] {
  return stderr.lines
    .join("")
    .split("\n")
    .filter((line) => line.startsWith("  "))
    .map((line) => line.trim());
}

interface Outcome {
  name: string;
  status: string;
  detail?: string;
}

function outcomesOf(report: Record<string, unknown>): Outcome[] {
  return report.outcomes as Outcome[];
}

void test("verify-parts: each identity field that differs from this run's is mismatched, by name", async () => {
  const fields: [string, string, string][] = [
    ["repository", "someone/else", '"owner/project"'],
    ["commit", "b".repeat(40), JSON.stringify(HEAD)],
    ["run", "1", '"4242"'],
    ["attempt", "2", '"1"'],
    ["leg", "linux", '"windows"'],
    ["node", "v1.0.0", JSON.stringify(process.version)],
    ["pnpm", "native", '"javascript"'],
    ["gate", "0.0.1", JSON.stringify(readOwnVersion())],
  ];
  for (const [field, theirs, ours] of fields) {
    const leg = await everyPartReported();
    edit(leg.files, "packages-a.json", (report) => {
      report[field] = theirs;
    });

    const { code, stderr } = await leg.verify();

    assert.equal(code, 1, field);
    const [problem, ...rest] = problems(stderr);
    assert.deepEqual(rest, [], field);
    assert.equal(
      problem,
      `mismatched: packages-a.json (part packages/a): ${field} is ${JSON.stringify(theirs)}, but this run's is ${ours}`,
    );
  }
});

void test("verify-parts: a non-zero exit code, or any outcome the whole gate counts as failing, is not accepted", async () => {
  const exit = await everyPartReported();
  edit(exit.files, "root.json", (report) => {
    report.exitCode = 1;
  });
  const exited = await exit.verify();
  assert.equal(exited.code, 1);
  assert.deepEqual(problems(exited.stderr), [
    "outcome not accepted: root.json (part root): exit code 1",
  ]);

  for (const status of ["failed", "missing", "no-op", "not-run"]) {
    const leg = await everyPartReported();
    edit(leg.files, "packages-b.json", (report) => {
      const [first] = outcomesOf(report);
      if (first !== undefined) {
        first.status = status;
      }
    });

    const { code, stderr } = await leg.verify();

    assert.equal(code, 1, status);
    assert.deepEqual(problems(stderr), [
      `outcome not accepted: packages-b.json (part packages/b): typecheck (packages/b) ${status}`,
    ]);
  }
});

void test("verify-parts: a skipped outcome is accepted, as the whole gate accepts it", async () => {
  const leg = await everyPartReported();
  edit(leg.files, "repo.json", (report) => {
    const links = outcomesOf(report).find(
      (outcome) => outcome.name === "local links",
    );
    if (links !== undefined) {
      links.status = "skipped";
    }
  });

  assert.equal((await leg.verify()).code, 0);
});

void test("verify-parts: outcomes must be exactly the part's, each once: one coverage or ruleset outcome removed, one repeated, one added", async () => {
  const cases: [string, (outcomes: Outcome[]) => Outcome[], string][] = [
    [
      "a coverage outcome removed",
      (outcomes) => outcomes.filter((o) => o.name !== "test coverage"),
      "outcomes not exact: repo.json (part repo): test coverage is absent",
    ],
    [
      "a ruleset outcome removed",
      (outcomes) => outcomes.filter((o) => o.name !== "judge ruleset"),
      "outcomes not exact: repo.json (part repo): judge ruleset is absent",
    ],
    [
      "an outcome repeated",
      (outcomes) => [
        ...outcomes,
        ...outcomes.filter((o) => o.name === "core setup"),
      ],
      "outcomes not exact: repo.json (part repo): core setup is reported 2 times",
    ],
    [
      "an outcome added",
      (outcomes) => [...outcomes, { name: "extra check", status: "passed" }],
      "outcomes not exact: repo.json (part repo): extra check isn't expected",
    ],
    [
      "a script's outcome moved in from another part",
      (outcomes) => [...outcomes, { name: "lint", status: "passed" }],
      "outcomes not exact: repo.json (part repo): lint isn't expected",
    ],
  ];
  for (const [what, change, expected] of cases) {
    const leg = await everyPartReported();
    edit(leg.files, "repo.json", (report) => {
      report.outcomes = change(outcomesOf(report));
    });

    const { code, stderr } = await leg.verify();

    assert.equal(code, 1, what);
    assert.deepEqual(problems(stderr), [expected], what);
  }
});
