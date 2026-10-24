// Entry point on the Windows machine:
//   node <this file> <run id> <commit sha> [<test file>]
// The first two are hex the local side built. The third, for a targeted run,
// is a repo-relative test file the local side checked against the same rule
// (test-target.ts), which allows only characters cmd reads as plain text.
// Anything else is refused, so nothing a person typed can reach the shell
// that starts this but such a path.

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createRealSys } from "./real.ts";
import { RUN_ID_PATTERN, SHA_PATTERN, type RunRequest } from "./record.ts";
import { runRemote } from "./runner.ts";
import { testTarget } from "./test-target.ts";

/** Exit code: the run's, or 2 for arguments that are not a run id, a commit
 * and optionally a test file the suite runs. */
export async function main(
  args: readonly string[],
  start: typeof runRemote = runRemote,
): Promise<number> {
  const [runId, sha, file, ...extra] = args;
  if (
    runId === undefined ||
    sha === undefined ||
    extra.length > 0 ||
    !RUN_ID_PATTERN.test(runId) ||
    !SHA_PATTERN.test(sha) ||
    (file !== undefined && testTarget(file) === undefined)
  ) {
    process.stderr.write(
      "usage: main.ts <run id> <commit sha> [<test file>]\n",
    );
    return 2;
  }
  const request: RunRequest =
    file === undefined ? { mode: "full" } : { mode: "only", file };
  return start(runId, sha, createRealSys(), request);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const code = await main(process.argv.slice(2));
  // Leave once the output is flushed, even if a leftover handle is still open.
  process.stdout.write("", () => {
    process.exit(code);
  });
}
