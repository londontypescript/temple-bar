// The real launcher: build the real dependencies, call main(), set the exit
// code. index.ts loads this only once the Node version has been checked. All
// behaviour lives in main.ts so it can be tested without spawning a process.

import { promises as fsp, realpath } from "node:fs";
import { promisify } from "node:util";

import { main } from "./main.ts";
import { createProcessRunner } from "./runner.ts";
import { readOwnVersion } from "./own-version.ts";

// The native form expands Windows short names, as pnpm reports folders.
const realPathNative = promisify(realpath.native);

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
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: process.env,
  ownVersion: readOwnVersion(),
  fs: {
    readText,
    writeText: (filePath, content) => fsp.writeFile(filePath, content, "utf8"),
    realPath: (filePath) => realPathNative(filePath),
  },
  run: createProcessRunner(),
  stdout: { write: (text) => process.stdout.write(text) },
  stderr: { write: (text) => process.stderr.write(text) },
});
process.exitCode = exitCode;
