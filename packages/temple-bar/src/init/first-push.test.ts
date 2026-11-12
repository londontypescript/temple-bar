// Setup's own push, with real git: exactly the commit read, never tags, and
// only to origin's own repository.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { pushAgreed } from "./first-push.ts";
import { readHeadState, readPushIdentities } from "./push-identities.ts";
import { createRealContext, type Context } from "../context.ts";
import { initTestRepo } from "../testing/git-repo.ts";

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

const ORIGIN = { owner: "acme", repo: "widgets" };

/** A repository with one commit and an annotated tag, whose pushes follow
 * tags, and a bare repository standing in for GitHub. */
function repos(): { dir: string; github: string; ctx: Context } {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-push-"));
  const github = mkdtempSync(path.join(tmpdir(), "temple-bar-push-github-"));
  git(github, ["init", "--bare", "--initial-branch=main"]);
  initTestRepo(dir);
  git(dir, ["commit", "--allow-empty", "-m", "one"]);
  git(dir, ["tag", "-a", "v1", "-m", "v1"]);
  git(dir, ["config", "push.followTags", "true"]);
  git(dir, ["remote", "add", "origin", "git@github.com:acme/widgets.git"]);
  const real = createRealContext();
  // origin's URL stays GitHub's; only the push itself lands in the bare
  // repository.
  const ctx: Context = {
    ...real,
    cwd: dir,
    git: {
      run: (args, cwd, input) =>
        real.git.run(
          args[2] === "push" && args[3] === "origin"
            ? [...args.slice(0, 3), github, ...args.slice(4)]
            : args,
          cwd,
          input,
        ),
    },
  };
  return { dir, github, ctx };
}

async function agreed(ctx: Context, dir: string) {
  const read = await readPushIdentities(
    ctx,
    dir,
    await readHeadState(ctx, dir),
  );
  assert.ok(read.ok);
  return read.value;
}

void test("the push sends the commit read to its branch, and no tag, whatever push.followTags says", async () => {
  const { dir, github, ctx } = repos();
  try {
    const outcome = await pushAgreed(ctx, dir, ORIGIN, await agreed(ctx, dir));
    assert.deepEqual(outcome, { ok: true });
    assert.equal(
      git(github, ["for-each-ref", "--format=%(refname) %(objectname)"]),
      `refs/heads/main ${git(dir, ["rev-parse", "HEAD"])}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(github, { recursive: true, force: true });
  }
});

void test("a push URL elsewhere, set directly or by pushInsteadOf, stops the push", async () => {
  for (const redirect of [
    [
      "remote",
      "set-url",
      "--add",
      "--push",
      "origin",
      "git@example.com:x/y.git",
    ],
    ["config", "url.git@example.com:.pushInsteadOf", "git@github.com:"],
  ]) {
    const { dir, github, ctx } = repos();
    try {
      git(dir, redirect);
      const outcome = await pushAgreed(
        ctx,
        dir,
        ORIGIN,
        await agreed(ctx, dir),
      );
      assert.ok(!outcome.ok);
      assert.match(outcome.message, /git@example\.com/);
      assert.equal(git(github, ["for-each-ref"]), "");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(github, { recursive: true, force: true });
    }
  }
});
