// More of ADR 0015's catalog examples as repositories, for the tests that
// judge each through both readers: the text around the catalog, the file's
// own shape, and the facts about the head each reader gathers from its own
// listing of the tree. The dangerous file is the same on both sides in the
// facts' cases, so its own finding can't stand in for a missing rule.

import type { AgreementCase } from "./agreement.ts";
import { BUMPED, bump, refuses, ROOT, ws } from "./catalog-cases.ts";
import { BASE, char, refused, swap } from "./catalog-fixture.ts";
import type { Files } from "./trees.ts";

/** A catalog bump in a file holding `around` before the marker (or after
 * the body), the same on both sides. */
const both = (
  what: string,
  around: string,
  reason: string,
  at: "prefix" | "suffix" = "prefix",
): AgreementCase => {
  const before = at === "prefix" ? `${around}${BASE}` : `${BASE}${around}`;
  return [what, ws(before), ws(bump(before)), refused(reason)];
};

const named = `${BASE}catalogs:\n  legacy:\n    react: 18.3.1\n`;

export const AROUND_REFUSED: readonly AgreementCase[] = [
  [
    "a second catalog: appended",
    ws(BASE),
    ws(`${BUMPED}catalog:\n  zod: 4.1.0\n`),
    refused('one marker: "catalog:" is on lines 5 and 23 here'),
  ],
  [
    "catalog: added where none was",
    ws("packages:\n  - app\n"),
    ws("packages:\n  - app\ncatalog:\n  vite: 8.3.3\n"),
    refused('one marker: no line on the base branch is exactly "catalog:"'),
  ],
  refuses(
    "catalog: # default",
    "catalog:\n",
    "catalog: # default\n",
    'one marker: no line here is exactly "catalog:"',
  ),
  both(
    "'catalog': {} before the marker",
    "'catalog': {}\n",
    "line shape: line 1 on the base branch",
  ),
  both(
    "'catalog': before the marker",
    "'catalog':\n",
    '"catalog" outside the body: line 1 here',
  ),
  [
    "a named catalog bumped",
    ws(named),
    ws(bump(swap(named, "18.3.1", "18.3.2"))),
    refused(
      "changed outside the catalog: the text after the catalog differs from line 25 here",
    ),
  ],
  refuses(
    "a package pattern",
    '"packages/*"',
    '"apps/*"',
    "changed outside the catalog: line 2, before the catalog, differs",
  ),
  refuses(
    "a setting",
    "  - esbuild",
    "  - sharp",
    "changed outside the catalog: the text after the catalog differs from line 22 here",
  ),
  refuses(
    "a comment",
    "every package",
    "each package",
    "changed outside the catalog: line 4, before the catalog, differs",
  ),
  refuses(
    "an empty line",
    '"packages/*"\n\n',
    '"packages/*"\n',
    "changed outside the catalog: line 3, before the catalog, differs",
  ),
  both(
    "an open flow mapping",
    '{x-note: "\n',
    "line shape: line 1 on the base branch",
  ),
  both(
    "a flow sequence holding quotes",
    'x-note: [foo", "]\n',
    "line shape: line 1 on the base branch",
  ),
  both(
    "a flow sequence",
    "packages: ['packages/*']\n",
    "line shape: line 1 on the base branch",
  ),
  both(
    "a block scalar",
    "note: |\n  text\n",
    "line shape: line 1 on the base branch",
  ),
  both(
    "an escape",
    'note: "a\\"\n',
    "file shape: a backslash on line 1 on the base branch",
  ),
  both(
    "a directive",
    "%YAML 1.2\n---\n",
    "line shape: line 1 on the base branch",
  ),
  both(
    "a document end",
    "...\n",
    "line shape: line 23 on the base branch",
    "suffix",
  ),
  both("a second ---", "x: 1\n---\n", "line shape: line 2 on the base branch"),
  both(
    "a tag",
    "name: !!str widgets\n",
    "line shape: line 1 on the base branch",
  ),
  both(
    "an override with catalog:",
    "overrides:\n  knip: catalog:\n",
    '"catalog" outside the body: line 24 here',
    "suffix",
  ),
  [
    "an override with $",
    ws(BASE),
    ws(`${BUMPED}overrides:\n  picomatch: $picomatch\n`),
    refused("file shape: a $ on line 24 here"),
  ],
  [
    "an escaped pnpmfile",
    ws(BASE),
    ws(`${BUMPED}"pnpm\\u0066ile": ./hooks.cjs\n`),
    refused("file shape: a backslash on line 23 here"),
  ],
  both(
    "configDependencies",
    "configDependencies:\n  pnpm-plugin-x: 1.0.0\n",
    "code runs at install: line 23 here names configDependencies",
    "suffix",
  ),
];

