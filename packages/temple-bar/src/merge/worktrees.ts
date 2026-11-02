// Reads `git worktree list --porcelain`: which folder has which branch
// checked out. `temple-bar merge` (to find the worktree to update, and to say
// where it kept it afterwards), `temple-bar ready` and `temple-bar leftovers`
// (to find, and remove, worktrees left behind) all need the same answer, so
// it is read once, here, and every caller gets the same protection.
//
// A worktree's path can hold any byte but NUL, a newline included. With
// `-z` git ends every line with NUL, so a path is read whole. Git before 2.36
// has no `-z` (stock Ubuntu 22.04 ships 2.34), and in its newline format a
// path holding a newline can't be told apart from the lines after it: a path
// can even be crafted to read as two whole worktrees. So on such a git the
// listing is read strictly, and checked against git's own record of each
// linked worktree, and anything that doesn't fit stops the caller rather
// than being guessed at.

import path from "node:path";

import type { Context } from "../context.ts";

export interface Worktree {
  readonly path: string;
  /** Short branch name, or undefined when detached or bare. */
  readonly branch: string | undefined;
  /** The full ref git names, such as `refs/heads/feat/x`, or undefined. */
  readonly branchRef: string | undefined;
  readonly head: string | undefined;
  /** The first entry git lists: the original clone, never removed. */
  readonly primary: boolean;
  readonly bare: boolean;
  readonly detached: boolean;
  /** git says the folder is gone, so `git worktree prune` would drop it. */
  readonly prunable: boolean;
  /** Another tool's claim on the worktree, which git itself honours. */
  readonly locked: boolean;
  /** The reason given with the lock, when there is one. */
  readonly lockReason: string | undefined;
}

const BRANCH_PREFIX = "refs/heads/";
const KEYS = new Set([
  "HEAD",
  "branch",
  "detached",
  "bare",
  "locked",
  "prunable",
]);
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** git's exit code for an option it doesn't know: `-z` before 2.36. */
const UNKNOWN_OPTION = 129;

function unreadable(why: string): Error {
  return new Error(`could not read git's worktree list: ${why}`);
}

/** One worktree's lines. `strict` refuses any key git doesn't document,
 * since in the newline format an unknown line can be part of a path. */
function readBlock(
  lines: readonly string[],
  primary: boolean,
  strict: boolean,
): Worktree {
  const [first = "", ...rest] = lines;
  const worktreePath = first.startsWith("worktree ")
    ? first.slice("worktree ".length)
    : "";
  if (worktreePath === "") {
    throw unreadable("an entry doesn't start with its worktree's path");
  }
  const values = new Map<string, string | undefined>();
  for (const line of rest) {
    const space = line.indexOf(" ");
    const key = space === -1 ? line : line.slice(0, space);
    if (!KEYS.has(key)) {
      if (strict) {
        throw unreadable(`unexpected line in ${worktreePath}'s entry`);
      }
      continue;
    }
    if (values.has(key)) {
      throw unreadable(`${key} appears twice in ${worktreePath}'s entry`);
    }
    values.set(key, space === -1 ? undefined : line.slice(space + 1));
  }
  const bare = values.has("bare");
  const head = values.get("HEAD");
  const branchRef = values.get("branch");
  const detached = values.has("detached");
  const wellFormed = bare
    ? !values.has("HEAD") &&
      !values.has("branch") &&
      !detached &&
      values.get("bare") === undefined
    : head !== undefined &&
      OBJECT_ID.test(head) &&
      (branchRef === undefined) === detached &&
      (detached ? values.get("detached") === undefined : branchRef !== "");
  if (!wellFormed) {
    throw unreadable(`${worktreePath}'s entry is not in git's format`);
  }
  return {
    path: worktreePath,
    branch:
      branchRef?.startsWith(BRANCH_PREFIX) === true
        ? branchRef.slice(BRANCH_PREFIX.length)
        : branchRef,
    branchRef,
    head,
    primary,
    bare,
    detached,
    prunable: values.has("prunable"),
    locked: values.has("locked"),
    lockReason: values.get("locked"),
  };
}

/** Lines ended by `terminator`, each entry ended by an empty line. */
function readEntries(
  text: string,
  terminator: string,
  strict: boolean,
): Worktree[] {
  const ending = terminator.repeat(2);
  if (!text.endsWith(ending)) {
    throw unreadable("it doesn't end where git ends it");
  }
  const worktrees: Worktree[] = [];
  let block: string[] = [];
  for (const line of text.slice(0, -terminator.length).split(terminator)) {
    if (line !== "") {
      block.push(line);
      continue;
    }
    if (block.length === 0) {
      throw unreadable("it has an empty entry");
    }
    worktrees.push(readBlock(block, worktrees.length === 0, strict));
    block = [];
  }
  return worktrees;
}

