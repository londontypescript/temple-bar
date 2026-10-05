// The lockfile check exists because `pnpm install --frozen-lockfile`
// installs whatever tarball the lockfile names for temple-bar, even when
// package.json pins another version (tried with pnpm 10.34.5: a 0.0.7 pin
// whose lockfile entry named 0.0.6's tarball installed 0.0.6). These tests
// hold the check to exactly temple-bar's entries, and to failing closed on
// YAML that could hide them.

import assert from "node:assert/strict";
import test from "node:test";

import { lockfileFindings } from "./lockfile.ts";

const NAME = "@londontypescript/temple-bar";
const INTEGRITY_7 =
  "sha512-jjP8Id+dsk7p8INzGne+3ElGWSEgR/1Q//HzY8a9nXekfbLzThH/cpTdbWCGlZSknpEXCpDjtOFlASx2wcheoQ==";
const INTEGRITY_6 =
  "sha512-y+ZO+p6xqul7jKudq1vZV1VRLV1mGULvs1UnULrMKSIDjcNt66ZboutF65egWBqRGZvCqfQH8YDq7UHvaNGibg==";

/** A lockfile as pnpm 10 writes it, trimmed to what the tests need. */
function lockfile({
  resolution = `{integrity: ${INTEGRITY_7}}`,
  knip = "6.39.0",
  extra = "",
} = {}): string {
  return `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    devDependencies:
      '@londontypescript/temple-bar':
        specifier: 0.0.7
        version: 0.0.7
      eslint:
        specifier: 10.0.0
        version: 10.0.0

packages:

  '@londontypescript/temple-bar@0.0.7':
    resolution: ${resolution}
    engines: {node: '>=24'}
    hasBin: true

  eslint@10.0.0:
    resolution: {integrity: sha512-abc==}

  knip@${knip}:
    resolution: {integrity: sha512-def==}
${extra}
snapshots:

  '@londontypescript/temple-bar@0.0.7':
    dependencies:
      knip: ${knip}

  eslint@10.0.0: {}
`;
}

void test("lockfile: a change elsewhere in the lockfile is not a change to temple-bar", () => {
  const before = lockfile();
  const after = before.replace("eslint@10.0.0", "eslint@10.1.0");
  assert.deepEqual(lockfileFindings(NAME, before, after), []);
});

void test("lockfile: an entry pointed at another tarball is refused, the way pnpm would install it", () => {
  const after = lockfile({
    resolution: `{integrity: ${INTEGRITY_6}, tarball: https://registry.npmjs.org/@londontypescript/temple-bar/-/temple-bar-0.0.6.tgz}`,
  });
  assert.deepEqual(lockfileFindings(NAME, lockfile(), after), [
    "pnpm-lock.yaml: temple-bar's entries: packages > @londontypescript/temple-bar@0.0.7 (changed)",
  ]);
});

void test("lockfile: the importer's version, and temple-bar's own dependencies, count too", () => {
  const before = lockfile();
  const importer = before.replace(
    "        version: 0.0.7\n      eslint",
    "        version: link:../elsewhere\n      eslint",
  );
  assert.deepEqual(lockfileFindings(NAME, before, importer), [
    "pnpm-lock.yaml: temple-bar's entries: importers > . > devDependencies > @londontypescript/temple-bar (changed)",
  ]);
  // A new knip version changes what temple-bar runs, and its snapshot says so.
  assert.deepEqual(
    lockfileFindings(NAME, before, lockfile({ knip: "6.40.0" })),
    [
      "pnpm-lock.yaml: temple-bar's entries: snapshots > @londontypescript/temple-bar@0.0.7 (changed)",
    ],
  );
});

void test("lockfile: an added entry, a second copy of one, or a removed lockfile are all changes", () => {
  const before = lockfile();
  const patched = lockfile({
    extra: `\npatchedDependencies:\n  '@londontypescript/temple-bar@0.0.7':\n    hash: abc\n    path: patches/x.patch\n`,
  });
  assert.deepEqual(lockfileFindings(NAME, before, patched), [
    "pnpm-lock.yaml: temple-bar's entries: patchedDependencies > @londontypescript/temple-bar@0.0.7 (added)",
  ]);
  const twice = lockfile({
    extra: `\n  '@londontypescript/temple-bar@0.0.7':\n    resolution: {integrity: ${INTEGRITY_6}}\n`,
  });
  assert.deepEqual(lockfileFindings(NAME, before, twice), [
    "pnpm-lock.yaml: temple-bar's entries: packages > @londontypescript/temple-bar@0.0.7 (again) (added)",
  ]);
  assert.match(
    lockfileFindings(NAME, before, undefined).join(""),
    /importers > \. > devDependencies > @londontypescript\/temple-bar \(removed\)/,
  );
  assert.deepEqual(lockfileFindings(NAME, undefined, undefined), []);
});

void test("lockfile: YAML that could hide temple-bar's name fails closed, naming the line", () => {
  const before = lockfile();
  for (const [hiding, line] of [
    // An escape spells the name without writing it.
    [
      `  "\\x40londontypescript/temple-bar@0.0.7":\n    resolution: {integrity: x}\n`,
      31,
    ],
    // An alias repeats an entry from elsewhere.
    [`  other: *entry\n`, 31],
    // A tag, an explicit key and a flow mapping across lines.
    [`  other: !!binary abc\n`, 31],
    [`  ? other\n  : value\n`, 31],
    [`  other: {a: 1,\n    b: 2}\n`, 31],
  ] as const) {
    assert.deepEqual(
      lockfileFindings(NAME, before, lockfile({ extra: `\n${hiding}` })),
      [
        `pnpm-lock.yaml: line ${String(line)} here uses YAML pnpm doesn't write, so the judge can't tell whether it changes temple-bar's entries`,
      ],
      hiding,
    );
  }
});

void test("lockfile: a lockfile written by pnpm reads cleanly", () => {
  assert.deepEqual(lockfileFindings(NAME, lockfile(), lockfile()), []);
});
