// Shared fixture for the hooks integration tests: a temp repo with a bare
// "origin" beside it and a fake node_modules/.bin/temple-bar, so the tests
// exercise the real installed shims (shims.ts) and the real command
// (command.ts) end to end, through real git, exactly like production.
//
// Not shipped: the build tsconfig must exclude "src/hooks/testing/**"
// (orchestrator change, alongside the existing "src/testing/**" exclusion).

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

import { configureTestRepo, initTestRepo } from "../../testing/git-repo.ts";

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
function toShPath(p: string): string {
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
  readonly repoDir: string;
  readonly originDir: string;
  readonly binPath: string;
  /** Runs `sh <fake-bin> hook <...args>` in repoDir. */
  hook(args: readonly string[], input?: string): CommandResult;
  /** Overwrites the fake bin with one that only records that it ran, to
   * prove the reference-transaction shim's fast path never starts it. */
  installMarkerBin(markerPath: string): void;
  /** Restores the real fake bin after installMarkerBin. */
  installRealBin(): void;
  cleanup(): void;
}

/**
 * Sets up repoDir (a normal repo on `main`) with a bare originDir remote,
 * a fake node_modules/.bin/temple-bar that runs the real CLI from source
 * (src/cli.ts, through the router), and installs the
 * real shims into repoDir via `hook install`.
 */
export function createHookFixture(): HookFixture {
  const root = mkdtempSync(path.join(tmpdir(), "temple-bar-hooks-"));
  const repoDir = path.join(root, "repo");
  const originDir = path.join(root, "origin.git");

  mkdirSync(repoDir, { recursive: true });
  runGit(root, ["init", "-q", "--bare", "--initial-branch=main", originDir]);

  initTestRepo(repoDir);
  runGit(repoDir, ["remote", "add", "origin", toShPath(originDir)]);

  const binDir = path.join(repoDir, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const binPath = path.join(binDir, "temple-bar");

  function installRealBin(): void {
    const script = `#!/bin/sh\nexec "${toShPath(process.execPath)}" "${toShPath(CLI_PATH)}" "$@"\n`;
    writeFileSync(binPath, script, "utf8");
    chmodSync(binPath, 0o755);
  }
  installRealBin();

  function hook(args: readonly string[], input?: string): CommandResult {
    return runSh(binPath, ["hook", ...args], repoDir, input);
  }

  function installMarkerBin(markerPath: string): void {
    const script = `#!/bin/sh\n: > "${toShPath(markerPath)}"\nexit 0\n`;
    writeFileSync(binPath, script, "utf8");
    chmodSync(binPath, 0o755);
  }

  function cleanup(): void {
    rmSync(root, { recursive: true, force: true });
  }

  return {
    repoDir,
    originDir,
    binPath,
    hook,
    installMarkerBin,
    installRealBin,
    cleanup,
  };
}

/** Installs the real shims (via the fake bin's `hook install`) and points
 * repoDir's hooksPath at them, exactly as production `init` (1.7) would. */
export function installRealHooks(fixture: HookFixture): CommandResult {
  return fixture.hook(["install"]);
}

/** Clones originDir to a second working copy, commits a file on `main` and
 * pushes it, simulating a merge that happened "on GitHub". Returns the new
 * commit's SHA. */
export function pushToOriginMain(
  root: string,
  originDir: string,
  fileName: string,
  content: string,
): string {
  const cloneDir = path.join(root, "clone");
  runGit(root, ["clone", "-q", toShPath(originDir), cloneDir]);
  configureTestRepo(cloneDir);
  writeFileSync(path.join(cloneDir, fileName), content, "utf8");
  runGit(cloneDir, ["add", fileName]);
  runGit(cloneDir, ["commit", "-q", "-m", `via clone: ${fileName}`]);
  runGit(cloneDir, ["push", "-q", "origin", "HEAD:main"]);
  const sha = runGit(cloneDir, ["rev-parse", "HEAD"]).stdout.trim();
  rmSync(cloneDir, { recursive: true, force: true });
  return sha;
}
