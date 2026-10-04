import assert from "node:assert/strict";
import test from "node:test";

import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
  createFakeHttp,
} from "../testing/fakes.ts";
import { testGateCommand as gateCommand } from "./testing/fake-tools.ts";
import {
  CORE_SCRIPTS,
  coreFiles,
  withCoreGit,
} from "./testing/core-fixture.ts";
import type { HttpResult } from "../seams/http.ts";
import type { Context } from "../context.ts";
import type { CheckOutcome } from "./report.ts";
import { runRulesetChecks } from "./ruleset.ts";
import {
  findRulesetProblems,
  isEffectiveRuleList,
  type EffectiveRule,
} from "./ruleset-compare.ts";
import { createFakeWriter } from "../testing/fakes.ts";

// The shape of a real answer from GET /repos/{o}/{r}/rules/branches/main:
// the rules setup creates plus extras a repo added on its own.
const SOURCE = {
  ruleset_source_type: "Repository",
  ruleset_source: "o/r",
  ruleset_id: 1,
};
function rule(
  type: string,
  parameters?: Record<string, unknown>,
): EffectiveRule {
  return parameters === undefined
    ? { type, ...SOURCE }
    : { type, parameters, ...SOURCE };
}
function pullRequest(overrides: Record<string, unknown> = {}): EffectiveRule {
  return rule("pull_request", {
    required_approving_review_count: 0,
    dismiss_stale_reviews_on_push: false,
    required_reviewers: [],
    require_code_owner_review: false,
    require_last_push_approval: false,
    required_review_thread_resolution: false,
    allowed_merge_methods: ["squash"],
    ...overrides,
  });
}
function goodRules(): EffectiveRule[] {
  return [
    rule("deletion"),
    rule("non_fast_forward"),
    pullRequest(),
    rule("required_linear_history"),
    rule("required_signatures"),
    // Extras a repo may add on top.
    rule("required_status_checks", {
      strict_required_status_checks_policy: true,
      required_status_checks: [{ context: "check" }],
    }),
    rule("code_scanning", { code_scanning_tools: [] }),
    // The judge's ruleset, reported as a rule of its own.
    rule("required_status_checks", {
      strict_required_status_checks_policy: true,
      do_not_enforce_on_create: false,
      required_status_checks: [
        { context: "temple-bar judge", integration_id: 15368 },
      ],
    }),
  ];
}
function without(type: string): EffectiveRule[] {
  return goodRules().filter((entry) => entry.type !== type);
}
function withPullRequest(overrides: Record<string, unknown>): EffectiveRule[] {
  return goodRules().map((entry) =>
    entry.type === "pull_request" ? pullRequest(overrides) : entry,
  );
}

void test("findRulesetProblems: setup's own rules plus extras pass", () => {
  assert.deepEqual(findRulesetProblems(goodRules()), []);
});

// A real answer, read from this repo's own `main` on 2026-10-01 (read-only).
const LIVE_RULES: unknown = JSON.parse(
  String.raw`[{"type":"deletion","ruleset_source_type":"Repository","ruleset_source":"londontypescript/temple-bar","ruleset_id":24133476},{"type":"non_fast_forward","ruleset_source_type":"Repository","ruleset_source":"londontypescript/temple-bar","ruleset_id":24133476},{"type":"pull_request","parameters":{"required_approving_review_count":0,"dismiss_stale_reviews_on_push":false,"required_reviewers":[],"require_code_owner_review":false,"dismissal_restriction":{"enabled":false,"allowed_actors":[]},"require_last_push_approval":false,"required_review_thread_resolution":false,"require_extra_approval_for_unattributed_changes":true,"allowed_merge_methods":["squash"]},"ruleset_source_type":"Repository","ruleset_source":"londontypescript/temple-bar","ruleset_id":24133476},{"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":true,"do_not_enforce_on_create":false,"required_status_checks":[{"context":"check (macos-latest, node 24)","integration_id":15368},{"context":"check (macos-latest, node 26)","integration_id":15368},{"context":"check (ubuntu-latest, node 24)","integration_id":15368},{"context":"check (ubuntu-latest, node 26)","integration_id":15368},{"context":"check (windows-latest, node 24)","integration_id":15368},{"context":"check (windows-latest, node 26)","integration_id":15368}]},"ruleset_source_type":"Repository","ruleset_source":"londontypescript/temple-bar","ruleset_id":24133476},{"type":"required_linear_history","ruleset_source_type":"Repository","ruleset_source":"londontypescript/temple-bar","ruleset_id":24133476},{"type":"code_scanning","parameters":{"code_scanning_tools":[{"tool":"CodeQL","security_alerts_threshold":"high_or_higher","alerts_threshold":"errors"}]},"ruleset_source_type":"Repository","ruleset_source":"londontypescript/temple-bar","ruleset_id":24133476},{"type":"required_signatures","ruleset_source_type":"Repository","ruleset_source":"londontypescript/temple-bar","ruleset_id":24133476}]`,
);

