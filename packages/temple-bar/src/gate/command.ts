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
//
// Every check comes from one check plan (plan.ts). With no options the gate
// runs all of it; CI can instead run one part of it per job (`--part`,
// part-run.ts) and then prove the parts' reports add up to the whole gate
// (`--verify-parts`, verify-parts.ts). `ready` and `merge` always run the
// whole gate.

import type { CommandEntry } from "../registry.ts";
import type { Context } from "../context.ts";
import { parseGateArgs } from "./options.ts";
import { createRealPartFiles, type PartFiles } from "./part-files.ts";
import { runPart } from "./part-run.ts";
import { buildPlan } from "./plan.ts";
import { exitCodeOf, prepare, runEntries } from "./plan-run.ts";
import { createRealGateTools, type GateTools } from "./tools.ts";
import { checkPinnedVersion } from "../pinned-version.ts";
import { writeReport } from "./report.ts";
import { REQUIRED_SCRIPTS } from "./stack.ts";
import { verifyParts } from "./verify-parts.ts";

/** Every check in the plan, in order (plan.ts). */
async function runWholeGate(ctx: Context, tools: GateTools): Promise<number> {
  const prepared = await prepare(ctx);
  const run = await runEntries(
    ctx,
    prepared,
    tools,
    buildPlan(prepared.inventory),
  );
  writeReport(ctx, run.outcomes);
  return exitCodeOf(run);
}

async function runGate(
  args: readonly string[],
  ctx: Context,
  tools: GateTools,
  files: PartFiles,
): Promise<number> {
  const mode = parseGateArgs(args);
  if (typeof mode === "string") {
    // 1, not 2: the gate's 2 already means a required script is missing.
    ctx.stderr.write(`gate: ${mode}\n`);
    return 1;
  }
  // Before any mode's work: a stale install would judge the repo by the
  // wrong version's rules.
  const pin = await checkPinnedVersion(ctx, ctx.cwd, "no check ran");
  if (pin.kind === "refused") {
    ctx.stderr.write(pin.lines.map((line) => `gate: ${line}\n`).join(""));
    return 1;
  }
  if (pin.note !== undefined) {
    ctx.stdout.write(`gate: ${pin.note}\n`);
  }
  switch (mode.kind) {
    case "whole":
      return runWholeGate(ctx, tools);
    case "part":
      return runPart(ctx, tools, files, mode);
    case "verify":
      return verifyParts(ctx, files, mode);
  }
}

// Anything the gate can't determine (git failing, an unreadable config) is
// a failure with a message, never a pass.
async function runGateSafely(
  args: readonly string[],
  ctx: Context,
  tools: GateTools,
  files: PartFiles,
): Promise<number> {
  try {
    return await runGate(args, ctx, tools, files);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(`gate: ${message}\n`);
    return 1;
  }
}

/** The gate, running `tools` for its npm-tool checks and writing and
 * reading part reports through `files`; tests pass fakes. */
export function createGateCommand(
  tools: GateTools,
  files: PartFiles = createRealPartFiles(),
): CommandEntry {
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
      "Started by a package manager, the gate runs every script through it,",
      "with no shell: a JavaScript entry point through Node, or pnpm's",
      "standalone executable directly. Any other launcher, such as a .cmd",
      "shim, runs nothing and fails, saying how to install pnpm.",
      "Then checks that every tracked TypeScript file (declarations aside) is",
      "in a program a typecheck script checks, and every .test. or .spec. code",
      "file is run by a test script, asking the tools those scripts run, in",
      "the root and every package; it can list tsc [-p <config>], tsc -b",
      "[<project>...], vitest [run] and node --test (no entry script before",
      "--test), joined with &&, and fails any other form, naming those it",
      "can list. Exclusions go under coverageExclusions in",
      "temple-bar.config.json.",
      "Checks that what setup installs is",
      "still in place: the git hooks (unchanged, by SHA-256), core.hooksPath",
      "unset, pull.ff=only, setup's .gitignore lines, its prepare, gate,",
      "ready and merge scripts, and AGENTS.md with temple-bar's block in it,",
      "unchanged.",
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
      "",
      "By part, in GitHub Actions only (GITHUB_ACTIONS=true, GITHUB_REPOSITORY,",
      "GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT set), started through pnpm:",
      "--part <name> --leg <leg> --report <file> runs one part of the same",
      "checks: repo (every check that isn't a package's scripts), root (the",
      "root's four scripts) or a package, by its folder (packages/app). Its",
      "exit code follows the rules above for that part's checks. It then",
      "writes a JSON report of the run, commit, leg, Node, pnpm, gate version",
      "and every outcome to <file>, which must not exist yet.",
      "--verify-parts <folder> --leg <leg> works out the parts itself and",
      "passes only when <folder> holds exactly one report per part, each",
      "from this run, commit, leg, Node, pnpm and gate, with exactly that",
      "part's checks and none failing; it names every problem it finds.",
      "A workspace package whose folder is repo or root can't be split.",
      "Any other options are refused with exit 1.",
    ].join("\n"),
    run: (args, ctx) => runGateSafely(args, ctx, tools, files),
  };
}

export const gateCommand: CommandEntry = createGateCommand(
  createRealGateTools(),
);
