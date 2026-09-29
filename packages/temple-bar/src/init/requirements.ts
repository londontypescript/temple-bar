// The four hard requirements `init` checks before it writes anything: a git
// repo, `gh` installed, `gh` signed in, and `origin` pointing at GitHub. Each
// check returns either "ok" or an exact, printable fix, and none of them
// write anything themselves.

import type { Context } from "../context.ts";

export interface RequirementFailure {
  readonly ok: false;
  readonly message: string;
}

export interface RequirementOk<T> {
  readonly ok: true;
  readonly value: T;
}

export type RequirementResult<T = undefined> =
  RequirementOk<T> | RequirementFailure;

function fail(message: string): RequirementFailure {
  return { ok: false, message };
}

/** Resolves the repo root from `cwd`, however deep inside it `init` runs. */
export async function checkGitRepo(
  ctx: Context,
  cwd: string,
): Promise<RequirementResult<string>> {
  const result = await ctx.git.run(["rev-parse", "--show-toplevel"], cwd);
  if (result.code !== 0) {
    return fail(
      "Not a git repository. Fix: run `git init` in this folder, then run `temple-bar init` again.",
    );
  }
  return { ok: true, value: result.stdout.trim() };
}

export async function checkGhInstalled(
  ctx: Context,
  repoRoot: string,
): Promise<RequirementResult> {
  const result = await ctx.gh.run(["--version"], repoRoot);
  if (result.notFound) {
    return fail(
      'The GitHub CLI ("gh") is not installed. Fix: install it yourself from ' +
        "https://cli.github.com and run `temple-bar init` again. Agents must " +
        "not install it on your behalf.",
    );
  }
  return { ok: true, value: undefined };
}

export async function checkGhSignedIn(
  ctx: Context,
  repoRoot: string,
): Promise<RequirementResult> {
  const result = await ctx.gh.run(["auth", "status"], repoRoot);
  if (result.code !== 0) {
    return fail(
      "The GitHub CLI is not signed in. Fix: run `gh auth login`, then run " +
        "`temple-bar init` again.",
    );
  }
  return { ok: true, value: undefined };
}

export interface GithubOrigin {
  readonly owner: string;
  readonly repo: string;
}

// Accepts https://github.com/owner/repo(.git), git@github.com:owner/repo(.git)
// and ssh://git@github.com/owner/repo(.git), each with an optional trailing
// slash.
const GITHUB_ORIGIN_PATTERNS: readonly RegExp[] = [
  /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
];

export function parseGithubOrigin(url: string): GithubOrigin | undefined {
  const trimmed = url.trim();
  for (const pattern of GITHUB_ORIGIN_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match) {
      const [, owner, repo] = match;
      if (owner && repo) {
        return { owner, repo };
      }
    }
  }
  return undefined;
}

export type OriginCheck =
  | { readonly state: "missing" }
  | { readonly state: "ok"; readonly origin: GithubOrigin }
  | { readonly state: "wrong-host"; readonly url: string };

/**
 * Distinguishes "no origin yet" (init offers to create one) from "origin
 * exists but isn't GitHub" (a hard stop with a fix, since init can't safely
 * guess what the user wants there).
 */
export async function checkOrigin(
  ctx: Context,
  repoRoot: string,
): Promise<OriginCheck> {
  const result = await ctx.git.run(["remote", "get-url", "origin"], repoRoot);
  if (result.code !== 0) {
    return { state: "missing" };
  }
  const url = result.stdout.trim();
  const origin = parseGithubOrigin(url);
  if (!origin) {
    return { state: "wrong-host", url };
  }
  return { state: "ok", origin };
}

export function wrongHostMessage(url: string): string {
  return (
    `The "origin" remote (${url}) doesn't point at GitHub. Fix: point it at ` +
    "a GitHub repository, e.g. `git remote set-url origin " +
    "git@github.com:<owner>/<repo>.git`, then run `temple-bar init` again."
  );
}
