// The core-setup check against a real repo, set up by setup's own code:
// deleting a hook fails the gate and restoring it passes; an edited hook
// fails too.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createFsSeam } from "../seams/fs.ts";
import { createGitSeam } from "../seams/git.ts";
import {
  createFakeContext,
  createFakeWriter,
  type FakeWriter,
} from "../testing/fakes.ts";
import { initTestRepo } from "../testing/git-repo.ts";
import { runCoreCheck } from "./core.ts";
import { installCore } from "./testing/core-fixture.ts";

async function check(dir: string) {
  const stderr: FakeWriter = createFakeWriter();
  const ctx = createFakeContext({
    git: createGitSeam(),
    fs: createFsSeam(),
    stderr,
    cwd: dir,
  });
  const outcome = await runCoreCheck(ctx);
  return { status: outcome.status, err: stderr.lines.join("") };
}

void test("core e2e: a deleted hook fails, the reinstalled one passes, an edited one fails", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-core-"));
  try {
    initTestRepo(dir);
    writeFileSync(path.join(dir, "README.md"), "# Sample\n");
    await installCore(dir);
    assert.equal((await check(dir)).status, "passed");

    const hook = path.join(dir, ".git", "hooks", "pre-commit");
    const original = readFileSync(hook, "utf8");
    unlinkSync(hook);
    const deleted = await check(dir);
    assert.equal(deleted.status, "failed");
    assert.match(deleted.err, /the pre-commit hook is missing/);

    await installCore(dir);
    assert.equal((await check(dir)).status, "passed");
    assert.equal(readFileSync(hook, "utf8"), original);

    appendFileSync(hook, "exit 0\n");
    const edited = await check(dir);
    assert.equal(edited.status, "failed");
    assert.match(
      edited.err,
      /the pre-commit hook differs from the one temple-bar installs/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("core e2e: pointing core.hooksPath elsewhere fails", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-core-path-"));
  try {
    initTestRepo(dir);
    await installCore(dir);
    execFileSync("git", ["config", "core.hooksPath", "elsewhere"], {
      cwd: dir,
    });
    const result = await check(dir);
    assert.equal(result.status, "failed");
    assert.match(result.err, /core\.hooksPath is set to "elsewhere"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
