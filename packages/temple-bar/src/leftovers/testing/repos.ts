// Real git repositories for `leftovers`' tests, with only GitHub faked: a
// bare "origin", a primary clone, and worktrees on pushed branches. The bare
// repository stands in for github.com/o/r, so origin's URL reads as that
// repository; everything else is real git. Every git call is recorded, so a
// test can assert that nothing destructive ran.

import { execFileSync } from "node:child_process";
import {
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
import type { GhResult, GhSeam } from "../../seams/gh.ts";
import { createFsSeam, type FsSeam } from "../../seams/fs.ts";
import { createGitSeam, type GitSeam } from "../../seams/git.ts";
import {
  createFakeHttp,
  createFakeWriter,
  type FakeWriter,
} from "../../testing/fakes.ts";
import { configureTestRepo } from "../../testing/git-repo.ts";
import { leftoversCommandEntry } from "../command.ts";

const GITHUB_URL = "https://github.com/o/r.git";

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

/** A worktree on `feat/<name>` with one commit, pushed to origin. */
export function addWorktree(repos: Repos, name: string): Branch {
  const worktree = path.join(repos.root, name);
  const branch = `feat/${name}`;
  git(repos.primary, "worktree", "add", "-q", "-b", branch, worktree);
  write(
    worktree,
    `${name}.ts`,
    `export const ${name.replace(/\W/g, "_")} = 1;\n`,
  );
  git(worktree, "add", "-A");
  git(worktree, "commit", "-q", "-m", `feat: ${name}`);
  git(worktree, "push", "-q", "-u", "origin", branch);
  return {
    path: worktree,
    branch,
    head: gitLine(worktree, "rev-parse", "HEAD"),
  };
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
  branch: Branch,
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

/** Real git, recording every call. origin's URL, the bare repository's
 * path, reads as github.com/o/r, which it stands in for. */
function recordingGit(repos: Repos): GitSeam & {
  readonly calls: RecordedCall[];
} {
  const real = createGitSeam();
  const calls: RecordedCall[] = [];
  return {
    calls,
    async run(args, cwd, input) {
      calls.push({ args, cwd, input });
      const result = await real.run(args, cwd, input);
      if (args[0] === "remote" && args[1] === "get-url") {
        return {
          ...result,
          stdout: result.stdout
            .split("\n")
            .map((url) => (url === repos.origin ? GITHUB_URL : url))
            .join("\n"),
        };
      }
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
  /** Runs `temple-bar leftovers <args>` in `cwd`. */
  leftovers(
    args: readonly string[],
    cwd: string,
    options?: { env?: NodeJS.ProcessEnv; fs?: FsSeam },
  ): Promise<Run>;
}

export function world(
  repos: Repos,
  pullRequests: () => readonly FakePullRequest[],
): World {
  const recording = recordingGit(repos);
  return {
    git: recording,
    async leftovers(args, cwd, options = {}) {
      const stdout: FakeWriter = createFakeWriter();
      const stderr: FakeWriter = createFakeWriter();
      const ctx: Context = {
        git: recording,
        gh: fakeGh(pullRequests),
        fs: options.fs ?? createFsSeam(),
        clock: { now: () => new Date() },
        prompt: {
          isInteractive: () => false,
          confirm: () => Promise.resolve("no-terminal"),
        },
        proc: { run: () => Promise.resolve(0) },
        http: createFakeHttp(),
        stdout,
        stderr,
        cwd,
        env: options.env ?? {},
      };
      const code = await leftoversCommandEntry.run(args, ctx);
      return { code, out: stdout.lines.join(""), err: stderr.lines.join("") };
    },
  };
}
