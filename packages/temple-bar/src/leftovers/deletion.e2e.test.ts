// The guards on the deletions themselves, against real git with only
// GitHub faked: one repository behind git, gh and origin's URLs; a remote
// branch deleted only at exactly the merged head and under a lease; a
// local branch deleted only when no worktree holds it and under its old
// value. Races are driven deterministically through the git seam.

import assert from "node:assert/strict";
import { existsSync, rmSync, writeFileSync } from "node:fs";
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
  world,
  write,
} from "./testing/repos.ts";

void test("guard: GH_REPO set refuses to start, deleting nothing", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x");
  const w = world(repos, () => [merged(x, 7)]);
  await release(w, x.path);
  const run = await w.leftovers(["--remove"], repos.primary, {
    env: { GH_REPO: "someone/else" },
  });
  assert.equal(run.code, 1);
  assert.equal(
    run.err,
    "leftovers: refused, nothing deleted:\nleftovers:   GH_REPO is set, so git or gh may be looking at another repository\n",
  );
  assert.deepEqual(destructive(w.git.calls), []);
});

void test("guard: a graft file refuses to start, since grafts rewrite ancestry", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x");
  const w = world(repos, () => [merged(x, 7)]);
  await release(w, x.path);
  const grafts = path.join(repos.primary, ".git", "info", "grafts");
  writeFileSync(grafts, "");
  const run = await w.leftovers(["--remove"], repos.primary);
  assert.equal(run.code, 1);
  assert.equal(
    run.err,
    `leftovers: refused, nothing deleted:\nleftovers:   a graft file rewrites ancestry (${grafts})\n`,
  );
  assert.deepEqual(destructive(w.git.calls), []);
});

void test("guard: origin's push URL naming another repository: nothing counts as finished", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x");
  const w = world(repos, () => [merged(x, 7)]);
  await release(w, x.path);
  git(
    repos.primary,
    "config",
    "remote.origin.pushurl",
    "https://github.com/other/r.git",
  );
  await assertKept(
    w,
    repos.primary,
    x,
    "origin's push URL https://github.com/other/r.git doesn't name o/r on github.com",
  );
  assert.equal(gitLine(repos.origin, "rev-parse", x.branch), x.head);
});

void test("guard: when gh can't list pull requests, nothing is finished or removed", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x");
  const w = world(repos, () => [merged(x, 7)], {
    gh: {
      run: (args) =>
        Promise.resolve(
          args[0] === "repo"
            ? {
                code: 0,
                stdout:
                  '{"nameWithOwner":"o/r","defaultBranchRef":{"name":"main"}}',
                stderr: "",
                notFound: false,
              }
            : { code: 1, stdout: "", stderr: "HTTP 502", notFound: false },
        ),
    },
  });
  await release(w, x.path);
  const run = await w.leftovers(["--remove"], repos.primary);
  assert.equal(run.code, 1);
  assert.match(
    run.err,
    /not checked: branches' pull requests \(gh couldn't list them\)\n/,
  );
  assert.ok(existsSync(x.path));
  assert.deepEqual(destructive(w.git.calls), []);
});

void test("guard: origin's branch behind the merged head is reported, not deleted", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x");
  write(x.path, "later.ts", "export const later = 1;\n");
  const later = commitAll(x.path, "feat: later");
  const w = world(repos, () => [merged({ ...x, head: later }, 7)]);
  await release(w, x.path);
  const run = await w.leftovers(["--remove"], repos.primary);
  assert.match(
    run.err,
    new RegExp(
      `kept origin/feat/x: its tip ${RegExp.escape(x.head)} isn't pull request #7's head ${RegExp.escape(later)}\\n`,
    ),
  );
  assert.equal(gitLine(repos.origin, "rev-parse", x.branch), x.head);
  assert.deepEqual(
    destructive(w.git.calls).filter((call) => call.startsWith("push")),
    [],
  );
});

