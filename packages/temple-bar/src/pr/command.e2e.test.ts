// End to end against real temp git repos and the real git seam: an oversized
// diff is warned about, a lockfile-only change is not, and a pure rename is
// not counted.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { Context } from "../context.ts";
import { createFsSeam } from "../seams/fs.ts";
import { createGitSeam } from "../seams/git.ts";
import { createFakeWriter, createFakeHttp } from "../testing/fakes.ts";
import { initTestRepo } from "../testing/git-repo.ts";
import { prSizeCommandEntry } from "./command.ts";

function git(dir: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: dir });
}

function lines(count: number): string {
  return Array.from({ length: count }, (_, i) => `line ${String(i)}\n`).join(
    "",
  );
}

/** A repo with one commit on main and a feature branch checked out. */
function repoWithBranch(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-pr-size-"));
  initTestRepo(dir);
  writeFileSync(
    path.join(dir, "temple-bar.config.json"),
    JSON.stringify({ maxPullRequestLines: 20, maxPullRequestFiles: 5 }),
  );
  writeFileSync(path.join(dir, "big.txt"), lines(50));
  git(dir, "add", "-A");
  git(dir, "commit", "-m", "base");
  git(dir, "checkout", "-b", "feature");
  return dir;
}

function commitAll(dir: string): void {
  git(dir, "add", "-A");
  git(dir, "commit", "-m", "change");
}

async function run(
  dir: string,
  body = "",
): Promise<{ code: number; out: string }> {
  const eventPath = path.join(dir, ".git", "event.json");
  writeFileSync(
    eventPath,
    JSON.stringify({ pull_request: { title: "feat: x", body } }),
  );
  const stdout = createFakeWriter();
  const ctx: Context = {
    git: createGitSeam(),
    gh: {
      run: () =>
        Promise.resolve({ code: 1, stdout: "", stderr: "", notFound: true }),
    },
    http: createFakeHttp(),
    fs: createFsSeam(),
    clock: { now: () => new Date() },
    prompt: {
      isInteractive: () => false,
      confirm: () => Promise.resolve("no-terminal"),
    },
    proc: { run: () => Promise.resolve(0) },
    stdout,
    stderr: createFakeWriter(),
    cwd: dir,
    env: { GITHUB_EVENT_PATH: eventPath },
  };
  const code = await prSizeCommandEntry.run(["--base", "main"], ctx);
  return { code, out: stdout.lines.join("") };
}

void test("pr-size e2e: an oversized diff closing three issues is warned about, exit 0", async () => {
  const dir = repoWithBranch();
  try {
    writeFileSync(path.join(dir, "new.txt"), lines(30));
    commitAll(dir);
    const { code, out } = await run(dir, "Closes #1\nCloses #2\nCloses #3");
    assert.equal(code, 0);
    assert.match(
      out,
      /warning: this pull request may be too big or mix concerns/,
    );
    assert.match(out, /it changes 30 lines \(limit 20\)/);
    assert.match(out, /it closes 3 issues: #1, #2, #3/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("pr-size e2e: a huge lockfile-only change is not warned about", async () => {
  const dir = repoWithBranch();
  try {
    writeFileSync(path.join(dir, "pnpm-lock.yaml"), lines(5000));
    commitAll(dir);
    const { code, out } = await run(dir, "Closes #1");
    assert.equal(code, 0);
    assert.match(out, /^pr-size: ok: 0 lines changed across 0 files/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("pr-size e2e: a pure rename is not counted, a file marked linguist-generated is not either", async () => {
  const dir = repoWithBranch();
  try {
    git(dir, "mv", "big.txt", "renamed.txt");
    writeFileSync(
      path.join(dir, ".gitattributes"),
      "out.gen.txt linguist-generated\n",
    );
    writeFileSync(path.join(dir, "out.gen.txt"), lines(500));
    commitAll(dir);
    const { code, out } = await run(dir);
    assert.equal(code, 0);
    // Only .gitattributes itself (1 line) counts.
    assert.match(out, /^pr-size: ok: 1 line changed across 1 file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
