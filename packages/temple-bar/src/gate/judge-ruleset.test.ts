// The gate's judge check: the default branch must require the judge's check
// as setup does, and a missing rule is a failure unless the judge workflow
// is still on its way to the default branch in this very checkout.

import assert from "node:assert/strict";
import test from "node:test";

import type { HttpResult } from "../seams/http.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
  createFakeHttp,
  createFakeWriter,
} from "../testing/fakes.ts";
import { findJudgeRuleProblem, JUDGE_RULESET_CHECK } from "./judge-ruleset.ts";
import { runRulesetChecks } from "./ruleset.ts";
import type { EffectiveRule } from "./ruleset-compare.ts";

const REPO_URL = "https://api.github.com/repos/acme/widgets";
const WORKFLOW = ".github/workflows/temple-bar-judge.yml";
const CONTENTS_URL = `${REPO_URL}/contents/${WORKFLOW}?ref=main`;

/** A required_status_checks rule; `strict` "unset" leaves the setting out,
 * as a ruleset that never turned it on reports it. */
function checks(
  required: readonly object[],
  strict: boolean | "unset" = true,
): EffectiveRule {
  return {
    type: "required_status_checks",
    parameters: {
      ...(strict === "unset"
        ? {}
        : { strict_required_status_checks_policy: strict }),
      required_status_checks: required,
    },
  };
}

const JUDGE = { context: "temple-bar judge", integration_id: 15368 };
// Another ruleset's required checks, as temple-bar's own `main` has.
const CI = checks([{ context: "gate (ubuntu-latest)" }], false);

void test("findJudgeRuleProblem: the judge's check from Actions on up-to-date branches passes, beside other required checks", () => {
  assert.equal(findJudgeRuleProblem([CI, checks([JUDGE])]), undefined);
});

void test("findJudgeRuleProblem: no rule naming the judge's check is missing", () => {
  assert.deepEqual(findJudgeRuleProblem([CI, { type: "deletion" }]), {
    kind: "missing",
    message: 'nothing requires the "temple-bar judge" check',
  });
});

void test("findJudgeRuleProblem: the check from any source, or on stale branches, is weakened", () => {
  for (const rule of [
    checks([{ context: "temple-bar judge" }]),
    checks([{ context: "temple-bar judge", integration_id: 1 }]),
    checks([JUDGE], false),
    checks([JUDGE], "unset"),
  ]) {
    assert.equal(
      findJudgeRuleProblem([rule])?.kind,
      "weakened",
      JSON.stringify(rule),
    );
  }
});

function json(status: number, body: unknown): HttpResult {
  return { kind: "response", status, body: JSON.stringify(body) };
}

/** The gate's ruleset read with GitHub faked: `rules` is what the default
 * branch enforces, `contents` the answer about the judge workflow. */
function run(options: {
  rules: EffectiveRule[];
  contents?: HttpResult;
  workflowHere?: boolean;
}) {
  const http = createFakeHttp((url) => {
    if (url === REPO_URL) {
      return json(200, { private: false, default_branch: "main" });
    }
    if (url === CONTENTS_URL) {
      return options.contents ?? json(404, { message: "Not Found" });
    }
    return json(200, options.rules);
  });
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    git: createFakeGit(() => ({
      code: 0,
      stdout: "git@github.com:acme/widgets.git\n",
      stderr: "",
    })),
    fs: createFakeFs(
      options.workflowHere === true
        ? { [`/repo/${WORKFLOW}`]: "on: {}\n" }
        : {},
    ),
    http,
    stderr,
    env: { GH_TOKEN: "t0ken" },
  });
  return {
    http,
    stderr,
    judge: async () => {
      const outcome = (await runRulesetChecks(ctx)).find(
        (entry) => entry.name === JUDGE_RULESET_CHECK,
      );
      assert.ok(outcome);
      return outcome;
    },
  };
}

void test("judge ruleset: required as setup does, it passes without asking anything more", async () => {
  const t = run({ rules: [checks([JUDGE])] });
  assert.equal((await t.judge()).status, "passed");
  assert.ok(t.http.calls.every((call) => !call.url.includes("/contents/")));
});

void test("judge ruleset: missing once the workflow is on the default branch fails, and says how to fix it", async () => {
  const t = run({ rules: [CI], contents: json(200, { name: "x" }) });
  const outcome = await t.judge();
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.detail, "missing");
  const text = t.stderr.lines.join("");
  assert.match(text, /the judge's ruleset is missing/);
  assert.match(text, /`pnpm exec temple-bar init --create-ruleset`/);
  assert.match(text, /requires the status check "temple-bar judge"/);
  // Asked about the default branch, with the same token.
  const asked = t.http.calls.find((call) => call.url === CONTENTS_URL);
  assert.equal(asked?.token, "t0ken");
});

void test("judge ruleset: weakened fails and says to edit it by hand", async () => {
  const t = run({ rules: [checks([JUDGE], false)] });
  const outcome = await t.judge();
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.detail, "weakened");
  assert.match(t.stderr.lines.join(""), /weakened: .*up to date/);
});

void test("judge ruleset: the change that brings the workflow is skipped, since the rule can't exist yet", async () => {
  const t = run({ rules: [CI], workflowHere: true });
  const outcome = await t.judge();
  assert.equal(outcome.status, "skipped");
  assert.match(outcome.detail ?? "", /on its way to the default branch/);
  assert.match(outcome.detail ?? "", /run setup again/);
  assert.doesNotMatch(t.stderr.lines.join(""), /judge/);
});

void test("judge ruleset: no workflow anywhere fails, and says to run setup", async () => {
  const t = run({ rules: [CI] });
  const outcome = await t.judge();
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.detail, "no judge workflow");
  assert.match(
    t.stderr.lines.join(""),
    /the judge isn't set up: .*\n {2}fix: run `pnpm exec temple-bar init` to write it/,
  );
});

void test("judge ruleset: a missing rule GitHub can't explain is a failure, never a pass", async () => {
  for (const contents of [
    json(500, {}),
    { kind: "network-error", message: "fetch failed" } as const,
  ]) {
    const t = run({ rules: [CI], contents, workflowHere: true });
    const outcome = await t.judge();
    assert.equal(outcome.status, "failed");
    assert.match(outcome.detail ?? "", /^missing; could not read GitHub/);
  }
});
