// Setup's own first push to a new repository: the first time the history
// becomes public, so only on the user's yes to the identities it publishes.
// Setup pushes rather than `gh repo create --push`, so it decides exactly
// what goes (the one commit it read, to its branch, never tags) and can tell
// a repository GitHub refused from a push that failed.

import type { Context } from "../context.ts";
import {
  identitiesText,
  readHeadState,
  readPushIdentities,
  type HeadState,
  type PushIdentities,
} from "./push-identities.ts";
import {
  parseGithubOrigin,
  rerunInit,
  type GithubOrigin,
} from "./requirements.ts";

export type PushOutcome =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

/** The rerun that answers the question: the user's yes, their owner, and
 * the code of the identities they saw. Only ever printed beside those
 * identities, or after the user agreed to them. */
export function createRepoRerun(owner: string, code: string): string {
  return rerunInit("--create-repo", "--owner", owner, "--identities", code);
}

/** The rerun without a code, for when the identities may still change (no
 * commit yet): it stops and shows them, with the code to agree. */
function showIdentitiesRerun(owner: string): string {
  return rerunInit("--create-repo", "--owner", owner);
}

/** `--create-repo` came without the code of what the user saw, or with
 * another one: the identities a push would publish now aren't the ones
 * they agreed to. */
export function identitiesNotAgreed(
  owner: string,
  given: string | undefined,
  identities: PushIdentities,
): string {
  const why =
    given === undefined
      ? "--create-repo needs --identities with the code setup shows with " +
        "the identities, so nothing was created or pushed: the user sees " +
        "who a push makes public before agreeing to it."
      : `The commit identities changed since code ${given} was shown, so ` +
        "nothing was created or pushed.";
  return (
    `${why} Show the user the identities below and ask again; only if ` +
    `they agree, run ${createRepoRerun(owner, identities.code)}.\n` +
    identitiesText(identities)
  );
}

function firstLines(text: string): string {
  return text.trim().split("\n").slice(0, 5).join("\n");
}

function fullName(origin: GithubOrigin): string {
  return `${origin.owner}/${origin.repo}`;
}

/** GitHub's owner and repository names ignore case. */
function sameRepository(a: GithubOrigin, b: GithubOrigin): boolean {
  return fullName(a).toLowerCase() === fullName(b).toLowerCase();
}

/** Every URL a push to origin goes to (a `pushurl`, or `pushInsteadOf`,
 * which git expands here) must be origin's own repository; otherwise the
 * push could publish the history somewhere the user never agreed to. */
async function checkPushUrls(
  ctx: Context,
  repoRoot: string,
  origin: GithubOrigin,
): Promise<string | undefined> {
  const result = await ctx.git.run(
    ["remote", "get-url", "--push", "--all", "origin"],
    repoRoot,
  );
  const urls = result.stdout
    .split("\n")
    .map((url) => url.trim())
    .filter((url) => url !== "");
  if (result.code !== 0 || urls.length === 0) {
    return (
      `Nothing was pushed: couldn't read where a push to "origin" goes ` +
      `(git: ${firstLines(result.stderr) || "no answer"}).`
    );
  }
  const elsewhere = urls.filter((url) => {
    const parsed = parseGithubOrigin(url);
    return parsed === undefined || !sameRepository(parsed, origin);
  });
  return elsewhere.length === 0
    ? undefined
    : `Nothing was pushed: a push to "origin" would also go to ` +
        `${elsewhere.join(", ")}, not only ${fullName(origin)}. Remove that ` +
        "push URL (`git remote set-url --delete --push origin <url>`), then " +
        "run setup again.";
}

/** Why HEAD can't be pushed, for a stop. */
function notPushable(head: Exclude<HeadState, { kind: "commits" }>): string {
  if (head.kind === "detached") {
    return "HEAD is detached. Switch to the branch to publish";
  }
  if (head.kind === "unborn") {
    return `${head.branch} has no commits yet. Commit first`;
  }
  return `HEAD couldn't be read (${head.reason}). Fix that`;
}

