import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { describe, run } from "../e2e/support/run.ts";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repoRoot, "scripts", "pack-local.ts");

void test("pack:local refuses to run without exactly one folder", async () => {
  for (const args of [[], ["one", "two"]]) {
    const result = await run(process.execPath, [script, ...args], {
      cwd: repoRoot,
      env: process.env,
    });
    assert.equal(result.code, 2, describe(result));
    assert.match(result.stderr, /Usage: pnpm pack:local <folder>/);
  }
});

void test("pack:local packs both packages into the folder, relative to where it was run", async () => {
  const startedIn = mkdtempSync(path.join(tmpdir(), "temple-bar-pack-local-"));
  try {
    const result = await run(process.execPath, [script, "trial"], {
      cwd: repoRoot,
      // What pnpm sets when the script is run from another folder.
      env: { ...process.env, INIT_CWD: startedIn },
    });
    assert.equal(result.code, 0, describe(result));
    const tarballs = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".tgz"));
    assert.equal(tarballs.length, 2, result.stdout);
    for (const tarball of tarballs) {
      assert.ok(existsSync(tarball), `${tarball} exists`);
      assert.equal(
        path.dirname(tarball),
        path.join(startedIn, "trial", "tarballs"),
      );
    }
  } finally {
    rmSync(startedIn, { recursive: true, force: true });
  }
});
