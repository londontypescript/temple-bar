// Offers to create the GitHub repository when `origin` is missing. Only ever
// acts on an explicit "yes" (ctx.prompt, or the --create-repo flag an agent
// passes after the user said yes in chat), and only for an owner the user
// named, which the caller has already confirmed is an organisation (ADR
// 0021). Every path that doesn't create stops `init` before it writes
// anything more.

import type { Context } from "../context.ts";
import {
  createRepoRerun,
  identitiesNotAgreed,
  pushAgreed,
  sameRepository,
} from "./first-push.ts";
import {
  identitiesText,
  readHeadState,
  readPushIdentities,
  type PushIdentities,
} from "./push-identities.ts";
import { mainCheckoutName } from "./repo-name.ts";
import {
  parseGithubOrigin,
  RERUN_INIT,
  type GithubOrigin,
} from "./requirements.ts";

const SOME_ORGANISATION = "<organisation>";

/** The command people who'd rather create the repository themselves are
 * given. It always names the owner: without one, gh picks the signed-in
 * personal account. */
export function repoCreateCommand(owner: string, name: string): string {
  return `gh repo create ${owner}/${name} --public --source . --remote origin --push`;
}

/** What setup runs on a yes: no `--push`, because setup pushes itself. */
function createArgs(full: string): readonly string[] {
  return [
    "repo",
    "create",
    full,
    "--public",
    "--source",
    ".",
    "--remote",
    "origin",
  ];
}

function byHand(owner: string, name: string): string {
  return (
    `To create it yourself instead, run:\n  ${repoCreateCommand(owner, name)}\n` +
    `then run ${RERUN_INIT} again.\n`
  );
}

/** No `--owner`: setup can't name the owner, so it never guesses one. */
function ownerNeededSteps(name: string, identities: PushIdentities): string {
  return (
    "No GitHub remote found, so nothing was created. temple-bar sets up " +
    "only public repositories owned by a GitHub organisation, never a " +
    "personal account. An agent: ask the user which organisation should " +
    `own the new public repository "${name}", and show them the identities ` +
    "below. Only if they agree, run " +
    `${createRepoRerun(SOME_ORGANISATION, identities.code)}. ` +
    byHand(SOME_ORGANISATION, name) +
    identitiesText(identities)
  );
}

function repoCreateQuestion(
  owner: string,
  name: string,
  identities: PushIdentities,
): string {
  const full = `${owner}/${name}`;
  return (
    `No GitHub remote found. Create the public repository ${full}, owned ` +
    `by the organisation ${owner}, and push this branch to it? ` +
    identitiesText(identities) +
    `This runs \`gh ${createArgs(full).join(" ")}\`, then pushes this ` +
    "branch's commits (never tags)."
  );
}

function noTerminalSteps(
  owner: string,
  name: string,
  identities: PushIdentities,
): string {
  return (
    "No terminal to ask in, so nothing was created. An agent: ask the user " +
    `whether to create the public repository ${owner}/${name}, owned by the ` +
    `organisation ${owner}, and show them the identities below. Only if ` +
    `they say yes, run ${createRepoRerun(owner, identities.code)}. ` +
    byHand(owner, name) +
    identitiesText(identities)
  );
}

function declinedSteps(owner: string, name: string): string {
  return (
    "OK, nothing was created. Run this yourself when you're ready:\n  " +
    `${repoCreateCommand(owner, name)}\nthen run ${RERUN_INIT} again.`
  );
}

const FIRST_COMMIT_MESSAGE = "Initial commit";

/** Setup couldn't make the first commit itself (for example signing needs
 * a passphrase an agent can't type). The repository exists on GitHub by
 * then, empty; the commit is left, and the rerun pushes it. */
function commitNeededSteps(detail: string, rerun: string): string {
  return (
    "Created the GitHub repository, but couldn't make the first commit " +
    `here${detail === "" ? "" : ` (${detail})`}, so nothing was pushed. ` +
    "Everything is staged. Hooks are not installed yet, because they " +
    "refuse commits to main. Commit it yourself:\n" +
    `  git commit -m "${FIRST_COMMIT_MESSAGE}"\n` +
    `then run ${rerun} to push it and finish.`
  );
}

export type RepoCreateOutcome =
  | { readonly kind: "declined"; readonly message: string }
  | { readonly kind: "created"; readonly origin: GithubOrigin }
  | { readonly kind: "failed"; readonly message: string };

/** What the caller knows before asking. */
export interface RepoCreateRequest {
  /** `--owner`: the organisation the user named, already confirmed to be
   * one. Undefined when they haven't named it yet. */
  readonly owner: string | undefined;
  /** `--create-repo`: the user already said yes in chat. Answers this
   * question, and only this one. */
  readonly approved: boolean;
  /** `--identities`: the code of the identities the user was shown. */
  readonly identitiesCode: string | undefined;
}

/** Asks, unless `--create-repo` answered with the code of the identities
 * read now. Resolves undefined on a yes, or the stop's message. */
async function agreed(
  ctx: Context,
  request: RepoCreateRequest & { readonly owner: string },
  name: string,
  identities: PushIdentities,
): Promise<string | undefined> {
  const { owner } = request;
  if (request.approved) {
    return request.identitiesCode === identities.code
      ? undefined
      : identitiesNotAgreed(owner, request.identitiesCode, identities);
  }
  const answer = await ctx.prompt.confirm(
    repoCreateQuestion(owner, name, identities),
  );
  if (answer === "no-terminal") {
    return noTerminalSteps(owner, name, identities);
  }
  return answer === "no" ? declinedSteps(owner, name) : undefined;
}

