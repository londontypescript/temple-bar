// Decision 100 (ADR 0021): setup works only on public repositories owned by
// a GitHub organisation. On a personal repository the owner merges past the
// judge without being asked, and a private one refuses the rulesets. Both
// checks run before setup writes anything, and anything GitHub's answer
// doesn't settle is refused, never assumed fine.

import type { Context } from "../context.ts";
import type { InitArgs } from "./init-args.ts";
import {
  checkGhHost,
  readOrigin,
  RERUN_INIT,
  type GithubOrigin,
  type RequirementResult,
} from "./requirements.ts";
import { field } from "./ruleset-update.ts";

const WROTE_NOTHING = "Setup wrote nothing.";

/** The refusal for a personal account, named. */
function personalAccount(login: string, where: string): string {
  return (
    `${where} "${login}" is a personal GitHub account, not an organisation. ` +
    "temple-bar sets up only repositories owned by an organisation, where " +
    "only admins can merge past its checks: on a personal repository the " +
    "owner merges past them without being asked. To prototype, work " +
    "without temple-bar; when the project is ready, ask an organisation " +
    `admin for a repository. ${WROTE_NOTHING}`
  );
}

function fail(message: string): {
  readonly ok: false;
  readonly message: string;
} {
  return { ok: false, message };
}

const OK: RequirementResult = { ok: true, value: undefined };

/** A `gh api` read, always of github.com: `--hostname` keeps gh from
 * answering from another host it is signed in to. */
async function readJson(
  ctx: Context,
  repoRoot: string,
  path: string,
): Promise<
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string }
> {
  const result = await ctx.gh.run(
    ["api", path, "--hostname", "github.com"],
    repoRoot,
  );
  if (result.code !== 0) {
    return { ok: false, error: (result.stderr || result.stdout).trim() };
  }
  try {
    return { ok: true, value: JSON.parse(result.stdout) as unknown };
  } catch {
    return { ok: false, error: `unexpected reply from ${path}` };
  }
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}

/** `origin` already exists: the repository must be public and owned by an
 * organisation. `owner` is the user's `--owner`, which must agree. */
async function checkExistingRepository(
  ctx: Context,
  repoRoot: string,
  origin: GithubOrigin,
  owner: string | undefined,
): Promise<RequirementResult> {
  const full = `${origin.owner}/${origin.repo}`;
  if (
    owner !== undefined &&
    owner.toLowerCase() !== origin.owner.toLowerCase()
  ) {
    return fail(
      `--owner ${owner} was given, but "origin" points at ${full}. --owner ` +
        "only names the owner of a repository setup creates; check with the " +
        `user which is right. ${WROTE_NOTHING}`,
    );
  }
  const repo = await readJson(ctx, repoRoot, `repos/${full}`);
  if (!repo.ok) {
    if (/\bHTTP 404\b/.test(repo.error)) {
      return fail(
        `GitHub doesn't show you ${full}, where "origin" points: it doesn't ` +
          "exist, or you can't see it. Create it as a public repository in " +
          "an organisation, or point origin at the right one, then run " +
          `${RERUN_INIT} again. ${WROTE_NOTHING}`,
      );
    }
    return couldNotConfirm(full, firstLine(repo.error));
  }
  const type = field(field(repo.value, "owner"), "type");
  const login = field(field(repo.value, "owner"), "login");
  if (type === "User" && typeof login === "string") {
    return fail(personalAccount(login, `"origin" points at ${full}, owned by`));
  }
  if (type !== "Organization") {
    return couldNotConfirm(full, "its owner's type was missing or unexpected");
  }
  const visibility = field(repo.value, "visibility");
  const isPrivate = field(repo.value, "private");
  if (visibility === "public" && isPrivate === false) {
    return OK;
  }
  if (
    visibility === "private" ||
    visibility === "internal" ||
    isPrivate === true
  ) {
    // "private" too when GitHub contradicts itself (public, yet private).
    return fail(
      `${full} is ${visibility === "internal" ? "internal" : "private"}. ` +
        "temple-bar supports only public repositories, and setup never " +
        "changes a repository's visibility: making it public publishes its " +
        "whole history, every commit's name and email included, so that is " +
        `the user's decision. ${WROTE_NOTHING}`,
    );
  }
  return couldNotConfirm(full, "its visibility was missing or unexpected");
}

/** Whether GitHub lists no branch in origin's repository: nothing was ever
 * pushed, so the first push is still to come, and it is setup's (see
 * first-push.ts). Asked only under `--create-repo`, the one run that may
 * make that push; an answer it can't read stops setup. */
