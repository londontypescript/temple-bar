// The judge workflow runs with the base branch's trust, so the properties
// that make it safe are asserted here, line by line, rather than trusted to
// review: it never checks out or runs the pull request, its token is read
// only, and the check it reports is the one the ruleset requires.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { JUDGE_CHECK, judgeWorkflow } from "./workflow.ts";

const text = judgeWorkflow();
/** The workflow without its comments: what GitHub actually runs. */
const code = text
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

void test("workflow: runs on pull_request_target only, so the base branch's copy judges", () => {
  assert.match(code, /^on:\n {2}pull_request_target:\n/m);
  assert.doesNotMatch(code, /^ {2}pull_request:/m);
  assert.doesNotMatch(code, /^ {2}(push|workflow_run|workflow_dispatch):/m);
});

void test("workflow: never checks out or names the pull request's code", () => {
  // Any of these would bring the pull request's commits into a job that
  // holds the base branch's token.
  for (const pattern of [
    /github\.event\.pull_request\.head/,
    /github\.head_ref/,
    /refs\/pull\//,
    /^\s+ref:/m,
    /\bgit (fetch|checkout|switch|clone)\b/,
  ]) {
    assert.doesNotMatch(code, pattern);
  }
  assert.match(code, /persist-credentials: false/);
  assert.match(code, /sparse-checkout: package\.json/);
});

void test("workflow: no pull request text reaches a shell", () => {
  // Titles, bodies and branch names are the pull request author's text:
  // interpolated into `run:` they would run as commands.
  const expressions = [...code.matchAll(/\$\{\{([^}]*)\}\}/g)].map((m) =>
    (m[1] ?? "").trim(),
  );
  assert.deepEqual(expressions.sort(), [
    "github.token",
    "steps.pin.outputs.version",
  ]);
});

void test("workflow: the token can only read", () => {
  assert.match(
    code,
    /^permissions:\n {2}contents: read\n {2}pull-requests: read\n\n/m,
  );
  assert.doesNotMatch(code, /: write/);
});

void test("workflow: the job's name is the check the ruleset requires", () => {
  assert.match(code, new RegExp(`^ {4}name: ${JUDGE_CHECK}$`, "m"));
});

void test("workflow: every action is pinned to a full commit hash", () => {
  const uses = [...code.matchAll(/uses: (\S+)/g)].map((m) => m[1] ?? "");
  assert.ok(uses.length > 0);
  for (const action of uses) {
    assert.match(action, /@[0-9a-f]{40}$/, action);
  }
});

/** Runs the workflow's pin step for real, in a folder holding `manifest`. */
function readPin(manifest: object): {
  status: number | null;
  out: string;
  err: string;
} {
  const script = /node -e '\n([\s\S]*?)\n\s*'\n/.exec(text)?.[1];
  assert.ok(script !== undefined, "the pin step's script");
  const dir = mkdtempSync(path.join(tmpdir(), "judge-pin-"));
  try {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
    const output = path.join(dir, "output");
    writeFileSync(output, "");
    const result = spawnSync(process.execPath, ["-e", script], {
      cwd: dir,
      env: { ...process.env, GITHUB_OUTPUT: output },
      encoding: "utf8",
    });
    return {
      status: result.status,
      out: readFileSync(output, "utf8"),
      err: result.stderr,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void test("workflow: the pin step hands on an exact version", () => {
  const result = readPin({
    devDependencies: { "@londontypescript/temple-bar": "0.0.7" },
  });
  assert.equal(result.status, 0, result.err);
  assert.equal(result.out, "version=0.0.7\n");
});

void test("workflow: the pin step refuses a range or a missing pin, saying what it needs", () => {
  for (const manifest of [
    { devDependencies: { "@londontypescript/temple-bar": "^0.0.7" } },
    { devDependencies: { "@londontypescript/temple-bar": "latest" } },
    { devDependencies: {} },
  ]) {
    const result = readPin(manifest);
    assert.equal(result.status, 1, JSON.stringify(manifest));
    assert.equal(result.out, "");
    assert.match(
      result.err,
      /must pin @londontypescript\/temple-bar to an exact version/,
    );
  }
});
