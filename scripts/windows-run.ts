// Runs the frozen install, `pnpm check` and `pnpm build` on the Windows
// machine for the commit checked out here, and prints a summary for the pull
// request:
//
//   pnpm windows-run [--host <ssh-destination>]
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
