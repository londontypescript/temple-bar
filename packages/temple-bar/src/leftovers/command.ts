// `temple-bar leftovers`: what merged or closed pull requests left behind,
// with the verdict on each. A command of its own, not only part of merge's
// report, because leftovers also come from pull requests merged on GitHub's
// website, where no merge command ran. Its flags let the session that owns
// a worktree release it, and then remove what is finished and released.
// ADR 0022 has the story.

import type { Context } from "../context.ts";
import type { CommandEntry } from "../registry.ts";
import { releaseWorktree, unreleaseWorktree } from "./release.ts";
import { removeLeftovers } from "./remove.ts";
import { reportLeftovers } from "./report.ts";

const PREFIX = "leftovers: ";

async function report(ctx: Context): Promise<number> {
  await reportLeftovers(ctx, ctx.cwd, PREFIX);
  return 0;
}

const MODES: Readonly<Record<string, (ctx: Context) => Promise<number>>> = {
  "--release": (ctx) => releaseWorktree(ctx, PREFIX),
  "--unrelease": (ctx) => unreleaseWorktree(ctx, PREFIX),
  "--remove": (ctx) => removeLeftovers(ctx, PREFIX),
};

export const leftoversCommandEntry: CommandEntry = {
  name: "leftovers",
  summary:
    "Report, release or remove the worktrees and branches merged work left behind.",
  args: "[--release | --unrelease | --remove]",
  details: [
    "With no flag, lists worktrees, local branches and origin's branches",
    "whose pull request merged or closed, each with the verdict --remove",
    'would reach: "would remove" or "kept:" and why. Deletes nothing.',
    "",
    "--release    Run by the session that owns a linked worktree, in it, as",
    "             its last step after its handoff. Records that everything",
    "             worth keeping is on GitHub, and lists the ignored files it",
    "             certifies: once the pull request merges, --remove deletes",
    "             the worktree and all ignored local data in it,",
    "             .temple-bar/ included. Refuses, writing nothing, a worktree",
    "             with changes, untracked files, a nested repository,",
    "             worktree or mounted folder, a submodule, hidden index",
    "             flags, or a git operation under way.",
    "--unrelease  Withdraws the release. A session that resumes in a",
    "             worktree runs it first; if it says the worktree is being",
    "             removed, stop and work elsewhere.",
    "--remove     From the primary checkout: removes each released worktree",
    "             whose branch's newest pull request merged into the default",
    "             branch, with its local branch, and origin's branch while its",
    "             tip is still the merged head. Never forces, never removes a",
    "             locked worktree, the primary checkout or the folder it runs",
    "             in, and keeps anything it can't check, saying why.",
    "",
    "Exits 0 for the report; for --release, --unrelease and --remove, 0 when",
    "all of it was done and 1 otherwise; 2 when called wrongly.",
  ].join("\n"),
  run: async (args: readonly string[], ctx: Context) => {
    const [flag] = args;
    const mode = flag === undefined ? report : MODES[flag];
    if (mode === undefined || args.length > 1) {
      ctx.stderr.write(
        args.length > 1
          ? `${PREFIX}give at most one of ${Object.keys(MODES).join(", ")}\n`
          : `${PREFIX}unknown argument: ${flag ?? ""}\n`,
      );
      return 2;
    }
    try {
      return await mode(ctx);
    } catch (error) {
      ctx.stderr.write(
        `${PREFIX}${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 1;
    }
  },
};
