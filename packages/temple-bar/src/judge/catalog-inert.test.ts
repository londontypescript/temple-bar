// What makes a catalog change inert: nothing in the head that maps the
// catalog onto temple-bar's install (an override reading it) or runs code
// there (a pnpmfile, an .npmrc, a config dependency), no root name that
// only folds to the workspace file or the root manifest, and facts that
// were read at all. Each case is a catalog bump the grammar otherwise
// passes, with the dangerous fact given as unchanged: the readers hand no
// change for it, so only this rule can catch it.

import assert from "node:assert/strict";
import test from "node:test";

import { headFacts } from "./catalog-facts.ts";
import { findCheckChanges } from "./changes.ts";
import type { CatalogContext, FileState } from "./file-state.ts";
import {
  BASE,
  char,
  INERT,
  refused,
  regular,
  swap,
  withoutFacts,
  workspace,
} from "./testing/catalog-fixture.ts";
import type { TreeEntry } from "./tree-entry.ts";

const bumped = swap(BASE, "vite: 8.3.3", "vite: 8.4.0");

const verdict = (context: Partial<CatalogContext>): string[] =>
  findCheckChanges([workspace(BASE, bumped, { ...INERT, ...context })]);

const withManifest = (manifest: unknown): string[] =>
  verdict({ rootManifest: regular(JSON.stringify(manifest)) });

void test("facts a reader never gathered are unknown, and unknown never passes", () => {
  assert.deepEqual(
    findCheckChanges([withoutFacts(BASE, bumped)]),
    refused(
      "unknown: the facts about the head that make a catalog change inert weren't read",
    ),
  );
});

void test("a root package.json that is missing, not a file, unreadable, unread or invalid is unknown", () => {
  const cases: readonly [FileState, string][] = [
    [{ kind: "absent" }, "unknown: there is no root package.json here"],
    [
      { kind: "special", mode: "120000" },
      "unknown: the root package.json here isn't a regular file",
    ],
    [
      { kind: "unreadable", reason: "it isn't valid UTF-8" },
      "unknown: could not read the root package.json here: it isn't valid UTF-8",
    ],
    [
      { kind: "regular", mode: "100644" },
      "unknown: the root package.json here wasn't read",
    ],
    [
      regular("{ not json"),
      "unknown: the root package.json here isn't valid JSON",
    ],
    [regular("[]"), "unknown: the root package.json here isn't a JSON object"],
    [
      regular('{"scripts": "x"}'),
      'unknown: the root package.json here has a "scripts" that isn\'t an object',
    ],
  ];
  for (const [rootManifest, reason] of cases) {
    assert.deepEqual(verdict({ rootManifest }), refused(reason), reason);
  }
});

void test("an override in the root package.json that reads the catalog, at any depth and in any case", () => {
  const cases: readonly [unknown, string][] = [
    [
      { pnpm: { overrides: { knip: "catalog:" } } },
      '"pnpm" > "overrides" > "knip" in package.json here is "catalog:"',
    ],
    [
      { pnpm: { overrides: { typescript: "$typescript" } } },
      '"pnpm" > "overrides" > "typescript" in package.json here is "$typescript"',
    ],
    [
      { resolutions: { knip: "CATALOG:" } },
      '"resolutions" > "knip" in package.json here is "CATALOG:"',
    ],
    [
      { overrides: { knip: { ".": "catalog:tools" } } },
      '"overrides" > "knip" > "." in package.json here is "catalog:tools"',
    ],
    [
      {
        pnpm: {
          packageExtensions: {
            "a@1": { dependencies: { knip: "npm:knip@catalog:" } },
          },
        },
      },
      '"pnpm" > "packageExtensions" > "a@1" > "dependencies" > "knip" in package.json here is "npm:knip@catalog:"',
    ],
    [
      { pnpm: { x: ["ok", ["$deep"]] } },
      '"pnpm" > "x" > 1 > 0 in package.json here is "$deep"',
    ],
    [{ pnpm: "catalog:" }, '"pnpm" in package.json here is "catalog:"'],
  ];
  for (const [manifest, where] of cases) {
    assert.deepEqual(
      withManifest(manifest),
      refused(`an override reads the catalog: ${where}`),
      where,
    );
  }
});

