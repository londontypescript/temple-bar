// The npm tools the gate runs, knip and markdownlint: the exact
// versions temple-bar itself depends on (pinned by its lockfile), never a
// copy the project happens to have installed. So every project on the same
// temple-bar runs the same checks, and a project can't swap in an older or
// patched tool.
//
// They sit behind one small interface, the way git and the filesystem sit
// behind seams, so unit tests hand the gate fakes instead of running the
// real tools; the end-to-end tests run the real ones.

import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Context } from "../context.ts";
import { runMarkdownlint } from "./markdownlint-run.ts";

export interface GateTools {
  /** Runs knip in ctx.cwd. Resolves its exit code: 0 clean, 1 it found
   * unused code, anything else it couldn't run. */
  readonly knip: (ctx: Context, args: readonly string[]) => Promise<number>;
  /** Lints `files` (relative to ctx.cwd) with markdownlint, using the
   * gate's fixed integrity configuration. Project style settings and inline
   * directives cannot change it. Resolves 0 clean, 1 lint errors, 2 couldn't run. */
  readonly markdownlint: (
    ctx: Context,
    files: readonly string[],
    integrityConfig: Readonly<Record<string, unknown>>,
  ) => Promise<number>;
}

/** knip's command-line entry point, inside the copy temple-bar depends on.
 * knip doesn't export its bin, so it is found from the package's main
 * module, which lives in dist/ next to bin/. */
export function knipBinPath(): string {
  const main = fileURLToPath(import.meta.resolve("knip"));
  return path.join(path.dirname(main), "..", "bin", "knip.js");
}

export function createRealGateTools(): GateTools {
  return {
    knip(ctx, args) {
      // knip runs in its own process, on the Node running the gate: it is a
      // whole program with its own config loading, and its output streams
      // through the context's writers like any other check's.
      return ctx.proc.run(process.execPath, [knipBinPath(), ...args], {
        cwd: ctx.cwd,
        env: { ...ctx.env, CI: "true" },
        stdout: ctx.stdout,
        stderr: ctx.stderr,
      });
    },
    markdownlint: runMarkdownlint,
  };
}
