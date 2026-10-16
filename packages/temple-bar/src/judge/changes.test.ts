// The comparison on its own, handed both sides' states the way the two
// readers hand them. What the readers see (trees, renames, odd paths) is
// tested through them: github-changes.test.ts, ../merge/guarded-states.test.ts
// and ../merge/judge-agreement.integration.test.ts.

import assert from "node:assert/strict";
import test from "node:test";

import { findCheckChanges } from "./changes.ts";
import type { FileState, PathChange } from "./file-state.ts";

const absent: FileState = { kind: "absent" };

const text = (content: string, mode = "100644"): FileState => ({
  kind: "regular",
  mode,
  text: content,
});

const json = (value: unknown): FileState =>
  text(JSON.stringify(value, null, 2));

/** A regular file whose text the comparison doesn't read. */
const plain: FileState = { kind: "regular", mode: "100644" };

const change = (
  path: string,
  base: FileState,
  head: FileState,
): PathChange => ({
  path,
  base,
  head,
});

const PIN = "@londontypescript/temple-bar";

const ROOT = {
  name: "widgets",
  packageManager: "pnpm@10.34.5",
  scripts: {
    gate: "temple-bar gate",
    typecheck: "tsc",
    lint: "eslint .",
    "format:check": "prettier --check .",
    test: "pnpm run test:unit",
    "test:unit": "node --test",
    build: "tsc -p build",
  },
  devDependencies: { [PIN]: "0.0.7", eslint: "10.0.0" },
};

const PACKAGE = {
  name: "a",
  scripts: { typecheck: "tsc", lint: "eslint .", test: "node --test" },
};

const NESTED = "packages/a/package.json";

/** The findings for one manifest going from `before` to `after`. */
function manifest(path: string, before: FileState, after: FileState) {
  return findCheckChanges([change(path, before, after)]);
}

void test("an ordinary change has no findings, and unguarded paths are left out whatever their state", () => {
  assert.deepEqual(
    findCheckChanges([
      change("src/app.ts", plain, absent),
      change("README.md", absent, plain),
      change("docs/tsconfig-notes.md", plain, plain),
    ]),
    [],
  );
});

void test("every script of a nested manifest is guarded: changed, added and removed", () => {
  // lint removed, typecheck changed, build added.
  const after = {
    ...PACKAGE,
    scripts: {
      typecheck: "node --version",
      test: "node --test",
      build: "tsc -b",
    },
  };
  assert.deepEqual(manifest(NESTED, json(PACKAGE), json(after)), [
    `${NESTED}: the "build" script`,
    `${NESTED}: the "lint" script`,
    `${NESTED}: the "typecheck" script`,
  ]);
});

void test("a guarded test can't hand its work to an unguarded test:unit: that changes too", () => {
  const after = {
    ...ROOT,
    scripts: { ...ROOT.scripts, "test:unit": "node --version" },
  };
  assert.deepEqual(manifest("package.json", json(ROOT), json(after)), [
    'package.json: the "test:unit" script',
  ]);
});

void test("a postinstall added to a nested package is a finding: it runs on CI's install, before the gate", () => {
  const after = {
    ...PACKAGE,
    scripts: { ...PACKAGE.scripts, postinstall: "node evil.js" },
  };
  assert.deepEqual(manifest(NESTED, json(PACKAGE), json(after)), [
    `${NESTED}: the "postinstall" script`,
  ]);
});

void test("scripts missing and scripts {} are the same: no scripts", () => {
  const bare = { name: "a" };
  assert.deepEqual(
    manifest(NESTED, json(bare), json({ ...bare, scripts: {} })),
    [],
  );
  assert.deepEqual(
    manifest(NESTED, json({ ...bare, scripts: {} }), json(bare)),
    [],
  );
});

void test("scripts that are null or an array make the head invalid: a finding", () => {
  for (const scripts of [null, ["lint"], "lint"]) {
    assert.deepEqual(
      manifest(NESTED, json(PACKAGE), json({ ...PACKAGE, scripts })),
      [
        `${NESTED} has a "scripts" that isn't an object here, so the judge can't tell whether it changes the checks`,
      ],
      JSON.stringify(scripts),
    );
  }
});

void test("a script that isn't a string always counts, even unchanged", () => {
  const odd = { ...PACKAGE, scripts: { ...PACKAGE.scripts, test: 1 } };
  assert.deepEqual(manifest(NESTED, json(odd), json(odd)), [
    `${NESTED}: the "test" script`,
  ]);
});

