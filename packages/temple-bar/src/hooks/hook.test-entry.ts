#!/usr/bin/env node
// Test-only entry point standing in for router.ts, which 1.5 doesn't own
// (1.4/1.6 are changing it in parallel). Routes `hook <...>` straight
// through createHookCommand with the real context and real stdin, so
// integration tests can spawn a real process (matching what git actually
// invokes) without depending on the router.
//
// Excluded from the published package: tsconfig.build.json must add
// "src/hooks/*.test-entry.ts" to its exclude list (orchestrator change,
// alongside the existing "src/testing/**" exclusion).

import { createRealContext } from "../context.ts";
import { createHookCommand } from "./command.ts";
import { readRealStdin } from "./stdin.ts";

const ctx = createRealContext();
const [sub, ...rest] = process.argv.slice(2);

if (sub !== "hook") {
  ctx.stderr.write("hook.test-entry: only the hook command is supported\n");
  process.exitCode = 2;
} else {
  const command = createHookCommand(readRealStdin);
  process.exitCode = await command.run(rest, ctx);
}
