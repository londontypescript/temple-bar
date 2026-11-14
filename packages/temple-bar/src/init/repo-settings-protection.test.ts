// The squash merge defaults inside setup's one question about GitHub: asked
// with everything else the yes covers, set only on that yes, read back, and
// "not finished" whenever they can't be read or didn't take.

import assert from "node:assert/strict";
import test from "node:test";

import type { GhResult } from "../seams/gh.ts";
import { createFakeContext, createFakeGh } from "../testing/fakes.ts";
import { offerProtection } from "./github-protection.ts";
import { manualSquashDefaultsSteps } from "./repo-settings.ts";
import { codeScanningAnswer } from "./testing/code-scanning-fake.ts";
import { error, JUDGE, MAIN, ok } from "./testing/required-checks-world.ts";

const origin = { owner: "acme", repo: "widgets" };

const SQUASH_QUESTION =
  "On GitHub now, set squash merges to default to the pull request's " +
  "title and description as the commit message?";

const repo = (title: string, message: string) =>
  ok({
    private: false,
    default_branch: "main",
    squash_merge_commit_title: title,
    squash_merge_commit_message: message,
  });

const GITHUBS_DEFAULT = repo("COMMIT_OR_PR_TITLE", "COMMIT_MESSAGES");
const SETUPS = repo("PR_TITLE", "PR_BODY");

/** Every ruleset, CodeQL and required check already in place, so the squash
 * defaults are the only thing left; `listed` empties the listing to make
 * the `main` ruleset missing too. */
function world(
  options: {
    before?: GhResult;
    after?: GhResult;
    patch?: GhResult;
    listed?: readonly object[];
    answer?: "yes" | "no" | "no-terminal";
    approved?: boolean;
  } = {},
) {
  const questions: string[] = [];
  let patched = false;
  const gh = createFakeGh((args) => {
    const target = args.find((arg) => arg.startsWith("repos/"));
    if (target === "repos/acme/widgets") {
      if (args.includes("PATCH")) {
        patched = true;
        return options.patch ?? ok();
      }
      return patched
        ? (options.after ?? SETUPS)
        : (options.before ?? GITHUBS_DEFAULT);
    }
    if (args.includes("POST")) return ok();
    if (target === "repos/acme/widgets/rulesets")
      return ok(options.listed ?? [MAIN, JUDGE]);
    if (target?.includes("/contents/")) return ok();
    return (
      codeScanningAnswer(args, "required") ??
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
  const patches = () =>
    gh.calls.filter(
      (call) =>
        call.args.includes("PATCH") && call.args[3] === "repos/acme/widgets",
    );
  return {
    gh,
    questions,
    patches,
    run: () => offerProtection(ctx, "/repo", origin, options.approved),
  };
}

/** Where the squash defaults' write sits among all the calls made. */
function patchIndex(t: ReturnType<typeof world>): number {
  return t.gh.calls.findIndex(
    (call) =>
      call.args.includes("PATCH") && call.args[3] === "repos/acme/widgets",
  );
}

void test("squash defaults already set: no question, nothing changed", async () => {
  const t = world({ before: SETUPS });
  const outcome = await t.run();
  assert.equal(outcome.kind, "exists");
  assert.deepEqual(t.questions, []);
  assert.equal(t.patches().length, 0);
});

void test("GitHub's own defaults: the one question names them, and a yes sets and reads them back", async () => {
  const t = world();
  const outcome = await t.run();
  assert.deepEqual(t.questions, [SQUASH_QUESTION]);
  assert.equal(t.patches().length, 1);
  assert.equal(outcome.kind, "created");
  assert.match(
    outcome.message,
    /Squash merges now default to the pull request's title and description/,
  );
  // Read once to plan, once after the write to check it took.
  const isRead = (call: { args: readonly string[] }) =>
    call.args.length === 2 && call.args[1] === "repos/acme/widgets";
  assert.ok(t.gh.calls.filter(isRead).length >= 2);
  assert.ok(t.gh.calls.findLastIndex(isRead) > patchIndex(t));
});

void test("with the main ruleset missing too, one question covers both, and the ruleset is created first", async () => {
  const t = world({ listed: [JUDGE] });
  const outcome = await t.run();
  assert.equal(t.questions.length, 1);
  assert.match(
    t.questions[0] ?? "",
    /^On GitHub now, create the `main` ruleset/,
  );
  assert.match(
    t.questions[0] ?? "",
    /, and set squash merges to default to the pull request's title and description as the commit message\?$/,
  );
  assert.equal(outcome.kind, "created");
  const post = t.gh.calls.findIndex((call) => call.args.includes("POST"));
  assert.ok(post !== -1 && post < patchIndex(t));
});

void test("the --create-ruleset yes covers the squash defaults without asking", async () => {
  const t = world({ answer: "no-terminal", approved: true });
  const outcome = await t.run();
  assert.deepEqual(t.questions, []);
  assert.equal(t.patches().length, 1);
  assert.equal(outcome.kind, "created");
});

void test("a no changes nothing and gives the manual step", async () => {
  const t = world({ answer: "no" });
  const outcome = await t.run();
  assert.equal(outcome.kind, "declined");
  assert.equal(t.patches().length, 0);
  assert.ok(outcome.message.includes(manualSquashDefaultsSteps(origin)));
});

void test("no terminal changes nothing, names the flag, and gives the manual step", async () => {
  const t = world({ answer: "no-terminal" });
  const outcome = await t.run();
  assert.equal(outcome.kind, "not-created");
  assert.equal(t.patches().length, 0);
  assert.match(outcome.message, /--create-ruleset/);
  assert.ok(outcome.message.includes(manualSquashDefaultsSteps(origin)));
});

void test("unreadable squash settings: nothing asked or changed for them, and setup isn't finished", async () => {
  for (const before of [
    error("gh: Service Unavailable (HTTP 503)"),
    ok({ private: false, default_branch: "main" }),
  ]) {
    const t = world({ before });
    const outcome = await t.run();
    assert.equal(outcome.kind, "not-created", before.stdout || before.stderr);
    assert.deepEqual(t.questions, []);
    assert.equal(t.patches().length, 0);
    assert.match(
      outcome.message,
      /couldn't read the repository's squash merge settings/,
    );
  }
});

void test("a write that fails, or a read-back that still differs, isn't finished", async () => {
  for (const options of [
    { patch: error("gh: Validation Failed (HTTP 422)") },
    { after: GITHUBS_DEFAULT },
  ]) {
    const t = world(options);
    const outcome = await t.run();
    assert.equal(outcome.kind, "not-created");
    assert.ok(outcome.message.includes(manualSquashDefaultsSteps(origin)));
  }
});
