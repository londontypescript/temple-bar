// Real git repositories for merge's and leftovers' end-to-end tests, with
// only GitHub faked: an "origin" bare repo, a clone, and a worktree holding
// the pull request's branch. The fake GitHub reads the branch's head from
// the bare repo and squash-merges into it the way GitHub would.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Context } from "../../context.ts";
import type { GhResult } from "../../seams/gh.ts";
import { createFsSeam } from "../../seams/fs.ts";
import { createGitSeam } from "../../seams/git.ts";
import { createFakeWriter } from "../../testing/fakes.ts";
import { configureTestRepo } from "../../testing/git-repo.ts";
import type { MergeDeps } from "../run.ts";

export function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function commitFile(
  dir: string,
  file: string,
  text: string,
  message: string,
): void {
  writeFileSync(path.join(dir, file), text);
  git(dir, "add", file);
  git(dir, "commit", "-m", message);
}

export interface Setup {
  readonly origin: string;
  readonly clone: string;
  readonly worktree: string;
  /** The branch tip GitHub had before merge pushed anything. */
  readonly pushedTip: string;
}

/** origin with main; a clone with feat/x in its own worktree, pushed; then
 * main moves on in origin, so the branch is behind. */
export function setUp(): Setup {
  const root = mkdtempSync(path.join(tmpdir(), "temple-bar-merge-"));
  const seed = path.join(root, "seed");
  const origin = path.join(root, "origin.git");
  const clone = path.join(root, "clone");
  const worktree = path.join(root, "wt-x");
  git(root, "init", "--bare", "--initial-branch=main", origin);
  git(root, "clone", origin, seed);
  configureTestRepo(seed);
  commitFile(seed, "README.md", "hello\n", "base");
  git(seed, "push", "origin", "main");

  git(root, "clone", origin, clone);
  configureTestRepo(clone);
  git(clone, "worktree", "add", "-b", "feat/x", worktree);
  commitFile(
    worktree,
    "x.ts",
    "export const x = 1;\n",
    "feat: x\n\nCo-Authored-By: Ada <ada@example.com>",
  );
  git(worktree, "push", "-u", "origin", "feat/x");
  const pushedTip = git(worktree, "rev-parse", "HEAD");

  commitFile(seed, "other.ts", "export const y = 2;\n", "feat: y");
  git(seed, "push", "origin", "main");
  return { origin, clone, worktree, pushedTip };
}

export function ok(stdout = ""): GhResult {
  return { code: 0, stdout, stderr: "", notFound: false };
}

/** A GitHub that answers from the bare repo and squash-merges into it. */
export function fakeGitHub(setup: Setup, body: string) {
  let merged = false;
  const calls: string[][] = [];
  const run = (args: readonly string[]): Promise<GhResult> => {
    calls.push([...args]);
    const joined = args.join(" ");
    if (joined.startsWith("repo view")) {
      return Promise.resolve(
        ok('{"nameWithOwner":"o/r","defaultBranchRef":{"name":"main"}}'),
      );
    }
    if (joined.startsWith("pr view")) {
      const head = merged
        ? ""
        : git(setup.origin, "rev-parse", "refs/heads/feat/x");
      return Promise.resolve(
        ok(
          JSON.stringify({
            number: 7,
            title: "feat: add x",
            body,
            state: merged ? "MERGED" : "OPEN",
            isDraft: false,
            baseRefName: "main",
            headRefName: "feat/x",
            headRefOid: head,
            isCrossRepository: false,
          }),
        ),
      );
    }
    if (joined.includes("/check-runs")) {
      return Promise.resolve(
        ok('{"name":"gate","status":"completed","conclusion":"success"}'),
      );
    }
    if (joined.startsWith("pr merge")) {
      // GitHub's squash: one new commit on main with the tree of the head.
      const head = args[args.indexOf("--match-head-commit") + 1] ?? "";
      const subject = args[args.indexOf("--subject") + 1] ?? "";
      const message = `${subject}\n\n${args[args.indexOf("--body") + 1] ?? ""}`;
      const squash = execFileSync(
        "git",
        [
          "commit-tree",
          `${head}^{tree}`,
          "-p",
          "refs/heads/main",
          "-m",
          message,
        ],
        {
          cwd: setup.origin,
          encoding: "utf8",
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "GitHub",
            GIT_AUTHOR_EMAIL: "noreply@github.com",
            GIT_COMMITTER_NAME: "GitHub",
            GIT_COMMITTER_EMAIL: "noreply@github.com",
          },
        },
      ).trim();
      git(setup.origin, "update-ref", "refs/heads/main", squash);
      merged = true;
      return Promise.resolve(ok());
    }
    if (joined.startsWith("pr list")) {
      return Promise.resolve(
        ok('[{"number":7,"headRefName":"feat/x","state":"MERGED"}]'),
      );
    }
    if (joined.startsWith("issue list")) {
      return Promise.resolve(ok("0"));
    }
    // Statuses, required checks and alerts: none.
    return Promise.resolve(ok(""));
  };
  return { gh: { run }, calls };
}

export function context(cwd: string, gh: Context["gh"]) {
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const ctx: Context = {
    git: createGitSeam(),
    gh,
    fs: createFsSeam(),
    clock: { now: () => new Date() },
    prompt: {
      isInteractive: () => false,
      confirm: () => Promise.resolve("no-terminal"),
    },
    proc: { run: () => Promise.resolve(0) },
    stdout,
    stderr,
    cwd,
    env: {},
  };
  return { ctx, stdout, stderr };
}

export const deps: MergeDeps = {
  sleep: () => Promise.resolve(),
  timing: { pollMs: 1, headAttempts: 2, checksTimeoutMs: 1_000 },
};
