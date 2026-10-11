// A stand-in for an old global pnpm that comes first on the PATH a tool gives
// git or the launcher: it reports a pnpm 8 version and does nothing else.
// For the delivery tests of the runtime check. POSIX only (a `sh` script);
// the Windows paths are covered by unit tests, and real Windows runs belong
// to the separate Windows work.

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const OLD_PNPM_VERSION = "8.1.1";

/** The first `pnpm` file on `env`'s PATH: the real one, to call by its full
 * path where the fake sits first. */
export function realPnpmPath(env: NodeJS.ProcessEnv): string {
  const key =
    Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
  for (const dir of (env[key] ?? "").split(path.delimiter)) {
    const candidate = path.join(dir, "pnpm");
    if (dir !== "" && existsSync(candidate)) return candidate;
  }
  assert.fail("no pnpm on PATH");
}

/**
 * Writes the fake into `dir` and returns `env` with it first on PATH.
 * `onlyForChildren` makes it answer only when pnpm started it (pnpm sets
 * npm_config_user_agent for the commands it runs), and hand a plain call
 * from the test straight to the real pnpm.
 */
export function withOldPnpmFirst(
  dir: string,
  env: NodeJS.ProcessEnv,
  options: { onlyForChildren?: boolean } = {},
): NodeJS.ProcessEnv {
  const real = realPnpmPath(env);
  mkdirSync(dir, { recursive: true });
  const shim = path.join(dir, "pnpm");
  const passThrough =
    options.onlyForChildren === true
      ? `if [ -z "$npm_config_user_agent" ]; then exec "${real}" "$@"; fi\n`
      : "";
  writeFileSync(
    shim,
    `#!/bin/sh\n${passThrough}if [ "$1" = "--version" ]; then echo ${OLD_PNPM_VERSION}; fi\nexit 0\n`,
    "utf8",
  );
  chmodSync(shim, 0o755);
  const key =
    Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
  return { ...env, [key]: `${dir}${path.delimiter}${env[key] ?? ""}` };
}