const notUtf8 = {
  bytes: Buffer.concat([Buffer.from(BASE), Buffer.from([0xff])]),
};
const executable = { text: BUMPED, executable: true } as const;

export const FILE_SHAPES_REFUSED: readonly AgreementCase[] = [
  [
    "CRLF line endings",
    ws(BASE),
    ws(BUMPED.replaceAll("\n", "\r\n")),
    refused("file shape: a carriage return on line 1 here"),
  ],
  [
    "a BOM added",
    ws(BASE),
    ws(`${char(0xfeff)}${BUMPED}`),
    refused("file shape: a byte order mark (U+FEFF) on line 1 here"),
  ],
  [
    "a final newline removed",
    ws(BASE),
    ws(BUMPED.slice(0, -1)),
    refused(
      "changed outside the catalog: the text after the catalog differs from line 23 here",
    ),
  ],
  [
    "made executable",
    ws(BASE),
    ws(BUMPED, { "pnpm-workspace.yaml": executable }),
    ["pnpm-workspace.yaml (mode changed from 100644 to 100755)"],
  ],
  [
    "replaced by a symlink",
    ws(BASE, { "w.yaml": BUMPED }),
    ws(BASE, {
      "pnpm-workspace.yaml": { symlink: "w.yaml" },
      "w.yaml": BUMPED,
    }),
    ["pnpm-workspace.yaml (not a regular file)"],
  ],
  [
    "added",
    { "package.json": ROOT },
    ws(BASE),
    ["pnpm-workspace.yaml (added)"],
  ],
  [
    "removed",
    ws(BASE),
    { "package.json": ROOT },
    ["pnpm-workspace.yaml (removed)"],
  ],
  [
    "not valid UTF-8 here",
    ws(BASE),
    ws(BASE, { "pnpm-workspace.yaml": notUtf8 }),
    ["pnpm-workspace.yaml (could not read it here: it isn't valid UTF-8)"],
  ],
  [
    "not valid UTF-8 on the base branch",
    ws(BASE, { "pnpm-workspace.yaml": notUtf8 }),
    ws(BUMPED),
    [
      "pnpm-workspace.yaml (could not read it on the base branch: it isn't valid UTF-8)",
    ],
  ],
  [
    "a folded name added beside it",
    ws(BASE),
    ws(BUMPED, { "PNPM-WORKSPACE.YAML": BASE }),
    [
      "PNPM-WORKSPACE.YAML (added)",
      ...refused(
        "folded name: PNPM-WORKSPACE.YAML here folds to pnpm-workspace.yaml",
      ),
    ],
  ],
  [
    "a copy at depth",
    ws(BASE, { "packages/a/pnpm-workspace.yaml": BASE }),
    ws(BASE, { "packages/a/pnpm-workspace.yaml": BUMPED }),
    ["packages/a/pnpm-workspace.yaml (modified)"],
  ],
];

/** A catalog bump in a repository holding `extra` on both sides. */
const beside = (
  what: string,
  extra: Files,
  findings: readonly string[],
): AgreementCase => [what, ws(BASE, extra), ws(BUMPED, extra), findings];

const manifest = (value: unknown): Files => ({
  "package.json": JSON.stringify(value),
});
const runs = (what: string) => refused(`code runs at install: ${what}`);
const unknown = (what: string) => refused(`unknown: ${what}`);
const override = (where: string, value: string) =>
  refused(
    `an override reads the catalog: ${where} in package.json here is ${JSON.stringify(value)}`,
  );

