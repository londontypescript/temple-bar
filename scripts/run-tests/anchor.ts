// The test runner's global setup: every `test` script names this file with
// Node's `--test-global-setup`, so the runner loads it once, in its own
// process, and on Windows it holds Git's shared /tmp for the whole run.
// lifecycle.ts says why and does the work; this file gives it the real
// processes and clock, and the way to leave.

import process from "node:process";

import { testRunHooks } from "./lifecycle.ts";
import { realDeps } from "./real.ts";

const hooks = testRunHooks(realDeps(), (code) => {
  // Leave once the message is flushed. Never settling keeps the runner from
  // starting a test file in the meantime.
  return new Promise(() => {
    process.stderr.write("", () => {
      process.exit(code);
    });
  });
});

export const { globalSetup, globalTeardown } = hooks;
