// The text around the catalog under the grammar: one marker, the prefix and
// suffix unchanged, their lines in shapes no YAML reader can dispute, and
// no word there that maps the catalog onto anything or runs code at
// install. The dangerous text is on both sides where the rule is about
// what the base already holds, so "changed outside the catalog" can't hide
// a missing rule.

import assert from "node:assert/strict";
import test from "node:test";

import { findCheckChanges } from "./changes.ts";
import { BASE, refused, swap, workspace } from "./testing/catalog-fixture.ts";

const verdict = (before: string, after: string): string[] =>
  findCheckChanges([workspace(before, after)]);

const bump = (text: string): string => swap(text, "vite: 8.3.3", "vite: 8.4.0");

/** A catalog bump in a file holding `text` before the marker, on both
 * sides. */
const withPrefix = (text: string): string[] => {
  const before = swap(BASE, "# Versions every package shares.\n", text);
  return verdict(before, bump(before));
};

/** A catalog bump in a file holding `text` after the body, on both sides.
 * It starts at line 23. */
const withSuffix = (text: string): string[] => {
  const before = `${BASE}${text}`;
  return verdict(before, bump(before));
};

void test("no marker, or more than one", () => {
  assert.deepEqual(
    verdict(BASE, `${BASE}catalog:\n  zod: 4.1.0\n`),
    refused('one marker: "catalog:" is on lines 5 and 23 here'),
  );
  assert.deepEqual(
    verdict(BASE, `${BASE}catalog:\ncatalog:\n`),
    refused('one marker: "catalog:" is on lines 5, 23 and 24 here'),
  );
  const none = 'packages:\n  - "packages/*"\n';
  assert.deepEqual(
    verdict(none, `${none}catalog:\n  vite: 8.3.3\n`),
    refused('one marker: no line on the base branch is exactly "catalog:"'),
  );
  assert.deepEqual(
    verdict(BASE, swap(BASE, "catalog:\n", "catalog: # default\n")),
    refused('one marker: no line here is exactly "catalog:"'),
  );
  assert.deepEqual(
    verdict(BASE, swap(BASE, "catalog:\n", "catalog: &defaults\n")),
    refused('one marker: no line here is exactly "catalog:"'),
  );
});

void test("anything changed before or after the catalog", () => {
  const cases: readonly [string, string, string][] = [
    ["a package pattern", '"packages/*"', '"apps/*"'],
    [
      "a negation",
      '  - "packages/*"\n',
      '  - "packages/*"\n  - "!packages/x"\n',
    ],
    ["a comment", "every package", "each package"],
    ["an empty line", '"packages/*"\n\n', '"packages/*"\n'],
    [
      "a second spelling of the section",
      "# Versions",
      "'catalog': {}\n# Versions",
    ],
  ];
  for (const [what, from, to] of cases) {
    const reason = verdict(BASE, bump(swap(BASE, from, to)))[0] ?? "";
    assert.match(
      reason,
      /changed outside the catalog: line [234], before the catalog, differs\)$/,
      what,
    );
  }
  assert.deepEqual(
    verdict(BASE, swap(BASE, "  - esbuild", "  - sharp")),
    refused(
      "changed outside the catalog: the text after the catalog differs from line 22 here",
    ),
  );
  const named = `${BASE}catalogs:\n  legacy:\n    react: 18.3.1\n`;
  assert.deepEqual(
    verdict(named, bump(swap(named, "react: 18.3.1", "react: 18.3.2"))),
    refused(
      "changed outside the catalog: the text after the catalog differs from line 25 here",
    ),
  );
});

void test("a final newline added or removed after the catalog changes the text after it", () => {
  assert.deepEqual(
    verdict(BASE, bump(BASE).slice(0, -1)),
    refused(
      "changed outside the catalog: the text after the catalog differs from line 23 here",
    ),
  );
  assert.deepEqual(
    verdict(BASE, `${bump(BASE)}\n`),
    refused(
      "changed outside the catalog: the text after the catalog differs from line 24 here",
    ),
  );
});

void test("an empty line added between the catalog and the text after it is a body line", () => {
  assert.deepEqual(
    verdict(BASE, swap(BASE, "\n\nonlyBuilt", "\n\n\nonlyBuilt")),
    refused(
      "head line unmatched: line 21 here is neither a line on the base branch nor an added entry",
    ),
  );
});

