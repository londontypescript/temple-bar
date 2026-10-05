// The gate's code scanning check: the default branch must require CodeQL's
// results, at least as strictly as setup does. Without that rule a pull
// request can merge with CodeQL's alerts open, or unscanned.
//
// It reads the same answer as the branch ruleset check (ruleset.ts). The
// rule can't exist before CodeQL has analysed the default branch, but
// whether it has is something CI's token can't read. So the one exception
// is the setup pull request itself: while the judge workflow is in this
// checkout but not yet on the default branch, setup hasn't finished, and
// its later run is what adds the rule. That exception can't be used to drop
// the rule: taking the judge workflow off the default branch is itself a
// change the judge refuses.

import type { Context } from "../context.ts";
import {
  codeScanningRule,
  MANUAL_CODE_SCANNING_RULE_STEPS,
} from "../init/code-scanning.ts";
import { rerunInit } from "../init/requirements.ts";
import type { WorkflowLookup } from "./judge-ruleset.ts";
import type { CheckOutcome } from "./report.ts";
import type { EffectiveRule } from "./ruleset-compare.ts";

export const CODE_SCANNING_CHECK = "code scanning rule";

type Fields = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolsOf(rule: {
  readonly type: string;
  readonly parameters?: Fields;
}): Fields[] {
  const listed: unknown =
    rule.type === "code_scanning"
      ? rule.parameters?.code_scanning_tools
      : undefined;
  return Array.isArray(listed) ? listed.filter(isRecord) : [];
}

// Each threshold's settings from loosest to strictest: a later one blocks a
// merge on more alerts, so it meets a bar set by an earlier one.
const ORDER: Readonly<Record<string, readonly string[]>> = {
  alerts_threshold: ["none", "errors", "errors_and_warnings", "all"],
  security_alerts_threshold: [
    "none",
    "critical",
    "high_or_higher",
    "medium_or_higher",
    "all",
  ],
};

/** The CodeQL entry setup requires, read from setup's own rule so this
 * can't drift from what setup creates. */
function expected(): Fields {
  const [tool] = toolsOf(codeScanningRule());
  if (tool === undefined) {
    throw new Error("setup's code scanning rule names no tool");
  }
  return tool;
}

function atLeast(key: string, want: unknown, got: unknown): boolean {
  const order = ORDER[key] ?? [];
  const wantRank = order.indexOf(String(want));
  const gotRank = typeof got === "string" ? order.indexOf(got) : -1;
  return gotRank >= 0 && gotRank >= wantRank;
}

export interface CodeScanningProblem {
  readonly kind: "missing" | "weakened";
  readonly message: string;
}

/**
 * What is wrong with how the default branch requires CodeQL: undefined when
 * some active rule requires it at setup's thresholds or stricter. GitHub
 * enforces every rule that applies, so one strict enough is enough.
 */
export function findCodeScanningProblem(
  rules: readonly EffectiveRule[],
): CodeScanningProblem | undefined {
  const want = expected();
  const entries = rules
    .flatMap((rule) => toolsOf(rule))
    .filter((entry) => entry.tool === want.tool);
  if (entries.length === 0) {
    return {
      kind: "missing",
      message: `nothing requires ${String(want.tool)}'s results`,
    };
  }
  const thresholds = Object.keys(ORDER);
  const sound = entries.some((entry) =>
    thresholds.every((key) => atLeast(key, want[key], entry[key])),
  );
  return sound
    ? undefined
    : {
        kind: "weakened",
        message:
          `${String(want.tool)}'s results must block a merge on ` +
          thresholds
            .map((key) => `${key} ${JSON.stringify(want[key])} or stricter`)
            .join(" and "),
      };
}

function manualSteps(): string {
  return MANUAL_CODE_SCANNING_RULE_STEPS.split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function failed(ctx: Context, detail: string, message: string): CheckOutcome {
  ctx.stderr.write(message);
  return { name: CODE_SCANNING_CHECK, status: "failed", detail };
}

/** The outcome once the rules are read. `workflow` is asked only when the
 * rule is missing. */
export async function codeScanningOutcome(
  ctx: Context,
  rules: readonly EffectiveRule[],
  workflow: () => Promise<WorkflowLookup>,
): Promise<CheckOutcome> {
  const problem = findCodeScanningProblem(rules);
  if (problem === undefined) {
    return {
      name: CODE_SCANNING_CHECK,
      status: "passed",
      detail: "the default branch requires CodeQL's results",
    };
  }
  if (problem.kind === "weakened") {
    return failed(
      ctx,
      "weakened",
      `gate: the default branch's code scanning rule is weakened: ${problem.message}.\n` +
        "  fix: edit it by hand to match:\n" +
        `${manualSteps()}\n`,
    );
  }
  const found = await workflow();
  if (found.ok && found.place === "this-checkout") {
    return {
      name: CODE_SCANNING_CHECK,
      status: "skipped",
      detail:
        "setup's pull request hasn't landed yet; once it has and CodeQL " +
        "has analysed the default branch, run setup again to require it",
    };
  }
  return failed(
    ctx,
    "missing",
    `gate: the default branch doesn't require CodeQL's results (${problem.message}), ` +
      "so a pull request can merge with code scanning alerts open.\n" +
      `  fix: run ${rerunInit("--create-ruleset")} once the user agrees. It ` +
      "turns CodeQL on if it's off, and requires its results once CodeQL " +
      "has analysed the default branch (a later run, if that analysis " +
      "hasn't finished). Or by hand:\n" +
      `${manualSteps()}\n`,
  );
}
