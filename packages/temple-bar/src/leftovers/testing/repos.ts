// Real git repositories for `leftovers`' tests, with only GitHub faked: a
// bare "origin", a primary clone, and worktrees on branches. The bare
// repository stands in for github.com/o/r, so origin's URL reads as that
// repository; everything else is real git. Every git call is recorded, so a
// test can assert that nothing destructive ran.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

import type { Context } from "../../context.ts";
import { createFsSeam, type FsSeam } from "../../seams/fs.ts";
import type { GhResult, GhSeam } from "../../seams/gh.ts";
import {
  createGitSeam,
  type GitResult,
  type GitSeam,
} from "../../seams/git.ts";
import {
  createFakeHttp,
  createFakeWriter,
  type FakeWriter,
} from "../../testing/fakes.ts";
import { configureTestRepo } from "../../testing/git-repo.ts";
import { leftoversCommandEntry } from "../command.ts";
import { RELEASED, REMOVING } from "../marker.ts";

const GITHUB_URL = "https://github.com/o/r.git";
export { RELEASED as RELEASED_REF, REMOVING as REMOVING_REF };

export function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** git's one-line answer, without its newline. */
export function gitLine(dir: string, ...args: string[]): string {
  return git(dir, ...args).replace(/\n$/, "");
}

export function write(dir: string, file: string, text: string): void {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), text);
}

export interface Repos {
  readonly root: string;
  readonly origin: string;
  readonly primary: string;
}

/** What a project's .gitignore usually holds, a harness's local settings
 * file included. */
const GITIGNORE =
  "node_modules/\ndist/\ncoverage/\n.temple-bar/\n.env\n.claude/settings.local.json\n";

/** origin with main, and a primary clone of it. Real paths throughout, so
 * `/var` and `/private/var` never differ. */
export function makeRepos(t: Pick<TestContext, "after">): Repos {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "temple-bar-leftovers-")),
  );
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const origin = path.join(root, "origin.git");
  const primary = path.join(root, "primary");
  git(root, "init", "-q", "--bare", "--initial-branch=main", origin);
  git(root, "clone", "-q", origin, primary);
  configureTestRepo(primary);
  git(primary, "switch", "-q", "-c", "main");
  write(primary, ".gitignore", GITIGNORE);
  write(primary, "README.md", "hello\n");
  git(primary, "add", "-A");
  git(primary, "commit", "-q", "-m", "base");
  git(primary, "push", "-q", "-u", "origin", "main");
  return { root, origin, primary };
}

export interface Branch {
  readonly path: string;
  readonly branch: string;
  readonly head: string;
}

/** A worktree on `feat/<name>` with one commit, pushed to origin unless
 * `push` is false: a test about a kept worktree leaves origin without the
 * branch, so the only deletion `--remove` could make is the one under test. */
export function addWorktree(
  repos: Repos,
  name: string,
  options: { readonly push?: boolean; readonly folder?: string } = {},
): Branch {
  const worktree = path.join(repos.root, options.folder ?? name);
  const branch = `feat/${name}`;
  git(repos.primary, "worktree", "add", "-q", "-b", branch, worktree);
  write(worktree, `${name}.ts`, "export const x = 1;\n");
  const head = commitAll(worktree, `feat: ${name}`);
  if (options.push !== false) {
    git(worktree, "push", "-q", "-u", "origin", branch);
  }
  return { path: worktree, branch, head };
}

/** Commits everything in the worktree; returns the new head. */
export function commitAll(worktree: string, message: string): string {
  git(worktree, "add", "-A");
  git(worktree, "commit", "-q", "-m", message);
  return gitLine(worktree, "rev-parse", "HEAD");
}

/** Writes a blob from text; returns its id. */
export function blob(dir: string, text: string): string {
  return execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: dir,
    encoding: "utf8",
    input: text,
  }).replace(/\n$/, "");
}

/** Rewrites the worktree's marker to name `head`, keeping its branch and
 * files: the marker `--release` would write at that head, for a fixture
 * whose state `--release` itself refuses. */