/** Parses `git worktree list --porcelain -z`. Throws when it isn't in that
 * format. */
export function parseWorktreeListZ(stdout: string): Worktree[] {
  return readEntries(stdout, "\0", false);
}

/** Parses the newline format of git before 2.36 strictly: each entry is one
 * `worktree` line, exactly one `HEAD` and one of `branch` or `detached`
 * (neither for a bare primary), optional `locked` and `prunable`, and
 * nothing else. A path holding a newline breaks that, so it throws rather
 * than guess where the path ends. */
export function parseWorktreeListStrict(stdout: string): Worktree[] {
  return readEntries(stdout, "\n", true);
}

const RECORD_END = "/.git\n";

/** The newline format can still be fooled: a path crafted as
 * `wt\nHEAD …\nbranch …\n\nworktree /elsewhere` reads as two well-formed
 * entries. git keeps one record per linked worktree,
 * `<common dir>/worktrees/<id>/gitdir`, holding the absolute path of the
 * worktree's `.git` and a newline, and lists each worktree from it. So the
 * linked worktrees listed must be exactly those records: as many, and the
 * same paths. */
async function checkAgainstRecords(
  ctx: Context,
  cwd: string,
  worktrees: readonly Worktree[],
): Promise<void> {
  const common = await ctx.git.run(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    cwd,
  );
  if (common.code !== 0 || !common.stdout.endsWith("\n")) {
    throw unreadable("git couldn't say where the repository's records are");
  }
  const folder = path.join(common.stdout.slice(0, -1), "worktrees");
  // Every record folder, whatever its name: git names it after the
  // worktree's folder, which can be `node_modules` or start with a dot.
  const entries = await ctx.fs.readdir(folder).catch(() => {
    throw unreadable("git's worktree records couldn't be read");
  });
  const recorded: string[] = [];
  for (const entry of entries ?? []) {
    if (entry.kind !== "directory") {
      continue;
    }
    const record = path.join(folder, entry.name, "gitdir");
    const kind = await ctx.fs.classify(record).catch(() => "unreadable");
    // A record with no gitdir file isn't listed by git either.
    if (kind === "missing") {
      continue;
    }
    const text =
      kind === "file"
        ? await ctx.fs.readText(record).catch(() => undefined)
        : undefined;
    if (text?.endsWith(RECORD_END) !== true) {
      throw unreadable(`git's record ${entry.name} isn't a worktree's path`);
    }
    recorded.push(text.slice(0, -RECORD_END.length));
  }
  const listed = worktrees
    .filter((worktree) => !worktree.primary)
    .map((worktree) => worktree.path)
    .sort();
  recorded.sort();
  const same =
    listed.length === recorded.length &&
    listed.every((entry, i) => entry === recorded[i]);
  if (!same) {
    throw unreadable(
      "the worktrees listed are not the ones git records. git older than " +
        "2.36 can't list a worktree whose path holds a newline unambiguously; " +
        "rename that worktree's folder or update git",
    );
  }
}

/** Every worktree of the repository at `cwd`; throws when git can't list
 * them, or lists them in a way that can't be read for certain, because
 * nothing that follows is safe without this list. */
export async function listWorktrees(
  ctx: Context,
  cwd: string,
): Promise<Worktree[]> {
  const result = await ctx.git.run(
    ["worktree", "list", "--porcelain", "-z"],
    cwd,
  );
  if (result.code === 0) {
    return parseWorktreeListZ(result.stdout);
  }
  if (result.code !== UNKNOWN_OPTION) {
    throw new Error(
      `could not list git worktrees: ${result.stderr.trim() || "git failed"}`,
    );
  }
  const old = await ctx.git.run(["worktree", "list", "--porcelain"], cwd);
  if (old.code !== 0) {
    throw new Error(
      `could not list git worktrees: ${old.stderr.trim() || "git failed"}`,
    );
  }
  const worktrees = parseWorktreeListStrict(old.stdout);
  await checkAgainstRecords(ctx, cwd, worktrees);
  return worktrees;
}

/** True when `git status` shows anything: staged, unstaged or untracked. */
export async function isDirty(ctx: Context, cwd: string): Promise<boolean> {
  // Untracked files don't count: a merge or fast-forward never touches them
  // unless they'd be overwritten, and git refuses that case itself. Counting
  // them stopped main updating after a setup pull request, whose .gitignore
  // hadn't reached main yet, so node_modules showed as untracked there.
  const result = await ctx.git.run(
    ["status", "--porcelain", "--untracked-files=no"],
    cwd,
  );
  return result.code !== 0 || result.stdout.trim() !== "";
}