void test("findRulesetProblems: a real answer from GitHub, with its extra rules, passes", () => {
  assert.ok(isEffectiveRuleList(LIVE_RULES));
  assert.deepEqual(findRulesetProblems(LIVE_RULES), []);
});

void test("findRulesetProblems: no rules at all reports every required rule missing", () => {
  const problems = findRulesetProblems([]);
  assert.deepEqual(
    problems.map((problem) => `${problem.kind} ${problem.rule}`),
    [
      "missing deletion",
      "missing non_fast_forward",
      "missing pull_request",
      "missing required_linear_history",
      "missing required_signatures",
    ],
  );
});

void test("findRulesetProblems: one absent rule is named, and only that one", () => {
  const problems = findRulesetProblems(without("required_signatures"));
  assert.deepEqual(
    problems.map((problem) => problem.rule),
    ["required_signatures"],
  );
  assert.equal(problems[0]?.kind, "missing");
});

void test("findRulesetProblems: allowing any merge method besides squash is weakened", () => {
  for (const methods of [
    ["merge", "squash"],
    ["rebase"],
    ["squash", "rebase"],
  ]) {
    const problems = findRulesetProblems(
      withPullRequest({ allowed_merge_methods: methods }),
    );
    assert.equal(problems.length, 1, JSON.stringify(methods));
    assert.equal(problems[0]?.kind, "weakened");
    assert.match(
      problems.map((p) => p.message).join(),
      /allowed_merge_methods/,
    );
  }
});

void test("findRulesetProblems: a pull_request rule with no merge methods listed is weakened", () => {
  const rules = goodRules().map((entry) =>
    entry.type === "pull_request" ? rule("pull_request", {}) : entry,
  );
  assert.equal(findRulesetProblems(rules)[0]?.kind, "weakened");
});

void test("findRulesetProblems: a stricter approval count is fine, an unset boolean setup turns on would be weakened", () => {
  assert.deepEqual(
    findRulesetProblems(
      withPullRequest({ required_approving_review_count: 2 }),
    ),
    [],
  );
  // A copy of the rules whose parameters had to be true would fail when
  // they are false; this exercises the generic comparison via expected.
  const problems = findRulesetProblems(goodRules(), [
    {
      type: "pull_request",
      parameters: { required_approving_review_count: 1 },
    },
  ]);
  assert.equal(problems[0]?.kind, "weakened");
  assert.match(problems.map((p) => p.message).join(), /at least 1/);
});

void test("findRulesetProblems: a loose second copy of a rule is not hidden by a strict one", () => {
  const rules = [
    ...goodRules(),
    pullRequest({ allowed_merge_methods: ["merge", "squash", "rebase"] }),
  ];
  assert.equal(findRulesetProblems(rules).length, 1);
});

// --- the check as the gate runs it, with GitHub faked ---

/** The branch ruleset's outcome, the first of the two the read serves; the
 * judge's has its own tests (judge-ruleset.test.ts). */
async function runRulesetCheck(ctx: Context): Promise<CheckOutcome> {
  const [branch] = await runRulesetChecks(ctx);
  assert.ok(branch);
  return branch;
}

const ORIGIN = "git@github.com:acme/widgets.git";
const REPO_URL = "https://api.github.com/repos/acme/widgets";