export function moveMarker(worktree: string, head: string): void {
  const marker = JSON.parse(
    git(worktree, "cat-file", "blob", RELEASED),
  ) as Record<string, unknown>;
  const moved = blob(worktree, `${JSON.stringify({ ...marker, head })}\n`);
  git(worktree, "update-ref", RELEASED, moved);
}

export interface FakePullRequest {
  readonly number: number;
  readonly headRefName: string;
  readonly headRefOid: string;
  readonly state: "OPEN" | "CLOSED" | "MERGED";
  readonly isCrossRepository: boolean;
  readonly baseRefName: string;
}

/** The pull request GitHub lists for a branch merged into main. */
export function merged(
  branch: Pick<Branch, "branch" | "head">,
  number: number,
  overrides: Partial<FakePullRequest> = {},
): FakePullRequest {
  return {
    number,
    headRefName: branch.branch,
    headRefOid: branch.head,
    state: "MERGED",
    isCrossRepository: false,
    baseRefName: "main",
    ...overrides,
  };
}

function ok(stdout: string): GhResult {
  return { code: 0, stdout, stderr: "", notFound: false };
}

/** GitHub for o/r: its default branch and pull requests, newest first. */
function fakeGh(pullRequests: () => readonly FakePullRequest[]): GhSeam {
  return {
    run(args) {
      const joined = args.join(" ");
      if (joined.startsWith("repo view")) {
        return Promise.resolve(
          ok('{"nameWithOwner":"o/r","defaultBranchRef":{"name":"main"}}'),
        );
      }
      if (joined.startsWith("pr list")) {
        return Promise.resolve(ok(JSON.stringify(pullRequests())));
      }
      return Promise.resolve({
        code: 1,
        stdout: "",
        stderr: `unexpected gh ${joined}`,
        notFound: false,
      });
    },
  };
}

export interface RecordedCall {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly input: string | undefined;
}

/** Runs around each git call: `before` may act first (a racing session,
 * say) or answer in git's place; `after` sees the result. */
export interface GitHooks {
  before?: (call: RecordedCall) => Promise<GitResult | undefined>;
  after?: (call: RecordedCall, result: GitResult) => Promise<void>;
}

/** Real git, recording every call. origin's URL, the bare repository's
 * path, reads as github.com/o/r, which it stands in for. */
function recordingGit(
  origin: string,
  hooks: GitHooks,
): GitSeam & { readonly calls: RecordedCall[] } {
  const real = createGitSeam();
  const calls: RecordedCall[] = [];
  return {
    calls,
    async run(args, cwd, input) {
      const call = { args, cwd, input };
      calls.push(call);
      const answer = await hooks.before?.(call);
      if (answer !== undefined) {
        return answer;
      }
      let result = await real.run(args, cwd, input);
      if (args[0] === "remote" && args[1] === "get-url") {
        const urls = result.stdout
          .split("\n")
          .map((url) => (url === origin ? GITHUB_URL : url));
        result = { ...result, stdout: urls.join("\n") };
      }
      await hooks.after?.(call, result);
      return result;
    },
  };
}

/** The calls that delete a worktree, a branch or origin's branch. */
export function destructive(calls: readonly RecordedCall[]): string[] {
  return calls
    .filter(({ args, input }) => {
      const command = args[0] === "--no-replace-objects" ? args[1] : args[0];
      const worktreeRemove = command === "worktree" && args.includes("remove");
      const branchDelete =
        command === "update-ref" &&
        ((args.includes("-d") &&
          args.some((arg) => arg.startsWith("refs/heads/"))) ||
          (input ?? "").includes("delete refs/heads/"));
      const remoteDelete =
        command === "push" &&
        args.some(
          (arg) => arg.startsWith(":") || arg === "--delete" || arg === "-d",
        );
      return worktreeRemove || branchDelete || remoteDelete;
    })
    .map(({ args }) => args.join(" "));
}

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

