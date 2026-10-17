// The five-package stack (e2e/fixtures/stack.ts) set up by the packed
// launcher, for the release tier's tests: temple-bar packed the way a
// release is, every other package installed for real from npm. One install
// per test file; a test that changes the stack puts back what it touched
// through git, so the next test starts from the same commit.
//
// What a failure needs to be diagnosed is kept outside the test's temporary
// folder, in this checkout's gitignored .temple-bar/release-check/: the
// lockfile pnpm resolved and every command's output, written as each one
// runs, so a hung or killed run leaves them too. The release-check workflow
// uploads that folder when a run fails. A failed install is then either the
// registry (run it again) or a graph that no longer fits (a reviewed version
// change, or a fix in temple-bar), never a reason to loosen a test.

import assert from "node:assert/strict";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stackWorkspace } from "../fixtures/stack.ts";
import {
  launch,
  makeProject,
  startPackedLauncher,
  type PackedLauncher,
} from "../support/launcher.ts";
import { describe, run, type RunResult } from "../support/run.ts";

const repoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export interface StackProject {
  readonly launcher: PackedLauncher;
  /** The stack's root. */
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /** What the packed launcher printed while it set the stack up. */
  readonly setup: RunResult;
  /** Runs a command in `cwd` (the stack's root by default), keeping its
   * output in the retained log. */
  run(
    command: string,
    args: readonly string[],
    cwd?: string,
  ): Promise<RunResult>;
  /** Writes `files` (undefined deletes one), runs `body`, then puts every
   * touched path back as committed and checks nothing else changed. */
  withFiles<T>(
    files: Readonly<Record<string, string | undefined>>,
    body: () => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
}

/** The folder this checkout keeps a test file's evidence in, emptied. */
function retainedFolder(name: string): string {
  const folder = path.join(repoRoot, ".temple-bar", "release-check", name);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  return folder;
}

/** Packs temple-bar, writes the stack into a new git project, sets it up
 * with the packed launcher and commits setup's work on a branch (the hooks
 * refuse commits to main). Retained evidence goes under `name`. */
export async function startStack(name: string): Promise<StackProject> {
  const retained = retainedFolder(name);
  const log = path.join(retained, "commands.log");
  /** Runs `start`, keeping its output and how long it took in the log. */
  const keep = async (
    label: string,
    start: () => Promise<RunResult>,
  ): Promise<RunResult> => {
    const began = Date.now();
    const result = await start();
    const seconds = ((Date.now() - began) / 1000).toFixed(1);
    appendFileSync(log, `$ ${label} (${seconds} s)\n${describe(result)}\n\n`);
    return result;
  };
  const launcher = await startPackedLauncher(`tb-${name}-`);
  try {
    const options = await makeProject(launcher, "stack", stackWorkspace());
    const { cwd } = options;
    // tsx keeps a cache in the temp folder, which the launcher checks is
    // left empty: a cache, not a leak, so it is turned off.
    const env = { ...options.env, TSX_DISABLE_CACHE: "1" };
    const setup = await keep("packed launcher", () =>
      launch(launcher, options),
    );
    const lockfile = path.join(cwd, "pnpm-lock.yaml");
    if (existsSync(lockfile)) {
      copyFileSync(lockfile, path.join(retained, "pnpm-lock.yaml"));
    }
    assert.equal(setup.code, 0, describe(setup));

    const inStack = async (
      command: string,
      args: readonly string[],
      at = cwd,
    ): Promise<RunResult> =>
      keep(
        `${path.relative(launcher.folder, at) || "."}: ${command} ${args.join(" ")}`,
        () => run(command, args, { cwd: at, env }),
      );
    const ok = async (args: readonly string[]): Promise<void> => {
      const result = await inStack("git", args);
      assert.equal(result.code, 0, describe(result));
    };
    // The gate's ruleset checks would read GitHub for a GitHub origin; this
    // project is made up, so its origin is somewhere never contacted.
    await ok([
      "remote",
      "set-url",
      "origin",
      "https://git.example.invalid/acme/stack.git",
    ]);
    await ok(["switch", "-q", "-c", "setup"]);
    await ok(["add", "-A"]);
    await ok(["commit", "-q", "-m", "chore: set up temple-bar"]);

    return {
      launcher,
      cwd,
      env,
      setup,
      run: inStack,
      withFiles: async (files, body) => {
        try {
          for (const [relative, text] of Object.entries(files)) {
            const file = path.join(cwd, ...relative.split("/"));
            if (text === undefined) {
              rmSync(file, { force: true });
            } else {
              mkdirSync(path.dirname(file), { recursive: true });
              writeFileSync(file, text);
            }
          }
          return await body();
        } finally {
          await restore(cwd, Object.keys(files), inStack);
        }
      },
      close: () => launcher.close(),
    };
  } catch (error) {
    await launcher.close();
    throw error;
  }
}

/** Puts `paths` back as the last commit has them: checked out if it has
 * them, deleted with any folder left empty if it doesn't. Then nothing in
 * the project may differ from that commit. */
async function restore(
  cwd: string,
  paths: readonly string[],
  inStack: StackProject["run"],
): Promise<void> {
  for (const relative of paths) {
    const tracked = await inStack("git", [
      "ls-files",
      "--error-unmatch",
      "--",
      relative,
    ]);
    if (tracked.code === 0) {
      const back = await inStack("git", ["checkout", "HEAD", "--", relative]);
      assert.equal(back.code, 0, describe(back));
      continue;
    }
    rmSync(path.join(cwd, ...relative.split("/")), { force: true });
    let folder = path.dirname(path.join(cwd, ...relative.split("/")));
    while (
      path.relative(cwd, folder) !== "" &&
      existsSync(folder) &&
      readdirSync(folder).length === 0
    ) {
      rmdirSync(folder);
      folder = path.dirname(folder);
    }
  }
  const status = await inStack("git", [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]);
  assert.equal(status.stdout, "", describe(status));
}

/** Each file git would commit in the project, with its text: what the fake
 * GitHub API serves as a commit's tree. */
export async function committedFiles(
  stack: StackProject,
): Promise<Record<string, string>> {
  const listed = await stack.run("git", ["ls-files", "-z"]);
  assert.equal(listed.code, 0, describe(listed));
  return Object.fromEntries(
    listed.stdout
      .split("\0")
      .filter(Boolean)
      .map((file) => [file, readFileSync(path.join(stack.cwd, file), "utf8")]),
  );
}
