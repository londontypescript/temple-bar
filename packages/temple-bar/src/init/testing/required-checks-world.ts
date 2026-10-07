// A fake GitHub for setup's required-checks tests: rulesets, setup's own
// `main` ruleset, the effective rules and the two workflow lookups. Excluded
// from the build (tsconfig.build.json excludes src/**/testing/**).

import assert from "node:assert/strict";

import type { GhResult } from "../../seams/gh.ts";
import { createFakeContext, createFakeGh } from "../../testing/fakes.ts";
import { offerProtection } from "../github-protection.ts";
import type { RulesetRule } from "../github-ruleset.ts";
import { JUDGE_RULESET_NAME } from "../judge-ruleset.ts";
import {
  GATE_CHECK,
  GATE_WORKFLOW_PATH,
  PR_TITLE_CHECK,
  PR_TITLE_WORKFLOW_PATH,
} from "../workflows.ts";
import {
  CODEQL_RULE,
  codeScanningAnswer,
  type CodeQlState,
} from "./code-scanning-fake.ts";

const origin = { owner: "acme", repo: "widgets" };
export const MAIN = {
  id: 42,
  target: "branch",
  name: "main: pull requests only",
};
export const JUDGE = { id: 7, target: "branch", name: JUDGE_RULESET_NAME };
export const OTHER = { id: 9, target: "branch", name: "project" };
export const BASE = [{ type: "deletion" }, { type: "required_signatures" }];
export const CHECKS: RulesetRule = {
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
export const ok = (body: unknown = {}): GhResult => ({
  code: 0,
  stdout: JSON.stringify(body),
  stderr: "",
  notFound: false,
});
export const error = (stderr: string, stdout = ""): GhResult => ({
  code: 1,
  stdout,
  stderr,
  notFound: false,
});
export const missing = error("gh: Not Found (HTTP 404)");

export function setup(
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
    enforcement?: string;
    /** The rules a second read of setup's ruleset finds: someone edited
     * it while the question was open. */
    rulesLater?: readonly RulesetRule[];
  } = {},
) {
  const questions: string[] = [];
  let rulesetReads = 0;
  const gh = createFakeGh((args) => {
    const target = args.find((arg) => arg.startsWith("repos/"));
    if (args.includes("PUT")) return options.put ?? ok();
    if (args.includes("POST")) return ok();
    if (target === "repos/acme/widgets/rulesets")
      return ok(options.listed ?? [MAIN, JUDGE]);
    if (target === "repos/acme/widgets/rulesets/42") {
      rulesetReads += 1;
      const rules =
        rulesetReads > 1 && options.rulesLater !== undefined
          ? options.rulesLater
          : (options.rules ?? BASE);
      return (
        options.unreadableRules ??
        ok({ rules, enforcement: options.enforcement ?? "active" })
      );
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

export function writes(t: ReturnType<typeof setup>, method = "PUT") {
  return t.gh.calls.filter((call) => call.args.includes(method));
}
export function writtenRules(t: ReturnType<typeof setup>): RulesetRule[] {
  const calls = writes(t);
  assert.equal(calls.length, 1, "one PUT applies the entire ruleset addition");
  assert.equal(calls[0]?.args[3], "repos/acme/widgets/rulesets/42");
  return (JSON.parse(calls[0].input ?? "null") as { rules: RulesetRule[] })
    .rules;
}
