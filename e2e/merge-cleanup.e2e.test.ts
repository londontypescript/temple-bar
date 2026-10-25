// What the packed `temple-bar merge` leaves after GitHub has accepted the
// squash, with real pnpm and real git: only GitHub is faked. It keeps the
// branch's worktree and local branch, and deletes origin's branch only while
// its tip is still the head GitHub accepted. The fake GitHub can run git
// commands the moment it accepts the squash, before cleanup runs, so a push
// or a commit can race the cleanup the way another session's could.

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";

import {
  startPackedLauncher,
  type PackedLauncher,
} from "./support/launcher.ts";
import {
  pullRequestEnv,
  startMergeProject,
  succeed,
  type MergeProject,
  type RaceStep,
} from "./support/merge-github.ts";
import { describe, run, type RunResult } from "./support/run.ts";

let launcher: PackedLauncher | undefined;
let project: MergeProject | undefined;

before(async () => {
  launcher = await startPackedLauncher("temple-bar-merge-cleanup-");
  project = await startMergeProject(launcher);
});

after(async () => {
  await launcher?.close();
});

function inProject(): MergeProject {
  assert.ok(project, "the workspace was not set up");
  return project;
}

function folder(): string {
  assert.ok(launcher, "the launcher did not start");
  return launcher.folder;
}

function git(args: readonly string[], cwd = inProject().cwd): Promise<string> {
  return succeed("git", args, { ...inProject(), cwd });
}

/** origin's tip of `branch`, or "" when origin has no such branch. */
function originTip(branch: string): Promise<string> {
  return git([
    "--git-dir",
    inProject().origin,
    "for-each-ref",
    "--format=%(objectname)",
    `refs/heads/${branch}`,
  ]);
}

interface Opened {
  readonly worktree: string;
  /** The branch's tip as pushed, which GitHub accepts: it is up to date. */
  readonly pushedTip: string;
  /** Runs `pnpm merge <N>` from the default-branch checkout. */
  merge(race?: readonly RaceStep[]): Promise<RunResult>;
  /** The head the fake GitHub recorded when it accepted the squash. */
  accepted(): string;
}

/** A pull request's branch, cut from origin's main in its own worktree
 * (the post-checkout hook installs it), marked ready and pushed. */
async function openPullRequest(number: number, name: string): Promise<Opened> {
  const branch = `feat/${name}`;
  const worktree = path.join(folder(), `wt-${name}`);
  await git(["fetch", "-q", "origin"]);
  await git(["worktree", "add", "-q", "-b", branch, worktree, "origin/main"]);
  writeFileSync(path.join(worktree, `${name}.md`), `# ${name}\n`);
  await git(["add", `${name}.md`], worktree);
  await git(["commit", "-q", "-m", `docs: add ${name}`], worktree);
  await succeed("pnpm", ["ready"], { ...inProject(), cwd: worktree });
  await git(["push", "-q", "-u", "origin", branch], worktree);
  const pushedTip = await git(["rev-parse", "HEAD"], worktree);
  const title = `docs: add ${name}`;
  return {
    worktree,
    pushedTip,
    merge: (race) => {
      const options = pullRequestEnv(inProject(), folder(), {
        number,
        branch,
        title,
        ...(race === undefined ? {} : { race }),
      });
      return run("pnpm", ["merge", String(number)], options);
    },
    accepted: () =>
      readFileSync(
        path.join(folder(), `pr-${String(number)}-merged-head`),
        "utf8",
      ),
  };
}

