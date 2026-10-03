// `temple-bar gate`: the merge gate. Runs the project's four stack scripts
// (typecheck, lint, format:check, test), the file-length cap and the other
// base checks, and combines them into one exit code:
//
//   0  everything passes
//   1  a check failed (stack script(s), a base check, or both)
//   2  the repo has content of its own, and a required script is missing
//      from package.json or does nothing
//
// Exit 2 takes priority over 1: a repo whose scripts can't check anything
// has a setup problem to fix first. Even then, every required script that
// does exist still runs, and so does every base check, so one missing
// script never hides another script's failures. A repo with only its
// starting files (see ownContentExists) must still be able to pass on the
// base checks alone, so those always run and are judged on their own.
//
// Every run ends with the same report, pass or fail: each check and its
// outcome, then the verdict (see report.ts).

import type { CommandEntry } from "../registry.ts";
import type { Context } from "../context.ts";
import {
  checkAgentsSize,
  formatAgentsSizeFailure,
  AGENTS_FILE,
  AGENTS_MAX_BYTES,
  AGENTS_MAX_LINES,
} from "./agents-size.ts";
import { runCoreCheck } from "./core.ts";
import { checkFileLengths, formatLengthFailure } from "./lengths.ts";
import { runRulesetCheck } from "./ruleset.ts";
import { writeReport, type CheckOutcome } from "./report.ts";
import {
  detectPackageManager,
  isNoOpScript,
  missingRequiredScripts,
  ownContentExists,
  readPackageManifest,
  runRequiredScripts,
  REQUIRED_SCRIPTS,
  SCRIPT_PURPOSE,
  type RequiredScript,
} from "./stack.ts";

const LENGTH_CHECK = "file-length cap";
const AGENTS_SIZE_CHECK = "AGENTS.md size";

