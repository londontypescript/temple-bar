#!/usr/bin/env node

// Thin entry point: build the real dependencies, call main(), set the exit
// code. All behaviour lives in main.ts so it can be tested without spawning
// a process.

import { promises as fsp } from "node:fs";

import { main } from "./main.ts";
import { createProcessRunner } from "./runner.ts";
import { readOwnVersion } from "./own-version.ts";

async function readText(filePath: string): Promise<string | undefined> {
  try {
    return await fsp.readFile(filePath, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

const exitCode = await main({
  cwd: process.cwd(),
  env: process.env,
  ownVersion: readOwnVersion(),
  fs: {
    readText,
    writeText: (filePath, content) => fsp.writeFile(filePath, content, "utf8"),
  },
  run: createProcessRunner(),
  stderr: { write: (text) => process.stderr.write(text) },
});
process.exitCode = exitCode;
