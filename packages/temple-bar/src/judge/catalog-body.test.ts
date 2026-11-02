// The catalog's body under the grammar: each entry's shape, key and value,
// duplicate keys, the walk that pairs the two sides' lines, and
// temple-bar's own entry. Rows of ADR 0015's "Refused" table about the body
// are tests here, each head its own case, with the exact finding.

import assert from "node:assert/strict";
import test from "node:test";

import { catalogOnlyChange, findCheckChanges } from "./changes.ts";
import {
  BASE,
  char,
  refused,
  swap,
  workspace,
} from "./testing/catalog-fixture.ts";

const verdict = (before: string, after: string): string[] =>
  findCheckChanges([workspace(before, after)]);

/** Each head made from the base by swapping `from` for one of `heads`. */
function assertEach(
  from: string,
  heads: readonly string[],
  reason: string,
  before = BASE,
): void {
  for (const to of heads) {
    assert.deepEqual(
      verdict(before, swap(before, from, to)),
      refused(reason),
      to,
    );
  }
}

void test("an entry moved, removed or a body comment edited leaves a base line unmatched", () => {
  const moved = swap(
    BASE,
    "  vite: 8.3.3\n  vitest: 4.0.13",
    "  vitest: 4.0.13\n  vite: 8.3.3",
  );
  assert.deepEqual(
    verdict(BASE, moved),
    refused(
      "base line unmatched: line 18 on the base branch has no match at line 18 here",
    ),
  );
  assert.deepEqual(
    verdict(BASE, swap(BASE, "  react: 19.2.0\n", "")),
    refused(
      "base line unmatched: line 13 on the base branch has no match at line 13 here",
    ),
  );
  const commented = swap(BASE, "  vite:", "  # The build.\n  vite:");
  assert.deepEqual(
    verdict(commented, swap(commented, "# The build.", "# The bundler.")),
    refused(
      "base line unmatched: line 18 on the base branch has no match at line 18 here",
    ),
  );
});

void test("base lines left over are removals, and a head line that is neither is unmatched", () => {
  const ending = "catalog:\n  vite: 8.3.3\n  zod: 4.1.0";
  assert.deepEqual(
    verdict(ending, "catalog:\n  vite: 8.3.3"),
    refused(
      "base line unmatched: line 3 on the base branch is left over, so it is removed",
    ),
  );
  assert.deepEqual(
    verdict(ending, `${ending}\n  # More to come.`),
    refused(
      "head line unmatched: line 4 here is neither a line on the base branch nor an added entry",
    ),
  );
  // A body that reaches the end of the file owns the final empty line.
  assert.deepEqual(
    verdict(ending, `${ending}\n`),
    refused(
      "head line unmatched: line 4 here is neither a line on the base branch nor an added entry",
    ),
  );
  assert.deepEqual(
    verdict(`${ending}\n`, ending),
    refused(
      "base line unmatched: line 4 on the base branch is left over, so it is removed",
    ),
  );
});

void test("the walk prefers the same line, then a changed value, then an addition", () => {
  const before = "catalog:\n  vite: 8.3.3\n";
  const after = "catalog:\n  zod: 4.1.0\n  vite: 8.4.0\n  ky: 1.0.0\n";
  assert.deepEqual(verdict(before, after), []);
  assert.deepEqual(catalogOnlyChange([workspace(before, after)]), {
    changed: 1,
    added: 2,
  });
});

void test("temple-bar's own entry bumped, added, removed or moved, and its -extra name added", () => {
  const own = "  '@londontypescript/temple-bar': 0.2.2\n";
  const before = swap(BASE, "  vite:", `${own}  vite:`);
  assert.deepEqual(
    verdict(before, swap(before, "temple-bar': 0.2.2", "temple-bar': 0.2.3")),
    refused(
      "temple-bar's own entry: '@londontypescript/temple-bar' changed on line 18 here",
    ),
  );
  assert.deepEqual(
    verdict(BASE, before),
    refused(
      "temple-bar's own entry: '@londontypescript/temple-bar' added on line 18 here",
    ),
  );
  assert.deepEqual(
    verdict(before, BASE),
    refused(
      "temple-bar's own entry: '@londontypescript/temple-bar' on line 18 on the base branch is removed or moved",
    ),
  );
  assert.deepEqual(
    verdict(
      before,
      swap(
        swap(before, own, ""),
        "  vitest: 4.0.13\n",
        `  vitest: 4.0.13\n${own}`,
      ),
    ),
    refused(
      "temple-bar's own entry: '@londontypescript/temple-bar' on line 18 on the base branch is removed or moved",
    ),
  );
  assert.deepEqual(
    verdict(
      BASE,
      swap(
        BASE,
        "  vite:",
        "  '@londontypescript/temple-bar-extra': 1.0.0\n  vite:",
      ),
    ),
    refused(
      "temple-bar's own entry: '@londontypescript/temple-bar-extra' added on line 18 here",
    ),
  );
  // Left over at the end of a body that ends the file.
  const ending = `catalog:\n  vite: 8.3.3\n${own}`;
  assert.deepEqual(
    verdict(ending, "catalog:\n  vite: 8.3.3\n"),
    refused(
      "temple-bar's own entry: '@londontypescript/temple-bar' on line 3 on the base branch is removed or moved",
    ),
  );
});

