// End-to-end regression test for F12 / P8.2: an unknown subcommand must exit
// non-zero, print usage to stderr, and leave the working directory
// (including .git) untouched. Runs the real src/cli.ts entry point with
// `process.execPath` under type stripping, in a fresh temp git repo, rather
// than calling route() directly, so it also proves the shebang/entry point
// wiring works end to end.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(here, "cli.ts");

interface Snapshot {
  readonly relativePath: string;
  readonly size: number;
  readonly mtimeMs: number;
}

function snapshotTree(root: string): Snapshot[] {
  const entries: Snapshot[] = [];

  function walk(dir: string): void {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else {
        entries.push({
          relativePath: path.relative(root, full),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      }
    }
  }

  walk(root);
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

void test("F12: an unknown subcommand exits non-zero, prints usage on stderr, and writes nothing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-f12-"));
  try {
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: dir,
    });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });

    const before = snapshotTree(dir);

    const result = (() => {
      try {
        execFileSync(process.execPath, [cliPath, "bogus"], {
          cwd: dir,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        return { code: 0, stderr: "" };
      } catch (error) {
        const e = error as { status: number | null; stderr: string };
        return { code: e.status, stderr: e.stderr };
      }
    })();

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /^Usage: temple-bar <command>/);
    assert.match(result.stderr, /unknown command: bogus/);

    const after = snapshotTree(dir);
    assert.deepEqual(after, before, "the directory tree must be unchanged");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
