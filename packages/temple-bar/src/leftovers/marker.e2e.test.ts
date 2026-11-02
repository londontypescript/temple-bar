// The release marker against real git, with only GitHub faked: it is valid
// only while the branch, HEAD and ignored files are exactly as released;
// it can't be steered through a symbolic ref; and of a racing `--unrelease`
// and `--remove`, exactly one wins, driven deterministically.

import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  addWorktree,
  asGit,
  assertKept,
  commitAll,
  destructive,
  git,
  gitLine,
  makeRepos,
  merged,
  release,
  RELEASED_REF,
  REMOVING_REF,
  world,
  write,
} from "./testing/repos.ts";

void test("validity: a marker released on another branch keeps it", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  const w = world(repos, () => [merged({ branch: "feat/y", head: x.head }, 8)]);
  await release(w, x.path);
  git(x.path, "switch", "-q", "-c", "feat/y");
  await assertKept(
    w,
    repos.primary,
    { path: x.path, branch: "feat/y" },
    "released on refs/heads/feat/x, but now on refs/heads/feat/y",
  );
});

void test("validity: a commit after the release keeps it, even when the pull request merged it", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  let head = x.head;
  const w = world(repos, () => [merged({ ...x, head }, 7)]);
  await release(w, x.path);
  write(x.path, "more.ts", "export const more = 1;\n");
  head = commitAll(x.path, "feat: more");
  await assertKept(
    w,
    repos.primary,
    x,
    `HEAD moved since it was released (from ${x.head} to ${head})`,
  );
});

void test("resume at the same HEAD: a new note in .temple-bar/ keeps it", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  const w = world(repos, () => [merged(x, 7)]);
  await release(w, x.path);
  write(x.path, ".temple-bar/resumed.md", "picked up again\n");
  await assertKept(
    w,
    repos.primary,
    x,
    `ignored files changed since it was released: ${JSON.stringify(".temple-bar/resumed.md")}`,
  );
});

void test("validity: an ignored file changed only in bytes a filter would normalise breaks the marker", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  git(repos.primary, "config", "core.autocrlf", "true");
  writeFileSync(
    path.join(repos.primary, ".git", "info", "attributes"),
    "* text=auto\n",
  );
  write(x.path, ".env", "TOKEN=1\r\n");
  const w = world(repos, () => [merged(x, 7)]);
  await release(w, x.path);
  write(x.path, ".env", "TOKEN=1\n");
  // git's filters would call the two the same file.
  const filtered = gitLine(x.path, "hash-object", ".env");
  writeFileSync(path.join(x.path, ".env"), "TOKEN=1\r\n");
  assert.equal(gitLine(x.path, "hash-object", ".env"), filtered);
  write(x.path, ".env", "TOKEN=1\n");
  await assertKept(
    w,
    repos.primary,
    x,
    `ignored files changed since it was released: ${JSON.stringify(".env")}`,
  );
});

void test("validity: a symbolic marker ref aliasing a branch is refused, and both --unrelease and --remove leave the branch alone", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  const w = world(repos, () => [merged(x, 7)]);
  git(x.path, "symbolic-ref", RELEASED_REF, `refs/heads/${x.branch}`);
  const why = `${RELEASED_REF} is a symbolic ref, pointing at refs/heads/${x.branch}`;
  const unreleased = await w.leftovers(["--unrelease"], x.path);
  assert.equal(unreleased.code, 1);
  assert.equal(unreleased.err, `leftovers: ${why}; nothing changed\n`);
  await assertKept(w, repos.primary, x, why);
  assert.equal(gitLine(repos.primary, "rev-parse", x.branch), x.head);
});

void test("--release after a claim refuses: the worktree is being removed", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  const w = world(repos, () => [merged(x, 7)]);
  await release(w, x.path);
  const marker = gitLine(x.path, "rev-parse", RELEASED_REF);
  git(x.path, "update-ref", REMOVING_REF, marker);
  git(x.path, "update-ref", "-d", RELEASED_REF);
  const run = await w.leftovers(["--release"], x.path);
  assert.equal(run.code, 1);
  assert.equal(
    run.err,
    "leftovers: this worktree is being removed; don't work in it\n",
  );
  assert.equal(gitLine(x.path, "rev-parse", REMOVING_REF), marker);
  assert.equal(git(x.path, "for-each-ref", RELEASED_REF), "");
});