void test("a script named like an object's own property is compared as a script", () => {
  const before = { scripts: { constructor: "a" } };
  assert.deepEqual(manifest(NESTED, json({ scripts: {} }), json(before)), [
    `${NESTED}: the "constructor" script`,
  ]);
  assert.deepEqual(manifest(NESTED, json(before), json(before)), []);
});

void test("an added manifest with scripts is one finding; one with none is the gate's to judge", () => {
  assert.deepEqual(manifest(NESTED, absent, json(PACKAGE)), [
    `${NESTED} (added, with scripts)`,
  ]);
  assert.deepEqual(manifest(NESTED, absent, json({ name: "a" })), []);
  assert.deepEqual(
    manifest(NESTED, absent, json({ name: "a", scripts: {} })),
    [],
  );
});

void test("a removed manifest is always a finding, with or without scripts", () => {
  assert.deepEqual(manifest(NESTED, json(PACKAGE), absent), [
    `${NESTED} (removed)`,
  ]);
  assert.deepEqual(manifest(NESTED, json({ name: "a" }), absent), [
    `${NESTED} (removed)`,
  ]);
  assert.deepEqual(manifest(NESTED, text("{ not json"), absent), [
    `${NESTED} (removed)`,
  ]);
});

void test("a head that isn't valid JSON, or isn't an object, is a finding", () => {
  assert.deepEqual(manifest(NESTED, json(PACKAGE), text("{ not json")), [
    `${NESTED} isn't valid JSON here, so the judge can't tell whether it changes the checks`,
  ]);
  assert.deepEqual(manifest(NESTED, json(PACKAGE), json(["a"])), [
    `${NESTED} isn't a JSON object here, so the judge can't tell whether it changes the checks`,
  ]);
  assert.deepEqual(manifest(NESTED, absent, text("")), [
    `${NESTED} isn't valid JSON here, so the judge can't tell whether it changes the checks`,
  ]);
});

void test("an invalid base is nothing to compare against: each of the head's scripts counts", () => {
  assert.deepEqual(manifest(NESTED, text("{ not json"), json(PACKAGE)), [
    `${NESTED}: the "lint" script`,
    `${NESTED}: the "test" script`,
    `${NESTED}: the "typecheck" script`,
  ]);
  assert.deepEqual(
    manifest(NESTED, json({ scripts: null }), json({ name: "a" })),
    [],
  );
});

void test("temple-bar's version is compared in every manifest, in every place it can be set", () => {
  assert.deepEqual(
    manifest(
      NESTED,
      json(PACKAGE),
      json({ ...PACKAGE, devDependencies: { [PIN]: "0.0.6" } }),
    ),
    [
      `${NESTED}: the temple-bar version in devDependencies["${PIN}"] (nothing on the base branch, "0.0.6" here)`,
    ],
  );
  for (const swap of [
    { pnpm: { overrides: { [PIN]: "file:./fake" } } },
    { overrides: { [`${PIN}@0`]: "0.0.1" } },
    { resolutions: { [`x>${PIN}`]: "0.0.1" } },
  ]) {
    const findings = manifest(
      "package.json",
      json(ROOT),
      json({ ...ROOT, ...swap }),
    );
    assert.ok(
      findings.some((line) => line.includes("the temple-bar version in")),
      JSON.stringify(findings),
    );
  }
});

void test("packageManager and devEngines count in every manifest; pnpm only at the root", () => {
  const fields = {
    packageManager: "pnpm@9.0.0",
    devEngines: { runtime: { name: "node", version: "22" } },
    pnpm: { onlyBuiltDependencies: ["evil"] },
  };
  assert.deepEqual(
    manifest("package.json", json(ROOT), json({ ...ROOT, ...fields })),
    [
      'package.json: the "packageManager" field',
      'package.json: the "devEngines" field',
      'package.json: the "pnpm" field',
    ],
  );
  assert.deepEqual(
    manifest(NESTED, json(PACKAGE), json({ ...PACKAGE, ...fields })),
    [
      `${NESTED}: the "packageManager" field`,
      `${NESTED}: the "devEngines" field`,
    ],
  );
  // A case-folded root manifest is the root one on a case-insensitive disk.
  assert.deepEqual(
    manifest("Package.json", json(ROOT), json({ ...ROOT, pnpm: {} })),
    ['Package.json: the "pnpm" field'],
  );
});

void test("other package.json changes pass: a dependency, a description", () => {
  const after = {
    ...ROOT,
    description: "Widgets",
    devDependencies: { ...ROOT.devDependencies, prettier: "3.0.0" },
  };
  assert.deepEqual(manifest("package.json", json(ROOT), json(after)), []);
});

