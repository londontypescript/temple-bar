// Runs the frozen install, `pnpm check` and `pnpm build` on the Windows
// machine for the commit checked out here, and prints a summary for the pull
// request:
//
//   pnpm windows-run [--host <ssh-destination>] [--only <path/to/file.test.ts>]
//
// With `--only`, it runs just that one test file there instead, as
// `pnpm test` would run it, installing only when the lockfile, Node or pnpm
// changed since the last targeted run: seconds rather than twenty minutes,
// for reproducing a failed Windows leg that one file shows.
//
// See scripts/windows-run/local.ts for what it does and its exit codes.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { runLocal } from "./windows-run/local.ts";
import { createLocalDeps } from "./windows-run/real.ts";

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exitCode = await runLocal(
    process.argv.slice(2),
    await createLocalDeps(),
  );
}