/**
 * Runs the whole "no origin yet" flow: asks, and on yes makes the first
 * commit if the branch has none (before hooks exist to refuse it), creates
 * the repository with `gh repo create`, then pushes. Never called when
 * origin already exists.
 */
export async function offerRepoCreation(
  ctx: Context,
  repoRoot: string,
  request: RepoCreateRequest,
  /** Writes the files that belong in the first commit. Only called when
   * there is no commit yet. */
  prepareFirstCommit: () => Promise<void> = () => Promise.resolve(),
): Promise<RepoCreateOutcome> {
  const declined = (message: string): RepoCreateOutcome => ({
    kind: "declined",
    message,
  });
  const failed = (message: string): RepoCreateOutcome => ({
    kind: "failed",
    message,
  });
  // Only offered when there is no origin, so the main checkout's folder is
  // the whole rule.
  const name = await mainCheckoutName(ctx, repoRoot);
  const head = await readHeadState(ctx, repoRoot);
  if (head.kind === "detached") {
    return declined(
      "HEAD is detached, so there is no branch to publish and nothing was " +
        `created. Switch to the branch to publish, then run ${RERUN_INIT} again.`,
    );
  }
  const read = await readPushIdentities(ctx, repoRoot, head);
  if (!read.ok) {
    return declined(`${read.message} Nothing was created or pushed.`);
  }
  const identities = read.value;
  const { owner } = request;
  if (owner === undefined) {
    return declined(ownerNeededSteps(name, identities));
  }
  const stop = await agreed(ctx, { ...request, owner }, name, identities);
  if (stop !== undefined) {
    return declined(stop);
  }

  let commitProblem: string | undefined;
  if (head.kind === "unborn") {
    await prepareFirstCommit();
    commitProblem = await makeFirstCommit(ctx, repoRoot);
  }

  const full = `${owner}/${name}`;
  const rerun = createRepoRerun(owner, identities.code);
  const created = await ctx.gh.run(createArgs(full), repoRoot);
  const originUrl = await ctx.git.run(
    ["remote", "get-url", "origin"],
    repoRoot,
  );
  if (created.code !== 0) {
    return failed(creationFailure(full, created, originUrl.code === 0, rerun));
  }
  const made = createdRepository(created.stdout, { owner, repo: name });
  const madeName = `${made.owner}/${made.repo}`;
  if (made.owner.toLowerCase() !== owner.toLowerCase()) {
    return failed(
      `gh reports creating ${madeName}, which isn't owned by ${owner}, so ` +
        "nothing was pushed. Check with the user which repository is right.",
    );
  }
  // Only the repository just made, as agreed: origin read back could name
  // another one (a `url.<base>.insteadOf` setting rewrites it).
  const origin = parseGithubOrigin(originUrl.stdout);
  if (origin === undefined || !sameRepository(origin, made)) {
    return failed(
      `Created ${madeName}, but "origin" points at ` +
        `${originUrl.stdout.trim() || "nothing"}, not at it, so nothing was ` +
        "pushed. Make origin point at it (a `url.<base>.insteadOf` setting " +
        `can rewrite it), then run ${rerun} again.`,
    );
  }
  if (commitProblem !== undefined) {
    return failed(commitNeededSteps(commitProblem, rerun));
  }
  const pushed = await pushAgreed(ctx, repoRoot, origin, identities);
  return pushed.ok
    ? { kind: "created", origin }
    : failed(`Created the GitHub repository ${madeName}. ${pushed.message}`);
}

/** The repository gh made. gh prints its URL, which carries the name GitHub
 * gave it (GitHub replaces characters a name can't hold); without one, the
 * name asked for. */
function createdRepository(stdout: string, asked: GithubOrigin): GithubOrigin {
  for (const line of stdout.split("\n")) {
    const parsed = parseGithubOrigin(line);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return asked;
}

/** What went wrong when `gh repo create` failed, and the fix. gh creates
 * the repository, then adds origin, and stops at the first step that
 * fails, undoing nothing. So with origin there, only the push is left.
 * With origin missing setup infers nothing: the name may belong to a
 * repository that already existed, which is not one setup made. */
function creationFailure(
  full: string,
  result: { readonly stdout: string; readonly stderr: string },
  hasOrigin: boolean,
  rerun: string,
): string {
  const said = (result.stderr || result.stdout).trim();
  if (hasOrigin) {
    return (
      `gh created ${full} and set it as "origin", then failed, so nothing ` +
      `was pushed. gh said:\n${said}\nRun ${rerun} again to push.`
    );
  }
  return (
    `\`gh repo create ${full}\` failed, and setup pushed nothing. gh ` +
    `said:\n${said}\nFix what gh reports, then run ${rerun} again.`
  );
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

/** A licence file GitHub recognises, at the repository's root. */
const LICENSE_NAME = /^(?:un)?licen[cs]e(?:[.-].*)?$|^copying(?:[.-].*)?$/i;

/** A note, never a failure, for a public repository with no licence: the
 * code is public, but nobody else may reuse it until one is added. The
 * licence is the user's choice, so setup never picks one. Says nothing
 * when the root can't be listed. */
export async function licenseNote(
  ctx: Context,
  repoRoot: string,
): Promise<string | undefined> {
  let files: string[];
  try {
    files = await ctx.fs.glob(repoRoot, "*");
  } catch {
    return undefined;
  }
  if (files.some((file) => LICENSE_NAME.test(file))) {
    return undefined;
  }
  return (
    "Note: this public repository has no LICENSE file, so nobody else may " +
    "reuse its code. Ask the user which licence they want and add it as " +
    "LICENSE; setup never picks one.\n"
  );
}
