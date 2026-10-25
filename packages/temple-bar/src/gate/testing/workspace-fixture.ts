// A pnpm workspace as the gate sees it through fakes: git's file list, the
// files on disk, and a pnpm (named by npm_execpath) that answers
// `pnpm list`, lists files for the tools the coverage check asks through
// `exec`, and runs scripts with whatever exit codes a test chooses. Not
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
  /** What tools list in each folder; by default every tracked file in it. */
  readonly listings?: FakeListings;
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
function scriptOf(call: RecordedProcCall): string | undefined {
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

/** The files a tool lists when run in `folder` ("" the root), relative to
 * the root and "/"-separated, or a line it fails with. */
export type FakeListings = (
  folder: string,
) => readonly string[] | { readonly error: string };

/** Answers a tool the coverage check runs through the package manager's
 * `exec`, as tsc (`--listFilesOnly`) and Vitest (`list --json`) list
 * `listings`' files, or fail with its error on stdout and exit 1;
 * `--showConfig` prints a config with no references. Undefined for any
 * call that isn't an `exec`. */
export function answerExec(
  call: RecordedProcCall,
  run: ProcRunOptions,
  listings: FakeListings,
): number | undefined {
  if (!call.args.includes("exec")) {
    return undefined;
  }
  const relative = path.relative(path.normalize("/repo"), call.cwd);
  const listed = listings(relative.split(path.sep).join("/"));
  if ("error" in listed) {
    run.stdout.write(`${listed.error}\n`);
    return 1;
  }
  // Forward slashes, as tsc and Vitest print them on every platform.
  const files = listed.map((file) => `/repo/${file}`);
  if (call.args.includes("--showConfig")) {
    run.stdout.write("{}\n");
  } else if (call.args.includes("--listFilesOnly")) {
    run.stdout.write(files.map((file) => `${file}\n`).join(""));
  } else if (call.args.includes("--json")) {
    run.stdout.write(JSON.stringify(files.map((file) => ({ file }))));
  } else {
    return 1;
  }
  return 0;
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
  // Every key is built with path.join: this record is plain, so on Windows
  // "/repo/package.json" and path.join("/repo", "package.json") would be two
  // entries that the fake filesystem then folds into one, the later winning.
  const files: Record<string, string> = { ...coreFiles() };
  for (const relative of tracked) {
    files[path.join("/repo", ...relative.split("/"))] ??= "{}\n";
  }
  files[path.join("/repo", "package.json")] = JSON.stringify({
    packageManager: "pnpm@10.34.5",
    scripts: { ...CORE_SCRIPTS, ...(options.rootScripts ?? ALL_SCRIPTS) },
  });
  for (const [folder, scripts] of Object.entries(packages)) {
    files[path.join("/repo", ...folder.split("/"), "package.json")] =
      JSON.stringify(scripts === undefined ? {} : { scripts });
  }
  // The launchers npm_execpath can name exist, as they would on a real disk.
  files[PNPM_EXEC] = "";
  files[NPM_EXEC] = "";
  const fs = createFakeFs({ ...files, ...options.untracked });

  const listing = options.listing ?? {
    stdout: pnpmListing(["", ...Object.keys(packages)]),
  };
  const listings: FakeListings =
    options.listings ??
    ((folder) =>
      tracked.filter((file) => folder === "" || file.startsWith(`${folder}/`)));
  const proc = createFakeProc((call, run: ProcRunOptions) => {
    const listed = answerExec(call, run, listings);
    if (listed !== undefined) {
      return listed;
    }
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
