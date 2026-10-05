// Unit tests for primary-checkout.ts through the fakes: telling the main
// checkout from a linked worktree, and when the main checkout warns.

import assert from "node:assert/strict";
import test from "node:test";

import type { GitResult } from "../seams/git.ts";
import {
  createFakeContext,
  createFakeGit,
  createFakeWriter,
} from "../testing/fakes.ts";
import {
  findCheckout,
  warnIfMainCheckoutOffDefault,
  type Checkout,
} from "./primary-checkout.ts";

function ok(stdout: string): GitResult {
  return { code: 0, stdout, stderr: "" };
}

const FAILED: GitResult = { code: 1, stdout: "", stderr: "" };

interface RepoState {
  readonly linked?: boolean;
  /** The branch HEAD names; undefined for a detached HEAD. */
  readonly branch?: string | undefined;
  /** What refs/remotes/origin/HEAD points at; undefined when unset. */
  readonly originHead?: string;
}

/** git as seen from /primary (the main checkout) or /worktree (linked). */
function repoGit(state: RepoState) {
  return createFakeGit((args) => {
    const joined = args.join(" ");
    switch (joined) {
      case "rev-parse --git-dir":
        return ok(
          state.linked ? "/primary/.git/worktrees/worktree\n" : ".git\n",
        );
      case "rev-parse --git-common-dir":
        return ok(state.linked ? "/primary/.git\n" : ".git\n");
      case "rev-parse --show-toplevel":
        return ok(state.linked ? "/worktree\n" : "/primary\n");
      case "symbolic-ref --quiet --short HEAD":
        return state.branch === undefined ? FAILED : ok(`${state.branch}\n`);
      case "symbolic-ref --quiet refs/remotes/origin/HEAD":
        return state.originHead === undefined
          ? FAILED
          : ok(`${state.originHead}\n`);
      default:
        return { code: 1, stdout: "", stderr: `unexpected: git ${joined}` };
    }
  });
}

const PRIMARY: Checkout = { worktree: "/primary", linked: false };

async function warningFor(state: RepoState): Promise<string> {
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    git: repoGit(state),
    stderr,
    cwd: state.linked ? "/worktree" : "/primary",
  });
  const checkout = await findCheckout(ctx);
  assert.ok(checkout !== undefined);
  await warnIfMainCheckoutOffDefault(ctx, checkout);
  return stderr.lines.join("");
}

void test("findCheckout: the main checkout's git folder is the shared one", async () => {
  const ctx = createFakeContext({ git: repoGit({}), cwd: "/primary" });

  assert.deepEqual(await findCheckout(ctx), PRIMARY);
});

void test("findCheckout: a linked worktree has a git folder of its own", async () => {
  const ctx = createFakeContext({
    git: repoGit({ linked: true }),
    cwd: "/worktree",
  });

  assert.deepEqual(await findCheckout(ctx), {
    worktree: "/worktree",
    linked: true,
  });
});

void test("findCheckout: outside a work tree there is no checkout", async () => {
  const ctx = createFakeContext({ git: createFakeGit(() => FAILED) });

  assert.equal(await findCheckout(ctx), undefined);
});

void test("main checkout: on main, with no origin/HEAD known, says nothing", async () => {
  assert.equal(await warningFor({ branch: "main" }), "");
});

void test("main checkout: on another branch, warns and says how to put it back", async () => {
  const warning = await warningFor({ branch: "feature" });

  assert.match(
    warning,
    /^temple-bar: warning: the main checkout at \/primary is on the branch feature, not main\.\n/,
  );
  assert.match(warning, /git switch main\n/);
  assert.match(warning, /git worktree add <folder> <branch>\n/);
});

void test("main checkout: on a detached HEAD, warns", async () => {
  assert.match(
    await warningFor({}),
    /the main checkout at \/primary is on a detached HEAD, not main\./,
  );
});

void test("main checkout: the default branch is origin's, not a hard-coded main", async () => {
  const originHead = "refs/remotes/origin/master";

  assert.equal(await warningFor({ branch: "master", originHead }), "");
  assert.match(
    await warningFor({ branch: "main", originHead }),
    /is on the branch main, not master\./,
  );
});

void test("linked worktree: on a branch or detached, never warns, without asking which branch", async () => {
  for (const branch of ["feature", undefined]) {
    const git = repoGit({ linked: true, branch });
    const stderr = createFakeWriter();
    const ctx = createFakeContext({ git, stderr, cwd: "/worktree" });

    await warnIfMainCheckoutOffDefault(ctx, {
      worktree: "/worktree",
      linked: true,
    });

    assert.deepEqual(stderr.lines, []);
    assert.equal(git.calls.length, 0);
  }
});
