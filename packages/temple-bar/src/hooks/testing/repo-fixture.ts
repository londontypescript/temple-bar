// Shared fixture for the hooks integration tests: a temp repo with a bare
// "origin" beside it and a fake node_modules/.bin/temple-bar, so the tests
// exercise the real installed shims (shims.ts) and the real command
// (command.ts) end to end, through real git, exactly like production.
//
// Not shipped: the build tsconfig excludes every `testing/` folder.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  chmodSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configureTestRepo } from "../../testing/git-repo.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
/** The real CLI entry point, run from source under type stripping. */
export const CLI_PATH = path.join(here, "..", "..", "cli.ts");

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Converts a filesystem path to the forward-slash form POSIX sh expects,
 * including under Git for Windows' MSYS sh (which git uses to run hooks on
 * every OS). A no-op on POSIX, where path.sep is already "/". */
export function toShPath(p: string): string {
  return p.split(path.sep).join("/");
}

export function runGit(cwd: string, args: readonly string[]): CommandResult {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    code: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** Runs a shim/bin script through `sh` explicitly (not by relying on OS
 * shebang association), matching how git itself runs hooks on every OS. */
export function runSh(
  scriptPath: string,
  args: readonly string[],
  cwd: string,
  input?: string,
): CommandResult {
  const result = spawnSync("sh", [toShPath(scriptPath), ...args], {
    cwd,
    encoding: "utf8",
    input,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export interface HookFixture {
  /** The temp directory holding repoDir, originDir and any extra clones. */
  readonly root: string;
  readonly repoDir: string;
  readonly originDir: string;
  readonly binPath: string;
  /** The branch both repos start on, and origin's default branch. */
  readonly branch: string;
  /** Runs `sh <fake-bin> hook <...args>` in repoDir. */
  hook(args: readonly string[], input?: string): CommandResult;
  /** Overwrites the fake bin with one that only records that it ran, to
   * prove the reference-transaction shim's fast path never starts it. */
  installMarkerBin(markerPath: string): void;
  /** Restores the real fake bin after installMarkerBin or removeBin. */
  installRealBin(): void;
  /** Deletes the fake bin, as in a checkout where the hooks are configured
   * but temple-bar hasn't been installed yet. */
  removeBin(): void;
  cleanup(): void;
}

export interface HookFixtureOptions {
  /** The branch to start on and make origin's default. Defaults to `main`. */
  readonly branch?: string;
}

/**
 * Sets up repoDir (a normal repo on `options.branch`, default `main`) with a
 * bare originDir remote whose default branch is the same, a fake
 * node_modules/.bin/temple-bar that runs the real CLI from source
 * (src/cli.ts, through the router). `installRealHooks` then installs the
 * real shims into repoDir via `hook install`.
 */
export function createHookFixture(
  options: HookFixtureOptions = {},
): HookFixture {
  const branch = options.branch ?? "main";
  const root = mkdtempSync(path.join(tmpdir(), "temple-bar-hooks-"));
  const repoDir = path.join(root, "repo");
  const originDir = path.join(root, "origin.git");

  mkdirSync(repoDir, { recursive: true });
  runGit(root, [
    "init",
    "-q",
    "--bare",
    `--initial-branch=${branch}`,
    originDir,
  ]);

  runGit(repoDir, ["init", "-q", `--initial-branch=${branch}`]);
  configureTestRepo(repoDir);
  runGit(repoDir, ["remote", "add", "origin", toShPath(originDir)]);

  const binPath = writeFakeBin(repoDir);

  function installRealBin(): void {
    writeFakeBin(repoDir);
  }

  function hook(args: readonly string[], input?: string): CommandResult {
    return runSh(binPath, ["hook", ...args], repoDir, input);
  }

  function installMarkerBin(markerPath: string): void {
    const script = `#!/bin/sh\n: > "${toShPath(markerPath)}"\nexit 0\n`;
    writeFileSync(binPath, script, "utf8");
    chmodSync(binPath, 0o755);
  }

  function removeBin(): void {
    rmSync(binPath, { force: true });
  }

  function cleanup(): void {
    rmSync(root, { recursive: true, force: true });
  }

  return {
    root,
    repoDir,
    originDir,
    binPath,
    branch,
    hook,
    installMarkerBin,
    installRealBin,
    removeBin,
    cleanup,
  };
}

/** Writes `<checkout>/node_modules/.bin/temple-bar` as a launcher for the
 * real CLI from source, the way an install of temple-bar would, and returns
 * its path. */
export function writeFakeBin(checkout: string): string {
  const binDir = path.join(checkout, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const binPath = path.join(binDir, "temple-bar");
  const script = `#!/bin/sh\nexec "${toShPath(process.execPath)}" "${toShPath(CLI_PATH)}" "$@"\n`;
  writeFileSync(binPath, script, "utf8");
  chmodSync(binPath, 0o755);
  return binPath;
}

/** Installs the real shims (via the fake bin's `hook install`) into the git
 * folder every worktree shares, exactly as production `init` would. */
export function installRealHooks(fixture: HookFixture): CommandResult {
  return fixture.hook(["install"]);
}

/** Marks the commit checked out in `dir` ready to push, the way a passing
 * `temple-bar ready` would, without running a gate: for tests about the
 * push itself. ready.integration.test.ts covers the real command. */
export function markReady(dir: string): string {
  const sha = runGit(dir, ["rev-parse", "HEAD"]).stdout.trim();
  const markPath = runGit(dir, [
    "rev-parse",
    "--git-path",
    "temple-bar-ready",
  ]).stdout.trim();
  writeFileSync(path.resolve(dir, markPath), `${sha}\n`, "utf8");
  return sha;
}

/** Clones originDir to a second working copy, commits a file on `branch`
 * (default `main`) and pushes it, simulating a merge that happened "on
 * GitHub". Returns the new commit's SHA. */
export function pushToOriginMain(
  root: string,
  originDir: string,
  fileName: string,
  content: string,
  branch = "main",
): string {
  const cloneDir = path.join(root, "clone");
  runGit(root, ["clone", "-q", toShPath(originDir), cloneDir]);
  configureTestRepo(cloneDir);
  // Continue `branch` if origin has it, else start it from origin's default
  // branch, or as the first commit when origin is still empty.
  const remoteBranch = `refs/remotes/origin/${branch}`;
  if (
    runGit(cloneDir, ["rev-parse", "--verify", "-q", remoteBranch]).code === 0
  ) {
    runGit(cloneDir, ["checkout", "-q", "-B", branch, remoteBranch]);
  } else if (
    runGit(cloneDir, ["rev-parse", "--verify", "-q", "HEAD"]).code === 0
  ) {
    runGit(cloneDir, ["checkout", "-q", "-b", branch]);
  } else {
    runGit(cloneDir, ["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
  }
  writeFileSync(path.join(cloneDir, fileName), content, "utf8");
  runGit(cloneDir, ["add", fileName]);
  runGit(cloneDir, ["commit", "-q", "-m", `via clone: ${fileName}`]);
  runGit(cloneDir, ["push", "-q", "origin", `HEAD:${branch}`]);
  const sha = runGit(cloneDir, ["rev-parse", "HEAD"]).stdout.trim();
  rmSync(cloneDir, { recursive: true, force: true });
  return sha;
}

/** Seeds origin with one commit on the fixture's branch, fetches it, records
 * origin's default branch as `refs/remotes/origin/HEAD` (as `git clone`
 * does), and checks the local branch out at that same commit, so both start
 * aligned: the normal state of a real clone. Returns that commit's SHA.
 *
 * origin/HEAD is set explicitly because only newer git versions create it on
 * fetch, and the tests must not depend on which git runs them. */
export function alignWithOrigin(fixture: HookFixture): string {
  const { repoDir, branch } = fixture;
  const sha = pushToOriginMain(
    fixture.root,
    fixture.originDir,
    "seed.txt",
    "seed\n",
    branch,
  );
  assert.equal(runGit(repoDir, ["fetch", "-q", "origin"]).code, 0);
  assert.equal(
    runGit(repoDir, ["remote", "set-head", "origin", branch]).code,
    0,
  );
  assert.equal(
    runGit(repoDir, ["checkout", "-q", "-B", branch, `origin/${branch}`]).code,
    0,
  );
  return sha;
}
