// Entry point on the Windows machine:
//   node <this file> <run id> <commit sha>
// Both arguments are hex the local side built; anything else is refused, so
// nothing a person typed can reach the shell that starts this.

import process from "node:process";

import { createRealSys } from "./real.ts";
import { RUN_ID_PATTERN, SHA_PATTERN } from "./record.ts";
import { runRemote } from "./runner.ts";

const [runId, sha, ...extra] = process.argv.slice(2);
if (
  runId === undefined ||
  sha === undefined ||
  extra.length > 0 ||
  !RUN_ID_PATTERN.test(runId) ||
  !SHA_PATTERN.test(sha)
) {
  process.stderr.write("usage: main.ts <run id> <commit sha>\n");
  process.exit(2);
}

const code = await runRemote(runId, sha, createRealSys());
// Leave once the output is flushed, even if a leftover handle is still open.
process.stdout.write("", () => {
  process.exit(code);
});
