import assert from "node:assert/strict";
import test from "node:test";

import {
  offerProtection as offerRuleset,
  protectionQuestion,
} from "./github-protection.ts";
import { rulesetBody } from "./github-ruleset.ts";
import {
  CODEQL_RULE,
  codeScanningAnswer,
} from "./testing/code-scanning-fake.ts";
import {
  BASE,
  CHECKS,
  error,
  MAIN as MAIN_WITH_ID,
  missing,
  setup,
  writes,
} from "./testing/required-checks-world.ts";
import { judgeRulesetBody, JUDGE_RULESET_NAME } from "./judge-ruleset.ts";
import { GITHUB_ACTIONS_APP_ID, JUDGE_CHECK } from "../judge/workflow.ts";
import { createFakeContext, createFakeGh } from "../testing/fakes.ts";
import type { GhResult } from "../seams/gh.ts";

const origin = { owner: "acme", repo: "widgets" };

const ok = (stdout = ""): GhResult => ({
  code: 0,
  stdout,
  stderr: "",
  notFound: false,
});

const notFound: GhResult = {
  code: 1,
  stdout: "",
  stderr: "HTTP 404: Not Found",
  notFound: false,
};

const MAIN = { target: "branch", name: "main: pull requests only" };
const JUDGE = { target: "branch", name: JUDGE_RULESET_NAME };

const isContentsRead = (args: readonly string[]) =>
  args.some((a) => a.includes("/contents/"));

/** GitHub with `listed` rulesets, and the judge workflow on the default
 * branch or not. Creating a ruleset succeeds. */
function github(listed: readonly object[], judgeOnMain: boolean) {
  return createFakeGh((args) => {
    if (args.includes("POST")) {
      return ok();
    }
    const codeScanning = codeScanningAnswer(args, "required", true);
    if (codeScanning !== undefined) {
      return codeScanning;
    }
    if (isContentsRead(args)) {
      return args.some((a) => a.endsWith("temple-bar-judge.yml")) && judgeOnMain
        ? ok()
        : notFound;
    }
    return ok(JSON.stringify(listed));
  });
}

function createdBodies(gh: ReturnType<typeof createFakeGh>): unknown[] {
  return gh.calls
    .filter((call) => call.args.includes("POST"))
    .map((call) => JSON.parse(call.input ?? "null") as unknown);
}

void test("judgeRulesetBody: requires the judge's check from GitHub Actions on up-to-date branches, and lets only the admin role past it, through a pull request", () => {
  const body = judgeRulesetBody();
  assert.equal(body.name, JUDGE_RULESET_NAME);
  assert.deepEqual(body.conditions, {
    ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] },
  });
  assert.deepEqual(body.rules, [
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
        required_status_checks: [
          { context: JUDGE_CHECK, integration_id: GITHUB_ACTIONS_APP_ID },
        ],
      },
    },
  ]);
  assert.deepEqual(body.bypass_actors, [
    { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" },
  ]);
  // The `main` ruleset keeps nobody past it.
  assert.deepEqual(rulesetBody().bypass_actors, []);
});

