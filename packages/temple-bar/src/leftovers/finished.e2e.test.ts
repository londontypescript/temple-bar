// What counts as finished, against real git with only GitHub faked: a
// branch's newest pull request merged into the default branch from this
// repository, and the branch holding nothing beyond its head. Each fixture
// fails one part of that, and nothing is deleted.

import assert from "node:assert/strict";
import test from "node:test";

import {
  addWorktree,
  asGit,
  assertKept,
  blob,
  commitAll,
  destructive,
  git,
  gitLine,
  makeRepos,
  merged,
  release,
  RELEASED_REF,
  world,
  write,
} from "./testing/repos.ts";

void test("guard: a fork's pull request from a branch of the same name keeps it", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x");
  const w = world(repos, () => [
    merged(x, 9, { isCrossRepository: true }),
    merged(x, 7),
  ]);
  await release(w, x.path);
  await assertKept(w, repos.primary, x, "pull request #9 came from a fork");
  assert.equal(gitLine(repos.origin, "rev-parse", x.branch), x.head);
});

void test("guard: a pull request into another base, from a branch of the same name, keeps it", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x");
  const w = world(repos, () => [
    merged(x, 9, { baseRefName: "develop" }),
    merged(x, 7),
  ]);
  await release(w, x.path);
  await assertKept(
    w,
    repos.primary,
    x,
    "pull request #9 merged into develop, not the default branch",
  );
});

void test("a closed pull request's worktree and branches are reported, never removed", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x");
  const w = world(repos, () => [merged(x, 7, { state: "CLOSED" })]);
  await release(w, x.path);
  await assertKept(
    w,
    repos.primary,
    x,
    "pull request #7 closed without merging",
  );
  const run = await w.leftovers([], repos.primary);
  assert.match(
    run.out,
    /local branch feat\/x \(pull request #7 closed\): kept: pull request #7 closed without merging\n/,
  );
  assert.match(
    run.out,
    /remote branch origin\/feat\/x \(pull request #7 closed\): kept: pull request #7 closed without merging\n/,
  );
});

void test("guard: a malformed pull request is unknown, never finished", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  const w = world(repos, () => [
    { ...merged(x, 7), baseRefName: undefined as unknown as string },
  ]);
  await release(w, x.path);
  await assertKept(
    w,
    repos.primary,
    x,
    "its newest pull request can't be read",
  );
});

void test("guard: a replacement ref can't fake ancestry: commits beyond the merged head keep it", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  // Work after the merged head, released there.
  write(x.path, "later.ts", "export const later = 1;\n");
  const later = commitAll(x.path, "feat: later");
  const w = world(repos, () => [merged(x, 7)]);
  await release(w, x.path);
  // A replacement that makes the merged head a child of the later work.
  const tree = gitLine(x.path, "rev-parse", `${x.head}^{tree}`);
  const fake = gitLine(x.path, "commit-tree", tree, "-p", later, "-m", "fake");
  git(x.path, "replace", x.head, fake);
  assert.equal(
    git(x.path, "merge-base", "--is-ancestor", later, x.head),
    "",
    "with replacements, git calls the later work part of the merged head",
  );
  await assertKept(
    w,
    repos.primary,
    { ...x },
    "it holds commits beyond pull request #7's head",
  );
});

void test("guard: the default branch is never deleted, even with a merged pull request named after it", async (t) => {
  const repos = makeRepos(t);
  const main = gitLine(repos.primary, "rev-parse", "main");
  git(repos.primary, "switch", "-q", "--detach");
  const w = world(repos, () => [merged({ branch: "main", head: main }, 7)]);
  const run = await w.leftovers(["--remove"], repos.primary);
  assert.match(
    run.err,
    /kept the local branch main: it is the default branch\n/,
  );
  assert.equal(gitLine(repos.primary, "rev-parse", "main"), main);
  assert.deepEqual(destructive(w.git.calls), []);
});

