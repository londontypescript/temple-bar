// `temple-bar leftovers`: lists branches and worktrees whose work has ended.
// A command of its own, not only part of merge's report, because leftovers
// also come from pull requests merged or closed on GitHub's website, where
// no merge command ran. Exit 0 whether or not it finds any: it is a report.

import type { Context } from "../context.ts";
import type { CommandEntry } from "../registry.ts";
import { reportLeftovers } from "./report.ts";

export const leftoversCommandEntry: CommandEntry = {
  name: "leftovers",
  summary: "List branches and worktrees left behind after their work ended.",
  details: [
    "Lists local and remote branches whose pull request merged or closed,",
    "worktrees on such branches, and worktrees whose branch or folder is",
    "gone, each with the command that would remove it. Deletes nothing.",
    "",
    "Exits 0 whether or not it finds any, 2 when called with arguments.",
  ].join("\n"),
  run: async (args: readonly string[], ctx: Context) => {
    if (args.length > 0) {
      ctx.stderr.write(`leftovers: unknown argument: ${args[0] ?? ""}\n`);
      return 2;
    }
    try {
      await reportLeftovers(ctx, ctx.cwd, "leftovers: ");
    } catch (error) {
      ctx.stderr.write(
        `leftovers: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 1;
    }
    return 0;
  },
};
