// Bundles every seam (src/seams/) into the single object commands receive.
// Commands never import a seam's real implementation or `process` directly;
// they take a Context and call through it, so tests can hand them
// src/testing/fakes.ts instead.

import { createClockSeam, type ClockSeam } from "./seams/clock.ts";
import { createFsSeam, type FsSeam } from "./seams/fs.ts";
import { createGhSeam, type GhSeam } from "./seams/gh.ts";
import { createGitSeam, type GitSeam } from "./seams/git.ts";
import {
  createStderrWriter,
  createStdoutWriter,
  type Writer,
} from "./seams/io.ts";
import { createPromptSeam, type PromptSeam } from "./seams/prompt.ts";

export interface Context {
  readonly git: GitSeam;
  readonly gh: GhSeam;
  readonly fs: FsSeam;
  readonly clock: ClockSeam;
  readonly prompt: PromptSeam;
  readonly stdout: Writer;
  readonly stderr: Writer;
  readonly cwd: string;
  readonly env: Readonly<NodeJS.ProcessEnv>;
}

export function createRealContext(): Context {
  return {
    git: createGitSeam(process.env),
    gh: createGhSeam(process.env),
    fs: createFsSeam(),
    clock: createClockSeam(),
    prompt: createPromptSeam(),
    stdout: createStdoutWriter(),
    stderr: createStderrWriter(),
    cwd: process.cwd(),
    env: process.env,
  };
}