void test(
  "merge cleanup, remote newer: a push to the branch after GitHub accepted the squash is kept on origin, and merge exits 1",
  { timeout: 600_000 },
  async () => {
    const pr = await openPullRequest(8, "a");
    // The newer commit exists on "GitHub" before the race, but no branch
    // points at it until the race moves feat/a there.
    const newer = await git([
      "--git-dir",
      inProject().origin,
      "commit-tree",
      `${pr.pushedTip}^{tree}`,
      "-p",
      pr.pushedTip,
      "-m",
      "docs: more a",
    ]);
    const merge = await pr.merge([
      {
        cwd: folder(),
        args: [
          "--git-dir",
          inProject().origin,
          "update-ref",
          "refs/heads/feat/a",
          newer,
        ],
      },
    ]);

    assert.equal(
      await originTip("feat/a"),
      newer,
      `origin must keep the commit pushed after the merge\n${describe(merge)}`,
    );
    assert.equal(merge.code, 1, describe(merge));
    assert.equal(pr.accepted(), pr.pushedTip);
    assert.ok(
      merge.stderr.includes(
        `merge: left behind: kept origin/feat/a: its tip is ${newer}, not the merged ${pr.pushedTip}, so it holds work that didn't merge. Look at it before deleting it.\n`,
      ),
      describe(merge),
    );
    assert.match(merge.stdout, /^merge: merged #8 as "docs: add a \(#8\)"$/m);
    assert.ok(existsSync(pr.worktree), "the worktree is kept");
    assert.equal(await git(["rev-parse", "feat/a"]), pr.pushedTip);
  },
);

void test(
  "merge cleanup, local newer: a commit made on the branch after GitHub accepted the squash survives, and origin's branch is deleted",
  { timeout: 600_000 },
  async () => {
    const pr = await openPullRequest(9, "b");
    const merge = await pr.merge([
      {
        cwd: path.join(folder(), "wt-b"),
        args: ["commit", "-q", "--allow-empty", "-m", "docs: more b"],
      },
    ]);
    assert.equal(merge.code, 0, describe(merge));

    const tip = await git(["rev-parse", "feat/b"]);
    assert.notEqual(tip, pr.pushedTip, "the commit made after the merge");
    assert.equal(await git(["log", "-1", "--format=%s", tip]), "docs: more b");
    assert.equal(await git(["rev-parse", `${tip}^`]), pr.pushedTip);
    assert.equal(pr.accepted(), pr.pushedTip);
    assert.equal(await originTip("feat/b"), "", "origin's branch is deleted");
    assert.ok(
      merge.stdout.includes(
        `merge: deleted origin/feat/b, whose tip was still the merged ${pr.pushedTip}\n`,
      ),
      describe(merge),
    );
    assert.ok(existsSync(pr.worktree), "the worktree is kept");
    assert.match(
      merge.stdout,
      new RegExp(
        `^merge: kept the worktree at .*wt-b on feat/b \\(${tip}, which is not the merged ${pr.pushedTip}\\);`,
        "m",
      ),
    );
    // Work that didn't merge is never offered for removal.
    assert.doesNotMatch(merge.stdout, /local branch feat\/b:/);
  },
);

void test(
  "merge cleanup, ordinary: origin's branch is deleted, and the worktree and local branch are kept, reported and listed as leftovers",
  { timeout: 600_000 },
  async () => {
    const pr = await openPullRequest(10, "c");
    const merge = await pr.merge();
    assert.equal(merge.code, 0, describe(merge));

    assert.equal(pr.accepted(), pr.pushedTip);
    assert.equal(await originTip("feat/c"), "", "origin's branch is deleted");
    assert.ok(existsSync(pr.worktree), "the worktree is kept");
    assert.equal(await git(["rev-parse", "feat/c"]), pr.pushedTip);
    assert.ok(
      merge.stdout.includes(
        `merge: deleted origin/feat/c, whose tip was still the merged ${pr.pushedTip}\n`,
      ),
      describe(merge),
    );
    assert.match(
      merge.stdout,
      new RegExp(
        `^merge: kept the worktree at .*wt-c on feat/c \\(${pr.pushedTip}\\); your harness removes it when it is done, or inspect it with temple-bar leftovers$`,
        "m",
      ),
    );
    assert.match(
      merge.stdout,
      /^merge: leftovers: {3}worktree .*wt-c: its branch feat\/c's pull request #10 is merged/m,
    );
    assert.match(
      merge.stdout,
      /^merge: leftovers: {3}local branch feat\/c: pull request #10 merged \(git branch -D feat\/c\)$/m,
    );
  },
);
