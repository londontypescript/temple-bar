// A batch reads git's index once (ADR 0018); these tests show, on a real
// repo, what it still catches: a link staged before a batch starts, and a
// link put on disk at any point, even inside the batch.

import assert from "node:assert/strict";
import {
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

import type { Context } from "../context.ts";
import { installHooks } from "../hooks/install.ts";
import { createInitCommand } from "./command.ts";
import { realLink, writeTargetRepo } from "./testing/write-target-repo.ts";
import { setupWriteTargets } from "./write-target.ts";

/** The context with its git seam recording each call's arguments. */
function recordingGit(ctx: Context) {
  const calls: (readonly string[])[] = [];
  return {
    indexReads: () => calls.filter((args) => args[0] === "ls-files").length,
    ctx: {
      ...ctx,
      git: {
        run: (args: readonly string[], cwd: string) => {
          calls.push(args);
          return ctx.git.run(args, cwd);
        },
      },
    },
  };
}

void test("setup batch: a link staged between two batches on one object is refused by the second", async () => {
  const repo = writeTargetRepo();
  try {
    const git = recordingGit(repo.ctx);
    const targets = setupWriteTargets(git.ctx, repo.root);
    await targets.batch(async (batched) => {
      assert.equal(await batched.writeText("AGENTS.md", "first\n"), true);
      assert.equal(await batched.writeText(".gitignore", "first\n"), true);
    });
    assert.equal(git.indexReads(), 1);
    repo.stageLink("AGENTS.md", "elsewhere");
    await targets.batch(async (batched) => {
      assert.equal(await batched.writeText("AGENTS.md", "second\n"), false);
    });
    assert.equal(git.indexReads(), 2, "the second batch read the index again");
    assert.equal(
      readFileSync(path.join(repo.root, "AGENTS.md"), "utf8"),
      "elsewhere",
    );
    assert.equal(
      targets.refusals.get("AGENTS.md")?.reason,
      "is a tracked symlink",
    );
  } finally {
    repo.cleanup();
  }
});

void test("setup batch: outside a batch, a link staged between two inspections is refused by the second", async () => {
  const repo = writeTargetRepo();
  try {
    const targets = setupWriteTargets(repo.ctx, repo.root);
    assert.equal(await targets.writeText("AGENTS.md", "first\n"), true);
    repo.stageLink("AGENTS.md", "elsewhere");
    assert.equal(await targets.writeText("AGENTS.md", "second\n"), false);
    assert.equal(
      readFileSync(path.join(repo.root, "AGENTS.md"), "utf8"),
      "elsewhere",
    );
  } finally {
    repo.cleanup();
  }
});

void test("setup batch: a file replaced by a link inside a batch is refused at its write", async () => {
  const repo = writeTargetRepo();
  try {
    const git = recordingGit(repo.ctx);
    const targets = setupWriteTargets(git.ctx, repo.root);
    const file = path.join(repo.root, "AGENTS.md");
    const outside = path.join(repo.outside, "target");
    writeFileSync(outside, "outside\n");
    await targets.batch(async (batched) => {
      assert.equal(await batched.writeText("AGENTS.md", "first\n"), true);
      rmSync(file);
      realLink(outside, file);
      assert.equal(await batched.writeText("AGENTS.md", "second\n"), false);
    });
    assert.equal(git.indexReads(), 1, "the index was read once");
    assert.equal(readlinkSync(file), outside);
    assert.equal(readFileSync(outside, "utf8"), "outside\n");
  } finally {
    repo.cleanup();
  }
});

void test("setup batch: a folder replaced by a link inside a batch is refused at its write", async () => {
  const repo = writeTargetRepo();
  try {
    const git = recordingGit(repo.ctx);
    const targets = setupWriteTargets(git.ctx, repo.root);
    const docs = path.join(repo.root, "docs");
    await targets.batch(async (batched) => {
      assert.equal(
        await batched.writeText("docs/conventions.md", "first\n"),
        true,
      );
      rmSync(docs, { recursive: true, force: true });
      realLink(repo.outside, docs, true);
      assert.equal(
        await batched.writeText("docs/conventions.md", "second\n"),
        false,
      );
    });
    assert.equal(git.indexReads(), 1, "the index was read once");
    assert.deepEqual(readdirSync(repo.outside), []);
  } finally {
    repo.cleanup();
  }
});

void test("setup batch: one setup run on a fresh repo reads git's index at most three times", async () => {
  const repo = writeTargetRepo();
  try {
    const git = recordingGit(repo.ctx);
    const code = await createInitCommand({ installHooks }).run([], git.ctx);
    assert.equal(code, 0, repo.stderr.lines.join(""));
    // The early .gitignore step, outside any batch, reads before its read
    // and again before its write; the batch of every other file reads once.
    assert.ok(git.indexReads() <= 3, `${String(git.indexReads())} index reads`);
  } finally {
    repo.cleanup();
  }
});
