import assert from "node:assert/strict";
import test from "node:test";

import type { GhResult } from "../seams/gh.ts";
import { createFakeContext, createFakeGh } from "../testing/fakes.ts";
import { offerProtection } from "./github-protection.ts";
import { rulesetBody, type RulesetRule } from "./github-ruleset.ts";
import { JUDGE_RULESET_NAME, judgeRulesetBody } from "./judge-ruleset.ts";
import {
  GATE_CHECK,
  GATE_WORKFLOW_PATH,
  PR_TITLE_CHECK,
  PR_TITLE_WORKFLOW_PATH,
} from "./workflows.ts";
import {
  CODEQL_RULE,
  codeScanningAnswer,
  type CodeQlState,
} from "./testing/code-scanning-fake.ts";

const origin = { owner: "acme", repo: "widgets" };
const MAIN = { id: 42, target: "branch", name: "main: pull requests only" };
const JUDGE = { id: 7, target: "branch", name: JUDGE_RULESET_NAME };
const OTHER = { id: 9, target: "branch", name: "project" };
const BASE = [{ type: "deletion" }, { type: "required_signatures" }];
const CHECKS: RulesetRule = {
  type: "required_status_checks",
  parameters: {
    strict_required_status_checks_policy: true,
    do_not_enforce_on_create: false,
    required_status_checks: [
      { context: GATE_CHECK, integration_id: 15368 },
      { context: PR_TITLE_CHECK, integration_id: 15368 },
    ],
  },
};
const ok = (body: unknown = {}): GhResult => ({
  code: 0,
  stdout: JSON.stringify(body),
  stderr: "",
  notFound: false,
});
const error = (stderr: string, stdout = ""): GhResult => ({
  code: 1,
  stdout,
  stderr,
  notFound: false,
});
const missing = error("gh: Not Found (HTTP 404)");

function setup(
  options: {
    listed?: readonly object[];
    rules?: readonly RulesetRule[];
    effective?: readonly RulesetRule[];
    gate?: GhResult;
    title?: GhResult;
    state?: CodeQlState;
    unreadableRules?: GhResult;
    put?: GhResult;
    answer?: "yes" | "no" | "no-terminal";
  } = {},
) {
  const questions: string[] = [];
  const gh = createFakeGh((args) => {
    const target = args.find((arg) => arg.startsWith("repos/"));
    if (args.includes("PUT")) return options.put ?? ok();
    if (args.includes("POST")) return ok();
    if (target === "repos/acme/widgets/rulesets")
      return ok(options.listed ?? [MAIN, JUDGE]);
    if (target === "repos/acme/widgets/rulesets/42") {
      return options.unreadableRules ?? ok({ rules: options.rules ?? BASE });
    }
    if (target?.includes("/rules/branches/")) {
      return options.unreadableRules ?? ok(options.effective ?? [CODEQL_RULE]);
    }
    if (target?.endsWith(`/contents/${GATE_WORKFLOW_PATH}`))
      return options.gate ?? ok();
    if (target?.endsWith(`/contents/${PR_TITLE_WORKFLOW_PATH}`))
      return options.title ?? ok();
    return (
      codeScanningAnswer(args, options.state ?? "required") ??
      error(`unexpected call: ${String(target)}`)
    );
  });
  const ctx = createFakeContext({
    gh,
    prompt: {
      isInteractive: () => true,
      confirm: (question) => {
        questions.push(question);
        return Promise.resolve(options.answer ?? "yes");
      },
    },
  });
  return { gh, questions, run: () => offerProtection(ctx, "/repo", origin) };
}

function writes(t: ReturnType<typeof setup>, method = "PUT") {
  return t.gh.calls.filter((call) => call.args.includes(method));
}
function writtenRules(t: ReturnType<typeof setup>): RulesetRule[] {
  const calls = writes(t);
  assert.equal(calls.length, 1, "one PUT applies the entire ruleset addition");
  assert.equal(calls[0]?.args[3], "repos/acme/widgets/rulesets/42");
  return (JSON.parse(calls[0].input ?? "null") as { rules: RulesetRule[] })
    .rules;
}

