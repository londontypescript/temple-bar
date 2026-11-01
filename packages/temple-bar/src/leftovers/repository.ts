// What `leftovers` reads about the repository as a whole before it judges
// any worktree or branch: which repository git and gh are looking at, each
// branch's newest pull request, and the local and remote branches. Anything
// that makes the answer doubtful is a blocker: with one, nothing counts as
// finished, so nothing is removed.

import path from "node:path";

import type { Context } from "../context.ts";
import { readRepository } from "../merge/github.ts";
import { listWorktrees, type Worktree } from "../merge/worktrees.ts";
import { withoutNewline } from "./paths.ts";

/** Variables that point git or gh somewhere other than this checkout. */
const REDIRECTING = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_NAMESPACE",
  "GH_REPO",
  "GH_HOST",
] as const;

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export interface PullRequestFacts {
  readonly number: number;
  readonly state: "OPEN" | "CLOSED" | "MERGED";
  /** The last commit the pull request held. */
  readonly head: string;
  readonly crossRepository: boolean;
  readonly base: string;
}

/** A branch's newest pull request, or why it can't be read. */
export type Newest =
  | { readonly kind: "known"; readonly pullRequest: PullRequestFacts }
  | { readonly kind: "unknown" };

export interface LocalRef {
  readonly tip: string;
  /** What the ref points at when it is symbolic; empty otherwise. */
  readonly symref: string;
}

export interface Repo {
  readonly primary: Worktree;
  readonly worktrees: readonly Worktree[];
  /** The repository's shared git folder, as an absolute path. */
  readonly commonDir: string | undefined;
  readonly nameWithOwner: string | undefined;
  readonly defaultBranch: string | undefined;
  /** Why nothing can count as finished; empty when all is in order. */
  readonly blockers: readonly string[];
  /** Keyed by full ref name, `refs/heads/<headRefName>`. Undefined when gh
   * couldn't list them. */
  readonly pullRequests: ReadonlyMap<string, Newest> | undefined;
  /** Keyed by full ref name. Undefined when git couldn't list them. */
  readonly localRefs: ReadonlyMap<string, LocalRef> | undefined;
  /** origin's branches, full ref name to tip. Undefined when unread. */
  readonly remoteRefs: ReadonlyMap<string, string> | undefined;
}

/** `owner/name` of a github.com remote URL, in lower case, or undefined
 * for anything else (another host, a local path, a form not known here). */
export function gitHubRepositoryOf(url: string): string | undefined {
  const forms = [
    /^https:\/\/(?:[^@/\s]+@)?github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/,
    /^ssh:\/\/git@github\.com(?::22)?\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/,
    /^git@github\.com:([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/,
  ];
  for (const form of forms) {
    const match = form.exec(url);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      return `${match[1]}/${match[2]}`.toLowerCase();
    }
  }
  return undefined;
}

/** origin's fetch URLs and every push URL must all name `nameWithOwner`
 * on github.com: a push URL elsewhere would send the deletions there. */
async function originProblems(
  ctx: Context,
  cwd: string,
  nameWithOwner: string,
): Promise<string[]> {
  const problems: string[] = [];
  for (const push of [false, true]) {
    const what = push ? "push URL" : "URL";
    const result = await ctx.git.run(
      ["remote", "get-url", ...(push ? ["--push"] : []), "--all", "origin"],
      cwd,
    );
    const urls = result.stdout.split("\n").filter((url) => url !== "");
    if (result.code !== 0 || urls.length === 0) {
      problems.push(`origin's ${what} couldn't be read`);
      continue;
    }
    for (const url of urls) {
      if (gitHubRepositoryOf(url) !== nameWithOwner.toLowerCase()) {
        problems.push(
          `origin's ${what} ${url} doesn't name ${nameWithOwner} on github.com`,
        );
      }
    }
  }
  return problems;
}

function parsePullRequest(item: unknown): PullRequestFacts | undefined {
  if (typeof item !== "object" || item === null) {
    return undefined;
  }
  const raw = item as Record<string, unknown>;
  const { number, state, headRefOid, isCrossRepository, baseRefName } = raw;
  if (
    typeof number !== "number" ||
    !Number.isInteger(number) ||
    number <= 0 ||
    (state !== "OPEN" && state !== "CLOSED" && state !== "MERGED") ||
    typeof headRefOid !== "string" ||
    !OBJECT_ID.test(headRefOid) ||
    typeof isCrossRepository !== "boolean" ||
    typeof baseRefName !== "string" ||
    baseRefName === ""
  ) {
    return undefined;
  }
  return {
    number,
    state,
    head: headRefOid,
    crossRepository: isCrossRepository,
    base: baseRefName,
  };
}

/** Each branch's newest pull request; gh lists newest first. A pull
 * request with a missing or malformed field is unknown, never safe, and one
 * whose branch can't be read makes the whole list unknown, since it could
 * be any branch's newest. */
async function readPullRequests(
  ctx: Context,
  cwd: string,
): Promise<Map<string, Newest> | undefined> {
  const result = await ctx.gh.run(
    [
      "pr",
      "list",
      "--state",
      "all",
      "--limit",
      "1000",
      "--json",
      "number,headRefName,headRefOid,state,isCrossRepository,baseRefName",
    ],
    cwd,
  );
  if (result.code !== 0) {
    return undefined;
  }
  let list: unknown;
  try {
    list = JSON.parse(result.stdout);
  } catch {
    return undefined;
  }
  if (!Array.isArray(list)) {
    return undefined;
  }
  const newest = new Map<string, Newest>();
  for (const item of list as unknown[]) {
    const branch =
      typeof item === "object" && item !== null
        ? (item as Record<string, unknown>).headRefName
        : undefined;
    if (typeof branch !== "string" || branch === "") {
      return undefined;
    }
    const ref = `refs/heads/${branch}`;
    if (!newest.has(ref)) {
      const pullRequest = parsePullRequest(item);
      newest.set(
        ref,
        pullRequest === undefined
          ? { kind: "unknown" }
          : { kind: "known", pullRequest },
      );
    }
  }
  return newest;
}

/** Local branches by full name (`%(refname)`, so a tag sharing a branch's
 * name can't stand in for it), with their tips and, for a symbolic ref,
 * its target. Undefined when the listing failed or warned (git warns about
 * a broken ref and leaves it out), which is never the same as no branches. */
export async function readLocalRefs(
  ctx: Context,
  cwd: string,
): Promise<Map<string, LocalRef> | undefined> {
  const result = await ctx.git.run(
    [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)%00%(symref)",
      "refs/heads/",
    ],
    cwd,
  );
  if (result.code !== 0 || result.stderr !== "") {
    return undefined;
  }
  const refs = new Map<string, LocalRef>();
  if (result.stdout === "") {
    return refs;
  }
  if (!result.stdout.endsWith("\n")) {
    return undefined;
  }
  // Ref names hold no newline or NUL.
  for (const line of result.stdout.slice(0, -1).split("\n")) {
    const [name = "", tip = "", symref, extra] = line.split("\0");
    if (
      !name.startsWith("refs/heads/") ||
      !OBJECT_ID.test(tip) ||
      symref === undefined ||
      extra !== undefined
    ) {
      return undefined;
    }
    refs.set(name, { tip, symref });
  }
  return refs;
}