export const HEAD_FACTS_REFUSED: readonly AgreementCase[] = [
  beside(
    "a pnpmfile",
    { ".pnpmfile.cjs": "x" },
    runs("a pnpmfile here (.pnpmfile.cjs)"),
  ),
  beside(
    "a pnpmfile at depth in any case",
    { "packages/a/.PNPMFILE.CJS": "x" },
    runs("a pnpmfile here (packages/a/.PNPMFILE.CJS)"),
  ),
  beside(
    "a pnpmfile under node_modules",
    { "node_modules/x/.pnpmfile.cjs": "x" },
    runs("a pnpmfile here (node_modules/x/.pnpmfile.cjs)"),
  ),
  beside(
    "an .npmrc",
    { ".npmrc": "engine-strict=true\n" },
    runs("an .npmrc here (.npmrc)"),
  ),
  beside(
    "an .npmrc at depth in any case",
    { "packages/a/.NPMRC": "x=1\n" },
    runs("an .npmrc here (packages/a/.NPMRC)"),
  ),
  beside("a folder named .npmrc", { ".npmrc/x": "1" }, [
    ".npmrc (not a regular file)",
    ...runs("an .npmrc here (.npmrc)"),
  ]),
  beside(
    "a folded workspace name",
    { "PNPM-WORKSPACE.YAML": "x: 1\n" },
    refused(
      "folded name: PNPM-WORKSPACE.YAML here folds to pnpm-workspace.yaml",
    ),
  ),
  beside(
    "a folded manifest name",
    { "Package.json": ROOT },
    refused("folded name: Package.json here folds to package.json"),
  ),
  [
    "no root manifest",
    { "pnpm-workspace.yaml": BASE },
    { "pnpm-workspace.yaml": BUMPED },
    unknown("there is no root package.json here"),
  ],
  beside(
    "an invalid root manifest",
    { "package.json": "{ not json" },
    unknown("the root package.json here isn't valid JSON"),
  ),
  beside(
    "a root manifest that isn't UTF-8",
    { "package.json": { bytes: Buffer.from([0x7b, 0xff, 0x7d]) } },
    unknown("could not read the root package.json here: it isn't valid UTF-8"),
  ),
  beside(
    "a root manifest made a symlink",
    { "package.json": { symlink: "root.json" }, "root.json": ROOT },
    [
      ...unknown("the root package.json here isn't a regular file"),
      "package.json (not a regular file)",
    ],
  ),
  beside(
    "an override reading the catalog",
    manifest({ pnpm: { overrides: { knip: "catalog:" } } }),
    override('"pnpm" > "overrides" > "knip"', "catalog:"),
  ),
  beside(
    "an override following the root's spec",
    manifest({ pnpm: { overrides: { typescript: "$typescript" } } }),
    override('"pnpm" > "overrides" > "typescript"', "$typescript"),
  ),
  beside(
    "a config dependency in the root's pnpm field",
    manifest({ pnpm: { configDependencies: { "pnpm-plugin-x": "1.0.0" } } }),
    runs('package.json\'s "pnpm" field here sets "configDependencies"'),
  ),
];

const script = (test: string) =>
  JSON.stringify({ name: "widgets", scripts: { test } });

export const ALONGSIDE: readonly AgreementCase[] = [
  [
    "a script",
    ws(BASE),
    ws(BUMPED, { "package.json": script("node --version") }),
    ['package.json: the "test" script'],
  ],
  [
    "a workflow",
    ws(BASE, { ".github/workflows/ci.yml": "a" }),
    ws(BUMPED, { ".github/workflows/ci.yml": "b" }),
    [".github/workflows/ci.yml (modified)"],
  ],
  [
    "a new package",
    ws(BASE),
    ws(BUMPED, { "packages/b/package.json": script("node --test") }),
    ["packages/b/package.json (added, with scripts)"],
  ],
];