void test("setup requires both workflows' checks in its main ruleset, keeping every other rule, with one read and PUT", async () => {
  const t = setup();
  assert.equal((await t.run()).kind, "created");
  assert.deepEqual(writtenRules(t), [...BASE, CHECKS]);
  assert.equal(
    t.gh.calls.filter(
      (call) => call.args[1] === "repos/acme/widgets/rulesets/42",
    ).length,
    1,
  );
  for (const path of [GATE_WORKFLOW_PATH, PR_TITLE_WORKFLOW_PATH]) {
    assert.ok(
      t.gh.calls.some(
        (call) =>
          call.args.includes(`repos/acme/widgets/contents/${path}`) &&
          call.args.includes("--silent"),
      ),
    );
  }
});

void test("setup retains project checks, replaces stale contexts and makes their one rule strict", async () => {
  const build = { context: "build", integration_id: 99 };
  const t = setup({
    rules: [
      ...BASE,
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: [build, { context: GATE_CHECK }],
          project_setting: "kept",
        },
      },
    ],
  });
  await t.run();
  assert.deepEqual(
    writtenRules(t),
    [
      ...BASE,
      {
        ...CHECKS,
        parameters: {
          ...CHECKS.parameters,
          project_setting: "kept",
          required_status_checks: [
            build,
            ...(CHECKS.parameters?.required_status_checks as unknown[]),
          ],
        },
      },
    ],
    "the project's existing required checks must survive the merge",
  );
});

void test("setup requires only the workflow on the default branch and names the other as not landed yet", async () => {
  const t = setup({ title: missing });
  const outcome = await t.run();
  const rule = writtenRules(t).find(
    (entry) => entry.type === "required_status_checks",
  );
  assert.deepEqual(rule?.parameters?.required_status_checks, [
    { context: GATE_CHECK, integration_id: 15368 },
  ]);
  assert.match(t.questions[0] ?? "", /the "temple-bar gate" check required/);
  assert.doesNotMatch(t.questions[0] ?? "", /temple-bar pr-title/);
  assert.match(
    outcome.message,
    /temple-bar-pr-title\.yml isn't on the default branch yet/,
  );
  assert.match(
    outcome.message,
    /run `pnpm exec temple-bar init` again to require it\./,
  );
});

void test("setup waits successfully without a question when neither workflow is there, even when the 404 is on stdout", async () => {
  const t = setup({ gate: missing, title: error("", "HTTP 404") });
  const outcome = await t.run();
  assert.equal(outcome.kind, "exists");
  assert.deepEqual(t.questions, []);
  assert.deepEqual(writes(t), []);
  assert.match(
    outcome.message,
    /temple-bar-gate\.yml and .*temple-bar-pr-title\.yml aren't on the default branch yet/,
  );
});

