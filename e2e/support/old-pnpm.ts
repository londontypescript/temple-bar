// A stand-in for an old global pnpm that comes first on the PATH a tool gives
// git or the launcher: it reports a pnpm 8 version and does nothing else.
// For the delivery tests of the runtime check.
//
// Each system gets the form its real pnpm takes, so the stand-in is found
// the same way: a `sh` script named `pnpm` on POSIX, and on Windows a
// `pnpm.cmd` batch file, which cmd finds through PATHEXT when temple-bar
// runs `pnpm` by name.

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const OLD_PNPM_VERSION = "8.1.1";

function pathKey(env: NodeJS.ProcessEnv): string {
  // Windows spells the variable `Path`.
  return (
    Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH"
  );
}

/** The file names a plain `pnpm` can resolve to, in the order the system
 * tries them: on Windows each PATHEXT extension (cmd never runs a file with
 * none, such as the `sh` script pnpm's installers also leave there). */
function pnpmNames(env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== "win32") return ["pnpm"];
  const key =
    Object.keys(env).find((name) => name.toUpperCase() === "PATHEXT") ??
    "PATHEXT";
  return (env[key] ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter((extension) => extension !== "")
    .map((extension) => `pnpm${extension.toLowerCase()}`);
}

/** The first `pnpm` on `env`'s PATH: the real one, to call by its full
 * path where the fake sits first. */
export function realPnpmPath(env: NodeJS.ProcessEnv): string {
  const names = pnpmNames(env);
  for (const dir of (env[pathKey(env)] ?? "").split(path.delimiter)) {
    if (dir === "") continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  assert.fail("no pnpm on PATH");
}

/** The `sh` stand-in. */
function posixScript(real: string, onlyForChildren: boolean): string {
  const passThrough = onlyForChildren
    ? `if [ -z "$npm_config_user_agent" ]; then exec "${real}" "$@"; fi\n`
    : "";
  return `#!/bin/sh\n${passThrough}if [ "$1" = "--version" ]; then echo ${OLD_PNPM_VERSION}; fi\nexit 0\n`;
}

/** The batch-file stand-in. CRLF line endings, as cmd expects. Labels
 * rather than parenthesised blocks, since cmd expands `%errorlevel%` in a
 * block before running any of it. */
function windowsScript(real: string, onlyForChildren: boolean): string {
  const lines = [
    "@echo off",
    ...(onlyForChildren
      ? ["if not defined npm_config_user_agent goto real"]
      : []),
    `if "%~1"=="--version" echo ${OLD_PNPM_VERSION}`,
    "exit /b 0",
    ...(onlyForChildren
      ? [":real", `call "${real}" %*`, "exit /b %errorlevel%"]
      : []),
  ];
  return `${lines.join("\r\n")}\r\n`;
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
  const onlyForChildren = options.onlyForChildren === true;
  mkdirSync(dir, { recursive: true });
  if (process.platform === "win32") {
    writeFileSync(
      path.join(dir, "pnpm.cmd"),
      windowsScript(real, onlyForChildren),
      "utf8",
    );
  } else {
    const shim = path.join(dir, "pnpm");
    writeFileSync(shim, posixScript(real, onlyForChildren), "utf8");
    chmodSync(shim, 0o755);
  }
  const key = pathKey(env);
  return { ...env, [key]: `${dir}${path.delimiter}${env[key] ?? ""}` };
}
