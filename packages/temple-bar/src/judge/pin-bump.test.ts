import assert from "node:assert/strict";
import test from "node:test";

import type { FileState, PathChange } from "./file-state.ts";
import { TEMPLE_BAR_PACKAGE } from "./manifests.ts";
import { pinBumpDisclosure, pinBumpPaths } from "./pin-bump.ts";
import { pinnedLockfile, pinnedManifest } from "./testing/trees.ts";

const file = (text: string): FileState => ({
  kind: "regular",
  mode: "100644",
  text,
});

const manifest = (value: object): FileState => file(JSON.stringify(value));

const change = (
  path: string,
  base: FileState,
  head: FileState,
): PathChange => ({
  path,
  base,
  head,
});

const pinned = (version: string, scripts?: Record<string, string>) =>
  file(pinnedManifest(version, scripts));

const lockfile = (version: string, other?: string) =>
  file(pinnedLockfile(version, other));

void test("the root manifest's devDependencies pin moving is a pin bump", () => {
  assert.deepEqual(
    pinBumpPaths([change("package.json", pinned("0.1.0"), pinned("0.2.0"))]),
    ["package.json"],
  );
});

void test("a workspace package's own pin moving is a pin bump", () => {
  const before = manifest({ name: "b", dependencies: {} });
  const after = manifest({
    name: "b",
    dependencies: { [TEMPLE_BAR_PACKAGE]: "0.2.0" },
  });
  assert.deepEqual(
    pinBumpPaths([change("packages/b/package.json", before, after)]),
    ["packages/b/package.json"],
  );
});

void test("an override in pnpm.overrides naming temple-bar is a pin bump", () => {
  const plain = manifest({ name: "root" });
  const overridden = manifest({
    name: "root",
    pnpm: { overrides: { [`${TEMPLE_BAR_PACKAGE}@0`]: "link:../elsewhere" } },
  });
  assert.deepEqual(pinBumpPaths([change("package.json", plain, overridden)]), [
    "package.json",
  ]);
});

void test("temple-bar's lockfile entries moving alone is a pin bump", () => {
  assert.deepEqual(
    pinBumpPaths([
      change("pnpm-lock.yaml", lockfile("0.1.0"), lockfile("0.2.0")),
    ]),
    ["pnpm-lock.yaml"],
  );
});

void test("a script change with the pin unchanged is no pin bump", () => {
  assert.deepEqual(
    pinBumpPaths([
      change("package.json", pinned("0.1.0"), pinned("0.1.0", { test: "y" })),
    ]),
    [],
  );
});

void test("a lockfile change outside temple-bar's entries is no pin bump", () => {
  assert.deepEqual(
    pinBumpPaths([
      change(
        "pnpm-lock.yaml",
        lockfile("0.1.0", "1.0.0"),
        lockfile("0.1.0", "1.0.1"),
      ),
    ]),
    [],
  );
});

void test("a manifest the judge can't read as one counts as moving the pin", () => {
  const symlink: FileState = { kind: "special", mode: "120000" };
  const unreadable: FileState = { kind: "unreadable", reason: "GitHub 502" };
  assert.deepEqual(
    pinBumpPaths([
      change("package.json", pinned("0.1.0"), file("{ not json")),
      change("packages/a/package.json", pinned("0.1.0"), symlink),
      change("packages/b/package.json", unreadable, pinned("0.1.0")),
      change("pnpm-lock.yaml", lockfile("0.1.0"), symlink),
    ]),
    [
      "package.json",
      "packages/a/package.json",
      "packages/b/package.json",
      "pnpm-lock.yaml",
    ],
  );
});

void test("the disclosure names every other path, or says there are none", () => {
  const bump = [
    change("package.json", pinned("0.1.0"), pinned("0.2.0")),
    change("pnpm-lock.yaml", lockfile("0.1.0"), lockfile("0.2.0")),
  ];
  assert.equal(
    pinBumpDisclosure(bump, ["package.json", "pnpm-lock.yaml"]),
    "This pull request changes nothing else.\n",
  );
  assert.equal(
    pinBumpDisclosure(bump, [
      ".github/workflows/ci.yml",
      "package.json",
      "pnpm-lock.yaml",
      "src/index.ts",
    ]),
    "This pull request also changes:\n" +
      "  .github/workflows/ci.yml\n" +
      "  src/index.ts\n",
  );
  // With the pin where it was there is nothing to disclose, whatever else
  // changed.
  const scriptOnly = [
    change("package.json", pinned("0.1.0"), pinned("0.1.0", { test: "y" })),
  ];
  assert.equal(pinBumpDisclosure(scriptOnly, ["package.json", "a.ts"]), "");
});