void test("setup creates the main ruleset with both checks and CodeQL when analysed, under one yes", async () => {
  const t = setup({ listed: [], state: "analysed", effective: [] });
  assert.equal((await t.run()).kind, "created");
  assert.equal(t.questions.length, 1);
  const posts = writes(t, "POST");
  assert.equal(posts.length, 1);
  const body = rulesetBody();
  assert.deepEqual(JSON.parse(posts[0]?.input ?? "null"), {
    ...body,
    rules: [...body.rules, CODEQL_RULE, CHECKS],
  });
  assert.match(
    t.questions[0] ?? "",
    /create the `main` ruleset \(.*CodeQL's results required.*"temple-bar gate" and "temple-bar pr-title" checks required.*up to date with `main`\)/,
  );
  assert.deepEqual(writes(t), []);
});

void test("setup leaves already required checks alone in its own main ruleset", async () => {
  const t = setup({ rules: [...BASE, CHECKS] });
  assert.equal((await t.run()).kind, "exists");
  assert.deepEqual(writes(t), []);
  assert.deepEqual(t.questions, []);
});

void test("checks required only by the judge's ruleset still get added to setup's main ruleset", async () => {
  const t = setup({
    effective: [...judgeRulesetBody().rules, CHECKS, CODEQL_RULE],
  });
  await t.run();
  assert.deepEqual(writtenRules(t), [...BASE, CHECKS]);
});

void test("a ruleset setup did not create is left alone with manual steps for ready checks only", async () => {
  const t = setup({ listed: [OTHER, JUDGE], title: missing });
  const outcome = await t.run();
  assert.equal(outcome.kind, "not-created");
  assert.match(
    outcome.message,
    /isn't one setup created, so setup leaves it alone/,
  );
  assert.match(
    outcome.message,
    /requires the status check "temple-bar gate" from GitHub Actions/,
  );
  assert.match(outcome.message, /requires branches to be up to date/);
  assert.doesNotMatch(outcome.message, /"temple-bar pr-title"/);
  assert.match(
    outcome.message,
    /temple-bar-pr-title\.yml isn't on the default branch yet/,
  );
  assert.deepEqual(writes(t), []);
  assert.deepEqual(t.questions, []);
});

void test("setup can accept effective checks in a ruleset it did not create", async () => {
  const t = setup({ listed: [OTHER, JUDGE], effective: [CODEQL_RULE, CHECKS] });
  assert.equal((await t.run()).kind, "exists");
  assert.deepEqual(writes(t), []);
  assert.deepEqual(t.questions, []);
});

void test("a foreign ruleset missing both ready checks gets manual steps and no write", async () => {
  const t = setup({ listed: [OTHER, JUDGE] });
  const outcome = await t.run();
  assert.equal(outcome.kind, "not-created");
  assert.match(
    outcome.message,
    /"temple-bar gate" and "temple-bar pr-title" from GitHub Actions/,
  );
  assert.deepEqual(writes(t), []);
});

void test("CodeQL and the two checks share one read and PUT, including failure and manual steps for both", async () => {
  for (const put of [ok(), error("HTTP 403: forbidden")]) {
    const t = setup({ state: "analysed", effective: [], put });
    const outcome = await t.run();
    assert.deepEqual(writtenRules(t), [...BASE, CODEQL_RULE, CHECKS]);
    assert.equal(
      t.gh.calls.filter(
        (call) => call.args[1] === "repos/acme/widgets/rulesets/42",
      ).length,
      1,
    );
    if (put.code === 0) {
      assert.equal(outcome.kind, "created");
    } else {
      assert.equal(outcome.kind, "not-created");
      assert.match(outcome.message, /HTTP 403/);
      assert.match(
        outcome.message,
        /requires code scanning results from CodeQL/,
      );
      assert.match(
        outcome.message,
        /requires the status checks "temple-bar gate" and "temple-bar pr-title"/,
      );
    }
  }
});

void test("an unreadable workflow is a setup failure, never a waiting success or a requirement for that check", async () => {
  const t = setup({
    gate: error("gh: server error (HTTP 500)"),
    title: missing,
  });
  const outcome = await t.run();
  assert.equal(
    outcome.kind,
    "not-created",
    "an unreadable workflow must make setup fail",
  );
  assert.match(
    outcome.message,
    /Couldn't read GitHub, so setup didn't require the checks/,
  );
  assert.match(outcome.message, /HTTP 500/);
  assert.match(outcome.message, /again once GitHub answers/);
  assert.deepEqual(writes(t), []);
});

void test("unreadable or malformed own and effective rules are setup failures, not empty rules", async () => {
  for (const listed of [
    [MAIN, JUDGE],
    [OTHER, JUDGE],
  ]) {
    for (const unreadableRules of [
      error("gh: server error (HTTP 500)"),
      ok({}),
      { ...ok(), stdout: "<html>" },
    ]) {
      const t = setup({ listed, unreadableRules });
      const outcome = await t.run();
      assert.equal(outcome.kind, "not-created");
      assert.match(outcome.message, /Couldn't read GitHub/);
      assert.deepEqual(writes(t), []);
    }
  }
});

void test("declining or having no terminal still names only ready checks in the manual steps and notes the rest", async () => {
  for (const answer of ["no", "no-terminal"] as const) {
    const t = setup({ title: missing, answer });
    const outcome = await t.run();
    assert.equal(outcome.kind, answer === "no" ? "declined" : "not-created");
    assert.match(
      outcome.message,
      /requires the status check "temple-bar gate"/,
    );
    assert.doesNotMatch(outcome.message, /"temple-bar pr-title"/);
    assert.match(
      outcome.message,
      /temple-bar-pr-title\.yml isn't on the default branch yet/,
    );
    assert.deepEqual(writes(t), []);
  }
});
