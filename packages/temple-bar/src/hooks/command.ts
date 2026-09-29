// `temple-bar hook <subcommand>`: the git hook entry points, plus the
// `install` subcommand that writes them. router.ts (1.4, owned by the
// orchestrator) registers this with `registry.register(createHookCommand(...))`.
// An unknown or missing subcommand prints usage to stderr, exits 2, and has
// no other effect (same contract as an unknown top-level command, F12/P8.2).

import type { Context } from "../context.ts";
import type { CommandEntry } from "../registry.ts";
import { installHooks } from "./install.ts";
import { preCommitCheck } from "./pre-commit.ts";
import { referenceTransactionCheck } from "./reference-transaction.ts";

const USAGE =
  "Usage: temple-bar hook <pre-commit|reference-transaction <state>|install>\n";

async function findRepoRoot(ctx: Context): Promise<string | undefined> {
  const result = await ctx.git.run(["rev-parse", "--show-toplevel"], ctx.cwd);
  return result.code === 0 ? result.stdout.trim() : undefined;
}

async function runInstall(ctx: Context): Promise<number> {
  const repoRoot = await findRepoRoot(ctx);
  if (repoRoot === undefined) {
    ctx.stderr.write("temple-bar: not inside a git repository\n");
    return 1;
  }

  const report = await installHooks(ctx, repoRoot);
  for (const item of report.items) {
    const detail = item.detail !== undefined ? ` (${item.detail})` : "";
    ctx.stdout.write(`${item.status}: ${item.item}${detail}\n`);
  }
  return report.hasConflicts ? 1 : 0;
}

/**
 * `readStdin` is only called for `reference-transaction`, so `pre-commit`
 * and `install` never wait on it. router.ts passes the real reader; unit
 * tests pass their own.
 */
export function createHookCommand(
  readStdin: () => Promise<string>,
): CommandEntry {
  return {
    name: "hook",
    summary: "Git hook entry points, installed by `hook install`.",
    async run(args, ctx) {
      const [sub, ...rest] = args;

      switch (sub) {
        case "pre-commit":
          return preCommitCheck(ctx);

        case "reference-transaction": {
          const [state] = rest;
          if (state === undefined) {
            ctx.stderr.write(USAGE);
            return 2;
          }
          return referenceTransactionCheck(state, await readStdin(), ctx);
        }

        case "install":
          return runInstall(ctx);

        default:
          ctx.stderr.write(USAGE);
          return 2;
      }
    },
  };
}
