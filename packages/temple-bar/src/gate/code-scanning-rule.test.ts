// The gate's code scanning check: the default branch must require CodeQL's
// results at setup's thresholds or stricter, and a missing rule fails unless
// setup's own pull request is still on its way.

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
import {
  CODE_SCANNING_CHECK,
  findCodeScanningProblem,
} from "./code-scanning-rule.ts";
import { runRulesetChecks } from "./ruleset.ts";
import type { EffectiveRule } from "./ruleset-compare.ts";

const REPO_URL = "https://api.github.com/repos/acme/widgets";
const WORKFLOW = ".github/workflows/temple-bar-judge.yml";

/** A code scanning rule; `null` leaves that threshold out. */
function codeQl(
  alerts: string | null = "errors",
  security: string | null = "high_or_higher",
  tool = "CodeQL",
): EffectiveRule {
  return {
    type: "code_scanning",
    parameters: {
      code_scanning_tools: [
        {
          tool,
          ...(alerts === null ? {} : { alerts_threshold: alerts }),
          ...(security === null ? {} : { security_alerts_threshold: security }),
        },
      ],
    },
  };
}

const JUDGE: EffectiveRule = {
  type: "required_status_checks",
  parameters: {
    strict_required_status_checks_policy: true,
    required_status_checks: [
      { context: "temple-bar judge", integration_id: 15368 },
    ],
  },
};

void test("findCodeScanningProblem: CodeQL at setup's thresholds passes, beside other rules", () => {
  assert.equal(
    findCodeScanningProblem([{ type: "deletion" }, JUDGE, codeQl()]),
    undefined,
  );
});

void test("findCodeScanningProblem: stricter thresholds pass", () => {
  for (const rule of [
    codeQl("all", "all"),
    codeQl("errors_and_warnings", "medium_or_higher"),
  ]) {
    assert.equal(findCodeScanningProblem([rule]), undefined);
  }
});

void test("findCodeScanningProblem: a looser or missing threshold is weakened", () => {
  for (const rule of [
    codeQl("none"),
    codeQl("errors", "critical"),
    codeQl("errors", "none"),
    codeQl(null),
    codeQl("errors", null),
    codeQl("errors", "something new"),
  ]) {
    assert.equal(
      findCodeScanningProblem([rule])?.kind,
      "weakened",
      JSON.stringify(rule),
    );
  }
});

void test("findCodeScanningProblem: no rule, or one for another tool only, is missing", () => {
  for (const rules of [[], [JUDGE], [codeQl("all", "all", "Semgrep")]]) {
    assert.deepEqual(findCodeScanningProblem(rules), {
      kind: "missing",
      message: "nothing requires CodeQL's results",
    });
  }
});

void test("findCodeScanningProblem: one strict rule is enough, since GitHub enforces every rule", () => {
  assert.equal(findCodeScanningProblem([codeQl("none"), codeQl()]), undefined);
});

function json(status: number, body: unknown): HttpResult {
  return { kind: "response", status, body: JSON.stringify(body) };
}

/** The gate's read with GitHub faked: `rules` on the default branch, the
 * judge workflow there or not, and in this checkout or not. */
function run(options: {
  rules: EffectiveRule[];
  judgeOnMain?: boolean;
  workflowHere?: boolean;
}) {
  const http = createFakeHttp((url) => {
    if (url === REPO_URL) {
      return json(200, { private: false, default_branch: "main" });
    }
    if (url.includes("/contents/")) {
      return options.judgeOnMain === true
        ? json(200, { name: "x" })
        : json(404, { message: "Not Found" });
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
    outcome: async () => {
      const found = (await runRulesetChecks(ctx)).find(
        (entry) => entry.name === CODE_SCANNING_CHECK,
      );
      assert.ok(found);
      return found;
    },
  };
}

void test("code scanning rule: required as setup does, it passes", async () => {
  const t = run({ rules: [JUDGE, codeQl()] });
  const outcome = await t.outcome();
  assert.equal(outcome.status, "passed");
  assert.ok(t.http.calls.every((call) => !call.url.includes("/contents/")));
});

void test("code scanning rule: missing fails, and says to run setup once the user agrees", async () => {
  const t = run({ rules: [JUDGE], judgeOnMain: true });
  const outcome = await t.outcome();
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.detail, "missing");
  const text = t.stderr.lines.join("");
  assert.match(text, /doesn't require CodeQL's results/);
  assert.match(
    text,
    /`pnpm exec temple-bar init --create-ruleset` once the user agrees/,
  );
  assert.match(text, /requires code scanning results from CodeQL/);
});

void test("code scanning rule: weakened fails and says to edit it by hand", async () => {
  const t = run({ rules: [JUDGE, codeQl("none")] });
  const outcome = await t.outcome();
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.detail, "weakened");
  assert.match(
    t.stderr.lines.join(""),
    /code scanning rule is weakened: .*alerts_threshold "errors" or stricter/,
  );
});

void test("code scanning rule: setup's own pull request, still on its way, is skipped", async () => {
  const t = run({ rules: [], workflowHere: true });
  const outcome = await t.outcome();
  assert.equal(outcome.status, "skipped");
  assert.match(outcome.detail ?? "", /setup's pull request hasn't landed yet/);
  assert.match(outcome.detail ?? "", /run setup again/);
  assert.doesNotMatch(t.stderr.lines.join(""), /CodeQL/);
  // The judge's check and this one share one question about the workflow.
  assert.equal(
    t.http.calls.filter((call) => call.url.includes("/contents/")).length,
    1,
  );
});

void test("code scanning rule: no judge workflow anywhere is not setup's pull request, so missing fails", async () => {
  const t = run({ rules: [JUDGE] });
  assert.equal((await t.outcome()).status, "failed");
});
