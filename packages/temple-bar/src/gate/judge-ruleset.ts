// The gate's judge check: the default branch must require the judge's check
// (see docs/adr/0011-which-checks-judge-a-pull-request.md). Without that
// rule, a pull request that weakens its own CI can merge on that CI's say-so,
// and nothing else would notice the rule had gone.
//
// It reads the same answer as the branch ruleset check (ruleset.ts), so it
// costs one more request only when the rule is missing: then it asks GitHub
// whether the judge workflow is on the default branch yet, since the rule
// can't exist before the workflow does. Requiring a check that never runs
// would block every pull request, the one adding the workflow included.

import path from "node:path";

import type { Context } from "../context.ts";
import {
  judgeRulesetBody,
  MANUAL_JUDGE_RULESET_STEPS,
} from "../init/judge-ruleset.ts";
import { RERUN_INIT, rerunInit } from "../init/requirements.ts";
import { JUDGE_WORKFLOW_PATH } from "../judge/workflow.ts";
import type { CheckOutcome } from "./report.ts";
import type { EffectiveRule } from "./ruleset-compare.ts";

export const JUDGE_RULESET_CHECK = "judge ruleset";

type Fields = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The checks a required_status_checks rule lists; none for other rules. */
function requiredChecks(rule: {
  readonly type: string;
  readonly parameters?: Fields;
}): Fields[] {
  const listed: unknown =
    rule.type === "required_status_checks"
      ? rule.parameters?.required_status_checks
      : undefined;
  return Array.isArray(listed) ? listed.filter(isRecord) : [];
}

/** The check setup requires, and how: read from setup's own ruleset body,
 * so this can't drift from what setup creates. */
function expected(): { readonly check: Fields; readonly strict: unknown } {
  const rule = judgeRulesetBody().rules.find(
    (entry) => requiredChecks(entry).length > 0,
  );
  const [check] = rule === undefined ? [] : requiredChecks(rule);
  if (rule === undefined || check === undefined) {
    throw new Error("the judge's ruleset requires no check");
  }
  return {
    check,
    strict: rule.parameters?.strict_required_status_checks_policy,
  };
}

export interface JudgeRuleProblem {
  readonly kind: "missing" | "weakened";
  readonly message: string;
}

/**
 * What is wrong with how the default branch requires the judge's check:
 * undefined when some active rule requires it as setup does. Other rulesets
 * may require other checks; only one rule needs to carry the judge's.
 */
export function findJudgeRuleProblem(
  rules: readonly EffectiveRule[],
): JudgeRuleProblem | undefined {
  const want = expected();
  const name = String(want.check.context);
  const carrying = rules.filter((rule) =>
    requiredChecks(rule).some((check) => check.context === want.check.context),
  );
  if (carrying.length === 0) {
    return { kind: "missing", message: `nothing requires the "${name}" check` };
  }
  // From GitHub Actions only, so a status anything else posts can't stand
  // in for it; and on up-to-date branches, so the judge saw what lands.
  const sound = carrying.some(
    (rule) =>
      rule.parameters?.strict_required_status_checks_policy === want.strict &&
      requiredChecks(rule).some(
        (check) =>
          check.context === want.check.context &&
          check.integration_id === want.check.integration_id,
      ),
  );
  return sound
    ? undefined
    : {
        kind: "weakened",
        message: `the "${name}" check must come from GitHub Actions, on branches up to date before merging`,
      };
}

/** Where a workflow is: already on the default branch, only in this
 * checkout (on its way there), or nowhere yet. */
type WorkflowPlace = "default-branch" | "this-checkout" | "nowhere";

export type WorkflowLookup =
  | { readonly ok: true; readonly place: WorkflowPlace }
  | { readonly ok: false; readonly reason: string };

/** Asks GitHub whether a workflow is on `branch`, and the disk
 * whether this checkout carries it. */
export async function findWorkflow(
  ctx: Context,
  repoUrl: string,
  branch: string,
  token: string | undefined,
  workflowPath: string,
): Promise<WorkflowLookup> {
  const reply = await ctx.http.get(
    `${repoUrl}/contents/${workflowPath}?ref=${encodeURIComponent(branch)}`,
    token,
  );
  if (reply.kind === "network-error") {
    return { ok: false, reason: reply.message };
  }
  if (reply.status === 200) {
    return { ok: true, place: "default-branch" };
  }
  if (reply.status !== 404) {
    return { ok: false, reason: `GitHub answered ${String(reply.status)}` };
  }
  const here = await ctx.fs.exists(
    path.join(ctx.cwd, ...workflowPath.split("/")),
  );
  return { ok: true, place: here ? "this-checkout" : "nowhere" };
}

function failed(ctx: Context, detail: string, message: string): CheckOutcome {
  ctx.stderr.write(message);
  return { name: JUDGE_RULESET_CHECK, status: "failed", detail };
}

function manualSteps(): string {
  return MANUAL_JUDGE_RULESET_STEPS.split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

/** The outcome once the rules are read. `workflow` is asked only when the
 * rule is missing. */
export async function judgeRulesetOutcome(
  ctx: Context,
  rules: readonly EffectiveRule[],
  workflow: () => Promise<WorkflowLookup>,
): Promise<CheckOutcome> {
  const problem = findJudgeRuleProblem(rules);
  if (problem === undefined) {
    return {
      name: JUDGE_RULESET_CHECK,
      status: "passed",
      detail: "the default branch requires the judge's check",
    };
  }
  if (problem.kind === "weakened") {
    return failed(
      ctx,
      "weakened",
      `gate: the judge's ruleset is weakened: ${problem.message}.\n` +
        "  fix: edit it by hand, under Settings > Rules > Rulesets, to match:\n" +
        `${manualSteps()}\n`,
    );
  }
  const found = await workflow();
  if (!found.ok) {
    // Unknown is not a pass: the rule is missing either way, and only
    // whether that is expected yet is in doubt.
    return failed(
      ctx,
      `missing; could not read GitHub: ${found.reason}`,
      `gate: the judge's ruleset is missing (${problem.message}), and GitHub ` +
        `couldn't say whether ${JUDGE_WORKFLOW_PATH} is on the default ` +
        `branch yet: ${found.reason}\n`,
    );
  }
  if (found.place === "this-checkout") {
    return {
      name: JUDGE_RULESET_CHECK,
      status: "skipped",
      detail: `${JUDGE_WORKFLOW_PATH} is on its way to the default branch; once it lands, run setup again to require its check`,
    };
  }
  if (found.place === "nowhere") {
    return failed(
      ctx,
      "no judge workflow",
      `gate: the judge isn't set up: ${JUDGE_WORKFLOW_PATH} is neither on ` +
        "the default branch nor here, so nothing stops a pull request that " +
        "weakens its own CI.\n" +
        `  fix: run ${RERUN_INIT} to write it, land it through a pull ` +
        "request, then run setup again to require its check.\n",
    );
  }
  return failed(
    ctx,
    "missing",
    `gate: the judge's ruleset is missing: ${problem.message} on the ` +
      "default branch, so a pull request that weakens its own CI could " +
      "merge on that CI's say-so.\n" +
      `  fix: run ${rerunInit("--create-ruleset")} once the user agrees, ` +
      "or add it by hand:\n" +
      `${manualSteps()}\n`,
  );
}