void test("a look-alike of temple-bar's name is outside the key grammar", () => {
  assertEach(
    "  vite:",
    [
      "  '@londontypescript/Temple-bar': 0.2.2\n  vite:",
      `  '@londontypescript/temple${char(0x2010)}bar': 0.2.2\n  vite:`,
      "  '@londontypescript/temple-bar/x': 0.2.2\n  vite:",
      "  '@londontypescript /temple-bar': 0.2.2\n  vite:",
    ],
    "key form: the key on line 18 here",
  );
});

void test("a value that isn't a plain version", () => {
  assertEach(
    "react: 19.2.0",
    [
      "react: npm:evil@19.3.1",
      "react: file:../x",
      "react: link:",
      "react: workspace:*",
      "react: latest",
      "react: >=19",
      "react: 19.x",
      "react: *",
      "react: https://example.com/react-19.3.1.tgz",
      "react: github:o/r",
      "react: 1.0.0-01",
      "react: 01.2.3",
      "react: 19.3.1+build.5",
      "react: 19.3",
      "react: v19.3.1",
      "react: ^~19.3.1",
      "react: 19.3.1-",
      "react: 19.3.1-a..b",
    ],
    "value grammar: the value on line 13 here",
  );
});

void test("a key outside the two forms the grammar reads", () => {
  assertEach(
    "'@types/react': 19.2.6",
    [
      "'@Types/react': 19.2.6",
      "'@types/react ': 19.2.6",
      "'@a/b''c': 19.2.6",
      "'@a/b/c': 19.2.6",
      '"@types/react": 19.2.6',
      "@types/react: 19.2.6",
      "'@/react': 19.2.6",
      "'@types/': 19.2.6",
      "'@types/-react': 19.2.6",
    ],
    "key form: the key on line 8 here",
  );
  assertEach(
    "  react: 19.2.0",
    [
      "  'react': 19.2.0",
      '  "react": 19.2.0',
      "  3d-view: 19.2.0",
      "  React: 19.2.0",
      `  r${char(0xe9)}act: 19.2.0`,
      "  _react: 19.2.0",
      "  yes: 19.2.0",
      "  off: 19.2.0",
      "  n: 19.2.0",
      "  null: 19.2.0",
      `  ${"a".repeat(215)}: 19.2.0`,
    ],
    "key form: the key on line 13 here",
  );
  // A backslash is refused before any key is read.
  assert.deepEqual(
    verdict(BASE, swap(BASE, "'@types/react'", "'@a/b\\c'")),
    refused("file shape: a backslash on line 8 here"),
  );
});

void test("a key of 214 characters is a name; 215 is not", () => {
  const plain = "a".repeat(214);
  const scoped = `@${"s".repeat(100)}/${"n".repeat(112)}`;
  assert.equal(scoped.length, 214);
  const added = `  ${plain}: 1.0.0\n  '${scoped}': 1.0.0\n`;
  assert.deepEqual(verdict(BASE, swap(BASE, "  vite:", `${added}  vite:`)), []);
  assert.deepEqual(
    verdict(BASE, swap(BASE, "  vite:", `  '${scoped}x': 1.0.0\n  vite:`)),
    refused("key form: the key on line 18 here"),
  );
});

void test("an entry not shaped as two spaces, a key, a colon, one space and a value", () => {
  assertEach(
    "  vite: 8.3.3",
    [
      "  vite: 8.3.3 # pinned",
      "  vite: 8.3.3 ",
      "    vite: 8.3.3",
      " vite: 8.3.3",
      "  vite:8.3.3",
      "  vite : 8.3.3",
      "  vite: '8.3.3'",
      '  vite: "8.3.3"',
      "  vite:  8.3.3",
      "  vite:",
      "   \n  vite: 8.3.3",
      "  - vite: 8.3.3",
      "  vite: 8.3.3: x",
    ],
    "entry shape: line 18 here",
  );
  assert.deepEqual(
    verdict(BASE, swap(BASE, "  vite: 8.3.3", "  vite:\t8.3.3")),
    refused("file shape: a tab on line 18 here"),
  );
});

void test("the same key twice in one body, on either side", () => {
  const twice = swap(
    BASE,
    "  vitest: 4.0.13\n",
    "  vitest: 4.0.13\n  react: 19.3.1\n",
  );
  assert.deepEqual(
    verdict(BASE, twice),
    refused("duplicate key: react on lines 13 and 20 here"),
  );
  assert.deepEqual(
    verdict(twice, swap(twice, "vite: 8.3.3", "vite: 8.4.0")),
    refused("duplicate key: react on lines 13 and 20 on the base branch"),
  );
  assert.deepEqual(
    verdict(BASE, swap(BASE, "  vite:", "  '@types/react': 19.2.7\n  vite:")),
    refused("duplicate key: '@types/react' on lines 8 and 18 here"),
  );
});

void test("the base side's body is held to the grammar as much as the head's", () => {
  const odd = swap(BASE, "  vite: 8.3.3", "  vite: 8.3.3 # pinned");
  assert.deepEqual(
    verdict(odd, swap(odd, "react: 19.2.0", "react: 19.2.1")),
    refused("entry shape: line 18 on the base branch"),
  );
});
