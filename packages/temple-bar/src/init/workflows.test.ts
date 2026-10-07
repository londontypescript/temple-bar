// The gate and title workflows run a project's checks on every pull
// request, and a ruleset will require their checks by name, so the
// properties that make them do that are asserted here rather than trusted to
// review: when they run, what their token can do, that nothing in them can
// skip a step or hide its failure, and what each runs, in order.

import assert from "node:assert/strict";
import test from "node:test";

import {
  GATE_CHECK,
  gateWorkflow,
  PR_TITLE_CHECK,
  prTitleWorkflow,
} from "./workflows.ts";

/** A workflow without its comments: what GitHub actually runs. */
function codeOf(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

const gate = codeOf(gateWorkflow());
const title = codeOf(prTitleWorkflow());

/** Each step's `name:`, `uses:` action or `run:` command, in order. */
function stepsOf(code: string): string[] {
  return [...code.matchAll(/^ {6}- name: .*\n {8}(uses|run): (\S+.*)$/gm)].map(
    (m) => (m[1] === "uses" ? (m[2] ?? "").split("@")[0] : m[2]) ?? "",
  );
}

void test("workflows: the gate runs on a pull request opened, pushed to or reopened, and nothing else", () => {
  assert.match(
    gate,
    /^on:\n {2}pull_request:\n {4}types: \[opened, synchronize, reopened\]\n\n/m,
  );
  assert.doesNotMatch(gate, /^ {2}(push|pull_request_target|workflow_\w+):/m);
});

void test("workflows: the title check runs on edits too, so a changed title is checked again", () => {
  assert.match(
    title,
    /^on:\n {2}pull_request:\n {4}types: \[opened, edited, synchronize, reopened\]\n\n/m,
  );
  assert.doesNotMatch(title, /^ {2}(push|pull_request_target|workflow_\w+):/m);
});

void test("workflows: the token can only read the code", () => {
  for (const code of [gate, title]) {
    assert.match(code, /^permissions:\n {2}contents: read\n\n/m);
    assert.doesNotMatch(code, /: write/);
  }
});

void test("workflows: each has its own concurrency group, so a title edit never cancels a gate run", () => {
  assert.match(
    gate,
    /^concurrency:\n {2}group: temple-bar-gate-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: true\n/m,
  );
  assert.match(
    title,
    /^concurrency:\n {2}group: temple-bar-pr-title-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: true\n/m,
  );
});

void test("workflows: nothing can skip a step or let it fail quietly", () => {
  for (const code of [gate, title]) {
    assert.doesNotMatch(code, /^\s*(- )?["']?if["']?:/m);
    assert.doesNotMatch(code, /continue-on-error/);
  }
});

void test("workflows: nothing changes what a step runs: no shell, folder or default overrides, and the checkout is the pull request's own", () => {
  for (const code of [gate, title]) {
    // Quoted keys too, since YAML accepts them. A shell such as `true {0}`
    // would pass every step without running it, and another folder would
    // run some other project's scripts.
    assert.doesNotMatch(
      code,
      /^\s*(- )?["']?(shell|working-directory|defaults)["']?:/m,
    );
    // Checking out another ref or repository would gate other code.
    assert.doesNotMatch(code, /^\s*(- )?["']?(ref|repository)["']?:/m);
  }
});

void test("workflows: one job each, named by the check a ruleset requires, on Node 24", () => {
  for (const [code, check] of [
    [gate, GATE_CHECK],
    [title, PR_TITLE_CHECK],
  ] as const) {
    const jobs = code.slice(code.indexOf("\njobs:\n"));
    assert.equal(jobs.match(/^ {2}\w[\w-]*:$/gm)?.length, 1, check);
    assert.match(
      code,
      new RegExp(`^ {4}name: ${check}\n {4}runs-on: ubuntu-latest\n`, "m"),
    );
    assert.match(code, /^ {10}node-version: 24$/m);
  }
  assert.equal(GATE_CHECK, "temple-bar gate");
  assert.equal(PR_TITLE_CHECK, "temple-bar pr-title");
});

void test("workflows: the gate has no time limit; the title check stops after 10 minutes", () => {
  assert.doesNotMatch(gate, /timeout-minutes/);
  assert.match(title, /^ {4}timeout-minutes: 10$/m);
});

void test("workflows: the gate's steps, in order, with the token on the gate step and full history for the size check", () => {
  assert.deepEqual(stepsOf(gate), [
    "actions/checkout",
    "pnpm/action-setup",
    "actions/setup-node",
    "pnpm install --frozen-lockfile",
    "pnpm gate",
    "pnpm exec temple-bar pr-size",
  ]);
  assert.match(
    gate,
    /^ {8}run: pnpm gate\n {8}env:\n {10}GH_TOKEN: \$\{\{ github\.token \}\}\n/m,
  );
  assert.equal(gate.match(/GH_TOKEN/g)?.length, 1, "only the gate step");
  assert.match(
    gate,
    /^ {10}persist-credentials: false\n {10}fetch-depth: 0\n/m,
  );
});

void test("workflows: the title check's steps, in order, from a default-depth checkout", () => {
  assert.deepEqual(stepsOf(title), [
    "actions/checkout",
    "pnpm/action-setup",
    "actions/setup-node",
    "pnpm install --frozen-lockfile",
    "pnpm exec temple-bar pr-title",
  ]);
  assert.match(title, /^ {10}persist-credentials: false\n\n/m);
  assert.doesNotMatch(title, /fetch-depth|GH_TOKEN/);
});

void test("workflows: pnpm comes from package.json, and Node caches its store", () => {
  for (const code of [gate, title]) {
    assert.match(code, /uses: pnpm\/action-setup@\S+ # v\d+\n\n/);
    assert.match(code, /^ {10}cache: pnpm$/m);
  }
});

void test("workflows: every action is pinned to a full commit hash", () => {
  for (const code of [gate, title]) {
    const uses = [...code.matchAll(/uses: (\S+)/g)].map((m) => m[1] ?? "");
    assert.equal(uses.length, 3);
    for (const action of uses) {
      assert.match(action, /@[0-9a-f]{40}$/, action);
    }
  }
});

void test("workflows: each opens by saying temple-bar wrote it, the gate holds it exact, and its job name is reserved", () => {
  for (const [text, check] of [
    [gateWorkflow(), GATE_CHECK],
    [prTitleWorkflow(), PR_TITLE_CHECK],
  ] as const) {
    const opening = text
      .slice(0, text.indexOf("\nname:"))
      .replaceAll(/\n# /g, " ");
    assert.match(opening, /^# Written by temple-bar\./);
    assert.match(opening, /exact copy/);
    assert.match(opening, /workflow of their own/);
    assert.match(opening, new RegExp(`"${check}" is reserved`));
  }
});