export interface World {
  readonly git: ReturnType<typeof recordingGit>;
  /** A context on the same git and GitHub, for running other commands. */
  context(
    cwd: string,
    env?: NodeJS.ProcessEnv,
    fs?: FsSeam,
  ): Context & { readonly stdout: FakeWriter; readonly stderr: FakeWriter };
  /** Runs `temple-bar leftovers <args>` in `cwd`. */
  leftovers(
    args: readonly string[],
    cwd: string,
    options?: { env?: NodeJS.ProcessEnv; fs?: FsSeam },
  ): Promise<Run>;
}

export function world(
  repos: Pick<Repos, "origin">,
  pullRequests: () => readonly FakePullRequest[],
  options: { readonly hooks?: GitHooks; readonly gh?: GhSeam } = {},
): World {
  const recording = recordingGit(repos.origin, options.hooks ?? {});
  const gh = options.gh ?? fakeGh(pullRequests);
  const context = (
    cwd: string,
    env: NodeJS.ProcessEnv = {},
    fs: FsSeam = createFsSeam(),
  ): Context & {
    readonly stdout: FakeWriter;
    readonly stderr: FakeWriter;
  } => ({
    git: recording,
    gh,
    fs,
    clock: { now: () => new Date() },
    prompt: {
      isInteractive: () => false,
      confirm: () => Promise.resolve("no-terminal"),
    },
    proc: { run: () => Promise.resolve(0) },
    http: createFakeHttp(),
    stdout: createFakeWriter(),
    stderr: createFakeWriter(),
    cwd,
    env,
  });
  return {
    git: recording,
    context,
    async leftovers(args, cwd, runOptions = {}) {
      const stdout = createFakeWriter();
      const stderr = createFakeWriter();
      const ctx: Context = {
        ...context(cwd, runOptions.env, runOptions.fs),
        stdout,
        stderr,
      };
      const code = await leftoversCommandEntry.run(args, ctx);
      return { code, out: stdout.lines.join(""), err: stderr.lines.join("") };
    },
  };
}

/** Releases the worktree, failing the test if `--release` refuses. */
export async function release(w: World, worktree: string): Promise<void> {
  const run = await w.leftovers(["--release"], worktree);
  if (run.code !== 0) {
    throw new Error(`--release refused: ${run.err}`);
  }
}

/** Runs `--remove` and asserts the worktree is kept for exactly `reason`
 * (the whole of its reasons: a string is compared exactly, a pattern must
 * match all of it), still exists, and that no git call anywhere in this
 * world deleted a worktree, a branch or origin's branch. */
export async function assertKept(
  w: World,
  from: string,
  worktree: Pick<Branch, "path" | "branch">,
  reason: string | RegExp,
  options: { env?: NodeJS.ProcessEnv; fs?: FsSeam } = {},
): Promise<void> {
  const run = await w.leftovers(["--remove"], from, options);
  const prefix = `leftovers: kept the worktree at ${worktree.path} (${worktree.branch}): `;
  const said = run.err
    .split("\n")
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length);
  const matches =
    said !== undefined &&
    (typeof reason === "string" ? said === reason : reason.test(said));
  if (!matches) {
    throw new Error(
      `expected ${JSON.stringify(prefix)} with the reason ${String(reason)}\nbut --remove said:\n${run.out}${run.err}`,
    );
  }
  if (run.code !== 1 || !existsSync(worktree.path)) {
    throw new Error(
      `--remove exited ${String(run.code)}; the worktree ${existsSync(worktree.path) ? "stayed" : "went"}`,
    );
  }
  const deleted = destructive(w.git.calls);
  if (deleted.length > 0) {
    throw new Error(`destructive git calls ran: ${deleted.join(" | ")}`);
  }
}

/** A released worktree on a merged, unpushed branch. */
export async function releasedWorktree(t: Pick<TestContext, "after">): Promise<{
  repos: Repos;
  x: Branch;
  w: World;
  merge: (head: string) => void;
}> {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  let head = x.head;
  const w = world(repos, () => [merged({ ...x, head }, 7)]);
  await release(w, x.path);
  return {
    repos,
    x,
    w,
    merge: (at) => {
      head = at;
    },
  };
}