void test("guard: a symbolic branch ref is never deleted, so the branch it aliases is safe", async (t) => {
  const repos = makeRepos(t);
  // Live work in its own worktree, and an alias of its branch whose name a
  // merged pull request shares.
  const y = addWorktree(repos, "y", { push: false });
  git(
    repos.primary,
    "symbolic-ref",
    "refs/heads/alias",
    `refs/heads/${y.branch}`,
  );
  const w = world(repos, () => [merged({ branch: "alias", head: y.head }, 7)]);
  const run = await w.leftovers(["--remove"], repos.primary);
  assert.match(
    run.err,
    /kept the local branch alias: it is a symbolic ref to refs\/heads\/feat\/y\n/,
  );
  assert.equal(gitLine(repos.primary, "rev-parse", y.branch), y.head);
  assert.deepEqual(destructive(w.git.calls), []);
});

void test("full names: a tag sharing a branch's name doesn't stand in for it", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x");
  git(repos.primary, "tag", x.branch, "main");
  const w = world(repos, () => [merged(x, 7)]);
  await release(w, x.path);
  const run = await w.leftovers(["--remove"], repos.primary);
  assert.equal(run.code, 0, run.out + run.err);
  assert.match(run.out, /deleted the local branch feat\/x/);
  assert.equal(
    gitLine(repos.primary, "rev-parse", `refs/tags/${x.branch}`),
    gitLine(repos.primary, "rev-parse", "main"),
  );
});

void test("full names: a missing branch is still missing when a tag has its name", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  git(repos.primary, "tag", x.branch, x.head);
  git(repos.primary, "update-ref", "-d", `refs/heads/${x.branch}`);
  const w = world(repos, () => [merged(x, 7)]);
  const run = await w.leftovers([], repos.primary);
  assert.ok(
    run.out.includes(
      `worktree ${asGit(x.path)} (feat/x): kept: its branch refs/heads/feat/x no longer exists\n`,
    ),
    run.out,
  );
});

void test("guard: a failed branch listing is unknown: nothing local is judged or removed", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  let failing = false;
  const w = world(repos, () => [merged(x, 7)], {
    hooks: {
      before: ({ args }) =>
        Promise.resolve(
          failing && args[0] === "for-each-ref" && args.includes("refs/heads/")
            ? { code: 128, stdout: "", stderr: "fatal: bad object\n" }
            : undefined,
        ),
    },
  });
  await release(w, x.path);
  failing = true;
  const run = await w.leftovers(["--remove"], repos.primary);
  assert.match(
    run.err,
    /not checked: local branches \(git couldn't list them\), so no worktree or local branch is removed\n/,
  );
  assert.ok(
    run.err.includes(
      `kept the worktree at ${asGit(x.path)} (feat/x): local branches couldn't be listed\n`,
    ),
    run.err,
  );
  assert.doesNotMatch(run.out + run.err, /no longer exists/);
  assert.deepEqual(destructive(w.git.calls), []);
});

void test("an empty branch listing is no branches, not a failure", async (t) => {
  const repos = makeRepos(t);
  git(repos.primary, "switch", "-q", "--detach");
  git(repos.primary, "update-ref", "-d", "refs/heads/main");
  assert.equal(git(repos.primary, "for-each-ref", "refs/heads/"), "");
  const w = world(repos, () => []);
  const run = await w.leftovers([], repos.primary);
  assert.equal(run.out, "leftovers: no leftover branches or worktrees\n");
});

void test("guard: a marker blob that isn't a version 1 marker is no marker", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  const w = world(repos, () => [merged(x, 7)]);
  await release(w, x.path);
  const marker = JSON.parse(
    git(x.path, "cat-file", "blob", RELEASED_REF),
  ) as Record<string, unknown>;
  git(
    x.path,
    "update-ref",
    RELEASED_REF,
    blob(x.path, `${JSON.stringify({ ...marker, version: 2 })}\n`),
  );
  await assertKept(w, repos.primary, x, "its release marker can't be read");
});
