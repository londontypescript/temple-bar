// The gate reads effective rules, which show required checks but no bypass
// list. It can prove the gate and title checks are required, but cannot
// prove nobody may bypass them. Offline, workflow-copies.ts checks only
// the fixed workflow text; live requirements need GitHub's effective rules.

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
          `${check === REQUIRED_CHECKS[0] ? "gate" : "title check"} failed or never reported can merge.\n` +
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
      detail: `${waiting.join(" and ")} on its way to the default branch; setup's pull request hasn't landed yet; once it has, run setup again to require the checks`,
    };
  }
  return {
    name: REQUIRED_CHECKS_CHECK,
    status: "passed",
    detail: "the default branch requires the gate and title checks",
  };
}
