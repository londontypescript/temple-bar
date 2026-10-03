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
    env: process.env,
  });
  return { ctx, stdout, stderr };
}