void test("lines outside the catalog that YAML could read across lines or as more than a key and a value", () => {
  const prefixes: readonly [string, string][] = [
    ["a flow mapping left open", '{x-note: "\n'],
    ["a flow sequence holding quotes", 'x-note: [foo", "]\n'],
    ["a flow sequence", "packages: ['packages/*']\n"],
    ["a flow mapping", "x: {a: 1}\n"],
    ["a literal block scalar", "note: |\n  text\n"],
    ["a folded block scalar", "note: >\n  text\n"],
    ["a directive", "%YAML 1.2\n---\n"],
    ["a document end", "...\n"],
    ["an anchor", "x: &a 1\n"],
    ["an alias", "x: *a\n"],
    ["a tag", "name: !!str widgets\n"],
    ["an explicit key", "? x\n"],
    ["a merge key", "<<: {}\n"],
    ["a single quote crossing lines", "note: 'a\n  b'\n"],
    ["a double quote crossing lines", 'note: "a\n  b"\n'],
    ["a quote inside a plain value", "note: it's\n"],
    ["a mapping inside a plain value", "note: a: b\n"],
    ["a value led by ^", "semver: ^7.6.0\n"],
    ["a value led by -", "childConcurrency: -1\n"],
    ["two spaces after the colon", "x:  1\n"],
    ["a line of spaces", "   \n"],
    ["a dash alone", "-\n"],
    ["a comment with no space before it", "x: 1# c\n"],
  ];
  for (const [what, text] of prefixes) {
    assert.deepEqual(
      withPrefix(text),
      refused("line shape: line 4 on the base branch"),
      what,
    );
  }
  for (const [what, text] of [
    ["a second ---", "x: 1\n---\n"],
    ["a plain value carried on at column 0", "note: a\nb\n"],
  ] as const) {
    assert.deepEqual(
      withPrefix(text),
      refused("line shape: line 5 on the base branch"),
      what,
    );
  }
  for (const text of ["---\n", "...\n", "x: [1\n"]) {
    assert.deepEqual(
      withSuffix(text),
      refused("line shape: line 23 on the base branch"),
      text,
    );
  }
});

void test("a backslash or a $ anywhere is refused before any shape is read", () => {
  assert.deepEqual(
    withPrefix('note: "a\\"\n'),
    refused("file shape: a backslash on line 4 on the base branch"),
  );
  assert.deepEqual(
    verdict(BASE, bump(`${BASE}"pnpm\\u0066ile": ./hooks.cjs\n`)),
    refused("file shape: a backslash on line 23 here"),
  );
  assert.deepEqual(
    verdict(BASE, bump(`${BASE}overrides:\n  picomatch: $picomatch\n`)),
    refused("file shape: a $ on line 24 here"),
  );
});

void test("catalog outside the body, except inside a longer word, in any case", () => {
  for (const text of [
    "overrides:\n  knip: catalog:\n",
    "overrides:\n  knip: 'catalog:'\n",
    "overrides:\n  knip: catalog:default\n",
    "x:\n  CATALOG: 1\n",
    "x:\n  xcatalog: 1\n",
    "x:\n  catalog-x: 1\n",
    "x:\n  'catalog': 1\n",
    "x:\n  # the catalog above\n",
  ]) {
    assert.deepEqual(
      withSuffix(text),
      refused('"catalog" outside the body: line 24 here'),
      text,
    );
  }
  assert.deepEqual(
    withPrefix("'catalog':\n"),
    refused('"catalog" outside the body: line 4 here'),
  );
  for (const text of [
    "catalogs:\n  legacy:\n    react: 18.3.1\n",
    "catalogMode: strict\n",
    "# Catalogs live here.\n",
  ]) {
    assert.deepEqual(withSuffix(text), [], text);
  }
});

void test("a pnpmfile setting or a config dependency outside the body, in any case", () => {
  for (const text of [
    "pnpmfile: ./hooks.cjs\n",
    "globalPnpmfile: ./hooks.cjs\n",
    "PNPMFILE: ./hooks.cjs\n",
    "# no pnpmfile here\n",
  ]) {
    assert.deepEqual(
      withSuffix(text),
      refused('"pnpmfile" outside the body: line 23 here'),
      text,
    );
  }
  for (const text of [
    "configDependencies:\n  pnpm-plugin-x: 1.0.0\n",
    "configdependencies:\n  x: 1.0.0\n",
    "CONFIGDEPENDENCIES: {}\n".replace("{}", "x"),
  ]) {
    assert.deepEqual(
      withSuffix(text),
      refused("code runs at install: line 23 here names configDependencies"),
      text,
    );
  }
});
