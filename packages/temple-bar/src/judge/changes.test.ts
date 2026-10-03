import assert from "node:assert/strict";
import test from "node:test";

import {
  changesManifest,
  findCheckChanges,
  type ChangedFile,
} from "./changes.ts";

const file = (
  filename: string,
  status = "modified",
  previousFilename?: string,
): ChangedFile =>
  previousFilename === undefined
    ? { filename, status }
    : { filename, status, previousFilename };

const manifest = (value: object): string => JSON.stringify(value, null, 2);

const BASE = {
  name: "widgets",
  scripts: {
    gate: "temple-bar gate",
    typecheck: "tsc",
    lint: "eslint .",
    "format:check": "prettier --check .",
    test: "node --test",
    build: "tsc -p build",
  },
  devDependencies: {
    "@londontypescript/temple-bar": "0.0.7",
    eslint: "10.0.0",
  },
};

function withChanges(changes: object): string {
  return manifest({ ...BASE, ...changes });
}

void test("an ordinary pull request changes no checks", () => {
  const files = [file("src/app.ts"), file("README.md", "added")];
  assert.equal(changesManifest(files), false);
  assert.deepEqual(findCheckChanges(files), []);
});

void test("any file under .github/workflows/ is a change to the checks: added, edited, removed or renamed away", () => {
  const files = [
    file(".github/workflows/ci.yml"),
    file(".github/workflows/fake-judge.yml", "added"),
    file(".github/workflows/release.yml", "removed"),
    file("docs/old-ci.yml", "renamed", ".github/workflows/old-ci.yml"),
    file(".github/dependabot.yml"),
  ];
  assert.deepEqual(findCheckChanges(files), [
    ".github/workflows/ci.yml (modified)",
    ".github/workflows/fake-judge.yml (added)",
    ".github/workflows/release.yml (removed)",
    "docs/old-ci.yml (renamed from .github/workflows/old-ci.yml)",
  ]);
});

void test("package.json with only other changes passes: a new dependency, another script", () => {
  const files = [file("package.json")];
  const head = manifest({
    ...BASE,
    scripts: { ...BASE.scripts, build: "tsc -b" },
    devDependencies: { ...BASE.devDependencies, prettier: "3.0.0" },
  });
  assert.deepEqual(findCheckChanges(files, { base: manifest(BASE), head }), []);
});

void test("a changed temple-bar pin is a change to the checks, naming both versions", () => {
  const head = withChanges({
    devDependencies: { "@londontypescript/temple-bar": "0.0.6" },
  });
  assert.deepEqual(
    findCheckChanges([file("package.json")], { base: manifest(BASE), head }),
    [
      'package.json: the temple-bar version in devDependencies["@londontypescript/temple-bar"] ("0.0.7" on the base branch, "0.0.6" here)',
    ],
  );
});

void test("an override that swaps temple-bar is caught, in each place package managers read one", () => {
  for (const changes of [
    { pnpm: { overrides: { "@londontypescript/temple-bar": "file:./fake" } } },
    { overrides: { "@londontypescript/temple-bar@0": "0.0.1" } },
    { resolutions: { "x>@londontypescript/temple-bar": "0.0.1" } },
  ]) {
    const findings = findCheckChanges([file("package.json")], {
      base: manifest(BASE),
      head: withChanges(changes),
    });
    assert.equal(findings.length, 1, JSON.stringify(changes));
    assert.match(findings[0] ?? "", /the temple-bar version in/);
  }
});

void test("each script the gate runs, and the gate script itself, is guarded", () => {
  for (const name of ["gate", "typecheck", "lint", "format:check", "test"]) {
    const head = withChanges({
      scripts: { ...BASE.scripts, [name]: "echo ok" },
    });
    assert.deepEqual(
      findCheckChanges([file("package.json")], { base: manifest(BASE), head }),
      [`package.json: the "${name}" script`],
    );
  }
});

void test("a removed guarded script is a change too", () => {
  const scripts = Object.fromEntries(
    Object.entries(BASE.scripts).filter(([name]) => name !== "lint"),
  );
  assert.deepEqual(
    findCheckChanges([file("package.json")], {
      base: manifest(BASE),
      head: withChanges({ scripts }),
    }),
    ['package.json: the "lint" script'],
  );
});

void test("package.json removed: the pin and every guarded script go with it", () => {
  const findings = findCheckChanges([file("package.json", "removed")], {
    base: manifest(BASE),
    head: undefined,
  });
  assert.equal(findings.length, 6);
});

void test("package.json renamed away is read as changed", () => {
  const files = [file("old.json", "renamed", "package.json")];
  assert.equal(changesManifest(files), true);
});

void test("a nested package.json is not the root one", () => {
  assert.equal(changesManifest([file("packages/a/package.json")]), false);
});

void test("package.json that isn't valid JSON fails closed", () => {
  assert.deepEqual(
    findCheckChanges([file("package.json")], {
      base: manifest(BASE),
      head: "{ not json",
    }),
    [
      "package.json isn't valid JSON here, so the judge can't tell whether it changes the checks",
    ],
  );
});

void test("asking about a changed package.json without reading it is a programming error", () => {
  assert.throws(() => findCheckChanges([file("package.json")]));
});
