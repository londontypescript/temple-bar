// The packed `temple-bar merge` in a pnpm workspace, with real pnpm and real
// git: only GitHub is faked. Merge runs the full gate in-process on a branch
// it brings up to date, and in a workspace the gate lists the packages
// through the pnpm that started it (npm_execpath). Started by
// `pnpm exec temple-bar merge` it has no such pnpm and refuses; started by
// the root `merge` script setup writes, as `pnpm merge <N>` from the
// default-branch checkout, the gate lists both packages and the merge lands.

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";

import {
  startPackedLauncher,
  type PackedLauncher,
} from "./support/launcher.ts";
import {
  startMergeProject,
  succeed,
  type MergeProject,
} from "./support/merge-github.ts";
import { describe, run } from "./support/run.ts";

let launcher: PackedLauncher | undefined;
let project: MergeProject | undefined;

before(async () => {
  launcher = await startPackedLauncher("temple-bar-workspace-merge-");
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

/** Runs a command that must succeed, in `cwd`, and returns its stdout. */
function ok(
  command: string,
  args: readonly string[],
  cwd = inProject().cwd,
): Promise<string> {
  return succeed(command, args, { ...inProject(), cwd });
}

void test(
  "workspace merge: pnpm merge from the default-branch checkout merges a behind branch, and the gate lists the packages",
  { timeout: 600_000 },
  async () => {
    const origin = inProject().origin;
    const worktree = path.join(folder(), "wt-x");
    const seed = path.join(folder(), "seed");

    const manifest = JSON.parse(
      await ok("git", ["show", "main:package.json"]),
    ) as { scripts?: Record<string, string> };
    assert.equal(manifest.scripts?.merge, "temple-bar merge");

    // The pull request's branch, in its own worktree (the post-checkout hook
    // installs it), marked ready and pushed.
    await ok("git", [
      "worktree",
      "add",
      "-q",
      "-b",
      "feat/x",
      worktree,
      "main",
    ]);
    writeFileSync(path.join(worktree, "x.md"), "# X\n");
    await ok("git", ["add", "x.md"], worktree);
    await ok("git", ["commit", "-q", "-m", "docs: add x"], worktree);
    await ok("pnpm", ["ready"], worktree);
    await ok("git", ["push", "-q", "-u", "origin", "feat/x"], worktree);
    const pushedTip = await ok("git", ["rev-parse", "HEAD"], worktree);

    // The default branch moves on, so the pull request's branch is behind.
    await ok("git", ["clone", "-q", origin, seed], folder());
    writeFileSync(path.join(seed, "y.md"), "# Y\n");
    await ok("git", ["add", "y.md"], seed);
    await ok("git", ["commit", "-q", "-m", "docs: add y"], seed);
    await ok("git", ["push", "-q", "origin", "main"], seed);

    // The control: started without pnpm, the gate inside merge can't list
    // the workspace's packages, so merge refuses and pushes nothing. Its
    // merge commit stays in the worktree, so the branch goes back to what
    // was pushed.
    const exec = await run(
      "pnpm",
      ["exec", "temple-bar", "merge", "7"],
      inProject(),
    );
    assert.equal(exec.code, 1, describe(exec));
    assert.match(exec.stderr, /the gate wasn't started through pnpm/);
    assert.match(
      exec.stderr,
      /`pnpm merge <N>` from the default-branch checkout/,
    );
    assert.match(
      exec.stderr,
      /^merge: refused: with origin\/main merged in, feat\/x fails the gate/m,
    );
    assert.equal(
      await ok("git", ["--git-dir", origin, "rev-parse", "refs/heads/feat/x"]),
      pushedTip,
    );
    await ok("git", ["reset", "-q", "--hard", pushedTip], worktree);

    const merge = await run("pnpm", ["merge", "7"], inProject());
    assert.equal(merge.code, 0, describe(merge));
    assert.match(
      merge.stdout,
      /^ {2}passed {3}workspace packages \(the root and 2 package\(s\)\)$/m,
    );
    assert.match(merge.stdout, /^ {2}passed {3}lint \(packages\/b\)$/m);
    assert.match(merge.stdout, /^merge: merged #7 as "docs: add x \(#7\)"$/m);
    assert.equal(
      await ok("git", [
        "--git-dir",
        origin,
        "log",
        "-1",
        "--format=%s",
        "main",
      ]),
      "docs: add x (#7)",
    );
    assert.equal(
      await ok("git", ["rev-parse", "main"]),
      await ok("git", ["--git-dir", origin, "rev-parse", "main"]),
      "main fast-forwarded",
    );

    // GitHub accepted the merge commit that brought the branch up to date.
    // Its remote branch is deleted, leased to that commit, and the worktree
    // and the local branch stay where they are.
    const accepted = readFileSync(path.join(folder(), "merged-head"), "utf8");
    assert.notEqual(accepted, pushedTip);
    assert.equal(
      await ok("git", [
        "--git-dir",
        origin,
        "for-each-ref",
        "refs/heads/feat/x",
      ]),
      "",
      "origin's branch is deleted",
    );
    assert.ok(existsSync(worktree), "the worktree is kept");
    assert.equal(await ok("git", ["rev-parse", "feat/x"]), accepted);
    assert.ok(
      merge.stdout.includes(
        `merge: deleted origin/feat/x, whose tip was still the merged ${accepted}\n`,
      ),
      describe(merge),
    );
    assert.match(
      merge.stdout,
      new RegExp(
        `^merge: kept the worktree at .*wt-x on feat/x \\(${accepted}\\);`,
        "m",
      ),
    );
  },
);
