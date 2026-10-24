// `temple-bar pr-size`: warns when a pull request is too big or mixes
// concerns. A size warning exits 0, because it must never block a merge.
// Failing to measure exits 1: that means the check itself isn't working (for
// example a CI checkout without the base branch), and a check that quietly
// does nothing is worse than a red one. 2 is a usage mistake (a flag it
// doesn't know, or no base to compare against).

import type { Context } from "../context.ts";
import type { CommandEntry } from "../registry.ts";
import { warnAboutPullRequestSize } from "./size.ts";

interface ParsedArgs {
  readonly base?: string;
  readonly head?: string;
  readonly pr?: string;
}

const VALUE_FLAGS = ["--base", "--head", "--pr"] as const;

function parseArgs(args: readonly string[]): ParsedArgs | string {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i] ?? "";
    const name = VALUE_FLAGS.find((candidate) => candidate === flag);
    if (name === undefined) {
      return `unknown argument: ${flag}`;
    }
    const value = args[++i];
    // A value that looks like a flag would be read by git as an option.
    if (value === undefined || value === "" || value.startsWith("-")) {
      return `${name} needs a value`;
    }
    values[name.slice(2)] = value;
  }
  return values;
}

async function prSizeCommand(
  args: readonly string[],
  ctx: Context,
): Promise<number> {
  const parsed = parseArgs(args);
  if (typeof parsed === "string") {
    ctx.stderr.write(`pr-size: ${parsed}\n`);
    return 2;
  }
  // In a pull request run GitHub names the target branch; its remote copy is
  // the one a shallow or detached CI checkout actually has.
  const baseBranch = ctx.env.GITHUB_BASE_REF;
  const base =
    parsed.base ??
    (baseBranch === undefined || baseBranch === ""
      ? undefined
      : `origin/${baseBranch}`);
  if (base === undefined) {
    ctx.stderr.write(
      "pr-size: no base to compare against: pass --base <ref> (outside GitHub Actions, GITHUB_BASE_REF is not set)\n",
    );
    return 2;
  }
  try {
    await warnAboutPullRequestSize(ctx, {
      base,
      head: parsed.head ?? "HEAD",
      ...(parsed.pr === undefined ? {} : { prNumber: parsed.pr }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(
      `pr-size: could not measure this pull request: ${message}\n`,
    );
    return 1;
  }
  return 0;
}

export const prSizeCommandEntry: CommandEntry = {
  name: "pr-size",
  summary: "Warn when a pull request is too big or closes several issues.",
  args: "[--base <ref>] [--head <ref>] [--pr <number>]",
  details: [
    "Squash merges make each pull request one commit on main, so a pull",
    "request should hold one concern. Measures source lines and test lines",
    "changed (a test is a *.test.* or *.spec.* file, anything under",
    "__tests__/, or a .snap file) and files touched, from the merge base of",
    "--base and --head (defaults: origin/$GITHUB_BASE_REF and HEAD),",
    "ignoring lockfiles, files marked linguist-generated in .gitattributes,",
    "and pure renames. Also counts the issues the title and body close (read",
    "from the GitHub Actions event, or from `gh pr view`, for --pr when",
    "given).",
    "",
    "Limits are maxPullRequestLines (source lines), maxPullRequestTestLines",
    "(test lines) and maxPullRequestFiles (all files) in",
    "temple-bar.config.json. A pull request over a limit, or closing several",
    "issues, needs a line in its description starting `One concern:` that",
    "says why it is one change: with one, there is no warning, and",
    "`temple-bar merge` refuses one without it. In GitHub Actions the",
    "warning is also an annotation on the pull request.",
    "",
    "Exits 0 whether or not it warns, 1 when it can't measure the pull",
    "request (in CI, check out with fetch-depth: 0), 2 when called wrongly.",
  ].join("\n"),
  run: prSizeCommand,
};