void test("guard: origin's branch moving after it was read is kept by the lease", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x");
  const other = path.join(repos.root, "other");
  git(repos.root, "clone", "-q", "-b", x.branch, repos.origin, other);
  const w = world(repos, () => [merged(x, 7)], {
    hooks: {
      // Someone pushes to the branch just before the deletion goes out.
      before: ({ args }) => {
        if (args[0] === "push" && args.includes(`:refs/heads/${x.branch}`)) {
          git(
            other,
            "-c",
            "user.name=T",
            "-c",
            "user.email=t@example.com",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "late",
          );
          git(other, "push", "-q", "origin", x.branch);
        }
        return Promise.resolve(undefined);
      },
    },
  });
  await release(w, x.path);
  const run = await w.leftovers(["--remove"], repos.primary);
  const late = gitLine(other, "rev-parse", "HEAD");
  assert.equal(
    gitLine(repos.origin, "rev-parse", x.branch),
    late,
    "the late push survives",
  );
  assert.match(
    run.err,
    new RegExp(
      `kept origin/feat/x: its tip is ${RegExp.escape(late)}, not the merged ${RegExp.escape(x.head)}`,
    ),
  );
});

void test("guard: when origin can't be read, no remote branch is pushed at, and local work goes on", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x");
  const w = world(repos, () => [merged(x, 7)], {
    hooks: {
      before: ({ args }) =>
        Promise.resolve(
          args[0] === "ls-remote"
            ? { code: 128, stdout: "", stderr: "fatal: unable to access\n" }
            : undefined,
        ),
    },
  });
  await release(w, x.path);
  const run = await w.leftovers(["--remove"], repos.primary);
  assert.match(
    run.err,
    /not checked: remote branches \(couldn't read origin\)\n/,
  );
  assert.match(run.out, /removed the worktree at .*x \(feat\/x\)/);
  assert.equal(gitLine(repos.origin, "rev-parse", x.branch), x.head);
  assert.equal(
    w.git.calls.some(({ args }) => args[0] === "push"),
    false,
  );
});

void test("guard: a local branch that moved after it was read is kept by its old value", async (t) => {
  const repos = makeRepos(t);
  const z = addWorktree(repos, "z", { push: false });
  git(repos.primary, "worktree", "remove", z.path);
  const w = world(repos, () => [merged(z, 7)], {
    hooks: {
      // The branch moves just before its deletion.
      before: ({ args }) => {
        if (
          args[0] === "update-ref" &&
          args.includes(`refs/heads/${z.branch}`)
        ) {
          git(repos.primary, "update-ref", `refs/heads/${z.branch}`, "main");
        }
        return Promise.resolve(undefined);
      },
    },
  });
  const run = await w.leftovers(["--remove"], repos.primary);
  assert.match(
    run.err,
    /kept the local branch feat\/z: it moved, or git refused/,
  );
  assert.equal(
    gitLine(repos.primary, "rev-parse", z.branch),
    gitLine(repos.primary, "rev-parse", "main"),
  );
});

void test("guard: a local branch checked out after the classification is kept, by the list read right before", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  const z = addWorktree(repos, "z", { push: false });
  git(repos.primary, "worktree", "remove", z.path);
  const again = path.join(repos.root, "z-again");
  const w = world(repos, () => [merged(x, 7), merged(z, 8)], {
    hooks: {
      // Once x is removed, a session checks feat/z out again.
      after: ({ args }) => {
        if (args[0] === "worktree" && args[1] === "remove") {
          git(repos.primary, "worktree", "add", "-q", again, z.branch);
        }
        return Promise.resolve();
      },
    },
  });
  await release(w, x.path);
  const run = await w.leftovers(["--remove"], repos.primary);
  assert.ok(
    run.err.includes(
      `kept the local branch feat/z: it is checked out in ${asGit(again)}\n`,
    ),
    run.err,
  );
  assert.equal(gitLine(repos.primary, "rev-parse", z.branch), z.head);
});

void test("guard: a branch whose worktree removal failed is kept, even once git no longer lists it", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  const w = world(repos, () => [merged(x, 7)], {
    hooks: {
      // git drops its record of the worktree, then fails on the folder.
      before: ({ args }) => {
        if (args[0] === "worktree" && args[1] === "remove") {
          rmSync(path.join(repos.primary, ".git", "worktrees", "x"), {
            recursive: true,
            force: true,
          });
          return Promise.resolve({
            code: 1,
            stdout: "",
            stderr: "error: failed to delete\n",
          });
        }
        return Promise.resolve(undefined);
      },
    },
  });
  await release(w, x.path);
  const run = await w.leftovers(["--remove"], repos.primary);
  assert.ok(
    run.err.includes(
      `kept the local branch feat/x: its worktree at ${asGit(x.path)} was kept\n`,
    ),
    run.err,
  );
  assert.equal(gitLine(repos.primary, "rev-parse", x.branch), x.head);
});
