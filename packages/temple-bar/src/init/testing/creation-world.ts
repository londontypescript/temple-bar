// A small model of a local repository and GitHub for the creation tests:
// HEAD, the history a push would send, origin, and what `gh repo create`,
// `git commit` and `git push` do. Tests change its state (a commit made
// while the question waits, say) and read back every call. Excluded from
// the build (tsconfig.build.json excludes src/**/testing/**).

import {
  createFakeGh,
  createFakeGit,
  type FakeGh,
  type FakeGit,
} from "../../testing/fakes.ts";
import type { GhResult } from "../../seams/gh.ts";
import type { GitResult } from "../../seams/git.ts";

interface WorldCommit {
  readonly author: string;
  readonly authorEmail: string;
  readonly committer?: string;
  readonly committerEmail?: string;
  readonly message: string;
}

export interface World {
  branch: string;
  detached: boolean;
  /** Undefined while the branch is unborn. */
  commit: string | undefined;
  history: WorldCommit[];
  /** What `git var GIT_AUTHOR_IDENT` names, without the timestamp. */
  ident: string;
  origin: string | undefined;
  /** Defaults to origin's own URL. */
  pushUrls: string[] | undefined;
  createAnswer: GhResult;
  /** The repository `gh repo create` makes, and prints the URL of when it
   * succeeds. Undefined: the one asked for (GitHub may rename it). */
  createdAs: string | undefined;
  /** Whether a `gh repo create` (even a failing one) added origin. */
  createAddsOrigin: boolean;
  /** What origin then reads as. Undefined: the made repository's URL (a
   * `url.<base>.insteadOf` setting can rewrite it). */
  originAfterCreate: string | undefined;
  /** Owner GitHub answers for `users/<owner>`; anything else is a 404. */
  accounts: Record<string, "Organization" | "User">;
  commitAnswer: GitResult;
  /** A line a commit-msg hook adds to setup's first commit. */
  hookAddsLine: string | undefined;
  pushAnswer: GitResult;
  /** What GitHub says about origin's repository. */
  remote: { type: string; visibility: string; private: boolean };
  /** Whether GitHub lists a branch in origin's repository: false once
   * `gh repo create` made it, true again after a push. */
  remoteHasBranches: boolean;
  /** Every call, as `git <args>` or `gh <args>`. */
  readonly calls: string[];
}

const OK: GitResult = { code: 0, stdout: "", stderr: "" };

export function newWorld(overrides: Partial<World> = {}): World {
  return {
    branch: "main",
    detached: false,
    commit: "c0ffee",
    history: [
      {
        author: "Ada Lovelace",
        authorEmail: "ada@example.com",
        message: "Start\n",
      },
    ],
    ident: "Ada Lovelace <ada@example.com>",
    origin: undefined,
    pushUrls: undefined,
    createAnswer: { code: 0, stdout: "", stderr: "", notFound: false },
    createdAs: undefined,
    createAddsOrigin: true,
    originAfterCreate: undefined,
    accounts: { acme: "Organization", ada: "User" },
    commitAnswer: OK,
    hookAddsLine: undefined,
    pushAnswer: OK,
    remote: { type: "Organization", visibility: "public", private: false },
    remoteHasBranches: true,
    calls: [],
    ...overrides,
  };
}

function logOutput(history: readonly WorldCommit[]): string {
  return history
    .map(
      (commit) =>
        [
          commit.author,
          commit.authorEmail,
          commit.committer ?? commit.author,
          commit.committerEmail ?? commit.authorEmail,
          commit.message,
        ].join("\0") + "\0",
    )
    .join("");
}

function answer(stdout: string, code = 0): GitResult {
  return { code, stdout, stderr: "" };
}

type Fallback<T> = (args: readonly string[]) => T;

