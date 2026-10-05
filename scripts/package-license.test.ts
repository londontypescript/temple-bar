// The MIT licence asks for its notice to travel with every copy, so each
// published package carries the licence. npm always packs a LICENSE file it
// finds in the package folder, whatever `files` says, and the release packs
// each package from its own folder. So each folder keeps a committed copy of
// the root LICENSE, and this test fails if a copy goes missing, drifts from
// the root file, or stops being packed.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { describe, run } from "../e2e/support/run.ts";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_DIRS = ["packages/temple-bar", "packages/create-temple-bar"];

for (const dir of PACKAGE_DIRS) {
  void test(`${dir} packs a LICENSE identical to the root one`, async () => {
    const packageDir = path.join(repoRoot, dir);
    const pack = await run("npm", ["pack", "--dry-run", "--json"], {
      cwd: packageDir,
      env: process.env,
    });
    assert.equal(pack.code, 0, describe(pack));
    const [packed] = JSON.parse(pack.stdout) as {
      files: { path: string }[];
    }[];
    const files = packed?.files.map((file) => file.path) ?? [];
    assert.ok(
      files.includes("LICENSE"),
      `${dir}'s package would ship without LICENSE (it packs: ${files.join(", ")}). Copy the root LICENSE into ${dir}.`,
    );
    assert.equal(
      readFileSync(path.join(packageDir, "LICENSE"), "utf8"),
      readFileSync(path.join(repoRoot, "LICENSE"), "utf8"),
      `${dir}/LICENSE differs from the root LICENSE. Copy the root file over it so both packages ship the same licence.`,
    );
  });
}
