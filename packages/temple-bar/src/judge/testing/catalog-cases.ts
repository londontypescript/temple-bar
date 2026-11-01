// ADR 0015's catalog examples as repositories, for the tests that judge
// each through both readers (../../merge/judge-agreement-catalog.integration.test.ts):
// the changes it admits and the body changes it refuses. The rest of the
// examples are in catalog-cases-around.ts.

import type { AgreementCase } from "./agreement.ts";
import { BASE, char, refused, swap, swapAll } from "./catalog-fixture.ts";
import type { Files } from "./trees.ts";

export const ROOT = JSON.stringify({ name: "widgets", scripts: { test: "x" } });

/** The repository with the root workspace file holding `text`. */
export const ws = (text: string, extra: Files = {}): Files => ({
  "package.json": ROOT,
  "pnpm-workspace.yaml": text,
  ...extra,
});

export const bump = (text: string): string =>
  swap(text, "vite: 8.3.3", "vite: 8.4.0");
export const BUMPED = bump(BASE);

/** A head swapping `from` for `to` in the base, refused for `reason`. */
export const refuses = (
  what: string,
  from: string,
  to: string,
  reason: string,
): AgreementCase => [what, ws(BASE), ws(swap(BASE, from, to)), refused(reason)];

const passes = (what: string, before: string, after: string): AgreementCase => [
  what,
  ws(before),
  ws(after),
  [],
];

const commented = swap(BASE, "  vite:", "  # The build.\n\n  vite:");
const OWN = "  '@londontypescript/temple-bar': 0.2.2\n";
const withOwn = swap(BASE, "  vite:", `${OWN}  vite:`);
const ADDED = "  '@types/node': 24.13.6\n";
const NAMED = "catalogs:\n  legacy:\n    react: 18.3.1\n";

function lockfile(vite: string): string {
  return (
    "lockfileVersion: '9.0'\n\ncatalogs:\n  default:\n    vite:\n" +
    `      specifier: ${vite}\n      version: ${vite}\n\nimporters:\n\n  .:\n` +
    "    devDependencies:\n      '@londontypescript/temple-bar':\n" +
    "        specifier: 0.2.2\n        version: 0.2.2\n      vite:\n" +
    `        specifier: 'catalog:'\n        version: ${vite}\n`
  );
}

export const PASSING: readonly AgreementCase[] = [
  passes(
    "seven values changed, three scoped",
    BASE,
    swapAll(BASE, [
      ["js': 9.39.1", "js': 9.39.2"],
      ["react': 19.2.6", "react': 19.2.7"],
      ["react-dom': 19.2.3", "react-dom': 19.2.4"],
      ["eslint: 9.39.1", "eslint: 9.39.2"],
      ["  react: 19.2.0", "  react: 19.2.1"],
      ["react-dom: 19.2.0", "react-dom: 19.2.1"],
      ["vitest: 4.0.13", "vitest: 4.0.14"],
    ]),
  ),
  passes(
    "an entry appended",
    BASE,
    swap(BASE, "  vitest: 4.0.13\n", "  vitest: 4.0.13\n  zod: 4.1.0\n"),
  ),
  passes(
    "a scoped entry first",
    BASE,
    swap(BASE, "catalog:\n", `catalog:\n${ADDED}`),
  ),
  passes(
    "a scoped entry mid-block",
    BASE,
    swap(BASE, "  prettier:", `${ADDED}  prettier:`),
  ),
  passes(
    "an entry before a comment",
    commented,
    swap(commented, "  # The build.", `${ADDED}  # The build.`),
  ),
  passes(
    "^ kept",
    swap(BASE, "8.3.3", "^8.3.0"),
    swap(BASE, "8.3.3", "^8.4.0"),
  ),
  passes(
    "~ kept",
    swap(BASE, "8.3.3", "~5.0.1"),
    swap(BASE, "8.3.3", "~5.0.2"),
  ),
  passes(
    "a prerelease released",
    swap(BASE, "8.3.3", "5.0.0-beta.3"),
    swap(BASE, "8.3.3", "5.0.0"),
  ),
  passes("a lower version", BASE, swap(BASE, "8.3.3", "8.3.0")),
  passes("beside comments and empty lines", commented, bump(commented)),
  passes("beside temple-bar's own entry", withOwn, bump(withOwn)),
  passes("an unchanged named catalog", `${BASE}${NAMED}`, `${BUMPED}${NAMED}`),
  passes(
    "catalogMode",
    `${BASE}catalogMode: strict\n`,
    `${BUMPED}catalogMode: strict\n`,
  ),
  passes("--- first", `---\n${BASE}`, `---\n${BUMPED}`),
  passes(
    "U+FFFD in a comment",
    `# ${char(0xfffd)}\n${BASE}`,
    `# ${char(0xfffd)}\n${BUMPED}`,
  ),
  [
    "both sides mode 100755",
    ws(BASE, { "pnpm-workspace.yaml": { text: BASE, executable: true } }),
    ws(BUMPED, { "pnpm-workspace.yaml": { text: BUMPED, executable: true } }),
    [],
  ],
  [
    "the root lockfile's catalogs and importers moved, temple-bar's entries kept",
    ws(BASE, { "pnpm-lock.yaml": lockfile("8.3.3") }),
    ws(BUMPED, { "pnpm-lock.yaml": lockfile("8.4.0") }),
    [],
  ],
];

