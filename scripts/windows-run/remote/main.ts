// Entry point on the Windows machine:
//   node <this file> <run id> <commit sha>
// Both arguments are hex the local side built; anything else is refused, so
// nothing a person typed can reach the shell that starts this.

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createRealSys } from "./real.ts";
import { RUN_ID_PATTERN, SHA_PATTERN } from "./record.ts";
import { runRemote } from "./runner.ts";

/** Exit code: the run's, or 2 for arguments that are not a run id and a
 * commit. */
export async function main(args: readonly string[]): Promise<number> {
  const [runId, sha, ...extra] = args;
  if (
    runId === undefined ||
    sha === undefined ||
    extra.length > 0 ||
    !RUN_ID_PATTERN.test(runId) ||
    !SHA_PATTERN.test(sha)
  ) {
    process.stderr.write("usage: main.ts <run id> <commit sha>\n");
    return 2;
  }
  return runRemote(runId, sha, createRealSys());
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
