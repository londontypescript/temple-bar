// How the coverage check (coverage.ts) makes a listing: it asks the tool a
// package's script runs which files that script would check or run, the
// way the script itself would reach the tool, and remembers the answer so
// an identical listing is made once per gate run.
//
// A tool runs through the package manager that started the gate (see
// launcher.ts), as `pnpm exec <tool>` or `npm exec --no -- <tool>`, from the
// package's folder, with no shell and with the environment the gate gives
// its scripts: CI=true, plus the script's name and command as a `run` sets
// them, since a config might read either. Stated limit: `exec` doesn't set
// the other variables a `run` does (npm_package_*, npm_config_*,
// INIT_CWD), so a config that branches on those could list other files
// than it runs. Nothing else differs.
//
// Output is captured, never streamed: the log shows one line per listing,
// not the lists.

import path from "node:path";

import type { Context } from "../context.ts";
import type { Writer } from "../seams/io.ts";
import { launch, launcherName, type Launcher } from "./launcher.ts";
import { detectPackageManager, type PackageManifest } from "./stack.ts";

/** What a tool printed, and how it exited. */
export interface ToolOutput {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** One listing the check made: the files it named, each by its real path,
 * or why it failed. */
export type Listing = {
  /** Identical listings share a key: they are made, and counted, once. */
  readonly key: string;
  /** How messages name it, such as `tsc -p tsconfig.web.json`. */
  readonly command: string;
  /** "the root" or a package's folder. */
  readonly where: string;
  /** Said after it in the "listings made" line, such as "from tsc -b". */
  readonly note?: string;
} & (
  | {
      readonly files: ReadonlySet<string>;
      /** For a listing that named no file: what to say about it, worked out
       * only when the outcome fails, since it may take another call. */
      readonly explainEmpty?: () => Promise<string>;
    }
  | { readonly failure: string }
);

/** Everything a listing needs about the package whose script asks for it. */
export interface ListingContext {
  readonly ctx: Context;
  /** The package's folder, where its scripts run. */
  readonly folder: string;
  /** The same folder with every link resolved. */
  readonly realFolder: string;
  /** "the root" or the package's folder relative to the root. */
  readonly where: string;
  /** Whose path rules decide what an absolute path looks like. */
  readonly platform: NodeJS.Platform;
  /** How a listing made here is identified: its real folder and `id`. */
  readonly keyOf: (id: readonly string[]) => string;
  /** Runs `tool args` in the folder, captured; identical calls run once. */
  readonly run: (tool: string, args: readonly string[]) => Promise<ToolOutput>;
  /** The listing `make` builds, made once per gate run for each `id`, with
   * the log line `gate: listing the files <command> <verb> in <where>`
   * written when it is made. */
  readonly once: (
    id: readonly string[],
    command: string,
    verb: "checks" | "runs",
    make: (key: string) => Promise<Listing>,
  ) => Promise<Listing>;
  /** `file` with every link resolved, or as given when it doesn't exist. */
  readonly real: (file: string) => Promise<string>;
}

/** The first line of `text` with something on it, trimmed. */
export function firstLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "");
}

function collect(): Writer & { text: () => string } {
  let text = "";
  return {
    write(chunk) {
      text += chunk;
    },
    text: () => text,
  };
}

/** How to start `tool args` through the package manager. */
type ToolCommand = (
  tool: string,
  args: readonly string[],
) => { readonly command: string; readonly args: readonly string[] };

function execArgs(
  manager: "npm" | "pnpm",
  tool: string,
  args: readonly string[],
): string[] {
  // `--no` stops npm offering to download a tool the package doesn't have.
  return manager === "pnpm"
    ? ["exec", tool, ...args]
    : ["exec", "--no", "--", tool, ...args];
}

/** The tool command for `launcher`, which must not be refused. Run by hand
 * (no launcher), the root's tools run through the package manager the
 * project uses, from PATH, as its scripts do. */
async function toolCommand(
  ctx: Context,
  launcher: Exclude<Launcher, { kind: "refused" }>,
  rootManifest: PackageManifest | undefined,
): Promise<ToolCommand> {
  if (launcher.kind === "absent") {
    const manager = await detectPackageManager(ctx, rootManifest);
    return (tool, args) => ({
      command: manager,
      args: execArgs(manager, tool, args),
    });
  }
  const manager = launcherName(launcher).toLowerCase().startsWith("pnpm")
    ? "pnpm"
    : "npm";
  return (tool, args) => launch(launcher, execArgs(manager, tool, args));
}

/** Where a package's listings run, and the script that asks for them. */
export interface ListingTarget {
  readonly folder: string;
  readonly realFolder: string;
  readonly where: string;
  readonly script: "typecheck" | "test";
  readonly command: string;
}

/**
 * The listing contexts of one gate run: every context it gives out shares
 * one memory of the calls and listings made, so identical ones (two
 * packages, or `tsc -b` projects that share a reference) are made once.
 * A listing is identified by the real folder it runs in and its arguments.
 */
export async function createListings(
  ctx: Context,
  launcher: Exclude<Launcher, { kind: "refused" }>,
  rootManifest: PackageManifest | undefined,
  platform: NodeJS.Platform = process.platform,
): Promise<(target: ListingTarget) => ListingContext> {
  const commandFor = await toolCommand(ctx, launcher, rootManifest);
  const runs = new Map<string, Promise<ToolOutput>>();
  const listings = new Map<string, Promise<Listing>>();

  return (target) => {
    const keyOf = (id: readonly string[]): string =>
      [target.realFolder, ...id].join("\0");
    const env = {
      ...ctx.env,
      CI: "true",
      npm_lifecycle_event: target.script,
      npm_lifecycle_script: target.command,
    };
    const run = (tool: string, args: readonly string[]) => {
      const key = keyOf([tool, ...args]);
      let output = runs.get(key);
      if (output === undefined) {
        const line = commandFor(tool, args);
        const stdout = collect();
        const stderr = collect();
        output = ctx.proc
          .run(line.command, line.args, {
            cwd: target.folder,
            env,
            stdout,
            stderr,
          })
          .then((code) => ({
            code,
            stdout: stdout.text(),
            stderr: stderr.text(),
          }));
        runs.set(key, output);
      }
      return output;
    };
    const once: ListingContext["once"] = (id, command, verb, make) => {
      const key = keyOf(id);
      let listing = listings.get(key);
      if (listing === undefined) {
        ctx.stdout.write(
          `gate: listing the files ${command} ${verb} in ${target.where}\n`,
        );
        listing = make(key);
        listings.set(key, listing);
      }
      return listing;
    };
    const real = async (file: string): Promise<string> => {
      try {
        return await ctx.fs.realpath(file);
      } catch {
        return (platform === "win32" ? path.win32 : path.posix).normalize(file);
      }
    };
    return {
      ctx,
      folder: target.folder,
      realFolder: target.realFolder,
      where: target.where,
      platform,
      keyOf,
      run,
      once,
      real,
    };
  };
}
