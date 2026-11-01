// The catalog changes ADR 0015 lets through without the maintainer: changed
// values and added entries in the root pnpm-workspace.yaml's default
// catalog, with everything around them unchanged. Each row of the ADR's
// "Passes" table is a test here; the same rows run through both readers in
// ../merge/judge-agreement-catalog.integration.test.ts.

import assert from "node:assert/strict";
import test from "node:test";

import { catalogOnlyChange, findCheckChanges } from "./changes.ts";
import type { PathChange } from "./file-state.ts";
import {
  BASE,
  char,
  INERT,
  regular,
  swap,
  swapAll,
  workspace,
  WORKSPACE,
} from "./testing/catalog-fixture.ts";

/** A change list with no findings, and what the judge says it changed. */
function assertPasses(
  changes: readonly PathChange[],
  counts: { changed: number; added: number },
): void {
  assert.deepEqual(findCheckChanges(changes), []);
  assert.deepEqual(catalogOnlyChange(changes), counts);
}

const passes = (
  before: string,
  after: string,
  counts: { changed: number; added: number },
) => {
  assertPasses([workspace(before, after)], counts);
};

void test("seven values changed, three under scoped keys, as a grouped Dependabot bump makes them", () => {
  const head = swapAll(BASE, [
    ["'@eslint/js': 9.39.1", "'@eslint/js': 9.39.2"],
    ["'@types/react': 19.2.6", "'@types/react': 19.2.7"],
    ["'@types/react-dom': 19.2.3", "'@types/react-dom': 19.2.4"],
    ["  eslint: 9.39.1", "  eslint: 9.39.2"],
    ["  react: 19.2.0", "  react: 19.2.1"],
    ["  react-dom: 19.2.0", "  react-dom: 19.2.1"],
    ["  vitest: 4.0.13", "  vitest: 4.0.14"],
  ]);
  passes(BASE, head, { changed: 7, added: 0 });
});

void test("a bump with the root lockfile's catalogs and importers moved, temple-bar's entries untouched", () => {
  const lockfile = (vite: string) =>
    [
      "lockfileVersion: '9.0'",
      "",
      "catalogs:",
      "  default:",
      "    vite:",
      `      specifier: ${vite}`,
      `      version: ${vite}`,
      "",
      "importers:",
      "",
      "  .:",
      "    devDependencies:",
      "      '@londontypescript/temple-bar':",
      "        specifier: 0.2.2",
      "        version: 0.2.2",
      "      vite:",
      "        specifier: 'catalog:'",
      `        version: ${vite}`,
      "",
      "packages:",
      "",
      "  '@londontypescript/temple-bar@0.2.2':",
      "    resolution: {integrity: sha512-a==}",
      "",
      `  vite@${vite}:`,
      "    resolution: {integrity: sha512-v==}",
      "",
    ].join("\n");
  assertPasses(
    [
      workspace(BASE, swap(BASE, "vite: 8.3.3", "vite: 8.3.4")),
      {
        path: "pnpm-lock.yaml",
        base: regular(lockfile("8.3.3")),
        head: regular(lockfile("8.3.4")),
      },
    ],
    { changed: 1, added: 0 },
  );
});

void test("an entry appended to the catalog", () => {
  passes(
    BASE,
    swap(BASE, "  vitest: 4.0.13\n", "  vitest: 4.0.13\n  zod: 4.1.0\n"),
    {
      changed: 0,
      added: 1,
    },
  );
});

void test("a scoped entry added first, mid-block or before an unchanged comment", () => {
  const added = "  '@types/node': 24.13.6\n";
  passes(BASE, swap(BASE, "catalog:\n", `catalog:\n${added}`), {
    changed: 0,
    added: 1,
  });
  passes(BASE, swap(BASE, "  prettier:", `${added}  prettier:`), {
    changed: 0,
    added: 1,
  });
  const commented = swap(BASE, "  vite:", "  # The build.\n  vite:");
  passes(
    commented,
    swap(commented, "  # The build.", `${added}  # The build.`),
    {
      changed: 0,
      added: 1,
    },
  );
});

