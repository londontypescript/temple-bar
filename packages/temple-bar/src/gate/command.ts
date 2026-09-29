// `temple-bar gate`: the merge gate (subtask 1.6). Runs the project's stack
// checks (typecheck/lint/format:check/test, D2/P3.3/decision 23) and the
// file-length cap (always, P3.1), and combines them into one exit code:
//
//   0  everything passes
//   1  a check failed (stack script(s), the length cap, or both)
//   2  code exists but a required script is missing from package.json (D2)
//
// Exit 2 takes priority over 1: a repo that can't even run the suite is a
// stack problem to fix first, not a body of failures to summarise. The
// length cap still runs and is still reported in that case (P1.6: a
// docs-only/mid-setup repo must be able to pass on the base check alone,
// which only works if the base check always runs and is judged on its own).
//
// Every run ends with the same report, pass or fail: each check and its
// outcome, then the verdict (report.ts, decision 20).

import type { CommandEntry } from "../registry.ts";
import type { Context } from "../context.ts";
import { checkFileLengths, formatLengthFailure } from "./lengths.ts";
import { writeReport, type CheckOutcome } from "./report.ts";
import {
  codeExists,
  detectPackageManager,
  missingRequiredScripts,
  readPackageManifest,
  runRequiredScripts,
  REQUIRED_SCRIPTS,
} from "./stack.ts";

const LENGTH_CHECK = "file-length cap";

function formatMissingScripts(missing: readonly string[]): string {
  const lines = [
    `gate: code exists but package.json is missing script(s): ${missing.join(", ")}`,
  ];
  for (const name of missing) {
    lines.push(`  add "${name}" to "scripts" in package.json`);
  }
  return `${lines.join("\n")}\n`;
}

interface StackResult {
  readonly outcomes: CheckOutcome[];
  /** Exit 2 (D2): code exists and a required script is missing. */
  readonly missingScripts: boolean;
}

async function runStackChecks(ctx: Context): Promise<StackResult> {
  const manifest = await readPackageManifest(ctx);
  const missing: readonly string[] = missingRequiredScripts(manifest);

  if (missing.length > 0) {
    if (!(await codeExists(ctx))) {
      // No code and no scripts: nothing to run, nothing to fail (P1.6).
      return {
        outcomes: REQUIRED_SCRIPTS.map((name) => ({
          name,
          status: "skipped",
          detail: "no code yet",
        })),
        missingScripts: false,
      };
    }
    ctx.stderr.write(formatMissingScripts(missing));
    return {
      outcomes: REQUIRED_SCRIPTS.map((name) =>
        missing.includes(name)
          ? { name, status: "missing", detail: "not in package.json" }
          : { name, status: "skipped", detail: "a required script is missing" },
      ),
      missingScripts: true,
    };
  }

  // missingRequiredScripts only returns [] when every required script is
  // present, which requires a manifest to have been found.
  const manager = await detectPackageManager(ctx, manifest);
  const results = await runRequiredScripts(ctx, manager, REQUIRED_SCRIPTS);
  return {
    outcomes: results.map(({ script, exitCode }) =>
      exitCode === 0
        ? { name: script, status: "passed" }
        : {
            name: script,
            status: "failed",
            detail: `exit ${String(exitCode)}`,
          },
    ),
    missingScripts: false,
  };
}

async function runLengthCheck(ctx: Context): Promise<CheckOutcome> {
  const result = await checkFileLengths(ctx);
  const cap = `${String(result.maxLines)}-line cap`;
  if (result.offenders.length > 0) {
    ctx.stderr.write(formatLengthFailure(result));
    return {
      name: LENGTH_CHECK,
      status: "failed",
      detail: `${String(result.offenders.length)} file(s) over the ${cap}`,
    };
  }
  return {
    name: LENGTH_CHECK,
    status: "passed",
    detail: `all ${String(result.totalChecked)} tracked text file(s) are within the ${cap}`,
  };
}

async function runGate(ctx: Context): Promise<number> {
  const stack = await runStackChecks(ctx);
  const outcomes = [...stack.outcomes, await runLengthCheck(ctx)];
  writeReport(ctx, outcomes);

  if (stack.missingScripts) {
    return 2;
  }
  return outcomes.some((outcome) => outcome.status === "failed") ? 1 : 0;
}

// Anything the gate can't determine (git failing, an unreadable config) is
// a failure with a message, never a pass.
async function runGateSafely(ctx: Context): Promise<number> {
  try {
    return await runGate(ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(`gate: ${message}\n`);
    return 1;
  }
}

export const gateCommand: CommandEntry = {
  name: "gate",
  summary: "Run the merge gate: stack checks and the file-length cap.",
  details: [
    "Once the project has code, runs these package.json scripts in order:",
    `${REQUIRED_SCRIPTS.join(", ")}. Then checks every tracked text file`,
    "against the file-length cap (maxFileLines in temple-bar.config.json).",
    "Ends by listing each check and its outcome.",
    "",
    "Exit codes: 0 every check passed, 1 a check failed,",
    "2 code exists but a required script is missing from package.json.",
  ].join("\n"),
  run: (_args, ctx) => runGateSafely(ctx),
};
