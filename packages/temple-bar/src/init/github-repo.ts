// Offers to create the GitHub repository when `origin` is missing (decision
// 3, plan §3 1.7). Only ever acts on an explicit "yes" from ctx.prompt; the
// two declined paths and the no-commits-yet path all stop `init` before it
// writes anything.

import type { Context } from "../context.ts";
import {
  parseGithubOrigin,
  RERUN_INIT,
  type GithubOrigin,
} from "./requirements.ts";

export function repoCreateCommand(name: string): string {
  return `gh repo create ${name} --public --source . --remote origin --push`;
}

export function repoCreateQuestion(name: string): string {
  return (
    `No GitHub remote found. Create a public GitHub repository named ` +
    `"${name}" and push this folder's current commits to it? ` +
    `(GitHub Free requires a public repository for rulesets.) This runs: ` +
    repoCreateCommand(name)
  );
}

export function noTerminalSteps(name: string): string {
  return (
    "No terminal to ask in, so nothing was created. To finish setup " +
    `yourself, run:\n  ${repoCreateCommand(name)}\nthen run ` +
    `${RERUN_INIT} again.`
  );
}

export function declinedSteps(name: string): string {
  return (
    "OK, nothing was created. Run this yourself when you're ready:\n  " +
    `${repoCreateCommand(name)}\nthen run ${RERUN_INIT} again.`
  );
}

export function noCommitsSteps(name: string): string {
  return (
    "This repository has no commits yet. Once hooks are installed they " +
    "refuse commits to main, so the first commit has to reach GitHub's " +
    "main branch before that happens. Run:\n" +
    '  git add -A && git commit -m "Initial commit"\n' +
    `  ${repoCreateCommand(name)}\n` +
    `then run ${RERUN_INIT} again.`
  );
}

export type RepoCreateOutcome =
  | { readonly kind: "declined"; readonly message: string }
  | { readonly kind: "no-commits"; readonly message: string }
  | { readonly kind: "created"; readonly origin: GithubOrigin }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Runs the whole "no origin yet" flow: asks, and on yes checks for commits
 * before ever shelling out to `gh repo create`. Never called when origin
 * already exists.
 */
export async function offerRepoCreation(
  ctx: Context,
  repoRoot: string,
): Promise<RepoCreateOutcome> {
  const name = repoRoot.split(/[/\\]/).filter(Boolean).at(-1) ?? "repo";
  const answer = await ctx.prompt.confirm(repoCreateQuestion(name));

  if (answer === "no-terminal") {
    return { kind: "declined", message: noTerminalSteps(name) };
  }
  if (answer === "no") {
    return { kind: "declined", message: declinedSteps(name) };
  }

  const head = await ctx.git.run(["rev-parse", "HEAD"], repoRoot);
  if (head.code !== 0) {
    return { kind: "no-commits", message: noCommitsSteps(name) };
  }

  const result = await ctx.gh.run(
    [
      "repo",
      "create",
      name,
      "--public",
      "--source",
      ".",
      "--remote",
      "origin",
      "--push",
    ],
    repoRoot,
  );
  if (result.code !== 0) {
    return {
      kind: "failed",
      message: `\`gh repo create\` failed:\n${result.stderr || result.stdout}`,
    };
  }

  const originUrl = await ctx.git.run(
    ["remote", "get-url", "origin"],
    repoRoot,
  );
  // gh repo create --remote origin --push already set origin on success, so
  // this only fails if something unexpected happened between the two calls.
  const origin = parseGithubOrigin(originUrl.stdout);
  if (!origin) {
    return {
      kind: "failed",
      message: `Repository created, but couldn't read the new "origin" URL back (got: ${originUrl.stdout.trim()}).`,
    };
  }
  return { kind: "created", origin };
}
