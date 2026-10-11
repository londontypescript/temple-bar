// Setup at the root of a pnpm workspace. One install covers the whole
// workspace, so a package folder holding its own lockfile or workspace file
// (a framework scaffolder run inside it leaves them behind) makes that single
// install fail or choose the wrong files. This file finds such leftovers
// before setup changes anything. Side effects go through the injected seams,
// so it is testable without spawning pnpm.

import path from "node:path";

import {
  FOREIGN_LOCKFILES,
  LAUNCH_COMMAND,
  listPackagesCommand,
} from "./package-manager.ts";
import type { ProcessRunner, RunOptions } from "./runner.ts";

export const WORKSPACE_FILE = "pnpm-workspace.yaml";

/** What setup reads from disk here. The launcher's file seam satisfies it. */
export interface WorkspaceFiles {
  readText(filePath: string): Promise<string | undefined>;
  realPath(filePath: string): Promise<string>;
}

/** Files that belong to the root only. Inside a package they break the one
 * root install. Other per-package files (ESLint config, .gitignore,
 * AGENTS.md) are legitimate and never looked at. */
const RESIDUE_FILES: readonly string[] = [
  "pnpm-lock.yaml",
  ...FOREIGN_LOCKFILES,
  WORKSPACE_FILE,
];

/** The absolute folder of every package in `pnpm list --json` output, or
 * undefined when the output isn't the list of {path} objects pnpm prints. */
export function parsePackageFolders(output: string): string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    return undefined;
  }
  const folders: string[] = [];
  for (const entry of parsed as unknown[]) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("path" in entry) ||
      typeof entry.path !== "string" ||
      !path.isAbsolute(entry.path)
    ) {
      return undefined;
    }
    folders.push(entry.path);
  }
  return folders;
}

export function workspaceListFailedMessage(detail: string): string {
  return (
    `temple-bar could not list this workspace's packages (${detail}). Nothing was changed.\n` +
    "\n" +
    "It looks at every package before installing, because a lockfile left\n" +
    "inside a package breaks the single install at the root. Check that\n" +
    `${WORKSPACE_FILE} is valid and that this command works here:\n` +
    "  pnpm list --recursive --depth -1 --json\n" +
    "Then run setup again:\n" +
    `  ${LAUNCH_COMMAND}\n`
  );
}

/** The refusal naming every leftover file (paths relative to the root). */
export function workspaceResidueMessage(found: readonly string[]): string {
  return (
    "temple-bar found files inside workspace packages that break a workspace install. Nothing was changed.\n" +
    "\n" +
    found.map((file) => `  ${file}`).join("\n") +
    "\n\n" +
    "A workspace installs once, from the root, and keeps one lockfile there.\n" +
    "A lockfile or workspace file inside a package (a framework scaffolder\n" +
    "leaves them) competes with the root's and makes that install fail or\n" +
    "pick the wrong files.\n" +
    "\n" +
    "Delete the files listed above, then run setup again:\n" +
    `  ${LAUNCH_COMMAND}\n`
  );
}

export type ResidueResult =
  { readonly found: readonly string[] } | { readonly failure: string };

/** Lists the workspace's packages and returns the leftover files in them, or
 * a failure message when the listing can't be trusted. Changes nothing. */
export async function findWorkspaceResidue(
  root: string,
  files: WorkspaceFiles,
  run: ProcessRunner,
  options: RunOptions,
): Promise<ResidueResult> {
  const list = listPackagesCommand();
  const result = await run(list.command, list.args, {
    ...options,
    capture: true,
  });
  if (result.code !== 0) {
    return {
      failure: workspaceListFailedMessage(
        `pnpm exited with ${String(result.code)}`,
      ),
    };
  }
  const folders = parsePackageFolders(result.stdout ?? "");
  if (folders === undefined) {
    return {
      failure: workspaceListFailedMessage("its output wasn't a package list"),
    };
  }
  // pnpm lists the root too when it has a package.json; its own lockfile and
  // workspace file are the real ones.
  const realRoot = await files.realPath(root);
  const found: string[] = [];
  for (const folder of folders) {
    if ((await files.realPath(folder)) === realRoot) {
      continue;
    }
    for (const name of RESIDUE_FILES) {
      const file = path.join(folder, name);
      if ((await files.readText(file)) !== undefined) {
        found.push(path.relative(root, file));
      }
    }
  }
  return { found };
}
