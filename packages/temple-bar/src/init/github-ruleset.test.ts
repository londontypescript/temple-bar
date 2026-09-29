import assert from "node:assert/strict";
import test from "node:test";

import { offerRuleset, rulesetBody } from "./github-ruleset.ts";
import {
  createFakeContext,
  createFakeGh,
  createFakePrompt,
} from "../testing/fakes.ts";
import type { GhResult } from "../seams/gh.ts";

const origin = { owner: "acme", repo: "widgets" };

const ok = (stdout = ""): GhResult => ({
  code: 0,
  stdout,
  stderr: "",
  notFound: false,
});

/** No rulesets listed yet; the create call returns `create`. */
function ghWithNoRulesets(create: GhResult = ok()) {
  return createFakeGh((args) => (args.includes("POST") ? create : ok("[]")));
}

function createCalls(gh: ReturnType<typeof createFakeGh>) {
  return gh.calls.filter((call) => call.args.includes("POST"));
}

void test("rulesetBody: the pull_request rule itself requires 0 approvals, and force-push and deletion are blocked on the default branch with no bypass", () => {
  const body = rulesetBody() as {
    bypass_actors: unknown[];
    conditions: { ref_name: { include: string[]; exclude: string[] } };
    rules: { type: string; parameters?: Record<string, unknown> }[];
  };

  assert.deepEqual(body.bypass_actors, []);
  assert.deepEqual(body.conditions.ref_name, {
    include: ["~DEFAULT_BRANCH"],
    exclude: [],
  });
  assert.deepEqual(body.rules.map((rule) => rule.type).sort(), [
    "deletion",
    "non_fast_forward",
    "pull_request",
  ]);
  const pullRequest = body.rules.find((rule) => rule.type === "pull_request");
  assert.equal(pullRequest?.parameters?.required_approving_review_count, 0);
});

void test("offerRuleset: an existing branch ruleset is left alone, no prompt asked", async () => {
  const gh = createFakeGh(() => ok(JSON.stringify([{ target: "branch" }])));
  let asked = false;
  const ctx = createFakeContext({
    gh,
    prompt: {
      isInteractive: () => true,
      confirm: () => {
        asked = true;
        return Promise.resolve("yes");
      },
    },
  });

  const outcome = await offerRuleset(ctx, "/repo", origin);

  assert.equal(outcome.kind, "exists");
  assert.equal(asked, false);
  assert.equal(createCalls(gh).length, 0);
});

void test("offerRuleset: an explicit yes sends the ruleset body as JSON on stdin", async () => {
  const gh = ghWithNoRulesets();
  const ctx = createFakeContext({
    gh,
    prompt: createFakePrompt({ interactive: true, answer: "yes" }),
  });

  const outcome = await offerRuleset(ctx, "/repo", origin);

  assert.equal(outcome.kind, "created");
  const [create] = createCalls(gh);
  assert.deepEqual(create?.args, [
    "api",
    "--method",
    "POST",
    "repos/acme/widgets/rulesets",
    "--input",
    "-",
  ]);
  assert.deepEqual(JSON.parse(create.input ?? "null"), rulesetBody());
});

void test("offerRuleset: a no is the user's choice, prints the steps and never creates", async () => {
  const gh = ghWithNoRulesets();
  const ctx = createFakeContext({
    gh,
    prompt: createFakePrompt({ interactive: true, answer: "no" }),
  });

  const outcome = await offerRuleset(ctx, "/repo", origin);

  assert.equal(outcome.kind, "declined");
  assert.match(outcome.message, /Settings > Rules > Rulesets/);
  assert.equal(createCalls(gh).length, 0);
});

void test("offerRuleset: no terminal is not-created (init ends non-zero) and never creates", async () => {
  const gh = ghWithNoRulesets();
  const ctx = createFakeContext({
    gh,
    prompt: createFakePrompt({ interactive: false, answer: "no-terminal" }),
  });

  const outcome = await offerRuleset(ctx, "/repo", origin);

  assert.equal(outcome.kind, "not-created");
  assert.match(outcome.message, /Settings > Rules > Rulesets/);
  assert.equal(createCalls(gh).length, 0);
});

void test("offerRuleset: a failed create (e.g. not an admin) is not-created and shows gh's error", async () => {
  const gh = ghWithNoRulesets({
    code: 1,
    stdout: "",
    stderr: "HTTP 404: Not Found",
    notFound: false,
  });
  const ctx = createFakeContext({
    gh,
    prompt: createFakePrompt({ interactive: true, answer: "yes" }),
  });

  const outcome = await offerRuleset(ctx, "/repo", origin);

  assert.equal(outcome.kind, "not-created");
  assert.match(outcome.message, /HTTP 404: Not Found/);
  assert.match(outcome.message, /Settings > Rules > Rulesets/);
});
