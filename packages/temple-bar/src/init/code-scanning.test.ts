// Setup's CodeQL step, under the same yes as the rulesets: turned on first,
// its results required in the `main` ruleset only once CodeQL has analysed
// the default branch, and left off on a private repository.

import assert from "node:assert/strict";
import test from "node:test";

import { codeScanningRule } from "./code-scanning.ts";
import { offerProtection, protectionQuestion } from "./github-protection.ts";
import { rulesetBody } from "./github-ruleset.ts";
import { JUDGE_RULESET_NAME } from "./judge-ruleset.ts";
import {
  CODEQL_RULE,
  codeScanningAnswer,
  MAIN_RULESET_ID,
  type CodeQlState,
} from "./testing/code-scanning-fake.ts";
import { createFakeContext, createFakeGh } from "../testing/fakes.ts";
import type { ConfirmResult } from "../seams/prompt.ts";
import type { GhResult } from "../seams/gh.ts";

const origin = { owner: "acme", repo: "widgets" };

const ok = (stdout = ""): GhResult => ({
  code: 0,
  stdout,
  stderr: "",
  notFound: false,
});

const MAIN = {
  id: MAIN_RULESET_ID,
  target: "branch",
  name: "main: pull requests only",
};
const JUDGE = { id: 7, target: "branch", name: JUDGE_RULESET_NAME };

/** GitHub with `listed` rulesets, the judge workflow on the default branch,
 * and CodeQL in `state`. `override` answers first, for a failing call. */
function github(
  state: CodeQlState,
  listed: readonly object[] = [MAIN, JUDGE],
  override: (args: readonly string[]) => GhResult | undefined = () => undefined,
) {
  return createFakeGh(
    (args) =>
      override(args) ??
      (args.includes("POST") ? ok() : undefined) ??
      codeScanningAnswer(args, state) ??
      (args.some((a) => a.includes("/contents/"))
        ? ok()
        : ok(JSON.stringify(listed))),
  );
}

function writes(gh: ReturnType<typeof createFakeGh>, method: string) {
  return gh.calls.filter((call) => call.args.includes(method));
}

async function offer(
  gh: ReturnType<typeof createFakeGh>,
  answer: ConfirmResult = "yes",
) {
  const questions: string[] = [];
  const ctx = createFakeContext({
    gh,
    prompt: {
      isInteractive: () => answer !== "no-terminal",
      confirm: (question) => {
        questions.push(question);
        return Promise.resolve(answer);
      },
    },
  });
  const outcome = await offerProtection(ctx, "/repo", origin);
  return { outcome, questions };
}

void test("codeScanningRule: CodeQL, blocking on errors and on high or critical security alerts, as temple-bar's own `main` ruleset has", () => {
  assert.deepEqual(codeScanningRule(), CODEQL_RULE);
});

void test("CodeQL off: the one question names it, and a yes turns on default setup and says to run setup again", async () => {
  const gh = github("off");
  const { outcome, questions } = await offer(gh);
  assert.deepEqual(questions, [
    protectionQuestion({
      main: false,
      judge: false,
      turnOnCodeQl: true,
      requireCodeQl: false,
    }),
  ]);
  assert.match(questions[0] ?? "", /turn on CodeQL code scanning/);
  const [patch] = writes(gh, "PATCH");
  assert.deepEqual(patch?.args, [
    "api",
    "--method",
    "PATCH",
    "repos/acme/widgets/code-scanning/default-setup",
    "--input",
    "-",
  ]);
  assert.deepEqual(JSON.parse(patch.input ?? "null"), { state: "configured" });
  assert.equal(outcome.kind, "created");
  assert.match(outcome.message, /Turned on CodeQL code scanning/);
  assert.match(outcome.message, /`pnpm exec temple-bar init` again/);
  assert.equal(writes(gh, "PUT").length, 0, "not required before analysing");
});

