// Integration tests for the post-checkout hook in real temp repos: the real
// shim from the shared git folder, the real CLI from source, real `git
// worktree add`. Only pnpm is a stand-in (testing/fake-pnpm.ts), so nothing
// reaches the npm registry.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createFakePnpm,
  runGitWithEnv,
  type FakePnpm,
} from "./testing/fake-pnpm.ts";
import {
  createHookFixture,
  installRealHooks,
  runGit,
  toShPath,
  type HookFixture,
} from "./testing/repo-fixture.ts";

const ZEROS = "0".repeat(40);

interface Project {
  readonly fixture: HookFixture;
  readonly pnpm: FakePnpm;
  /** The commit new worktrees start from: it has no packages/gone/. */
  readonly base: string;
  readonly worktree: string;
}

function write(dir: string, file: string, content: string): void {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), content, "utf8");
}

/** A primary checkout with a pnpm project, env templates committed, real
 * env files beside them (holding values no output may show), and the
 * hooks installed. */
function createProject(): Project {
  const fixture = createHookFixture();
  const { repoDir, root } = fixture;
  write(repoDir, ".gitignore", "node_modules/\n.env\n.env.*\n!*.example\n");
  write(repoDir, ".env.example", "KEY_A=\nKEY_B=\nKEY_C=\n");
  write(repoDir, "package.json", "{}\n");
  write(repoDir, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  write(repoDir, "packages/app/index.txt", "app\n");
  write(repoDir, "packages/app/.env.example", "APP_KEY=\n");
  runGit(repoDir, ["add", "."]);
  runGit(repoDir, ["commit", "-q", "-m", "chore: base"]);
  const base = runGit(repoDir, ["rev-parse", "HEAD"]).stdout.trim();
  write(repoDir, "packages/gone/index.txt", "gone\n");
  runGit(repoDir, ["add", "."]);
  runGit(repoDir, [
    "commit",
    "-q",
    "-m",
    "chore: a package newer branches have",
  ]);

  write(repoDir, ".env", "KEY_A=secret-value-a\nKEY_B=secret-value-b\n");
  chmodSync(path.join(repoDir, ".env"), 0o600);
  write(repoDir, ".env.local", "LOCAL=secret-value-local\n");
  write(repoDir, "packages/app/.env", "APP_KEY=secret-value-app\n");
  write(repoDir, "packages/gone/.env", "GONE=secret-value-gone\n");
  assert.equal(installRealHooks(fixture).code, 0);

  const pnpmDir = path.join(root, "fake-pnpm");
  mkdirSync(pnpmDir);
  return {
    fixture,
    pnpm: createFakePnpm(pnpmDir),
    base,
    worktree: path.join(root, "feature"),
  };
}

function addWorktree(project: Project, fail = false) {
  return runGitWithEnv(
    project.fixture.repoDir,
    ["worktree", "add", "-q", "-b", "feature", project.worktree, project.base],
    project.pnpm.env({ fail }),
  );
}

void test("worktree add: the new worktree gets its dependencies and env files, with missing keys named and no value printed", () => {
  const project = createProject();
  try {
    const result = addWorktree(project);
    const output = result.stdout + result.stderr;

    assert.equal(result.code, 0, output);
    assert.deepEqual(
      project.pnpm.calls().map((call) => call.args),
      [["install", "--frozen-lockfile"]],
    );
    // The fake creates node_modules/ where it runs: in the new worktree.
    assert.ok(existsSync(path.join(project.worktree, "node_modules")));

    const { repoDir } = project.fixture;
    for (const file of [".env", ".env.local", "packages/app/.env"]) {
      assert.ok(
        existsSync(path.join(project.worktree, file)),
        `${file} must be copied in`,
      );
      assert.equal(
        readFileSync(path.join(project.worktree, file), "utf8"),
        readFileSync(path.join(repoDir, file), "utf8"),
        `${file} must be copied as it is`,
      );
    }
    if (process.platform !== "win32") {
      assert.equal(
        statSync(path.join(project.worktree, ".env")).mode & 0o777,
        0o600,
      );
    }
    assert.equal(
      existsSync(path.join(project.worktree, "packages", "gone")),
      false,
    );
    assert.match(
      output,
      /skipped packages\/gone\/\.env: its folder isn't on this worktree's branch/,
    );
    assert.match(output, /\.env lacks keys that \.env\.example lists: KEY_C\n/);
    assert.doesNotMatch(output, /packages\/app\/\.env lacks/);
    assert.doesNotMatch(output, /secret-value/);
  } finally {
    project.fixture.cleanup();
  }
});

void test("worktree add: an env file already in the worktree is never overwritten", () => {
  const project = createProject();
  try {
    assert.equal(addWorktree(project).code, 0);
    writeFileSync(path.join(project.worktree, ".env"), "KEY_A=mine\n", "utf8");

    // The same hook run again, as git runs it for a new worktree.
    const hook = path.join(
      project.fixture.repoDir,
      ".git",
      "hooks",
      "post-checkout",
    );
    const again = spawnSync("sh", [toShPath(hook), ZEROS, project.base, "1"], {
      cwd: project.worktree,
      env: project.pnpm.env(),
      encoding: "utf8",
    });
    const output = again.stdout + again.stderr;

    assert.equal(again.status, 0, output);
    assert.match(output, /kept \.env: this worktree already has one/);
    assert.equal(
      readFileSync(path.join(project.worktree, ".env"), "utf8"),
      "KEY_A=mine\n",
    );
    assert.doesNotMatch(output, /secret-value/);
  } finally {
    project.fixture.cleanup();
  }
});

void test("worktree add: a failed install exits non-zero, says what to run, and leaves the worktree and its env files", () => {
  const project = createProject();
  try {
    const result = addWorktree(project, true);
    const output = result.stdout + result.stderr;

    assert.notEqual(result.code, 0, output);
    assert.match(output, /pnpm install --frozen-lockfile failed \(exit 1\)/);
    // The path itself is git's spelling of it, which on Windows and macOS
    // can differ from the test's temp path (short names, /private).
    assert.match(output, /cd ".*feature" && pnpm install --frozen-lockfile/);
    assert.ok(existsSync(path.join(project.worktree, "package.json")));
    assert.ok(existsSync(path.join(project.worktree, ".env")));
  } finally {
    project.fixture.cleanup();
  }
});

void test("checkout: switching branches in a worktree does nothing extra", () => {
  const project = createProject();
  try {
    assert.equal(addWorktree(project).code, 0);
    const callsAfterAdd = project.pnpm.calls().length;

    const env = project.pnpm.env();
    const created = runGitWithEnv(
      project.worktree,
      ["checkout", "-b", "other"],
      env,
    );
    const back = runGitWithEnv(project.worktree, ["checkout", "feature"], env);

    assert.equal(created.code, 0, created.stderr);
    assert.equal(back.code, 0, back.stderr);
    assert.doesNotMatch(
      created.stdout + created.stderr + back.stdout + back.stderr,
      /temple-bar/,
    );
    assert.equal(project.pnpm.calls().length, callsAfterAdd);
  } finally {
    project.fixture.cleanup();
  }
});
