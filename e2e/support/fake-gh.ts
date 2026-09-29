// A fake `gh` on PATH, so `temple-bar init` runs end to end without GitHub.
//
// The gh seam starts `gh` directly, without a shell, and on Windows that
// only finds a real `.exe`, never a script shim. So the fake is a copy of
// this Node binary named `gh` (`gh.exe` on Windows), plus a preload script
// passed in NODE_OPTIONS that answers in its place. Every Node process in
// the test loads the preload, so it only acts when the running binary is
// named `gh`. The same mechanism on every OS, so all three test the same
// thing.

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// Answers as a signed-in `gh` for a repo whose `main` ruleset already
// exists. Node resolves the first argument to an absolute path (it takes it
// for a script), so only its basename is the subcommand.
const PRELOAD = `"use strict";
const path = require("node:path");
if (path.basename(process.execPath).replace(/\\.exe$/i, "") === "gh") {
  const args = [path.basename(process.argv[1] || ""), ...process.argv.slice(2)];
  if (args[0] === "auth") {
    process.exit(0);
  }
  if (args[0] === "api" && args.some((a) => a.endsWith("/rulesets"))) {
    process.stdout.write('[{"target":"branch"}]');
    process.exit(0);
  }
  process.stderr.write("fake gh: unexpected call: " + JSON.stringify(args) + "\\n");
  process.exit(1);
}
`;

/** Creates the fake under `workDir`; returns env to run commands with. */
export function createFakeGh(
  workDir: string,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const binDir = path.join(workDir, "fake-gh-bin");
  mkdirSync(binDir, { recursive: true });
  const exe = process.platform === "win32" ? "gh.exe" : "gh";
  copyFileSync(process.execPath, path.join(binDir, exe));
  const preload = path.join(workDir, "fake-gh-preload.cjs");
  writeFileSync(preload, PRELOAD);

  const pathKey =
    Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  return {
    ...env,
    [pathKey]: `${binDir}${path.delimiter}${env[pathKey] ?? ""}`,
    // NODE_OPTIONS reads a backslash inside quotes as an escape, which would
    // eat every separator in a Windows path; Node takes forward slashes.
    NODE_OPTIONS:
      `${env.NODE_OPTIONS ?? ""} --require "${preload.replaceAll("\\", "/")}"`.trim(),
  };
}
