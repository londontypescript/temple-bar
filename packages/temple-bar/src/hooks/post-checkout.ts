// Logic behind `temple-bar hook post-checkout <previous> <new> <flag>`: sets
// up a worktree that `git worktree add` has just made, whichever tool made
// it, so it is ready to work in. Env files come in first (env-files.ts),
// then dependencies, with `pnpm install --frozen-lockfile`, so the worktree
// gets exactly what the lockfile on its branch says.
//
// Every other checkout does nothing. git passes a previous HEAD of all zeros
// only for a checkout with nothing before it: a new worktree, or the first
// checkout of a fresh clone, told apart here because a new worktree has a
// git folder of its own inside the shared one.
//
// The checkout has already happened, and a hook can't undo it, so a failure
// here says exactly what to run to finish the setup by hand.

import path from "node:path";

import type { Context } from "../context.ts";
import { checkEnvKeys, copyEnvFiles, describeEnv } from "./env-files.ts";

const NO_PREVIOUS_HEAD = /^0+$/;

const INSTALL_ARGS = ["install", "--frozen-lockfile"] as const;
const INSTALL_COMMAND = `pnpm ${INSTALL_ARGS.join(" ")}`;

/** git prints some paths relative to `cwd`. Joined rather than resolved:
 * path.resolve would put the current drive in front of an already absolute
 * path on Windows. */
function absolute(cwd: string, p: string): string {
  return path.isAbsolute(p) ? p : path.join(cwd, p);
}

async function gitPath(
  ctx: Context,
  cwd: string,
  flag: string,
): Promise<string | undefined> {
  const result = await ctx.git.run(["rev-parse", flag], cwd);
  if (result.code !== 0) {
    return undefined;
  }
  return absolute(cwd, result.stdout.trim());
}

/** The checkout to copy env files from: the main worktree, which `git
 * worktree list` names first. Undefined when it is bare (no files). */
async function findPrimaryCheckout(ctx: Context): Promise<string | undefined> {
  const result = await ctx.git.run(
    ["worktree", "list", "--porcelain"],
    ctx.cwd,
  );
  if (result.code !== 0) {
    return undefined;
  }
  const [first = ""] = result.stdout.split(/\r?\n\r?\n/);
  const lines = first.split(/\r?\n/);
  const worktreeLine = lines.find((line) => line.startsWith("worktree "));
  if (worktreeLine === undefined || lines.includes("bare")) {
    return undefined;
  }
  return worktreeLine.slice("worktree ".length);
}

function say(ctx: Context, line: string): void {
  ctx.stdout.write(`temple-bar: ${line}\n`);
}

async function setUpEnvFiles(ctx: Context, worktree: string): Promise<number> {
  const primary = await findPrimaryCheckout(ctx);
  if (primary === undefined) {
    say(ctx, "no primary checkout to copy env files from (the repo is bare)");
    return 0;
  }
  try {
    const copies =
      path.relative(primary, worktree) === ""
        ? []
        : await copyEnvFiles(ctx, primary, worktree);
    const checks = await checkEnvKeys(ctx, worktree);
    for (const line of describeEnv(copies, checks)) {
      say(ctx, line);
    }
    return 0;
  } catch (error) {
    // Only the error's code (EACCES and the like) and the file names in its
    // message: never anything read from an env file.
    const reason = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(
      `temple-bar: copying env files into this worktree failed: ${reason}\n` +
        `Copy them from ${primary} by hand.\n`,
    );
    return 1;
  }
}

async function installDependencies(
  ctx: Context,
  worktree: string,
): Promise<number> {
  if (!(await ctx.fs.exists(path.join(worktree, "pnpm-lock.yaml")))) {
    say(ctx, "no pnpm-lock.yaml here, so no dependencies to install");
    return 0;
  }
  say(ctx, `installing dependencies: ${INSTALL_COMMAND}`);
  const code = await ctx.proc.run("pnpm", INSTALL_ARGS, {
    cwd: worktree,
    env: ctx.env,
    stdout: ctx.stdout,
    stderr: ctx.stderr,
  });
  if (code !== 0) {
    ctx.stderr.write(
      `temple-bar: ${INSTALL_COMMAND} failed (exit ${String(code)}), so this new worktree has no dependencies yet.\n` +
        "The worktree itself was made. Fix what pnpm reported above, then run:\n" +
        `  cd "${worktree}" && ${INSTALL_COMMAND}\n`,
    );
    return 1;
  }
  return 0;
}

/**
 * `temple-bar hook post-checkout`: 0 when there was nothing to do or the
 * setup finished, 1 when a step failed (and its message says how to finish).
 */
export async function postCheckout(
  previousHead: string,
  ctx: Context,
): Promise<number> {
  if (!NO_PREVIOUS_HEAD.test(previousHead)) {
    return 0;
  }
  const gitDir = await gitPath(ctx, ctx.cwd, "--git-dir");
  const commonDir = await gitPath(ctx, ctx.cwd, "--git-common-dir");
  const worktree = await gitPath(ctx, ctx.cwd, "--show-toplevel");
  if (
    gitDir === undefined ||
    commonDir === undefined ||
    worktree === undefined ||
    path.normalize(gitDir) === path.normalize(commonDir)
  ) {
    return 0;
  }

  say(ctx, `setting up the new worktree at ${worktree}`);
  const envCode = await setUpEnvFiles(ctx, worktree);
  const installCode = await installDependencies(ctx, worktree);
  return envCode !== 0 || installCode !== 0 ? 1 : 0;
}