function gitAnswer(
  world: World,
  args: readonly string[],
  fallback: Fallback<GitResult>,
): GitResult {
  const [first, second] = args;
  const ref = `refs/heads/${world.branch}`;
  if (first === "symbolic-ref") {
    return world.detached ? answer("", 1) : answer(`${ref}\n`);
  }
  if (first === "rev-parse" && second === "--verify") {
    return answer("", world.commit === undefined ? 1 : 0);
  }
  if (first === "rev-parse" && second === "--git-common-dir") {
    return answer("/repo/widgets/.git\n");
  }
  if (first === "--git-dir") {
    return answer("false\n");
  }
  if (first === "for-each-ref") {
    return answer(world.commit === undefined ? "" : `${world.commit} ${ref}\n`);
  }
  if (first === "--no-replace-objects") {
    return answer(logOutput(world.history));
  }
  if (first === "var") {
    return answer(`${world.ident} 1700000000 +0000\n`);
  }
  if (first === "remote" && args.includes("--push")) {
    const urls = world.pushUrls ?? (world.origin ? [world.origin] : []);
    return answer(urls.map((url) => `${url}\n`).join(""));
  }
  if (first === "remote" && second === "get-url") {
    return world.origin === undefined
      ? { code: 2, stdout: "", stderr: "error: No such remote 'origin'\n" }
      : answer(`${world.origin}\n`);
  }
  if (first === "commit") {
    if (world.commitAnswer.code === 0) {
      const [name = "", email = ""] = world.ident.split(/ <|>$/);
      world.commit = "5e7c0de";
      world.history = [
        {
          author: name,
          authorEmail: email,
          message: `Initial commit\n${world.hookAddsLine ?? ""}`,
        },
      ];
    }
    return world.commitAnswer;
  }
  if (args.includes("push")) {
    if (world.pushAnswer.code === 0) {
      world.remoteHasBranches = true;
    }
    return world.pushAnswer;
  }
  return fallback(args);
}

function ghAnswer(
  world: World,
  args: readonly string[],
  fallback: Fallback<GhResult>,
): GhResult {
  const ok = (stdout: string): GhResult => ({
    code: 0,
    stdout,
    stderr: "",
    notFound: false,
  });
  if (args[0] === "repo" && args[1] === "create") {
    const made = world.createdAs ?? args[2] ?? "";
    if (world.createAddsOrigin) {
      world.origin = world.originAfterCreate ?? `git@github.com:${made}.git`;
    }
    if (world.createAnswer.code !== 0) {
      return world.createAnswer;
    }
    world.remoteHasBranches = false;
    return {
      ...world.createAnswer,
      stdout: world.createAnswer.stdout || `https://github.com/${made}\n`,
    };
  }
  const path = args[1] ?? "";
  if (args[0] === "api" && args[2] === "--hostname") {
    if (/^repos\/[^/]+\/[^/]+$/.test(path)) {
      const [, owner = ""] = path.split("/");
      return ok(
        JSON.stringify({
          owner: { login: owner, type: world.remote.type },
          visibility: world.remote.visibility,
          private: world.remote.private,
        }),
      );
    }
    if (path.endsWith("/branches?per_page=1")) {
      return ok(world.remoteHasBranches ? '[{"name":"main"}]' : "[]");
    }
  }
  const account = /^users\/(.+)$/.exec(args[1] ?? "")?.[1];
  if (args[0] === "api" && account !== undefined) {
    const type = world.accounts[account];
    return type === undefined
      ? {
          code: 1,
          stdout: "",
          stderr: "gh: Not Found (HTTP 404)",
          notFound: false,
        }
      : ok(JSON.stringify({ login: account, type }));
  }
  return fallback(args);
}

/** git and gh fakes acting on `world`, recording each call there. Calls
 * the world doesn't model go to the fallbacks (by default, a success with
 * no output). */
export function worldSeams(
  world: World,
  fallbacks: { git?: Fallback<GitResult>; gh?: Fallback<GhResult> } = {},
): { git: FakeGit; gh: FakeGh } {
  const git = fallbacks.git ?? (() => OK);
  const gh =
    fallbacks.gh ??
    ((): GhResult => ({ code: 0, stdout: "", stderr: "", notFound: false }));
  return {
    git: createFakeGit((args) => {
      world.calls.push(`git ${args.join(" ")}`);
      return gitAnswer(world, args, git);
    }),
    gh: createFakeGh((args) => {
      world.calls.push(`gh ${args.join(" ")}`);
      return ghAnswer(world, args, gh);
    }),
  };
}
