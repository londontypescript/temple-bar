// `temple-bar pr-size`: warns when a pull request is too big or mixes
// concerns. Always exits 0, because a warning must never block a merge, and
// 2 only for a usage mistake (a flag it doesn't know, or no base to compare
// against).

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

export async function prSizeCommand(
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
    // Still exit 0: failing to measure must not block a merge, but it must
    // not pass silently either.
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(
      `pr-size: could not measure this pull request: ${message}\n`,
    );
  }
  return 0;
}

export const prSizeCommandEntry: CommandEntry = {
  name: "pr-size",
  summary: "Warn when a pull request is too big or closes several issues.",
  args: "[--base <ref>] [--head <ref>] [--pr <number>]",
  details: [
    "Squash merges make each pull request one commit on main, so a pull",
    "request should hold one concern. Measures lines changed and files",
    "touched from the merge base of --base and --head (defaults: origin/",
    "$GITHUB_BASE_REF and HEAD), ignoring lockfiles, files marked",
    "linguist-generated in .gitattributes, and pure renames. Also counts",
    "the issues the title and body close (read from the GitHub Actions event,",
    "or from `gh pr view`, for --pr when given).",
    "",
    "Limits are maxPullRequestLines and maxPullRequestFiles in",
    "temple-bar.config.json. In GitHub Actions the warning is also an",
    "annotation on the pull request.",
    "",
    "Always exits 0, except 2 when called wrongly.",
  ].join("\n"),
  run: prSizeCommand,
};
