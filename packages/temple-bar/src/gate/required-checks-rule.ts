// The gate's check that the default branch requires the gate and title
// checks, so a pull request whose gate failed, or never reported, can't
// merge. Setup adds each one once its workflow is on the default branch
// (init/required-checks.ts), and this uses setup's own definition of
// "required", so the two can't drift.
//
// What it can't prove: it reads the effective rules, which show what is
// required but not who may bypass it, so it can't tell the checks are in
// the ruleset nobody may bypass. Offline, only the workflow text is
// checked (workflow-copies.ts); this needs GitHub.

import type { Context } from "../context.ts";
import {
  contextIsListed,
  contextIsRequired,
  manualChecksSteps,
  REQUIRED_CHECKS,
} from "../init/required-checks.ts";
import { RERUN_INIT, rerunInit } from "../init/requirements.ts";
import type { WorkflowLookup } from "./judge-ruleset.ts";
import type { CheckOutcome } from "./report.ts";
import type { EffectiveRule } from "./ruleset-compare.ts";

export const REQUIRED_CHECKS_CHECK = "gate and title checks rule";

/** Each context has its own bootstrap: a repository can have the judge
 * already while either of these workflows is still on its way. */
export async function requiredChecksOutcome(
  ctx: Context,
  rules: readonly EffectiveRule[],
  workflow: (path: string) => Promise<WorkflowLookup>,
): Promise<CheckOutcome> {
  const failures: string[] = [];
  const waiting: string[] = [];
  for (const check of REQUIRED_CHECKS) {
    if (contextIsRequired(rules, check.context)) {
      continue;
    }
    const name = `"${check.context}"`;
    const fail = (detail: string, message: string) => {
      failures.push(`${name}: ${detail}`);
      ctx.stderr.write(`gate: ${name} check ${message}\n`);
    };
    const manual = manualChecksSteps([check])
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n");
    if (contextIsListed(rules, check.context)) {
      fail(
        "weakened",
        "rule is weakened: it must come from GitHub Actions, " +
          "on branches up to date before merging.\n  fix: edit it by hand:\n" +
          manual,
      );
      continue;
    }
    const found = await workflow(check.path);
    if (!found.ok) {
      fail(
        `missing; could not read GitHub: ${found.reason}`,
        `rule is missing, and GitHub couldn't say whether ${check.path} is on the default branch: ${found.reason}`,
      );
    } else if (found.place === "this-checkout") {
      waiting.push(`${name} (${check.path})`);
    } else if (found.place === "nowhere") {
      fail(
        "missing; no workflow",
        `rule is missing and ${check.path} is neither on the default branch nor here.\n` +
          `  fix: run ${RERUN_INIT} to write it, land it through a pull request, then run setup again to require its check.`,
      );
    } else {
      fail(
        "missing",
        "rule is missing: a pull request whose " +
          `${check.label} failed or never reported can merge.\n` +
          `  fix: run ${rerunInit("--create-ruleset")} once the user agrees, or edit it by hand:\n${manual}`,
      );
    }
  }
  if (failures.length > 0) {
    return {
      name: REQUIRED_CHECKS_CHECK,
      status: "failed",
      detail: failures.join("; "),
    };
  }
  if (waiting.length > 0) {
    return {
      name: REQUIRED_CHECKS_CHECK,
      status: "skipped",
      detail: `${waiting.join(" and ")}: setup's pull request hasn't landed yet; once it has, run setup again to require ${waiting.length === 1 ? "its check" : "their checks"}`,
    };
  }
  return {
    name: REQUIRED_CHECKS_CHECK,
    status: "passed",
    detail: "the default branch requires the gate and title checks",
  };
}
