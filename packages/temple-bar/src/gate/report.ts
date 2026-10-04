// The gate's closing report: one line per check with its outcome, then a
// verdict. Pass and fail share the same shape, and a passing gate lists the
// checks that ran, so a reader never has to infer what was checked from
// silence.

import type { Context } from "../context.ts";

/**
 * - passed / failed: the check ran and this is its result.
 * - missing: a required script isn't in package.json, so it couldn't run.
 * - no-op: a required script's command does nothing, so it wasn't run.
 * - skipped: deliberately not run (the repo has no content of its own yet,
 *   or the check doesn't apply here); never a failure on its own.
 */
type CheckStatus = "passed" | "failed" | "missing" | "no-op" | "skipped";

export interface CheckOutcome {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail?: string;
}

function isFailure(outcome: CheckOutcome): boolean {
  return (
    outcome.status === "failed" ||
    outcome.status === "missing" ||
    outcome.status === "no-op"
  );
}

/** The report text, and whether it describes a failure. */
function formatReport(outcomes: readonly CheckOutcome[]): {
  readonly text: string;
  readonly failed: boolean;
} {
  const width = Math.max(...outcomes.map((outcome) => outcome.status.length));
  const lines = ["gate: checks:"];
  for (const outcome of outcomes) {
    const detail = outcome.detail === undefined ? "" : ` (${outcome.detail})`;
    lines.push(`  ${outcome.status.padEnd(width)}  ${outcome.name}${detail}`);
  }

  const failures = outcomes.filter(isFailure);
  lines.push(
    failures.length === 0
      ? "gate: passed"
      : `gate: failed: ${failures.map((outcome) => outcome.name).join(", ")}`,
  );
  return { text: `${lines.join("\n")}\n`, failed: failures.length > 0 };
}

/** A passing report goes to stdout, a failing one to stderr, where the
 * gate's failure messages have always gone. */
export function writeReport(
  ctx: Context,
  outcomes: readonly CheckOutcome[],
): void {
  const report = formatReport(outcomes);
  (report.failed ? ctx.stderr : ctx.stdout).write(report.text);
}