void test("the project's own catalog references, and $ or catalog: anywhere else, leave a change inert", () => {
  assert.deepEqual(
    withManifest({
      name: "widgets",
      devDependencies: {
        vite: "catalog:",
        "@londontypescript/temple-bar": "0.2.2",
      },
      pnpm: {
        overrides: { "left-pad": "1.3.0", "catalog:": "1.0.0", x: "a$b" },
      },
      description: "$ and catalog: in a field pnpm never reads overrides from",
    }),
    [],
  );
});

void test("a config dependency in the root package.json's pnpm field, in any case", () => {
  for (const key of [
    "configDependencies",
    "configdependencies",
    "CONFIGDEPENDENCIES",
  ]) {
    assert.deepEqual(
      withManifest({ pnpm: { [key]: { "pnpm-plugin-x": "1.0.0" } } }),
      refused(
        `code runs at install: package.json's "pnpm" field here sets "${key}"`,
      ),
      key,
    );
  }
});

void test("a pnpmfile or an .npmrc anywhere in the head, by folded name", () => {
  for (const pnpmfile of [
    ".pnpmfile.cjs",
    "packages/a/.PNPMFILE.CJS",
    "tools/.pnpmfile.mjs",
  ]) {
    assert.deepEqual(
      verdict({ pnpmfiles: [pnpmfile] }),
      refused(`code runs at install: a pnpmfile here (${pnpmfile})`),
    );
  }
  for (const npmrc of [".npmrc", "packages/a/.NPMRC"]) {
    assert.deepEqual(
      verdict({ npmrcs: [npmrc] }),
      refused(`code runs at install: an .npmrc here (${npmrc})`),
    );
  }
});

void test("a root name that folds to the workspace file or the root manifest", () => {
  for (const [twin, folded] of [
    ["PNPM-WORKSPACE.YAML", "pnpm-workspace.yaml"],
    ["Package.json", "package.json"],
    [`${char(0xff50)}ackage.json`, "package.json"],
  ] as const) {
    assert.deepEqual(
      verdict({ foldedTwins: [twin] }),
      refused(`folded name: ${twin} here folds to ${folded}`),
    );
  }
});

void test("the facts are checked in a fixed order, whatever order each list is in", () => {
  const everything: Partial<CatalogContext> = {
    foldedTwins: ["Package.json", "PNPM-WORKSPACE.YAML"],
    rootManifest: { kind: "absent" },
    pnpmfiles: ["z/.pnpmfile.cjs", "a/.pnpmfile.cjs"],
    npmrcs: [".npmrc"],
  };
  assert.deepEqual(
    verdict(everything),
    refused(
      "folded name: PNPM-WORKSPACE.YAML here folds to pnpm-workspace.yaml",
    ),
  );
  assert.deepEqual(
    verdict({ ...everything, foldedTwins: [] }),
    refused("unknown: there is no root package.json here"),
  );
  assert.deepEqual(
    verdict({
      ...everything,
      foldedTwins: [],
      rootManifest: INERT.rootManifest,
    }),
    refused("code runs at install: a pnpmfile here (a/.pnpmfile.cjs)"),
  );
});

const entry = (mode: string, type: string): TreeEntry => ({
  mode,
  type,
  id: "a".repeat(40),
});
const FILE = entry("100644", "blob");

void test("the facts come from the head's whole tree, entries of every kind, sorted", () => {
  const listing: [string, TreeEntry][] = [
    ["package.json", FILE],
    ["pnpm-workspace.yaml", FILE],
    ["PACKAGE.JSON", FILE],
    ["Pnpm-Workspace.yaml", entry("040000", "tree")],
    ["packages/a/PNPM-WORKSPACE.YAML", FILE],
    ["packages/a/.npmrc", entry("040000", "tree")],
    ["node_modules/x/.NPMRC", entry("120000", "blob")],
    ["src/.pnpmfile.cjs", FILE],
    [".PNPMFILE.mjs", FILE],
    ["src/index.ts", FILE],
  ];
  const expected = {
    rootManifest: FILE,
    foldedTwins: ["PACKAGE.JSON", "Pnpm-Workspace.yaml"],
    pnpmfiles: [".PNPMFILE.mjs", "src/.pnpmfile.cjs"],
    npmrcs: ["node_modules/x/.NPMRC", "packages/a/.npmrc"],
  };
  assert.deepEqual(headFacts(new Map(listing)), expected);
  assert.deepEqual(headFacts(new Map(listing.reverse())), expected);
  assert.deepEqual(headFacts(new Map([["src/a.ts", FILE]])), {
    rootManifest: undefined,
    foldedTwins: [],
    pnpmfiles: [],
    npmrcs: [],
  });
});
