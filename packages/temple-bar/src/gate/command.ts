// `temple-bar gate`: the merge gate. Runs the project's four stack scripts
// (typecheck, lint, format:check, test) in the root and in every package of
// a pnpm workspace, the file-length cap and the other base checks, and
// combines them into one exit code:
//
//   0  everything passes
//   1  a check failed (stack script(s), the workspace inventory, a base
//      check, or several)
//   2  a required script is missing from a package.json or does nothing
//      (in the root, only once the repo has content of its own)
//
// Exit 2 takes priority over 1: a repo whose scripts can't check anything
// has a setup problem to fix first. Even then, every required script that
// does exist still runs, and so does every base check, so one missing
// script never hides another script's failures. A repo with only its
// starting files (see ownContentExists) must still be able to pass on the
// base checks alone, so those always run and are judged on their own.
//
// The root's scripts run first, then each workspace package's, in path
// order (packages.ts lists them; package-scripts.ts runs one package's).
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
import {
  checkFileLengths,
  formatLengthFailure,
  listGitPaths,
} from "./lengths.ts";
import { runLinkCheck, runMarkdownLint } from "./markdown.ts";
import { runPackageScripts } from "./package-scripts.ts";
import { takeInventory } from "./packages.ts";
import { runRulesetChecks } from "./ruleset.ts";
import { runUnusedCheck } from "./unused.ts";
import { runWorkflowCopiesCheck } from "./workflow-copies.ts";
import { createRealGateTools, type GateTools } from "./tools.ts";
import { writeReport, type CheckOutcome } from "./report.ts";
import {
  readPackageManifest,
  REQUIRED_SCRIPTS,
  scriptCommandFor,
} from "./stack.ts";

const LENGTH_CHECK = "file-length cap";
const AGENTS_SIZE_CHECK = "AGENTS.md size";

interface StackResult {
  readonly outcomes: CheckOutcome[];
  /** A required script is missing or does nothing, so the gate exits 2. */
  readonly scriptsIncomplete: boolean;
}

/** The scripts of the root, then of every package the inventory lists,
 * with the inventory's own line first. */
async function runStackChecks(
  ctx: Context,
  listed: readonly string[],
): Promise<StackResult> {
  const inventory = await takeInventory(ctx, listed);
  const commandFor = await scriptCommandFor(
    ctx,
    await readPackageManifest(ctx),
  );
  const results = [
    await runPackageScripts(ctx, { relative: "", folder: ctx.cwd }, commandFor),
  ];
  for (const member of inventory.packages) {
    results.push(await runPackageScripts(ctx, member, commandFor));
  }

  // Written after the scripts' own output, so it isn't buried under it.
  for (const result of results) {
    if (result.message !== "") {
      ctx.stderr.write(result.message);
    }
  }
  if (inventory.message !== undefined) {
    ctx.stderr.write(inventory.message);
  }

  return {
    outcomes: [
      inventory.outcome,
      ...results.flatMap((result) => result.outcomes),
    ],
    scriptsIncomplete: results.some((result) => result.incomplete),
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

async function runGate(ctx: Context, tools: GateTools): Promise<number> {
  const listed = await listGitPaths(ctx);
  const stack = await runStackChecks(ctx, listed);
  const outcomes = [
    ...stack.outcomes,
    await runCoreCheck(ctx),
    await runWorkflowCopiesCheck(ctx),
    await runLengthCheck(ctx),
    await runAgentsSizeCheck(ctx),
    await runMarkdownLint(ctx, tools, listed),
    await runLinkCheck(ctx, listed),
    await runUnusedCheck(ctx, tools),
    ...(await runRulesetChecks(ctx)),
  ];
  writeReport(ctx, outcomes);

  if (stack.scriptsIncomplete) {
    return 2;
  }
  return outcomes.some((outcome) => outcome.status === "failed") ? 1 : 0;
}

// Anything the gate can't determine (git failing, an unreadable config) is
// a failure with a message, never a pass.
async function runGateSafely(ctx: Context, tools: GateTools): Promise<number> {
  try {
    return await runGate(ctx, tools);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(`gate: ${message}\n`);
    return 1;
  }
}

/** The gate, running `tools` for its npm-tool checks; tests pass fakes. */
export function createGateCommand(tools: GateTools): CommandEntry {
  return {
    name: "gate",
    summary:
      "Run the merge gate: stack checks in every workspace package, setup's core, the gate and title workflows, the file-length cap, the AGENTS.md size limit, markdown lint, local links, unused code, the branch ruleset, the judge's ruleset and the gate and title checks rule.",
    details: [
      "Once the repo has files of its own (beyond package.json, the lockfile,",
      "AGENTS.md, .gitignore, README.md, LICENSE, temple-bar.config.json and",
      "the docs, CLAUDE.md and workflows setup writes),",
      "requires these package.json scripts and runs every one that exists:",
      `${REQUIRED_SCRIPTS.join(", ")}. A script that does nothing (such as`,
      "`true` or a bare `echo`) fails. In a pnpm workspace",
      "(pnpm-workspace.yaml), every package pnpm lists needs the same four",
      "scripts, and they run in its folder: the root's first, then each",
      "package's, by path. The list comes from the pnpm that started the gate",
      "(npm_execpath), so run it as `pnpm gate`, `pnpm ready` or",
      "`pnpm merge <N>`. Run `pnpm merge` from the default-branch checkout,",
      "never inside a pull request's worktree: pnpm runs whatever the",
      "current folder's package.json says. A tracked package.json that is",
      "neither the root's nor a listed package's fails.",
      "Started by a package manager, the gate runs every script through it.",
      "Checks that what setup installs is",
      "still in place: the git hooks (unchanged, by SHA-256), core.hooksPath",
      "unset, pull.ff=only, setup's .gitignore lines, its prepare, gate,",
      "ready and merge scripts, and AGENTS.md's temple-bar block, when it has",
      "one, unchanged.",
      "Checks the gate and title workflows setup writes",
      "(.github/workflows/temple-bar-gate.yml and temple-bar-pr-title.yml) are",
      "exact copies of the ones this temple-bar writes, CRLF line endings",
      "aside; a missing or edited one fails, naming the first line that differs.",
      "Then checks every tracked text file",
      "against the file-length cap (maxFileLines in temple-bar.config.json).",
      "Also checks AGENTS.md stays within 200 lines and 32 KiB (skipped when",
      "there is no AGENTS.md). Checks explicit full/collapsed Markdown",
      "reference labels with markdownlint, and actual local links and images",
      "including supported HTML references against files git lists.",
      "These integrity checks ignore Markdown style settings and lint-disable",
      "directives. Style belongs to project scripts; inline code paths are",
      "examples, not existence assertions. Web links are never fetched.",
      "Runs knip (unused files, exports and types) when there",
      "is a package.json. Reads GitHub's rules for the default branch and",
      "fails if setup's rules are missing or weakened, the judge's check",
      "included (until the judge workflow reaches the default branch, a",
      "checkout that carries it is skipped). Public repos only: a",
      "private repo, no GitHub origin or no network is skipped, except in",
      "GitHub Actions, where an unreachable API fails). In GitHub Actions it",
      "needs GH_TOKEN (GH_TOKEN: ${{ github.token }} on the gate step) and",
      "fails without one. Ends by listing each check and its outcome.",
      "",
      "Exit codes: 0 every check passed, 1 a check failed,",
      "2 a required script is missing from a package.json or does nothing.",
    ].join("\n"),
    run: (_args, ctx) => runGateSafely(ctx, tools),
  };
}

export const gateCommand: CommandEntry = createGateCommand(
  createRealGateTools(),
);
