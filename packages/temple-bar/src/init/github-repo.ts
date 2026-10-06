// Offers to create the GitHub repository when `origin` is missing. Only ever
// acts on an explicit "yes" (ctx.prompt, or the --create-repo flag an agent
// passes after the user said yes in chat); the two declined paths and the
// no-commits-yet path all stop `init` before it writes anything.

import type { Context } from "../context.ts";
import { repoName } from "./repo-name.ts";
import {
  parseGithubOrigin,
  RERUN_INIT,
  rerunInit,
  type GithubOrigin,
} from "./requirements.ts";

export function repoCreateCommand(name: string): string {
  return `gh repo create ${name} --public --source . --remote origin --push`;
}

function repoCreateQuestion(name: string): string {
  return (
    `No GitHub remote found. Create a public GitHub repository named ` +
    `"${name}" and push this folder's current commits to it? ` +
    `(GitHub Free requires a public repository for rulesets.) This runs: ` +
    repoCreateCommand(name)
  );
}

function noTerminalSteps(name: string): string {
  return (
    "No terminal to ask in, so nothing was created. An agent: ask the user " +
    `whether to create the repository, and only if they say yes run ` +
    `${rerunInit("--create-repo")}. To finish setup yourself, run:\n  ` +
    `${repoCreateCommand(name)}\nthen run ${RERUN_INIT} again.`
  );
}

function declinedSteps(name: string): string {
  return (
    "OK, nothing was created. Run this yourself when you're ready:\n  " +
    `${repoCreateCommand(name)}\nthen run ${RERUN_INIT} again.`
  );
}

const FIRST_COMMIT_MESSAGE = "Initial commit";

/** The one command left when setup couldn't make the first commit itself
 * (for example signing needs a passphrase an agent can't type). The repo
 * already exists on GitHub by then; only the commit and the push are left. */
function commitNeededSteps(detail: string): string {
  return (
    "Created the GitHub repository, but couldn't make the first commit " +
    `here${detail === "" ? "" : ` (${detail})`}. Everything is staged. ` +
    "Hooks are not installed yet, because they refuse commits to main. " +
    "Run this yourself:\n" +
    `  git commit -m "${FIRST_COMMIT_MESSAGE}" && git push -u origin HEAD\n` +
    `then run ${RERUN_INIT} again to finish.`
  );
}

export type RepoCreateOutcome =
  | { readonly kind: "declined"; readonly message: string }
  | { readonly kind: "created"; readonly origin: GithubOrigin }
  | {
      readonly kind: "commit-needed";
      readonly origin: GithubOrigin;
      readonly message: string;
    }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Runs the whole "no origin yet" flow: asks, and on yes makes the first
 * commit if the repo has none (before hooks exist to refuse it), then
 * shells out to `gh repo create`. Never called when origin
 * already exists.
 */
export async function offerRepoCreation(
  ctx: Context,
  repoRoot: string,
  /** Writes the files that belong in the first commit. Only called when
   * there is no commit yet. */
  prepareFirstCommit: () => Promise<void> = () => Promise.resolve(),
  /** The user already said yes in chat and the agent passed
   * --create-repo: answers this question, and only this one. */
  approved = false,
): Promise<RepoCreateOutcome> {
  const name = await repoName(ctx, repoRoot);
  const answer = approved
    ? "yes"
    : await ctx.prompt.confirm(repoCreateQuestion(name));

  if (answer === "no-terminal") {
    return { kind: "declined", message: noTerminalSteps(name) };
  }
  if (answer === "no") {
    return { kind: "declined", message: declinedSteps(name) };
  }

  const head = await ctx.git.run(["rev-parse", "HEAD"], repoRoot);
  let commitProblem: string | undefined;
  if (head.code !== 0) {
    await prepareFirstCommit();
    commitProblem = await makeFirstCommit(ctx, repoRoot);
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
      // Without a commit there is nothing to push; the user's commit
      // command pushes it.
      ...(commitProblem === undefined ? ["--push"] : []),
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
  if (commitProblem !== undefined) {
    return {
      kind: "commit-needed",
      origin,
      message: commitNeededSteps(commitProblem),
    };
  }
  return { kind: "created", origin };
}

/** Stages everything (the .gitignore already keeps node_modules/ out) and
 * commits. Returns undefined on success, else why it failed. Git can't
 * prompt here: no terminal is attached, so a signing key that needs a
 * passphrase fails instead of hanging. */
async function makeFirstCommit(
  ctx: Context,
  repoRoot: string,
): Promise<string | undefined> {
  const add = await ctx.git.run(["add", "-A"], repoRoot);
  if (add.code !== 0) {
    return add.stderr.trim().split("\n")[0] ?? "git add failed";
  }
  const commit = await ctx.git.run(
    ["commit", "-m", FIRST_COMMIT_MESSAGE],
    repoRoot,
  );
  if (commit.code !== 0) {
    return (commit.stderr || commit.stdout).trim().split("\n")[0] ?? "";
  }
  return undefined;
}
