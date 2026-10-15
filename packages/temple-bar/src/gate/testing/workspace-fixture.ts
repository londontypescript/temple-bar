// A pnpm workspace as the gate sees it through fakes: git's file list, the
// files on disk, and a pnpm (named by npm_execpath) that answers
// `pnpm list` and runs scripts with whatever exit codes a test chooses. Not
// shipped: the build tsconfig excludes every `testing/` folder.

import path from "node:path";

import type { Context } from "../../context.ts";
import type { ProcRunOptions } from "../../seams/proc.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
  createFakeProc,
  createFakeWriter,
  type FakeFs,
  type FakeProc,
  type FakeWriter,
  type RecordedProcCall,
} from "../../testing/fakes.ts";
import { CORE_SCRIPTS, coreFiles, withCoreGit } from "./core-fixture.ts";

/** Where the pnpm that started the gate lives, as npm_execpath names it. */
export const PNPM_EXEC = path.join("/tools", "pnpm", "bin", "pnpm.cjs");
/** npm's own entry point, as npm_execpath names it under `npm run`. */
export const NPM_EXEC = path.join("/tools", "npm", "bin", "npm-cli.js");

export const ALL_SCRIPTS: Readonly<Record<string, string>> = {
  typecheck: "tsc",
  lint: "eslint .",
  "format:check": "prettier --check .",
  test: "node --test",
};

export interface WorkspaceOptions {
  /** Each package folder (relative, "/"-separated) and its scripts;
   * undefined writes a package.json with no scripts at all. */
  readonly packages?: Readonly<
    Record<string, Readonly<Record<string, string>> | undefined>
  >;
  /** The root's own scripts, besides setup's. */
  readonly rootScripts?: Readonly<Record<string, string>>;
  /** Extra paths git lists, beyond the manifests and the workspace file. */
  readonly extraTracked?: readonly string[];
  /** Files on disk that git doesn't list, by absolute path. */
  readonly untracked?: Readonly<Record<string, string>>;
  /** false: no pnpm-workspace.yaml. */
  readonly workspaceFile?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  /** What `pnpm list` prints and exits with; by default, every package. */
  readonly listing?: {
    readonly stdout: string;
    readonly code?: number;
    readonly stderr?: string;
  };
  /** The exit code for `script` run in `folder` (relative, "" the root). */
  readonly exitCode?: (folder: string, script: string) => number;
}

export interface Workspace {
  readonly ctx: Context;
  readonly fs: FakeFs;
  readonly proc: FakeProc;
  readonly stdout: FakeWriter;
  readonly stderr: FakeWriter;
}

/** pnpm's probed `list --recursive --depth -1 --json` output for these
 * folders (the root included), in the order given. */
export function pnpmListing(folders: readonly string[]): string {
  return JSON.stringify(
    folders.map((folder) => ({
      name: folder === "" ? "workspace-root" : `pkg-${folder}`,
      version: "1.0.0",
      path: path.join("/repo", ...folder.split("/").filter(Boolean)),
      private: true,
    })),
    null,
    2,
  );
}

/** The script a recorded run was for, however it was started. */
export function scriptOf(call: RecordedProcCall): string | undefined {
  return call.args[call.args.indexOf("run") + 1];
}

/** The runs of scripts, as "folder:script" ("" the root), in order. */
export function scriptRuns(proc: FakeProc): string[] {
  return proc.calls
    .filter((call) => call.args.includes("run"))
    .map((call) => {
      const relative = path.relative(path.normalize("/repo"), call.cwd);
      return `${relative.split(path.sep).join("/")}:${scriptOf(call) ?? ""}`;
    });
}

function isListing(call: RecordedProcCall): boolean {
  return call.args.includes("list");
}

export function workspace(options: WorkspaceOptions = {}): Workspace {
  const packages = options.packages ?? {
    "packages/a": ALL_SCRIPTS,
    "packages/b": ALL_SCRIPTS,
  };
  const workspaceFile = options.workspaceFile ?? true;
  const tracked = [
    "package.json",
    ...(workspaceFile ? ["pnpm-workspace.yaml"] : []),
    ...Object.keys(packages).map((folder) => `${folder}/package.json`),
    ...(options.extraTracked ?? []),
  ];
  const files: Record<string, string> = {
    ...coreFiles(),
    "/repo/package.json": JSON.stringify({
      packageManager: "pnpm@10.34.5",
      scripts: { ...CORE_SCRIPTS, ...(options.rootScripts ?? ALL_SCRIPTS) },
    }),
  };
  for (const relative of tracked) {
    files[path.join("/repo", ...relative.split("/"))] ??= "{}\n";
  }
  for (const [folder, scripts] of Object.entries(packages)) {
    files[path.join("/repo", ...folder.split("/"), "package.json")] =
      JSON.stringify(scripts === undefined ? {} : { scripts });
  }
  const fs = createFakeFs({ ...files, ...options.untracked });

  const listing = options.listing ?? {
    stdout: pnpmListing(["", ...Object.keys(packages)]),
  };
  const proc = createFakeProc((call, run: ProcRunOptions) => {
    if (isListing(call)) {
      run.stdout.write(listing.stdout);
      run.stderr.write(listing.stderr ?? "");
      return listing.code ?? 0;
    }
    const relative = path.relative(path.normalize("/repo"), call.cwd);
    return (
      options.exitCode?.(
        relative.split(path.sep).join("/"),
        scriptOf(call) ?? "",
      ) ?? 0
    );
  });
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    git: createFakeGit(
      withCoreGit(() => ({
        code: 0,
        stdout: tracked.map((relative) => `${relative}\0`).join(""),
        stderr: "",
      })),
    ),
    fs,
    proc,
    stdout,
    stderr,
    env: options.env ?? { npm_execpath: PNPM_EXEC },
  });
  return { ctx, fs, proc, stdout, stderr };
}
