// A catalog-only change never vouches for anything beside it: every other
// change to the checks in the same pull request still gives its own
// finding, whatever order the readers list the paths in, and the judge
// names a catalog-only change only when nothing else is found.

import assert from "node:assert/strict";
import test from "node:test";

import { catalogOnlyChange, findCheckChanges } from "./changes.ts";
import type { FileState, PathChange } from "./file-state.ts";
import { BASE, regular, swap, workspace } from "./testing/catalog-fixture.ts";

const plain: FileState = { kind: "regular", mode: "100644" };
const absent: FileState = { kind: "absent" };
const json = (value: unknown): FileState => regular(JSON.stringify(value));

const catalogBump = workspace(BASE, swap(BASE, "vite: 8.3.3", "vite: 8.4.0"));

const lockfile = (integrity: string): FileState =>
  regular(
    `lockfileVersion: '9.0'\n\npackages:\n\n  '@londontypescript/temple-bar@0.2.2':\n    resolution: {integrity: ${integrity}}\n`,
  );

const beside: readonly [string, PathChange, string][] = [
  [
    "a script",
    {
      path: "package.json",
      base: json({ name: "r", scripts: { test: "node --test" } }),
      head: json({ name: "r", scripts: { test: "node --version" } }),
    },
    'package.json: the "test" script',
  ],
  [
    "a workflow",
    { path: ".github/workflows/ci.yml", base: plain, head: plain },
    ".github/workflows/ci.yml (modified)",
  ],
  [
    "temple-bar's entries in the lockfile",
    {
      path: "pnpm-lock.yaml",
      base: lockfile("sha512-a=="),
      head: lockfile("sha512-b=="),
    },
    "pnpm-lock.yaml: temple-bar's entries: packages > @londontypescript/temple-bar@0.2.2 (changed)",
  ],
  [
    "a new package",
    {
      path: "packages/b/package.json",
      base: absent,
      head: json({ name: "b", scripts: { test: "node --test" } }),
    },
    "packages/b/package.json (added, with scripts)",
  ],
  [
    "a pnpmfile",
    { path: ".pnpmfile.cjs", base: absent, head: plain },
    ".pnpmfile.cjs (added)",
  ],
];

void test("every other change to the checks beside a catalog-only change keeps its own finding", () => {
  for (const [what, other, finding] of beside) {
    const changes = [catalogBump, other];
    assert.deepEqual(findCheckChanges(changes), [finding], what);
    assert.equal(catalogOnlyChange(changes), undefined, what);
  }
});

void test("the findings are the same whatever order the paths come in", () => {
  const refusedBump = workspace(BASE, swap(BASE, "  react: 19.2.0\n", ""));
  const changes = [refusedBump, ...beside.map(([, other]) => other)];
  const expected = findCheckChanges(changes);
  assert.equal(expected.length, beside.length + 1);
  assert.deepEqual(findCheckChanges([...changes].reverse()), expected);
  assert.deepEqual(
    findCheckChanges([...changes.slice(3), ...changes.slice(0, 3)]),
    expected,
  );
});

void test("a catalog-only change is named only when it passes and changes something", () => {
  assert.deepEqual(catalogOnlyChange([catalogBump]), { changed: 1, added: 0 });
  // Unguarded paths beside it change nothing.
  assert.deepEqual(
    catalogOnlyChange([
      catalogBump,
      { path: "src/a.ts", base: plain, head: plain },
    ]),
    { changed: 1, added: 0 },
  );
  assert.equal(catalogOnlyChange([]), undefined);
  assert.equal(
    catalogOnlyChange([workspace(BASE, swap(BASE, "  react: 19.2.0\n", ""))]),
    undefined,
  );
  assert.equal(catalogOnlyChange([workspace(BASE, BASE)]), undefined);
  assert.equal(
    catalogOnlyChange([
      { ...catalogBump, path: "packages/a/pnpm-workspace.yaml" },
    ]),
    undefined,
  );
});
