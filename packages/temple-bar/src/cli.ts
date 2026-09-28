#!/usr/bin/env node

// Thin entry point: build the real context, run the router, set the exit
// code. All behaviour lives in router.ts and context.ts so it can be tested
// without spawning a process.

import { createRealContext } from "./context.ts";
import { route } from "./router.ts";

const ctx = createRealContext();
const exitCode = await route(process.argv.slice(2), ctx);
process.exitCode = exitCode;
