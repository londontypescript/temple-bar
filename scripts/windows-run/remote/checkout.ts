// Getting the commit onto the machine: a persistent clone with no GitHub
// origin, fetched from the run's bundle, and a detached worktree at the
// commit. Git hooks are off for every checkout: the clone's hooks are the
// ones an earlier run's install wrote, pointing at a worktree that may have
// been deleted since, and the install step is the only install, so it is
// recorded.

import path from "node:path";

import { pathExists } from "./fsx.ts";
import type { Refusal } from "./record.ts";
import type { Layout } from "./sweep.ts";
import type { Sys } from "./sys.ts";

/** Why the run stopped before its steps, with the detail for the terminal. */
export class Failure extends Error {
  readonly refusal: Refusal;
  constructor(refusal: Refusal, message: string) {
    super(message);
    this.refusal = refusal;
  }
}

/** Git with hooks turned off, for any command that could run one. */
export function gitNoHooks(
  sys: Sys,
  args: readonly string[],
  cwd: string,
): ReturnType<Sys["git"]> {
  return sys.git(["-c", `core.hooksPath=${sys.devNull}`, ...args], cwd);
}

/** Makes the clone if need be and fetches the run's bundle into `ref`. */
export async function fetchCommit(
  sys: Sys,
  layout: Layout,
  runId: string,
  ref: string,
): Promise<void> {
  await sys.fs.mkdir(layout.clone);
  if (!(await pathExists(sys.fs, path.join(layout.clone, ".git")))) {
    const init = await sys.git(["init", "--quiet", layout.clone]);
    if (init.code !== 0) {
      throw new Failure("fetch-failed", "git init failed");
    }
  }
  // Before any checkout: node_modules paths are long.
  const configured = await sys.git(
    ["config", "core.longpaths", "true"],
    layout.clone,
  );
  if (configured.code !== 0) {
    throw new Failure("fetch-failed", "git config core.longpaths failed");
  }

  const bundle = path.join(layout.incoming, runId, "run.bundle");
  // The tags come too, as CI's full-history checkout has them, and the clone
  // keeps exactly the bundle's: one deleted or moved since an earlier run
  // must not linger here.
  const fetched = await sys.git(
    [
      "fetch",
      "--quiet",
      "--prune",
      "--force",
      bundle,
      `HEAD:${ref}`,
      "+refs/tags/*:refs/tags/*",
    ],
    layout.clone,
  );
  if (fetched.code !== 0) {
    throw new Failure(
      "fetch-failed",
      `git fetch failed: ${fetched.stderr.trim()}`,
    );
  }
}

/** Adds a detached worktree of the clone at `sha`, or says why it can't. */
export async function addWorktree(
  sys: Sys,
  layout: Layout,
  worktree: string,
  sha: string,
): Promise<void> {
  const added = await gitNoHooks(
    sys,
    ["worktree", "add", "--detach", worktree, sha],
    layout.clone,
  );
  if (added.code !== 0) {
    throw new Failure(
      "checkout-failed",
      `git worktree add failed: ${added.stderr.trim()}`,
    );
  }
}

/** The worktree must be at exactly the requested commit. */
export async function verifyHead(
  sys: Sys,
  worktree: string,
  sha: string,
): Promise<void> {
  const head = await sys.git(["rev-parse", "HEAD"], worktree);
  if (head.code !== 0 || head.stdout.trim() !== sha) {
    throw new Failure(
      "commit-mismatch",
      `the worktree is at ${head.stdout.trim() || "an unknown commit"}, not ${sha}`,
    );
  }
}
