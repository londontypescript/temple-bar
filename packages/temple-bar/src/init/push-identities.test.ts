// The identities a first push publishes, read from a real repository: git's
// own settings must not hide one, rename one or break the read.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readHeadState,
  readPushIdentities,
  type PushIdentities,
} from "./push-identities.ts";
import { createRealContext, type Context } from "../context.ts";
import { createGitSeam } from "../seams/git.ts";
import { initTestRepo } from "../testing/git-repo.ts";

function git(dir: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, ...env },
  }).trim();
}

const ANN = {
  GIT_AUTHOR_NAME: "Ann",
  GIT_AUTHOR_EMAIL: "ann@example.com",
  GIT_COMMITTER_NAME: "Cal",
  GIT_COMMITTER_EMAIL: "cal@example.com",
};

/** A repository whose one commit Ann wrote, Cal committed, and Grace and Zed
 * co-authored (Zed outside the trailer block, in lower case). */
function annRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-identities-"));
  initTestRepo(dir);
  git(
    dir,
    [
      "commit",
      "--allow-empty",
      "-m",
      "Start\n\nco-authored-by:Zed <zed@example.com> paired here\n\nCo-authored-by: Grace <grace@example.com>",
    ],
    ANN,
  );
  return dir;
}

function contextIn(dir: string, env: NodeJS.ProcessEnv = {}): Context {
  const full = { ...process.env, ...env };
  return {
    ...createRealContext(),
    git: createGitSeam(full),
    env: full,
    cwd: dir,
  };
}

async function read(
  dir: string,
  env: NodeJS.ProcessEnv = {},
): Promise<PushIdentities> {
  const ctx = contextIn(dir, env);
  const result = await readPushIdentities(
    ctx,
    dir,
    await readHeadState(ctx, dir),
  );
  assert.ok(result.ok, result.ok ? "" : result.message);
  return result.value;
}

function withRepo(body: (dir: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = annRepo();
    try {
      await body(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

void test(
  "every source is disclosed: author, committer, co-authors anywhere in the message, the configured identity",
  withRepo(async (dir) => {
    const { lines } = await read(dir);
    assert.deepEqual(lines, [
      "Ann <ann@example.com>: author",
      "Cal <cal@example.com>: committer",
      "Grace <grace@example.com>: co-author",
      "Test <test@example.com>: your git author identity, your git committer identity",
      "Zed <zed@example.com> paired here: co-author",
      "No environment variable overrides the git identity.",
    ]);
  }),
);

void test(
  "git settings don't change the read: a mailmap, signatures shown, trailer separators, output encoding",
  withRepo(async (dir) => {
    const plain = await read(dir);
    writeFileSync(
      path.join(dir, ".mailmap"),
      "Mapped <mapped@example.com> <ann@example.com>\n",
    );
    for (const [key, value] of [
      ["log.mailmap", "true"],
      ["log.showSignature", "true"],
      ["trailer.separators", "#"],
      ["i18n.logOutputEncoding", "ISO-8859-1"],
      ["format.pretty", "oneline"],
    ]) {
      git(dir, ["config", key ?? "", value ?? ""]);
    }
    assert.deepEqual(await read(dir), plain);
  }),
);

void test(
  "a name outside ASCII reads the same whatever the output encoding",
  withRepo(async (dir) => {
    git(dir, ["config", "i18n.logOutputEncoding", "ISO-8859-1"]);
    git(dir, ["commit", "--allow-empty", "-m", "x"], {
      GIT_AUTHOR_NAME: "José",
      GIT_AUTHOR_EMAIL: "jose@example.com",
    });
    assert.ok(
      (await read(dir)).lines.includes("José <jose@example.com>: author"),
    );
  }),
);

void test(
  "replacement refs are ignored: a push sends the real commit",
  withRepo(async (dir) => {
    const plain = await read(dir);
    const tree = git(dir, ["rev-parse", "HEAD^{tree}"]);
    const fake = git(dir, ["commit-tree", tree, "-m", "fake"], {
      GIT_AUTHOR_NAME: "Fake",
      GIT_AUTHOR_EMAIL: "fake@example.com",
    });
    git(dir, ["replace", "HEAD", fake]);
    assert.equal(git(dir, ["log", "-1", "--format=%an"]), "Fake");
    assert.deepEqual(await read(dir), plain);
  }),
);

void test(
  "environment overrides are shown and coded; a new identity changes the code, a moved one doesn't",
  withRepo(async (dir) => {
    const plain = await read(dir);
    const overridden = await read(dir, {
      GIT_AUTHOR_EMAIL: "other@example.com",
    });
    assert.ok(
      overridden.lines.includes(
        "Set in the environment: GIT_AUTHOR_EMAIL=other@example.com",
      ),
    );
    assert.notEqual(overridden.code, plain.code);

    // The configured identity committing moves it into the history.
    git(dir, ["commit", "--allow-empty", "-m", "by the configured identity"]);
    assert.equal((await read(dir)).code, plain.code);

    git(dir, ["commit", "--allow-empty", "-m", "x"], {
      GIT_AUTHOR_NAME: "New",
      GIT_AUTHOR_EMAIL: "new@example.com",
    });
    assert.notEqual((await read(dir)).code, plain.code);
  }),
);

void test("HEAD's state is read exactly: commits, unborn, detached, a broken ref, a ref below the branch's name", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-head-"));
  try {
    initTestRepo(dir);
    const ctx = contextIn(dir);
    assert.deepEqual(await readHeadState(ctx, dir), {
      kind: "unborn",
      branch: "main",
    });

    git(dir, ["commit", "--allow-empty", "-m", "one"]);
    const one = git(dir, ["rev-parse", "HEAD"]);
    // A ref below an unborn branch's name isn't that branch.
    git(dir, ["switch", "--orphan", "fresh"]);
    git(dir, ["update-ref", "refs/heads/fresh/x", one]);
    assert.deepEqual(await readHeadState(ctx, dir), {
      kind: "unborn",
      branch: "fresh",
    });

    git(dir, ["switch", "main"]);
    assert.deepEqual(await readHeadState(ctx, dir), {
      kind: "commits",
      commit: one,
      branch: "main",
    });

    git(dir, ["switch", "--detach"]);
    assert.deepEqual(await readHeadState(ctx, dir), { kind: "detached" });

    // A ref git can't parse: git skips it with only a warning, so it reads
    // as unreadable, never as unborn.
    git(dir, ["switch", "main"]);
    const mainRef = path.join(dir, ".git", "refs", "heads", "main");
    writeFileSync(mainRef, "garbage\n");
    const broken = await readHeadState(ctx, dir);
    assert.equal(broken.kind, "unreadable");
    assert.equal((await readPushIdentities(ctx, dir, broken)).ok, false);

    // A branch naming a missing object is listed, but its history can't be
    // read, which stops setup too.
    writeFileSync(mainRef, `${"1".repeat(40)}\n`);
    const missing = await readHeadState(ctx, dir);
    assert.equal(missing.kind, "commits");
    assert.equal((await readPushIdentities(ctx, dir, missing)).ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