const unmatched = (line: number) =>
  `base line unmatched: line ${String(line)} on the base branch has no match at line ${String(line)} here`;
const VALUES = [
  "npm:evil@19.3.1",
  "file:../x",
  "link:",
  "workspace:*",
  "latest",
  ">=19",
  "19.x",
  "*",
  "https://example.com/r.tgz",
  "github:o/r",
  "1.0.0-01",
  "01.2.3",
];
const KEYS = ["'@Types/react'", "'@types/react '", "'@a/b''c'", "'@a/b/c'"];
const SHAPES = [
  "  vite: 8.3.3 # pinned",
  "  vite: 8.3.3 ",
  "    vite: 8.3.3",
  "  vite:8.3.3",
  "  vite : 8.3.3",
  "  vite: '8.3.3'",
  "   \n  vite: 8.3.3",
];

export const BODY_REFUSED: readonly AgreementCase[] = [
  refuses(
    "vite moved below vitest",
    "  vite: 8.3.3\n  vitest: 4.0.13",
    "  vitest: 4.0.13\n  vite: 8.3.3",
    unmatched(18),
  ),
  [
    "a body comment edited",
    ws(commented),
    ws(swap(commented, "# The build.", "# The bundler.")),
    refused(unmatched(18)),
  ],
  [
    "temple-bar bumped",
    ws(withOwn),
    ws(swap(withOwn, "bar': 0.2.2", "bar': 0.2.3")),
    refused(
      "temple-bar's own entry: '@londontypescript/temple-bar' changed on line 18 here",
    ),
  ],
  [
    "temple-bar added",
    ws(BASE),
    ws(withOwn),
    refused(
      "temple-bar's own entry: '@londontypescript/temple-bar' added on line 18 here",
    ),
  ],
  [
    "temple-bar removed",
    ws(withOwn),
    ws(BASE),
    refused(
      "temple-bar's own entry: '@londontypescript/temple-bar' on line 18 on the base branch is removed or moved",
    ),
  ],
  refuses(
    "temple-bar-extra added",
    "  vite:",
    "  '@londontypescript/temple-bar-extra': 1.0.0\n  vite:",
    "temple-bar's own entry: '@londontypescript/temple-bar-extra' added on line 18 here",
  ),
  ...VALUES.map((value) =>
    refuses(
      value,
      "react: 19.2.0",
      `react: ${value}`,
      "value grammar: the value on line 13 here",
    ),
  ),
  ...KEYS.map((key) =>
    refuses(key, "'@types/react'", key, "key form: the key on line 8 here"),
  ),
  refuses(
    "a backslash in a key",
    "'@types/react'",
    "'@a/b\\c'",
    "file shape: a backslash on line 8 here",
  ),
  ...SHAPES.map((shape) =>
    refuses(
      JSON.stringify(shape),
      "  vite: 8.3.3",
      shape,
      "entry shape: line 18 here",
    ),
  ),
  refuses(
    "a tab",
    "  vite: 8.3.3",
    "  vite:\t8.3.3",
    "file shape: a tab on line 18 here",
  ),
  refuses(
    "a duplicate key",
    "  vitest: 4.0.13\n",
    "  vitest: 4.0.13\n  react: 19.3.1\n",
    "duplicate key: react on lines 13 and 20 here",
  ),
];