void test("offerRuleset: with the judge on the default branch, one yes creates the `main` ruleset, then the judge's", async () => {
  const gh = github([], true);
  const outcome = await offerRuleset(
    createFakeContext({ gh }),
    "/repo",
    origin,
    true,
  );
  assert.equal(outcome.kind, "created");
  assert.deepEqual(createdBodies(gh), [rulesetBody(), judgeRulesetBody()]);
  assert.doesNotMatch(outcome.message, /isn't required yet/);
});

void test("offerRuleset: the judge not on the default branch yet: only the `main` ruleset, and it says to run setup again after the merge", async () => {
  const gh = github([], false);
  const outcome = await offerRuleset(
    createFakeContext({ gh }),
    "/repo",
    origin,
    true,
  );
  assert.equal(outcome.kind, "created");
  assert.deepEqual(createdBodies(gh), [rulesetBody()]);
  assert.match(outcome.message, /isn't required yet/);
  assert.match(outcome.message, /`pnpm exec temple-bar init` again/);
});

void test("offerRuleset: a run after the setup pull request merged adds only the judge's ruleset, asking about it alone", async () => {
  const gh = github([MAIN], true);
  const questions: string[] = [];
  const ctx = createFakeContext({
    gh,
    prompt: {
      isInteractive: () => true,
      confirm: (question) => {
        questions.push(question);
        return Promise.resolve("yes");
      },
    },
  });
  const outcome = await offerRuleset(ctx, "/repo", origin);
  assert.equal(outcome.kind, "created");
  assert.deepEqual(questions, [
    protectionQuestion({
      main: false,
      judge: true,
      turnOnCodeQl: false,
      requireCodeQl: false,
    }),
  ]);
  assert.deepEqual(createdBodies(gh), [judgeRulesetBody()]);
});

void test("offerRuleset: both rulesets there: nothing asked, created or even looked up", async () => {
  const gh = github([MAIN, JUDGE], true);
  const outcome = await offerRuleset(
    createFakeContext({ gh }),
    "/repo",
    origin,
  );
  assert.equal(outcome.kind, "exists");
  assert.deepEqual(createdBodies(gh), []);
  assert.equal(gh.calls.filter((call) => isContentsRead(call.args)).length, 0);
});

void test("offerRuleset: the judge's ruleset alone doesn't count as the `main` ruleset", async () => {
  const gh = github([JUDGE], true);
  const outcome = await offerRuleset(
    createFakeContext({ gh }),
    "/repo",
    origin,
    true,
  );
  assert.equal(outcome.kind, "created");
  assert.deepEqual(createdBodies(gh), [rulesetBody()]);
});

void test("offerRuleset: the judge's ruleset failing to create says what was created and how to add the rest", async () => {
  let posts = 0;
  const gh = createFakeGh((args) => {
    if (args.includes("POST")) {
      posts += 1;
      return posts === 2 ? notFound : ok();
    }
    return (
      codeScanningAnswer(args, "required", true) ??
      (isContentsRead(args)
        ? args.some((a) => a.endsWith("temple-bar-judge.yml"))
          ? ok()
          : notFound
        : ok("[]"))
    );
  });
  const outcome = await offerRuleset(
    createFakeContext({ gh }),
    "/repo",
    origin,
    true,
  );
  assert.equal(outcome.kind, "not-created");
  assert.match(outcome.message, /Created "main: pull requests only", but/);
  assert.match(outcome.message, /HTTP 404/);
  assert.match(outcome.message, /requires the status check "temple-bar judge"/);
});

// Only GitHub's "not found" means the workflow hasn't arrived yet. Any other
// failure leaves setup not knowing, so it fails rather than reporting the
// rulesets in place: everything else here is already set up.
for (const [what, reply] of [
  ["a server error", error("gh: Service Unavailable (HTTP 503)")],
  ["a refusal", error("gh: Forbidden (HTTP 403)")],
  ["no answer at all", error("error connecting to api.github.com")],
] as const) {
  void test(`offerRuleset: the judge workflow unreadable with ${what} fails setup with its own message, and never creates the judge's ruleset`, async () => {
    const t = setup({
      listed: [MAIN_WITH_ID],
      rules: [...BASE, CHECKS, CODEQL_RULE],
      judge: reply,
    });
    const outcome = await t.run();
    assert.equal(outcome.kind, "not-created");
    assert.match(
      outcome.message,
      /Couldn't read GitHub to tell whether \.github\/workflows\/temple-bar-judge\.yml is on the default branch, so setup didn't require the judge's check:/,
    );
    assert.ok(outcome.message.includes(reply.stderr));
    assert.doesNotMatch(outcome.message, /isn't required yet/);
    assert.deepEqual(writes(t, "POST"), []);
    assert.deepEqual(t.questions, []);
  });
}

void test("offerRuleset: the judge workflow not found is still only waiting for the merge, not a failure", async () => {
  const t = setup({
    listed: [MAIN_WITH_ID],
    rules: [...BASE, CHECKS, CODEQL_RULE],
    judge: missing,
  });
  const outcome = await t.run();
  assert.equal(outcome.kind, "exists");
  assert.match(outcome.message, /isn't required yet/);
});
