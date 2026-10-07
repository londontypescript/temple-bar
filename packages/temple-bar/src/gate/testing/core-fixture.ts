// What a set-up repo looks like to the gate's core check, for the gate's
// tests: every test of a passing gate needs setup's core in place, the way
// every real project has it. Not shipped: the build tsconfig excludes every
// `testing/` folder.

import path from "node:path";

import { createFsSeam } from "../../seams/fs.ts";
import { createGitSeam } from "../../seams/git.ts";
import type { GitResult } from "../../seams/git.ts";
import { installHooks } from "../../hooks/install.ts";
import { GITIGNORE_LINES, writeSetupFiles } from "../../init/files.ts";
import { CHECKED_WORKFLOWS } from "../../init/workflows.ts";
import { createFakeContext, createFakeWriter } from "../../testing/fakes.ts";
import { INSTALLED_SCRIPTS, INSTALLED_SHIMS } from "../core.ts";

/** The scripts setup adds to package.json, to spread into a test's own. */
export const CORE_SCRIPTS: Readonly<Record<string, string>> = INSTALLED_SCRIPTS;

/** The files the core and workflow checks read under `root`, for a fake
 * filesystem: the hooks in `<root>/.git/hooks`, .gitignore and the gate and
 * title workflows. package.json is the test's own; give it CORE_SCRIPTS. */
export function coreFiles(root = "/repo"): Record<string, string> {
  const files: Record<string, string> = {
    [path.join(root, ".gitignore")]: `${GITIGNORE_LINES.join("\n")}\n`,
  };
  for (const workflow of CHECKED_WORKFLOWS) {
    files[path.join(root, ...workflow.path.split("/"))] = workflow.content;
  }
  for (const [name, content] of Object.entries(INSTALLED_SHIMS)) {
    files[path.join(root, ".git", "hooks", name)] = content;
  }
  return files;
}

/** Wraps a fake git script so it also answers the core check's questions as
 * a set-up repo would: the hooks folder is .git/hooks, core.hooksPath is
 * unset and pull.ff is "only". Everything else goes to `script`. */
export function withCoreGit(
  script: (args: readonly string[], cwd: string) => GitResult,
): (args: readonly string[], cwd: string) => GitResult {
  return (args, cwd) => {
    const joined = args.join(" ");
    if (joined === "rev-parse --git-common-dir") {
      return { code: 0, stdout: ".git\n", stderr: "" };
    }
    if (joined === "config --get core.hooksPath") {
      return { code: 1, stdout: "", stderr: "" };
    }
    if (joined === "config --get pull.ff") {
      return { code: 0, stdout: "only\n", stderr: "" };
    }
    return script(args, cwd);
  };
}

/** Runs setup's own file writing and hook install on a real repo at `dir`,
 * so an end-to-end test checks exactly what setup installs. Write the test's
 * package.json first: setup adds its scripts to it. */
export async function installCore(dir: string): Promise<void> {
  const ctx = createFakeContext({
    git: createGitSeam(),
    fs: createFsSeam(),
    stdout: createFakeWriter(),
    stderr: createFakeWriter(),
    cwd: dir,
  });
  const files = await writeSetupFiles(ctx, dir);
  const hooks = await installHooks(ctx, dir);
  if (files.packageOutcome.conflicts.length > 0 || hooks.hasConflicts) {
    throw new Error(`setup could not install its core in ${dir}`);
  }
}
