// Integration tests for the length cap against real temp git repos: the
// package default applies with no config file, a project's own config
// overrides it, an over-cap file fails and names itself, and a nested
// worktree is never scanned (P3.7).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createFsSeam } from "../seams/fs.ts";
import { createGitSeam } from "../seams/git.ts";
import type { Context } from "../context.ts";
import { checkFileLengths, DEFAULT_MAX_FILE_LINES } from "./lengths.ts";

function initRepo(dir: string): void {
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
}

function stageAll(dir: string): void {
  execFileSync("git", ["add", "-A"], { cwd: dir });
}

function minimalContext(cwd: string): Context {
  return {
    git: createGitSeam(),
    gh: {
      run: () =>
        Promise.resolve({ code: 0, stdout: "", stderr: "", notFound: false }),
    },
    fs: createFsSeam(),
    clock: { now: () => new Date() },
    prompt: {
      isInteractive: () => false,
      confirm: () => Promise.resolve("no-terminal"),
    },
    proc: { run: () => Promise.resolve(0) },
    stdout: { write: () => undefined },
    stderr: { write: () => undefined },
    cwd,
    env: process.env,
  };
}

void test("lengths e2e: a file over the configured cap fails, naming itself", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-lengths-over-"));
  try {
    initRepo(dir);
    writeFileSync(
      path.join(dir, "temple-bar.config.json"),
      JSON.stringify({ maxFileLines: 3 }),
    );
    writeFileSync(path.join(dir, "big.txt"), "1\n2\n3\n4\n5\n");
    writeFileSync(path.join(dir, "small.txt"), "1\n");
    stageAll(dir);

    const result = await checkFileLengths(minimalContext(dir));

    assert.equal(result.maxLines, 3);
    assert.deepEqual(
      result.offenders.map((o) => o.path),
      ["big.txt"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("lengths e2e: maxFileLines from the project's config is honoured (a file that would pass the default fails a tighter cap)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-lengths-config-"));
  try {
    initRepo(dir);
    writeFileSync(
      path.join(dir, "temple-bar.config.json"),
      JSON.stringify({ maxFileLines: 2 }),
    );
    writeFileSync(path.join(dir, "medium.txt"), "1\n2\n3\n");
    stageAll(dir);

    const result = await checkFileLengths(minimalContext(dir));

    assert.deepEqual(
      result.offenders.map((o) => o.path),
      ["medium.txt"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("lengths e2e: the package default applies with no config file present", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-lengths-default-"));
  try {
    initRepo(dir);
    const overDefault = "line\n".repeat(DEFAULT_MAX_FILE_LINES + 1);
    writeFileSync(path.join(dir, "huge.txt"), overDefault);
    writeFileSync(path.join(dir, "small.txt"), "line\n");
    stageAll(dir);

    const result = await checkFileLengths(minimalContext(dir));

    assert.equal(result.maxLines, DEFAULT_MAX_FILE_LINES);
    assert.deepEqual(
      result.offenders.map((o) => o.path),
      ["huge.txt"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("lengths e2e: a nested worktree inside the project passes, even one with an over-cap file", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-lengths-worktree-"));
  const nestedDir = path.join(dir, "nested-worktree");
  try {
    initRepo(dir);
    writeFileSync(path.join(dir, "small.txt"), "1\n2\n3\n");
    stageAll(dir);
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

    mkdirSync(nestedDir);
    execFileSync(
      "git",
      ["worktree", "add", "-b", "nested-lengths-branch", nestedDir],
      { cwd: dir },
    );
    writeFileSync(
      path.join(nestedDir, "way-too-big.txt"),
      "line\n".repeat(DEFAULT_MAX_FILE_LINES + 100),
    );

    const result = await checkFileLengths(minimalContext(dir));

    assert.deepEqual(result.offenders, []);
    assert.equal(
      result.totalChecked,
      1,
      "only the outer repo's own file should be checked",
    );
  } finally {
    try {
      execFileSync("git", ["worktree", "remove", "--force", nestedDir], {
        cwd: dir,
      });
    } catch {
      // Best-effort: the outer rmSync below removes everything regardless.
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
