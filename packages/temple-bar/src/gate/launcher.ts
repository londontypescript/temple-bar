// How the gate starts again the package manager that started it, for a
// workspace's package list and for every script. It is worked out once per
// run from npm_execpath, so the list and the scripts can never use two
// different package managers.
//
// Three forms start it without a shell, so nothing in a path or an argument
// is ever read as shell syntax:
//   - a JavaScript entry (pnpm or npm installed by npm, corepack or
//     pnpm/action-setup) runs through the Node running the gate;
//   - pnpm's standalone executable (`pnpm`, or `pnpm.exe` on Windows) runs
//     directly;
//   - anything else, such as a `.cmd` shim, is refused, with how to install
//     a pnpm that can be started.
// Only the name decides between the first two: a binary named otherwise is
// refused, so a stand-in such as /usr/bin/true can't "pass" every script
// without running it.

import path from "node:path";

import type { Context } from "../context.ts";

export type Launcher =
  /** npm_execpath unset: the gate was run by hand. */
  | { readonly kind: "absent" }
  | {
      readonly kind: "javascript" | "native";
      /** The real file, every link resolved. */
      readonly path: string;
    }
  | { readonly kind: "refused"; readonly reason: string };

export type Startable = Extract<Launcher, { path: string }>;

const JAVASCRIPT = /\.[cm]?js$/i;

/** How to get a pnpm the gate can start, said when it can't. */
const INSTALL_PNPM =
  "install pnpm with npm (`npm install --global pnpm`), with corepack " +
  "(`corepack enable pnpm`) or with pnpm's standalone installer " +
  "(https://pnpm.io/installation)";

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What npm_execpath names, and how to start it. Never throws: a path that
 * can't be read is refused, like one that can't be started. The platform is
 * a parameter so tests can check Windows' rules anywhere.
 */
export async function resolveLauncher(
  ctx: Context,
  platform: NodeJS.Platform = process.platform,
): Promise<Launcher> {
  const given = ctx.env.npm_execpath ?? "";
  if (given === "") {
    return { kind: "absent" };
  }
  const paths = platform === "win32" ? path.win32 : path.posix;
  const refuse = (why: string): Launcher => ({
    kind: "refused",
    reason: `npm_execpath (${given}) ${why}`,
  });
  // A bare `pnpm` would be looked up on PATH, which a project can change,
  // and a relative path depends on the folder a script runs in. Windows'
  // `C:pnpm` is relative too, to that drive's current folder.
  if (!paths.isAbsolute(given)) {
    return refuse("isn't an absolute path");
  }
  // The real file decides the form and is what runs: pnpm's standalone
  // installer can leave a link to the binary.
  let real: string;
  try {
    real = await ctx.fs.realpath(given);
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    return refuse(
      code === "ENOENT"
        ? "doesn't exist"
        : `can't be resolved: ${describe(error)}`,
    );
  }
  let kind: string;
  try {
    kind = await ctx.fs.classify(real);
  } catch (error) {
    return refuse(`can't be read: ${describe(error)}`);
  }
  if (kind !== "file") {
    return refuse("isn't a file");
  }
  // The real path is the host's own, so the host's rules read its name.
  // Letter case is ignored: Windows and a default macOS volume ignore it.
  const name = path.basename(real);
  if (JAVASCRIPT.test(name)) {
    return { kind: "javascript", path: real };
  }
  if (name.toLowerCase() === (platform === "win32" ? "pnpm.exe" : "pnpm")) {
    return { kind: "native", path: real };
  }
  return refuse(`names ${name}, which can't be started without a shell`);
}

/** The command line that runs `args` through `launcher`. */
export function launch(
  launcher: Startable,
  args: readonly string[],
): { readonly command: string; readonly args: readonly string[] } {
  return launcher.kind === "javascript"
    ? { command: process.execPath, args: [launcher.path, ...args] }
    : { command: launcher.path, args };
}

/** The launcher's file name, for saying which package manager it is. */
export function launcherName(launcher: Startable): string {
  return path.basename(launcher.path);
}

/** The gate's message when it can't start the package manager again. */
export function refusalMessage(
  launcher: Extract<Launcher, { kind: "refused" }>,
): string {
  return `the package manager that started the gate can't be started again without a shell: ${launcher.reason}; ${INSTALL_PNPM}`;
}