void test("CodeQL on but not yet analysed: nothing asked or changed, and it says to run setup again", async () => {
  const gh = github("waiting");
  const { outcome, questions } = await offer(gh);
  assert.deepEqual(questions, []);
  assert.equal(outcome.kind, "exists");
  assert.match(outcome.message, /CodeQL isn't required yet/);
  assert.equal(writes(gh, "PATCH").length + writes(gh, "PUT").length, 0);
});

void test("CodeQL analysed: a yes adds its rule to setup's `main` ruleset, keeping the rules it has", async () => {
  const gh = github("analysed");
  const { outcome, questions } = await offer(gh);
  assert.match(questions[0] ?? "", /add to the `main` ruleset: CodeQL's/);
  const [put] = writes(gh, "PUT");
  assert.equal(
    put?.args[3],
    `repos/acme/widgets/rulesets/${String(MAIN_RULESET_ID)}`,
  );
  assert.deepEqual(JSON.parse(put.input ?? "null"), {
    rules: [
      { type: "deletion" },
      {
        type: "pull_request",
        parameters: { allowed_merge_methods: ["squash"] },
      },
      codeScanningRule(),
    ],
  });
  assert.equal(outcome.kind, "created");
  assert.match(outcome.message, /Required CodeQL's results/);
});

void test("CodeQL analysed and no `main` ruleset yet: its rule goes into the ruleset being created", async () => {
  const gh = github("analysed", [JUDGE]);
  const { outcome, questions } = await offer(gh);
  assert.match(
    questions[0] ?? "",
    /create the `main` ruleset \(.*CodeQL's results required/,
  );
  const [post] = writes(gh, "POST");
  const body = rulesetBody();
  assert.deepEqual(JSON.parse(post?.input ?? "null"), {
    ...body,
    rules: [...body.rules, codeScanningRule()],
  });
  assert.equal(writes(gh, "PUT").length, 0);
  assert.equal(outcome.kind, "created");
});

void test("CodeQL analysed but the branch's ruleset isn't setup's: left alone, with the steps, and setup ends non-zero", async () => {
  const gh = github("analysed", [
    { id: 9, target: "branch", name: "ours" },
    JUDGE,
  ]);
  const { outcome, questions } = await offer(gh);
  assert.deepEqual(questions, []);
  assert.equal(outcome.kind, "not-created");
  assert.match(outcome.message, /isn't one setup created/);
  assert.match(outcome.message, /requires code scanning results from CodeQL/);
  assert.equal(writes(gh, "PUT").length, 0);
});

void test("CodeQL already required: nothing asked, and nothing about CodeQL said", async () => {
  const gh = github("required");
  const { outcome, questions } = await offer(gh);
  assert.deepEqual(questions, []);
  assert.equal(outcome.kind, "exists");
  assert.doesNotMatch(outcome.message, /CodeQL/);
  assert.equal(
    gh.calls.filter((call) =>
      call.args.some((a) => a.includes("/code-scanning/")),
    ).length,
    0,
    "a required rule needs no further reads",
  );
});

void test("a private repository: CodeQL is explained and left off, never asked about", async () => {
  const gh = github("private");
  const { outcome, questions } = await offer(gh);
  assert.deepEqual(questions, []);
  assert.equal(outcome.kind, "exists");
  assert.match(outcome.message, /free only on public repositories/);
  assert.equal(writes(gh, "PATCH").length, 0);
});

void test("one yes covers everything at once, and the question names it all", async () => {
  const gh = github("off", []);
  const { outcome, questions } = await offer(gh);
  assert.equal(questions.length, 1);
  assert.equal(
    questions[0],
    "On GitHub now, create the `main` ruleset (pull request required, " +
      "squash merges only, linear history, signed commits, no force-push, " +
      "no deletion, no bypass), create the judge's ruleset (the judge's " +
      "check required, and branches up to date with `main`), and turn on " +
      "CodeQL code scanning (GitHub's default setup; its results are " +
      "required on a later run, once it has analysed the default branch)?",
  );
  assert.equal(writes(gh, "POST").length, 2);
  assert.equal(writes(gh, "PATCH").length, 1);
  assert.match(
    outcome.message,
    /Created the "main: pull requests only" and "main: the judge" rulesets/,
  );
  assert.match(outcome.message, /Turned on CodeQL/);
});

void test("a no changes nothing and says how to turn CodeQL on by hand", async () => {
  const gh = github("off");
  const { outcome } = await offer(gh, "no");
  assert.equal(outcome.kind, "declined");
  assert.match(outcome.message, /Settings > Advanced Security/);
  assert.equal(writes(gh, "PATCH").length, 0);
});

void test("no terminal changes nothing and names the flag an agent passes after asking", async () => {
  const gh = github("off");
  const { outcome } = await offer(gh, "no-terminal");
  assert.equal(outcome.kind, "not-created");
  assert.match(outcome.message, /`pnpm exec temple-bar init --create-ruleset`/);
  assert.equal(writes(gh, "PATCH").length, 0);
});

void test("nothing CodeQL can analyse yet (GitHub's 422) is a later run's job, not a failure", async () => {
  const gh = github("off", [MAIN, JUDGE], (args) =>
    args.includes("PATCH")
      ? {
          code: 1,
          stdout: "",
          stderr: "gh: not in the required state (HTTP 422)",
          notFound: false,
        }
      : undefined,
  );
  const { outcome } = await offer(gh);
  assert.equal(outcome.kind, "created");
  assert.match(outcome.message, /no code it can analyse/);
  assert.match(outcome.message, /`pnpm exec temple-bar init` again/);
});

void test("turning CodeQL on failing otherwise ends setup non-zero, with GitHub's error and the steps", async () => {
  const gh = github("off", [MAIN, JUDGE], (args) =>
    args.includes("PATCH")
      ? {
          code: 1,
          stdout: "",
          stderr: "gh: Must have admin rights (HTTP 403)",
          notFound: false,
        }
      : undefined,
  );
  const { outcome } = await offer(gh);
  assert.equal(outcome.kind, "not-created");
  assert.match(
    outcome.message,
    /^Turning on CodeQL failed:\ngh: Must have admin rights/,
  );
  assert.match(
    outcome.message,
    /To do the rest yourself:\nOn GitHub, under Settings > Advanced Security/,
  );
});

void test("CodeQL's state unreadable: the rulesets still go ahead, and setup ends non-zero saying why", async () => {
  const gh = github("off", [], (args) =>
    args.some((a) => a.endsWith("/code-scanning/default-setup")) &&
    !args.includes("PATCH")
      ? {
          code: 1,
          stdout: "",
          stderr: "gh: Bad credentials (HTTP 401)",
          notFound: false,
        }
      : undefined,
  );
  const { outcome } = await offer(gh);
  assert.equal(writes(gh, "POST").length, 2);
  assert.equal(writes(gh, "PATCH").length, 0);
  assert.equal(outcome.kind, "not-created");
  assert.match(outcome.message, /Couldn't read CodeQL's state from GitHub/);
  assert.match(outcome.message, /Bad credentials/);
});

void test("CodeQL analysed and the `main` ruleset already scans with another tool: CodeQL joins that rule, not a second one", async () => {
  const semgrep = { tool: "Semgrep", alerts_threshold: "all" };
  const gh = github("analysed", [MAIN, JUDGE], (args) =>
    args.includes(`repos/acme/widgets/rulesets/${String(MAIN_RULESET_ID)}`) &&
    !args.includes("PUT")
      ? ok(
          JSON.stringify({
            rules: [
              { type: "deletion" },
              {
                type: "code_scanning",
                parameters: { code_scanning_tools: [semgrep] },
              },
            ],
          }),
        )
      : undefined,
  );
  await offer(gh);
  const [put] = writes(gh, "PUT");
  assert.ok(put);
  assert.deepEqual(JSON.parse(put.input ?? "null"), {
    rules: [
      { type: "deletion" },
      {
        type: "code_scanning",
        parameters: {
          code_scanning_tools: [
            semgrep,
            ...(codeScanningRule().parameters
              ?.code_scanning_tools as unknown[]),
          ],
        },
      },
    ],
  });
});