function formatMissingScripts(missing: readonly RequiredScript[]): string {
  const lines = [
    `gate: the repo has files of its own, but package.json is missing script(s): ${missing.join(", ")}`,
  ];
  for (const name of missing) {
    lines.push(
      `  add "${name}" to "scripts" in package.json: ${SCRIPT_PURPOSE[name]}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function formatNoOpScripts(
  noOps: readonly { name: RequiredScript; command: string }[],
): string {
  const lines = [
    `gate: package.json has script(s) that check nothing: ${noOps.map(({ name }) => name).join(", ")}`,
  ];
  for (const { name, command } of noOps) {
    lines.push(
      `  "${name}" is ${JSON.stringify(command)}: replace it with ${SCRIPT_PURPOSE[name]}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

interface StackResult {
  readonly outcomes: CheckOutcome[];
  /** A required script is missing or does nothing, so the gate exits 2. */
  readonly scriptsIncomplete: boolean;
}

async function runStackChecks(ctx: Context): Promise<StackResult> {
  const manifest = await readPackageManifest(ctx);
  const missing = missingRequiredScripts(manifest);

  // The scripts are required once the repo has content of its own. Before
  // that there is nothing for them to check, so missing ones aren't a
  // failure. A project that already has all four still gets them run.
  if (missing.length > 0 && !(await ownContentExists(ctx))) {
    return {
      outcomes: REQUIRED_SCRIPTS.map((name) => ({
        name,
        status: "skipped",
        detail: "no content of its own yet",
      })),
      scriptsIncomplete: false,
    };
  }

  // Read as unknown: package.json is user-written, and a script that isn't
  // a string is left for the package manager to reject when it runs.
  const scripts: Readonly<Record<string, unknown>> = manifest?.scripts ?? {};
  const noOps = REQUIRED_SCRIPTS.flatMap((name) => {
    const command = scripts[name];
    return typeof command === "string" && isNoOpScript(command)
      ? [{ name, command }]
      : [];
  });
  const isNoOp = (name: RequiredScript): boolean =>
    noOps.some((noOp) => noOp.name === name);

  // Every script that exists and does something runs, even when another is
  // missing or does nothing, so one gap never hides another script's
  // failures.
  const runnable = REQUIRED_SCRIPTS.filter(
    (name) => !missing.includes(name) && !isNoOp(name),
  );
  const results =
    runnable.length === 0
      ? []
      : await runRequiredScripts(
          ctx,
          await detectPackageManager(ctx, manifest),
          runnable,
        );

  // Written after the scripts' own output, so it isn't buried under it.
  if (missing.length > 0) {
    ctx.stderr.write(formatMissingScripts(missing));
  }
  if (noOps.length > 0) {
    ctx.stderr.write(formatNoOpScripts(noOps));
  }

  return {
    outcomes: REQUIRED_SCRIPTS.map((name): CheckOutcome => {
      const noOp = noOps.find((entry) => entry.name === name);
      if (noOp !== undefined) {
        return { name, status: "no-op", detail: JSON.stringify(noOp.command) };
      }
      const result = results.find((entry) => entry.script === name);
      if (result === undefined) {
        return { name, status: "missing", detail: "not in package.json" };
      }
      return result.exitCode === 0
        ? { name, status: "passed" }
        : {
            name,
            status: "failed",
            detail: `exit ${String(result.exitCode)}`,
          };
    }),
    scriptsIncomplete: missing.length > 0 || noOps.length > 0,
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

async function runAgentsSizeCheck(ctx: Context): Promise<CheckOutcome> {
  const result = await checkAgentsSize(ctx);
  if (!result.found) {
    // Setup writes AGENTS.md, but a docs-only or mid-setup repo may not have
    // one yet; absence is not an oversized file.
    return {
      name: AGENTS_SIZE_CHECK,
      status: "skipped",
      detail: `no ${AGENTS_FILE}`,
    };
  }
  if (result.overLines || result.overBytes) {
    ctx.stderr.write(formatAgentsSizeFailure(result));
    return {
      name: AGENTS_SIZE_CHECK,
      status: "failed",
      detail: `${String(result.lines)} lines, ${String(result.bytes)} bytes`,
    };
  }
  return {
    name: AGENTS_SIZE_CHECK,
    status: "passed",
    detail: `${String(result.lines)}/${String(AGENTS_MAX_LINES)} lines, ${String(result.bytes)}/${String(AGENTS_MAX_BYTES)} bytes`,
  };
}

async function runGate(ctx: Context): Promise<number> {
  const stack = await runStackChecks(ctx);
  const outcomes = [
    ...stack.outcomes,
    await runCoreCheck(ctx),
    await runLengthCheck(ctx),
    await runAgentsSizeCheck(ctx),
    await runRulesetCheck(ctx),
  ];
  writeReport(ctx, outcomes);

  if (stack.scriptsIncomplete) {
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
  summary:
    "Run the merge gate: stack checks, the file-length cap, the AGENTS.md size limit and the branch ruleset.",
  details: [
    "Once the repo has files of its own (beyond package.json, the lockfile,",
    "AGENTS.md, .gitignore, README.md, LICENSE and temple-bar.config.json),",
    "requires these package.json scripts and runs every one that exists:",
    `${REQUIRED_SCRIPTS.join(", ")}. A script that does nothing (such as`,
    "`true` or a bare `echo`) fails. Checks that what setup installs is",
    "still in place: the git hooks (unchanged, by SHA-256), core.hooksPath",
    "unset, pull.ff=only, setup's .gitignore lines and its prepare and gate",
    "scripts. Then checks every tracked text file",
    "against the file-length cap (maxFileLines in temple-bar.config.json).",
    "Also checks AGENTS.md stays within 200 lines and 32 KiB (skipped when",
    "there is no AGENTS.md). Reads GitHub's rules for the default branch and",
    "fails if setup's rules are missing or weakened (public repos only; a",
    "private repo, no GitHub origin or no network is skipped, except in",
    "GitHub Actions, where an unreachable API fails). In GitHub Actions it",
    "needs GH_TOKEN (GH_TOKEN: ${{ github.token }} on the gate step) and",
    "fails without one. Ends by listing each check and its outcome.",
    "",
    "Exit codes: 0 every check passed, 1 a check failed,",
    "2 a required script is missing from package.json or does nothing.",
  ].join("\n"),
  run: (_args, ctx) => runGateSafely(ctx),
};