async function hasNoBranches(
  ctx: Context,
  repoRoot: string,
  origin: GithubOrigin,
): Promise<RequirementResult<boolean>> {
  const full = `${origin.owner}/${origin.repo}`;
  const branches = await readJson(
    ctx,
    repoRoot,
    `repos/${full}/branches?per_page=1`,
  );
  if (!branches.ok) {
    return couldNotRead(full, firstLine(branches.error));
  }
  if (!Array.isArray(branches.value)) {
    return couldNotRead(full, "they came back in another shape");
  }
  return { ok: true, value: branches.value.length === 0 };
}

/** No `origin` yet: the owner the user named must be an organisation. */
async function checkNewOwner(
  ctx: Context,
  repoRoot: string,
  owner: string,
): Promise<RequirementResult> {
  const account = await readJson(ctx, repoRoot, `users/${owner}`);
  if (!account.ok) {
    if (/\bHTTP 404\b/.test(account.error)) {
      return fail(
        `GitHub has no account named "${owner}". Check the organisation's ` +
          `name with the user, then run setup again. ${WROTE_NOTHING}`,
      );
    }
    return couldNotConfirmOwner(owner, firstLine(account.error));
  }
  const type = field(account.value, "type");
  const login = field(account.value, "login");
  if (type === "Organization") {
    return OK;
  }
  if (type === "User") {
    return fail(
      personalAccount(typeof login === "string" ? login : owner, "--owner"),
    );
  }
  return couldNotConfirmOwner(owner, "its type was missing or unexpected");
}

type Refusal = ReturnType<typeof fail>;

function couldNotConfirm(full: string, reason: string): Refusal {
  return fail(
    `Couldn't confirm that ${full} is public and owned by an organisation ` +
      `(${reason}), so setup stopped. Run ${RERUN_INIT} again once gh can ` +
      `read it. ${WROTE_NOTHING}`,
  );
}

function couldNotConfirmOwner(owner: string, reason: string): Refusal {
  return fail(
    `Couldn't confirm that "${owner}" is a GitHub organisation (${reason}), ` +
      `so setup stopped. Run setup again once gh can read it. ${WROTE_NOTHING}`,
  );
}

function couldNotRead(full: string, reason: string): Refusal {
  return fail(
    `Couldn't read ${full}'s branches on GitHub (${reason}), so setup ` +
      "stopped. Run the same command again once gh can read them. " +
      WROTE_NOTHING,
  );
}

/** What setup does about GitHub, settled before it writes anything. */
export type RepositoryPlan =
  /** Refused: nothing was written. */
  | { readonly kind: "refused"; readonly message: string }
  /** origin isn't GitHub: a stop, after .gitignore, as before. */
  | { readonly kind: "wrong-host"; readonly url: string }
  /** origin is an organisation's public repository. `finish`: the first
   * push is still to come, and `--create-repo` asks setup to make it. */
  | {
      readonly kind: "existing";
      readonly origin: GithubOrigin;
      readonly finish: boolean;
    }
  /** No origin: offer to create it, owned by `--owner` once named. */
  | { readonly kind: "create" };

/** Reads origin and applies the rule above to it, or to the owner named
 * for a new repository. Only reads; every refusal writes nothing. */
export async function planRepository(
  ctx: Context,
  repoRoot: string,
  args: InitArgs,
): Promise<RepositoryPlan> {
  const refused = (message: string): RepositoryPlan => ({
    kind: "refused",
    message,
  });
  const host = checkGhHost(ctx);
  if (!host.ok) {
    return refused(`${host.message} ${WROTE_NOTHING}`);
  }
  const origin = await readOrigin(ctx, repoRoot);
  if (origin.state === "unreadable") {
    return refused(
      `Couldn't read the "origin" remote (git: ${origin.reason || "no answer"}), ` +
        `so setup stopped. Fix what git reports, then run ${RERUN_INIT} ` +
        `again. ${WROTE_NOTHING}`,
    );
  }
  if (origin.state === "wrong-host") {
    return { kind: "wrong-host", url: origin.url };
  }
  if (origin.state === "missing") {
    if (args.owner !== undefined) {
      const owner = await checkNewOwner(ctx, repoRoot, args.owner);
      if (!owner.ok) {
        return refused(owner.message);
      }
    }
    return { kind: "create" };
  }
  const repo = await checkExistingRepository(
    ctx,
    repoRoot,
    origin.origin,
    args.owner,
  );
  if (!repo.ok) {
    return refused(repo.message);
  }
  // Only the run that may make the first push asks: without the flag,
  // nothing changes from before.
  if (!args.createRepo) {
    return { kind: "existing", origin: origin.origin, finish: false };
  }
  const empty = await hasNoBranches(ctx, repoRoot, origin.origin);
  return empty.ok
    ? { kind: "existing", origin: origin.origin, finish: empty.value }
    : refused(empty.message);
}