/** origin's branches by full name. Undefined when origin can't be read. */
async function readRemoteRefs(
  ctx: Context,
  cwd: string,
): Promise<Map<string, string> | undefined> {
  const result = await ctx.git.run(["ls-remote", "--heads", "origin"], cwd);
  if (result.code !== 0) {
    return undefined;
  }
  const refs = new Map<string, string>();
  for (const line of result.stdout.split("\n")) {
    if (line === "") {
      continue;
    }
    const tab = line.indexOf("\t");
    const tip = line.slice(0, tab);
    const name = line.slice(tab + 1);
    if (tab <= 0 || !OBJECT_ID.test(tip) || !name.startsWith("refs/heads/")) {
      return undefined;
    }
    refs.set(name, tip);
  }
  return refs;
}

/** Why `--remove` must not start at all: the environment points git or gh
 * at another repository, or a graft rewrites ancestry (which would fake
 * "holds nothing beyond the merged head"). The report shows the same
 * reasons as blockers. */
export async function refusalsToStart(
  ctx: Context,
  commonDir: string | undefined,
): Promise<string[]> {
  const refusals = REDIRECTING.filter(
    (name) => ctx.env[name] !== undefined,
  ).map(
    (name) =>
      `${name} is set, so git or gh may be looking at another repository`,
  );
  if (ctx.env.GIT_GRAFT_FILE !== undefined) {
    refusals.push("GIT_GRAFT_FILE is set, so ancestry may be rewritten");
  }
  if (commonDir === undefined) {
    refusals.push("git couldn't say where the repository's folder is");
  } else {
    const grafts = path.join(commonDir, "info", "grafts");
    const kind = await ctx.fs.classify(grafts).catch(() => "unreadable");
    if (kind !== "missing") {
      refusals.push(`a graft file rewrites ancestry (${grafts})`);
    }
  }
  return refusals;
}

export async function readCommonDir(
  ctx: Context,
  cwd: string,
): Promise<string | undefined> {
  const result = await ctx.git.run(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    cwd,
  );
  return result.code === 0 ? withoutNewline(result.stdout) : undefined;
}

/** Everything about the repository the checks need, read fresh. Only the
 * pull request list can be passed in, so a re-check before deleting reads
 * git again but needn't ask GitHub for the list twice. */
export async function readRepo(
  ctx: Context,
  /** Any folder of the repository; its commands run in the primary. */
  from: string,
  options: {
    readonly pullRequests?: ReadonlyMap<string, Newest> | undefined;
    readonly remote: boolean;
  },
): Promise<Repo> {
  const worktrees = await listWorktrees(ctx, from);
  const primary = worktrees[0];
  if (primary === undefined) {
    throw new Error("git listed no worktrees");
  }
  const cwd = primary.path;
  const commonDir = await readCommonDir(ctx, cwd);
  const blockers = await refusalsToStart(ctx, commonDir);
  const repository = await readRepository(ctx, cwd).catch((error: unknown) => {
    blockers.push(error instanceof Error ? error.message : String(error));
    return undefined;
  });
  if (repository !== undefined) {
    blockers.push(
      ...(await originProblems(ctx, cwd, repository.nameWithOwner)),
    );
  }
  const pullRequests =
    "pullRequests" in options
      ? options.pullRequests
      : await readPullRequests(ctx, cwd);
  return {
    primary,
    worktrees,
    commonDir,
    nameWithOwner: repository?.nameWithOwner,
    defaultBranch: repository?.defaultBranch,
    blockers,
    pullRequests,
    localRefs: await readLocalRefs(ctx, cwd),
    remoteRefs: options.remote ? await readRemoteRefs(ctx, cwd) : undefined,
  };
}
