// A stand-in `pnpm` for the worktree setup tests, first on PATH, so the real
// post-checkout hook runs end to end without reaching the npm registry. It
// records each call and creates node_modules/ where it runs, or fails like
// a frozen-lockfile mismatch when asked to.
//
// Not shipped: the build tsconfig excludes every `testing/` folder.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { toShPath, type CommandResult } from "./repo-fixture.ts";

const SCRIPT = `import { appendFileSync, mkdirSync } from "node:fs";
appendFileSync(
  process.env.FAKE_PNPM_LOG,
  JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + "\\n",
);
if (process.env.FAKE_PNPM_FAIL === "1") {
  process.stderr.write("ERR_PNPM_OUTDATED_LOCKFILE (from the fake pnpm)\\n");
  process.exit(1);
}
mkdirSync("node_modules", { recursive: true });
`;

export interface FakePnpmCall {
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface FakePnpm {
  /** The environment to run git with: PATH starts at the fake. */
  env(options?: { fail?: boolean }): NodeJS.ProcessEnv;
  calls(): FakePnpmCall[];
}

/** Writes the fake into `dir` (an existing, empty folder). */
export function createFakePnpm(dir: string): FakePnpm {
  const script = path.join(dir, "fake-pnpm.mjs");
  const logPath = path.join(dir, "calls.jsonl");
  writeFileSync(script, SCRIPT, "utf8");
  // `pnpm` for POSIX; `pnpm.cmd` for Windows, where the proc seam starts
  // pnpm through cmd.exe, which looks for a .cmd file.
  const shim = path.join(dir, "pnpm");
  writeFileSync(
    shim,
    `#!/bin/sh\nexec "${toShPath(process.execPath)}" "${toShPath(script)}" "$@"\n`,
    "utf8",
  );
  chmodSync(shim, 0o755);
  writeFileSync(
    path.join(dir, "pnpm.cmd"),
    `@"${process.execPath}" "${script}" %*\r\n`,
    "utf8",
  );

  return {
    env(options = {}) {
      return {
        ...process.env,
        PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_PNPM_LOG: logPath,
        FAKE_PNPM_FAIL: options.fail === true ? "1" : "0",
      };
    },
    calls() {
      if (!existsSync(logPath)) {
        return [];
      }
      return readFileSync(logPath, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as FakePnpmCall);
    },
  };
}

/** Runs git with `env`, as a person would after putting the fake on PATH. */
export function runGitWithEnv(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): CommandResult {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  return {
    code: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
