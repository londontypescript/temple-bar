import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createGhSeam } from "./gh.ts";

/**
 * Builds an env whose PATH points only at an empty directory, so `gh` can't
 * be found regardless of what's really installed. Windows may spell the
 * variable "Path" (or another casing) rather than "PATH", and env lookups
 * there are case-insensitive, so every casing already present must be
 * replaced, not just "PATH" itself.
 */
function envWithoutGh(emptyDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  let sawPathKey = false;
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "path") {
      env[key] = emptyDir;
      sawPathKey = true;
    }
  }
  if (!sawPathKey) {
    env.PATH = emptyDir;
  }
  return env;
}

void test("gh seam: a missing gh executable is reported as notFound, not thrown", async () => {
  const emptyDir = mkdtempSync(path.join(tmpdir(), "temple-bar-empty-path-"));
  try {
    const gh = createGhSeam(envWithoutGh(emptyDir));
    const result = await gh.run(["--version"], process.cwd());

    assert.equal(result.notFound, true);
    assert.equal(result.code, null);
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});