/** Pushes the commit HEAD names to its branch on origin, after reading the
 * history once more: a commit made while the question waited, a hook's
 * co-author in setup's own first commit or a changed setting may carry
 * someone the user never saw. */
export async function pushAgreed(
  ctx: Context,
  repoRoot: string,
  origin: GithubOrigin,
  agreed: PushIdentities,
): Promise<PushOutcome> {
  const full = fullName(origin);
  const rerun = createRepoRerun(origin.owner, agreed.code);
  const head = await readHeadState(ctx, repoRoot);
  if (head.kind !== "commits") {
    return {
      ok: false,
      message: `Nothing was pushed to ${full}: ${notPushable(head)}, then run ${rerun} again.`,
    };
  }
  const now = await readPushIdentities(ctx, repoRoot, head);
  if (!now.ok) {
    return {
      ok: false,
      message: `${now.message} Nothing was pushed to ${full}.`,
    };
  }
  if (now.value.code !== agreed.code) {
    return {
      ok: false,
      message:
        `Nothing was pushed to ${full}: the identities a push would publish ` +
        `changed since code ${agreed.code} was agreed. Show the user the ` +
        "identities below and ask again; only if they agree, run " +
        `${createRepoRerun(origin.owner, now.value.code)}.\n` +
        identitiesText(now.value),
    };
  }
  const stray = await checkPushUrls(ctx, repoRoot, origin);
  if (stray !== undefined) {
    return { ok: false, message: stray };
  }
  const push = await ctx.git.run(
    [
      // Exactly the commit read above, never tags: `push.followTags`
      // would also send annotated tags, and their taggers.
      "-c",
      "push.followTags=false",
      "push",
      "origin",
      `${head.commit}:refs/heads/${head.branch}`,
    ],
    repoRoot,
  );
  if (push.code === 0) {
    // Tracking origin's branch, as a push with `-u` would. A convenience:
    // if it fails, the push still happened.
    await ctx.git.run(
      ["branch", `--set-upstream-to=origin/${head.branch}`, head.branch],
      repoRoot,
    );
    return { ok: true };
  }
  const url = await ctx.git.run(["remote", "get-url", "origin"], repoRoot);
  return {
    ok: false,
    message:
      `The push to ${full} didn't complete (it may or may not have reached ` +
      `GitHub), so setup stopped. git said:\n${firstLines(push.stderr || push.stdout)}\n` +
      `If git couldn't sign in over origin's URL (${url.stdout.trim()}): ` +
      "`gh auth setup-git` sets up HTTPS, or " +
      `\`git remote set-url origin git@github.com:${full}.git\` switches to ` +
      `SSH. Otherwise, fix what git reports. Then run ${rerun} again: while ` +
      "GitHub lists no branches, it pushes once the identities are still " +
      "the ones agreed.",
  };
}

/** `origin` is an organisation's public repository GitHub lists no branches
 * in, and `--create-repo` was given: a creation whose push never happened,
 * or a repository made by hand. Its first push is setup's, on the code of
 * the identities the user agreed to, as for a repository setup creates.
 * Resolves undefined once pushed, or the stop's message. */
export async function finishCreation(
  ctx: Context,
  repoRoot: string,
  origin: GithubOrigin,
  code: string | undefined,
): Promise<string | undefined> {
  const full = fullName(origin);
  const head = await readHeadState(ctx, repoRoot);
  if (head.kind !== "commits") {
    return (
      `GitHub lists no branches in ${full}, and there is nothing here to ` +
      `push: ${notPushable(head)}, then run ` +
      `${showIdentitiesRerun(origin.owner)} to see the identities to agree.`
    );
  }
  const identities = await readPushIdentities(ctx, repoRoot, head);
  if (!identities.ok) {
    return identities.message;
  }
  if (code !== identities.value.code) {
    return identitiesNotAgreed(origin.owner, code, identities.value);
  }
  const pushed = await pushAgreed(ctx, repoRoot, origin, identities.value);
  return pushed.ok ? undefined : pushed.message;
}
