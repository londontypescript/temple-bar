// Helpers for the gate's end-to-end tests, which run against real temp git
// repos with the real git, filesystem and process seams. GitHub is never
// contacted: the network seam is a fake that always fails. Not shipped: the
// build tsconfig excludes every `testing/` folder.

import { execFileSync } from "node:child_process";

import type { Context } from "../../context.ts";
import { createFsSeam } from "../../seams/fs.ts";
import { createGitSeam } from "../../seams/git.ts";
import { createProcSeam } from "../../seams/proc.ts";
import {
  createFakeContext,
  createFakeWriter,
  type FakeWriter,
} from "../../testing/fakes.ts";

/** `git add -A` in `dir`. New files are listed by the gate either way, but
 * staging keeps fixtures closer to a real mid-development repo and
 * exercises `--cached` too. */
export function stageAll(dir: string): void {
  execFileSync("git", ["add", "-A"], { cwd: dir });
}

/** The test run's environment without npm_execpath. Under `pnpm test` it
 * names the pnpm running the suite, and the gate would run every script
 * through it; these fixtures are npm projects, run as a person would run
 * the gate by hand, so they need no pnpm on PATH. */
export function withoutPackageManager(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.npm_execpath;
  return env;
}

/** A context on the real seams in `cwd`, with its output recorded. */
export function realContext(cwd: string): {
  ctx: Context;
  stdout: FakeWriter;
  stderr: FakeWriter;
} {
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    git: createGitSeam(),
    fs: createFsSeam(),
    proc: createProcSeam(),
    stdout,
    stderr,
    cwd,
    env: withoutPackageManager(),
  });
  return { ctx, stdout, stderr };
}