function json(status: number, body: unknown): HttpResult {
  return { kind: "response", status, body: JSON.stringify(body) };
}

function setup(options: {
  origin?: { code: number; stdout: string };
  repo?: HttpResult;
  rules?: HttpResult;
  env?: NodeJS.ProcessEnv;
}) {
  const origin = options.origin ?? { code: 0, stdout: `${ORIGIN}\n` };
  const http = createFakeHttp((url) => {
    if (url === REPO_URL) {
      return (
        options.repo ?? json(200, { private: false, default_branch: "main" })
      );
    }
    return options.rules ?? json(200, goodRules());
  });
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    git: createFakeGit(() => ({ ...origin, stderr: "" })),
    http,
    stderr,
    env: options.env ?? {},
  });
  return { ctx, http, stderr };
}

void test("ruleset check: passes when the default branch has every rule", async () => {
  const { ctx, http, stderr } = setup({});
  const outcome = await runRulesetCheck(ctx);
  assert.equal(outcome.status, "passed");
  assert.deepEqual(
    http.calls.map((call) => call.url),
    [REPO_URL, `${REPO_URL}/rules/branches/main`],
  );
  assert.deepEqual(stderr.lines, []);
});

void test("ruleset check: reads the repo's actual default branch, URL-encoded", async () => {
  const { ctx, http } = setup({
    repo: json(200, { private: false, default_branch: "release/1" }),
  });
  await runRulesetCheck(ctx);
  assert.equal(http.calls[1]?.url, `${REPO_URL}/rules/branches/release%2F1`);
});

void test("ruleset check: fails on a missing rule and says how to fix it", async () => {
  const { ctx, stderr } = setup({
    rules: json(200, without("required_signatures")),
  });
  const outcome = await runRulesetCheck(ctx);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.detail, "missing required_signatures");
  const text = stderr.lines.join("");
  assert.match(text, /missing: required_signatures/);
  assert.match(text, /`pnpm exec temple-bar init --create-ruleset`/);
  assert.match(text, /Settings > Rules > Rulesets/);
});

void test("ruleset check: no rules at all fails", async () => {
  const { ctx } = setup({ rules: json(200, []) });
  assert.equal((await runRulesetCheck(ctx)).status, "failed");
});

void test("ruleset check: fails when merge commits are allowed again", async () => {
  const { ctx, stderr } = setup({
    rules: json(
      200,
      withPullRequest({ allowed_merge_methods: ["merge", "squash"] }),
    ),
  });
  const outcome = await runRulesetCheck(ctx);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.detail, "weakened pull_request");
  assert.match(
    stderr.lines.join(""),
    /weakened: pull_request: allowed_merge_methods/,
  );
});

void test("ruleset check: a private repo is skipped with a reason, whichever way it shows", async () => {
  for (const repo of [
    json(404, { message: "Not Found" }),
    json(200, { private: true, default_branch: "main" }),
  ]) {
    const { ctx, http, stderr } = setup({
      repo,
      env: { GITHUB_ACTIONS: "true", GITHUB_TOKEN: "ci-token" },
    });
    const outcome = await runRulesetCheck(ctx);
    assert.equal(outcome.status, "skipped");
    assert.match(outcome.detail ?? "", /private repository/);
    assert.equal(http.calls.length, 1, "never asks for a private repo's rules");
    assert.deepEqual(stderr.lines, []);
  }
});

void test("ruleset check: no origin, or an origin outside GitHub, is skipped without any request", async () => {
  const none = setup({ origin: { code: 1, stdout: "" } });
  const none1 = await runRulesetCheck(none.ctx);
  assert.equal(none1.status, "skipped");
  assert.equal(none1.detail, "no origin remote");

  const other = setup({
    origin: { code: 0, stdout: "https://gitlab.com/acme/widgets.git\n" },
  });
  const other1 = await runRulesetCheck(other.ctx);
  assert.equal(other1.status, "skipped");
  assert.equal(other1.detail, "origin is not on GitHub");
  assert.equal(none.http.calls.length + other.http.calls.length, 0);
});

