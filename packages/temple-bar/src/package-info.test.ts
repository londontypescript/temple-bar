// Proves `--version` reads the version from the package's own package.json
// in both places it must run from: source under type stripping (this test
// file, imported directly, is that path) and the built dist/*.js (simulated
// here by compiling with the project's own tsc into a temp directory that
// mirrors the real layout: package.json next to a dist/ folder).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { readOwnVersion } from "./package-info.ts";

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

void test("readOwnVersion reads the real package.json under type stripping (source path)", () => {
  const raw = readFileSync(path.join(packageDir, "package.json"), "utf8");
  const expected = (JSON.parse(raw) as { version: string }).version;
  assert.equal(readOwnVersion(), expected);
});

void test("readOwnVersion works from a build: package.json next to dist/ (built path)", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "temple-bar-version-build-"));
  try {
    const raw = readFileSync(path.join(packageDir, "package.json"), "utf8");
    const expected = (JSON.parse(raw) as { version: string }).version;

    cpSync(
      path.join(packageDir, "package.json"),
      path.join(tmp, "package.json"),
    );

    // Compile the real, unmodified src/ straight into the temp dist/, so
    // this exercises the same tsconfig.build.json the real build uses.
    // Run tsc's JavaScript entry with Node itself: node_modules/.bin/tsc is
    // a shell script on Windows, which execFile can't start without a shell.
    const tscEntry = path.join(
      packageDir,
      "..",
      "..",
      "node_modules",
      "typescript",
      "bin",
      "tsc",
    );
    execFileSync(
      process.execPath,
      [
        tscEntry,
        "-p",
        "tsconfig.build.json",
        "--outDir",
        path.join(tmp, "dist"),
      ],
      { cwd: packageDir },
    );

    // A tiny runner colocated with the compiled output at the same depth as
    // the real dist/cli.js, so it exercises the exact "../package.json"
    // resolution the real built entry point relies on.
    const runnerPath = path.join(tmp, "dist", "print-version.mjs");
    writeFileSync(
      runnerPath,
      'import { readOwnVersion } from "./package-info.js";\nprocess.stdout.write(readOwnVersion());\n',
    );

    const output = execFileSync(process.execPath, [runnerPath], {
      encoding: "utf8",
    });
    assert.equal(output, expected);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
