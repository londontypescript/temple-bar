#!/usr/bin/env node

// The entry point, kept tiny and old-Node-proof on purpose: it checks the
// Node running it before loading anything else, because the real code uses
// syntax and APIs an older Node cannot even parse.

import { nodeTooOldMessage } from "./node-version.ts";

const tooOld = nodeTooOldMessage(process.versions.node, process.execPath);
if (tooOld === undefined) {
  await import("./launch.ts");
} else {
  process.stderr.write(tooOld);
  process.exitCode = 1;
}