void test("versions with ^ or ~, a prerelease, or a lower version", () => {
  for (const [from, to] of [
    ["^8.3.0", "^8.4.0"],
    ["~5.0.1", "~5.0.2"],
    ["5.0.0-beta.3", "5.0.0"],
    ["8.3.3", "8.3.0"],
    ["1.0.0-rc.1", "1.0.0-0a.x-y.2"],
  ] as const) {
    const before = swap(BASE, "vite: 8.3.3", `vite: ${from}`);
    passes(before, swap(before, `vite: ${from}`, `vite: ${to}`), {
      changed: 1,
      added: 0,
    });
  }
});

void test("a bump beside unchanged comment and empty lines inside the body", () => {
  const before = swapAll(BASE, [
    ["  vite:", "  # The build.\n\n  vite:"],
    ["  react:", "\n# Column-0 comments are body lines too.\n  react:"],
  ]);
  passes(before, swap(before, "vite: 8.3.3", "vite: 8.4.0"), {
    changed: 1,
    added: 0,
  });
});

void test("a bump beside temple-bar's own entry, unchanged", () => {
  const before = swap(
    BASE,
    "  vite:",
    "  '@londontypescript/temple-bar': 0.2.2\n  vite:",
  );
  passes(before, swap(before, "vite: 8.3.3", "vite: 8.4.0"), {
    changed: 1,
    added: 0,
  });
});

void test("a bump with well-shaped text around it, the same on both sides", () => {
  const suffixes = [
    "catalogs:\n  legacy:\n    react: 18.3.1\n",
    "catalogMode: strict\n",
    "overrides:\n  'left-pad': 1.3.0\n  semver: '^7.6.0' # a range\n",
    "packageExtensions:\n  'some-pkg@1':\n    peerDependencies:\n      left-pad: '*'\n",
    "note: a plain value\n  carried on an indented line\n",
  ];
  for (const suffix of suffixes) {
    const before = `${BASE}${suffix}`;
    passes(before, swap(before, "vite: 8.3.3", "vite: 8.4.0"), {
      changed: 1,
      added: 0,
    });
  }
  const prefixes = [
    "---\n",
    "# A comment before the document.\n---\n",
    "# Packages and settings.\nlinkWorkspacePackages: true\n",
    '- "packages/*"\n',
  ];
  for (const prefix of prefixes) {
    const before = `${prefix}${BASE}`;
    passes(before, swap(before, "vite: 8.3.3", "vite: 8.4.0"), {
      changed: 1,
      added: 0,
    });
  }
});

void test("a bump in a file whose mode is 100755 on both sides", () => {
  const head = swap(BASE, "vite: 8.3.3", "vite: 8.4.0");
  assertPasses(
    [
      {
        path: WORKSPACE,
        base: regular(BASE, "100755"),
        head: regular(head, "100755"),
        catalogContext: INERT,
      },
    ],
    { changed: 1, added: 0 },
  );
});

void test("non-ASCII text, U+FFFD included, in a comment inside the body or anywhere outside it", () => {
  const before = swapAll(BASE, [
    [
      "# Versions every package shares.",
      `# Versions every package shares ${char(0x2014)} caf${char(0xe9)} ${char(0xfffd)}.`,
    ],
    ["  vite:", `  # Vite, f${char(0xfc)}r alle.\n  vite:`],
    ["  - esbuild", `  - 'esbuild ${char(0x2713)}'`],
  ]);
  passes(before, swap(before, "vite: 8.3.3", "vite: 8.4.0"), {
    changed: 1,
    added: 0,
  });
});

void test("a catalog that ends the file, with or without a final newline, kept as it was", () => {
  const ending = "catalog:\n  vite: 8.3.3\n  zod: 4.1.0";
  for (const before of [ending, `${ending}\n`, `${ending}\n\n`]) {
    passes(before, swap(before, "vite: 8.3.3", "vite: 8.4.0"), {
      changed: 1,
      added: 0,
    });
  }
  passes(ending, `${ending}\n  react: 19.2.0`, { changed: 0, added: 1 });
});

void test("a catalog with no entries yet gains its first", () => {
  const before = "packages:\n  - app\ncatalog:\nlinkWorkspacePackages: true\n";
  passes(before, swap(before, "catalog:\n", "catalog:\n  vite: 8.3.3\n"), {
    changed: 0,
    added: 1,
  });
});