void test("a head that isn't a regular file is a finding, its text unread", () => {
  for (const mode of ["120000", "160000", "040000"]) {
    assert.deepEqual(
      manifest(NESTED, json(PACKAGE), { kind: "special", mode }),
      [`${NESTED} (not a regular file)`],
      mode,
    );
  }
  assert.deepEqual(
    findCheckChanges([
      change("pnpm-lock.yaml", plain, { kind: "special", mode: "120000" }),
    ]),
    ["pnpm-lock.yaml (not a regular file)"],
  );
});

void test("a change of mode is a finding, and a manifest that was a symlink has nothing to compare against", () => {
  const exec = text(JSON.stringify(PACKAGE), "100755");
  assert.deepEqual(manifest(NESTED, text(JSON.stringify(PACKAGE)), exec), [
    `${NESTED} (mode changed from 100644 to 100755)`,
  ]);
  assert.deepEqual(
    manifest(NESTED, { kind: "special", mode: "120000" }, json(PACKAGE)),
    [
      `${NESTED} (mode changed from 120000 to 100644)`,
      `${NESTED}: the "lint" script`,
      `${NESTED}: the "test" script`,
      `${NESTED}: the "typecheck" script`,
    ],
  );
});

void test("a side that couldn't be read is a finding, never taken as absent", () => {
  const unreadable: FileState = {
    kind: "unreadable",
    reason: "missing object",
  };
  assert.deepEqual(manifest(NESTED, unreadable, absent), [
    `${NESTED} (could not read it on the base branch: missing object)`,
  ]);
  assert.deepEqual(manifest(NESTED, json(PACKAGE), unreadable), [
    `${NESTED} (could not read it here: missing object)`,
  ]);
  assert.deepEqual(
    findCheckChanges([change("pnpm-lock.yaml", unreadable, plain)]),
    ["pnpm-lock.yaml (could not read it on the base branch: missing object)"],
  );
});

void test("whole files: any change to a workflow, an install setting or temple-bar's config", () => {
  assert.deepEqual(
    findCheckChanges([
      change(".github/workflows/ci.yml", plain, plain),
      change(".github/workflows/fake-judge.yml", absent, plain),
      change("packages/a/.npmrc", plain, absent),
      change("temple-bar.config.json", plain, {
        kind: "special",
        mode: "120000",
      }),
      change("eslint.config.js", plain, absent),
    ]),
    [
      ".github/workflows/ci.yml (modified)",
      ".github/workflows/fake-judge.yml (added)",
      "packages/a/.npmrc (removed)",
      "temple-bar.config.json (modified)",
    ],
  );
});

void test("findings come in a stable order: whole files, then manifests by path, then the lockfile", () => {
  const lockfile = (integrity: string) =>
    text(
      `lockfileVersion: '9.0'\n\npackages:\n\n  '${PIN}@0.0.7':\n    resolution: {integrity: ${integrity}}\n`,
    );
  const findings = findCheckChanges([
    change("pnpm-lock.yaml", lockfile("sha512-a=="), lockfile("sha512-b==")),
    change("packages/b/package.json", json(PACKAGE), absent),
    change("pnpm-workspace.yaml", plain, plain),
    change(NESTED, absent, json(PACKAGE)),
    change(".github/workflows/ci.yml", plain, plain),
  ]);
  assert.deepEqual(findings, [
    ".github/workflows/ci.yml (modified)",
    "pnpm-workspace.yaml (modified)",
    `${NESTED} (added, with scripts)`,
    "packages/b/package.json (removed)",
    `pnpm-lock.yaml: temple-bar's entries: packages > ${PIN}@0.0.7 (changed)`,
  ]);
});

void test("the lockfile keeps its policy: only temple-bar's entries count", () => {
  const lockfile = (eslint: string) =>
    text(
      `lockfileVersion: '9.0'\n\npackages:\n\n  '${PIN}@0.0.7':\n    resolution: {integrity: sha512-a==}\n\n  eslint@${eslint}:\n    resolution: {integrity: sha512-e==}\n`,
    );
  assert.deepEqual(
    findCheckChanges([
      change("pnpm-lock.yaml", lockfile("10.0.0"), lockfile("10.1.0")),
    ]),
    [],
  );
  // A nested lockfile isn't the one CI installs from.
  assert.deepEqual(
    findCheckChanges([change("packages/a/pnpm-lock.yaml", plain, absent)]),
    [],
  );
});

void test("a manifest or lockfile whose text wasn't read is a mistake in the reader, never a pass", () => {
  assert.throws(() => manifest(NESTED, absent, plain), /wasn't read/);
  assert.throws(
    () => findCheckChanges([change("pnpm-lock.yaml", plain, plain)]),
    /wasn't read/,
  );
});