void test("ruleset check: an unreachable API is skipped locally, with the reason shown", async () => {
  const { ctx } = setup({
    repo: {
      kind: "network-error",
      message: "getaddrinfo ENOTFOUND api.github.com",
    },
  });
  const outcome = await runRulesetCheck(ctx);
  assert.equal(outcome.status, "skipped");
  assert.match(outcome.detail ?? "", /ENOTFOUND/);
});

void test("ruleset check: in GitHub Actions without a token it fails every time, says the fix, and asks nothing", async () => {
  const { ctx, http, stderr } = setup({ env: { GITHUB_ACTIONS: "true" } });
  const outcome = await runRulesetCheck(ctx);
  assert.match(stderr.lines.join(""), /needs a token in GitHub Actions/);
  assert.match(stderr.lines.join(""), /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.equal(outcome.status, "failed");
  assert.equal(http.calls.length, 0);
});

void test("ruleset check: an unreachable API fails in GitHub Actions", async () => {
  const { ctx, stderr } = setup({
    repo: { kind: "network-error", message: "fetch failed" },
    env: { GITHUB_ACTIONS: "true", GITHUB_TOKEN: "ci-token" },
  });
  const outcome = await runRulesetCheck(ctx);
  assert.equal(outcome.status, "failed");
  assert.match(stderr.lines.join(""), /could not read the branch ruleset/);
});

void test("ruleset check: a failing rules request fails in Actions, with a rate-limit hint on 403", async () => {
  const { ctx } = setup({
    rules: json(403, { message: "rate limit exceeded" }),
    env: { GITHUB_ACTIONS: "true", GITHUB_TOKEN: "ci-token" },
  });
  const outcome = await runRulesetCheck(ctx);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.detail ?? "", /403.*GH_TOKEN/);
});

void test("ruleset check: garbled replies are unreadable, never a pass", async () => {
  for (const setupOptions of [
    { repo: { kind: "response", status: 200, body: "<html>" } as const },
    { rules: { kind: "response", status: 200, body: "{}" } as const },
  ]) {
    const { ctx } = setup({
      ...setupOptions,
      env: { GITHUB_ACTIONS: "true", GITHUB_TOKEN: "ci-token" },
    });
    assert.equal((await runRulesetCheck(ctx)).status, "failed");
  }
});

void test("ruleset check: sends GH_TOKEN (or GITHUB_TOKEN) when set, and none otherwise", async () => {
  const withToken = setup({ env: { GITHUB_TOKEN: "t-1" } });
  await runRulesetCheck(withToken.ctx);
  assert.deepEqual(
    withToken.http.calls.map((call) => call.token),
    ["t-1", "t-1"],
  );
  const preferred = setup({ env: { GH_TOKEN: "t-2", GITHUB_TOKEN: "t-1" } });
  await runRulesetCheck(preferred.ctx);
  assert.equal(preferred.http.calls[0]?.token, "t-2");
  const blank = setup({ env: { GH_TOKEN: "" } });
  await runRulesetCheck(blank.ctx);
  assert.equal(blank.http.calls[0]?.token, undefined);
});

void test("gate: a weakened ruleset fails the whole gate and shows in the report", async () => {
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    git: createFakeGit(
      withCoreGit((args) => ({
        code: 0,
        stdout: args[0] === "remote" ? `${ORIGIN}\n` : "README.md\n",
        stderr: "",
      })),
    ),
    fs: createFakeFs({
      ...coreFiles(),
      "/repo/package.json": JSON.stringify({ scripts: CORE_SCRIPTS }),
      "/repo/README.md": "hi\n",
    }),
    http: createFakeHttp((url) =>
      url === REPO_URL
        ? json(200, { private: false, default_branch: "main" })
        : json(200, withPullRequest({ allowed_merge_methods: ["merge"] })),
    ),
    stdout,
    stderr,
  });
  assert.equal(await gateCommand.run([], ctx), 1);
  const text = stderr.lines.join("");
  assert.match(text, /failed +branch ruleset \(weakened pull_request\)/);
  assert.match(text, /^gate: failed: branch ruleset$/m);
});
