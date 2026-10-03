// The npm tools the gate runs, knip and markdownlint-cli2: the exact
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

export interface GateTools {
  /** Runs knip in ctx.cwd. Resolves its exit code: 0 clean, 1 it found
   * unused code, anything else it couldn't run. */
  readonly knip: (ctx: Context, args: readonly string[]) => Promise<number>;
  /** Lints `files` (relative to ctx.cwd) with markdownlint-cli2, using the
   * project's own markdownlint config when it has one and `defaultConfig`
   * when it doesn't. Resolves 0 clean, 1 lint errors, 2 couldn't run. */
  readonly markdownlint: (
    ctx: Context,
    files: readonly string[],
    defaultConfig: Readonly<Record<string, unknown>>,
  ) => Promise<number>;
}

/** knip's command-line entry point, inside the copy temple-bar depends on.
 * knip doesn't export its bin, so it is found from the package's main
 * module, which lives in dist/ next to bin/. */
export function knipBinPath(): string {
  const main = fileURLToPath(import.meta.resolve("knip"));
  return path.join(path.dirname(main), "..", "bin", "knip.js");
}

type MarkdownlintMain = (params: {
  readonly directory: string;
  readonly argv: readonly string[];
  readonly noGlobs: boolean;
  readonly optionsDefault: {
    readonly config: Readonly<Record<string, unknown>>;
  };
  readonly logMessage: (message: string) => void;
  readonly logError: (message: string) => void;
}) => Promise<number>;

function hasMain(value: unknown): value is { main: MarkdownlintMain } {
  return (
    typeof value === "object" &&
    value !== null &&
    "main" in value &&
    typeof value.main === "function"
  );
}

// markdownlint-cli2 ships no type declarations, so it is imported through a
// name TypeScript doesn't resolve and checked at run time instead.
const MARKDOWNLINT_MODULE = "markdownlint-cli2";

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
    async markdownlint(ctx, files, defaultConfig) {
      // In process, so the file list never meets a command-line length
      // limit (Windows allows about 32,000 characters).
      const module: unknown = await import(MARKDOWNLINT_MODULE);
      if (!hasMain(module)) {
        ctx.stderr.write(
          `gate: ${MARKDOWNLINT_MODULE} has no main function; reinstall temple-bar\n`,
        );
        return 2;
      }
      try {
        return await module.main({
          directory: ctx.cwd,
          // A leading ":" makes each one a literal path, never a glob.
          argv: files.map((file) => `:${file}`),
          // Lint exactly the files the gate lists, not extra globs from a
          // project's config.
          noGlobs: true,
          optionsDefault: { config: defaultConfig },
          logMessage: (message) => {
            ctx.stdout.write(`${message}\n`);
          },
          logError: (message) => {
            ctx.stderr.write(`${message}\n`);
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.stderr.write(`gate: markdownlint could not run: ${message}\n`);
        return 2;
      }
    },
  };
}