void test("resume at the same HEAD: --unrelease withdraws the release, and the worktree is kept", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  const w = world(repos, () => [merged(x, 7)]);
  const before = await w.leftovers(["--unrelease"], x.path);
  assert.equal(before.code, 0);
  assert.match(before.out, /isn't released; nothing to withdraw/);
  await release(w, x.path);
  const run = await w.leftovers(["--unrelease"], x.path);
  assert.equal(run.code, 0, run.err);
  assert.equal(
    run.out,
    `leftovers: withdrew the release of ${asGit(x.path)}\n`,
  );
  await assertKept(
    w,
    repos.primary,
    x,
    "not released: the session there hasn't run `temple-bar leftovers --release`",
  );
});

/** True for the claim's transaction: `released` becomes `removing`. */
function isClaim(args: readonly string[], input: string | undefined): boolean {
  return (
    args[0] === "update-ref" && (input ?? "").includes(`create ${REMOVING_REF}`)
  );
}

interface Unreleased {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

void test("race: the claim first, then --unrelease: the removal wins and the session is told to stop", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x");
  const unreleases: Unreleased[] = [];
  const w = world(repos, () => [merged(x, 7)], {
    hooks: {
      after: async ({ args, input }) => {
        if (isClaim(args, input) && unreleases.length === 0) {
          unreleases.push(await w.leftovers(["--unrelease"], x.path));
        }
      },
    },
  });
  await release(w, x.path);
  const run = await w.leftovers(["--remove"], repos.primary);
  assert.deepEqual(
    unreleases.map(({ code, err }) => [code, err]),
    [[1, "leftovers: this worktree is being removed; don't work in it\n"]],
  );
  assert.equal(run.code, 0, run.out + run.err);
  assert.equal(existsSync(x.path), false);
});

void test("race: --unrelease first, then the claim: the session wins and the worktree is kept", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  const unreleases: Unreleased[] = [];
  const w = world(repos, () => [merged(x, 7)], {
    hooks: {
      before: async ({ args, input }) => {
        if (isClaim(args, input) && unreleases.length === 0) {
          unreleases.push(await w.leftovers(["--unrelease"], x.path));
        }
        return undefined;
      },
    },
  });
  await release(w, x.path);
  await assertKept(
    w,
    repos.primary,
    x,
    /^couldn't claim it, so its release was withdrawn or changed \(git said: .+\)$/,
  );
  assert.deepEqual(
    unreleases.map(({ code, out }) => [code, out]),
    [[0, `leftovers: withdrew the release of ${asGit(x.path)}\n`]],
  );
});

void test("after the claim, the whole check runs again: an ignored file written then keeps it, and the claim is dropped", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  let wrote = false;
  const w = world(repos, () => [merged(x, 7)], {
    hooks: {
      after: ({ args, input }) => {
        if (isClaim(args, input) && !wrote) {
          wrote = true;
          write(x.path, ".temple-bar/last-moment.md", "late\n");
        }
        return Promise.resolve();
      },
    },
  });
  await release(w, x.path);
  await assertKept(
    w,
    repos.primary,
    x,
    `ignored files changed since it was released: ${JSON.stringify(".temple-bar/last-moment.md")}; the session there must release it again for it to be removed`,
  );
  assert.equal(git(x.path, "for-each-ref", "refs/worktree/"), "");
  assert.deepEqual(destructive(w.git.calls), []);
});

void test("race: a removal claiming the worktree while --release runs wins, and the release isn't written", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  const w = world(repos, () => [merged(x, 7)], {
    hooks: {
      // Right before the release's own transaction, a claim lands.
      before: ({ args, input }) => {
        if (
          args[0] === "update-ref" &&
          (input ?? "").includes(`create ${RELEASED_REF}`)
        ) {
          git(
            x.path,
            "update-ref",
            REMOVING_REF,
            gitLine(x.path, "hash-object", "-w", "README.md"),
          );
        }
        return Promise.resolve(undefined);
      },
    },
  });
  const run = await w.leftovers(["--release"], x.path);
  assert.equal(run.code, 1);
  assert.equal(
    run.err,
    "leftovers: this worktree is being removed; don't work in it\n",
  );
  assert.equal(git(x.path, "for-each-ref", RELEASED_REF), "");
});
