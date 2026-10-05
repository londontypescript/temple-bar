// `temple-bar ready`: says "this commit is finished, let it be pushed".
//
// Every push to a pull request costs a full CI run, so a branch is pushed
// once, when its work is done, and only after the same gate CI runs has
// passed here. `ready` runs that gate on the commit checked out in this
// worktree and, if it passes, marks the commit (mark.ts). The pre-push hook
// refuses any branch whose tip isn't the marked commit, so a new commit
// needs `ready` again.
//
// Some changes need the maintainer's yes before they leave the machine: a
// change to AGENTS.md (the rules every agent follows), or to the checks that
// judge the repo (the files the judge guards, listed in judge/changes.ts). For
// those, `ready` still marks the commit, and warns that the agent must ask
// the maintainer in chat before pushing (maintainer.ts says why it warns
// rather than asks).

import type { Context } from "../context.ts";
import { gateCommand } from "../gate/command.ts";
import type { CommandEntry } from "../registry.ts";
import { GUARDED_CHECKS } from "../judge/guarded-checks.ts";
import { changesNeedingMaintainer, maintainerWarning } from "./maintainer.ts";
import { clearMark, writeMark } from "./mark.ts";

/** Stops `ready` with a message saying what to do instead. */
class NotReady extends Error {
  override readonly name = "NotReady";
}

function stop(message: string): never {
  throw new NotReady(message);
}

async function git(
  ctx: Context,
  args: readonly string[],
  cwd: string,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const result = await ctx.git.run(args, cwd);
  return {
    ok: result.code === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

async function findWorktreeRoot(ctx: Context): Promise<string> {
  const result = await git(ctx, ["rev-parse", "--show-toplevel"], ctx.cwd);
  return result.ok ? result.stdout : stop("not inside a git repository.");
}

async function headCommit(ctx: Context, root: string): Promise<string> {
  const result = await git(
    ctx,
    ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
    root,
  );
  return result.ok && result.stdout !== ""
    ? result.stdout
    : stop("there is no commit here yet. Commit your work, then run ready.");
}

const MAX_LISTED = 10;

// The gate reads the files on disk, but a push carries only the commit. A
// change that isn't committed, or a new file that was never added, would be
// judged here and then be missing from what CI sees, so `ready` only judges a
// worktree that matches its commit exactly. Ignored files (node_modules, build
// output) don't count.
async function requireClean(ctx: Context, root: string): Promise<void> {
  const result = await git(
    ctx,
    ["status", "--porcelain", "--untracked-files=all"],
    root,
  );
  if (!result.ok) {
    stop(`could not read the worktree's status: ${result.stderr}`);
  }
  const lines = result.stdout.split("\n").filter((line) => line !== "");
  if (lines.length === 0) {
    return;
  }
  const listed = lines.slice(0, MAX_LISTED).map((line) => `  ${line}`);
  if (lines.length > MAX_LISTED) {
    listed.push(`  ...and ${String(lines.length - MAX_LISTED)} more`);
  }
  stop(
    "the worktree has changes that aren't committed, so the gate would judge files the push won't carry:\n" +
      `${listed.join("\n")}\n` +
      "Commit them (or remove what doesn't belong), then run ready again.",
  );
}

/** Runs the full gate in `ctx.cwd` and returns its exit code. */
export type RunGate = (ctx: Context) => Promise<number>;

async function runReady(ctx: Context, runGate: RunGate): Promise<number> {
  const root = await findWorktreeRoot(ctx);
  // The gate reads package.json and the rest from the directory it runs in.
  const rootCtx: Context = { ...ctx, cwd: root };

  // Whatever happens next, an older mark no longer describes this worktree.
  await clearMark(ctx, root);
  const head = await headCommit(ctx, root);
  const short = head.slice(0, 7);
  await requireClean(ctx, root);

  // Worked out before the gate runs, so a clone with nothing to compare
  // with is told to fetch at once, rather than after a long gate run.
  const reasons = await changesNeedingMaintainer(ctx, root, head);

  if ((await runGate(rootCtx)) !== 0) {
    stop(
      `the gate did not pass, so ${short} is not marked ready to push.\n` +
        "Fix what it reported, commit, and run ready again.",
    );
  }

  // The gate can take minutes; judge only the commit it actually checked.
  if ((await headCommit(ctx, root)) !== head) {
    stop(
      `the checked-out commit changed while the gate ran, so ${short} is not marked. Run ready again.`,
    );
  }
  await requireClean(ctx, root);

  await writeMark(ctx, root, head);
  ctx.stdout.write(
    `ready: ${short} passed the gate and is marked ready to push. Any new commit needs ready again.\n`,
  );
  // Last, so it is what the agent reads before it reaches for git push.
  if (reasons.length > 0) {
    ctx.stderr.write(`ready: ${maintainerWarning(short, reasons)}`);
  }
  return 0;
}

/** `runGate` is the real gate in production (readyCommand below); unit
 * tests pass their own so they can choose its result. */
export function createReadyCommand(runGate: RunGate): CommandEntry {
  return {
    name: "ready",
    summary:
      "Run the full gate on this commit and, if it passes, mark it ready to push.",
    details: [
      "Push once, when the work is finished: the pre-push hook refuses a",
      "branch until ready has marked the commit at its tip, and any new",
      "commit needs ready again. Run it in the worktree that has the branch",
      "checked out, with everything committed.",
      "",
      "A commit that changes AGENTS.md, or the checks that judge the repo",
      `(${GUARDED_CHECKS}),`,
      "needs the maintainer's yes too:",
      "ready marks it, and warns to ask the maintainer in chat before pushing.",
      "The pre-push hook repeats the warning.",
      "",
      "Exit codes: 0 marked, 1 not marked (the reason is printed).",
    ].join("\n"),
    async run(_args, ctx) {
      try {
        return await runReady(ctx, runGate);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.stderr.write(`ready: ${message}\n`);
        return 1;
      }
    },
  };
}

export const readyCommand: CommandEntry = createReadyCommand((ctx) =>
  gateCommand.run([], ctx),
);
