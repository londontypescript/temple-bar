// temple-bar describes itself in one sentence, and that sentence appears in
// several places: the README's first line, temple-bar's npm description and
// package README, and create-temple-bar's, which name temple-bar by the same
// sentence. They drifted apart once, unnoticed, so this test reads the
// sentence from the README and fails when any copy differs. The GitHub
// About text holds it too, but it can't be read offline, so it isn't
// checked here.
//
// The same test holds the npm metadata both packages share: who wrote them
// and where their home page and issue tracker are.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative: string): string {
  return readFileSync(path.join(repoRoot, relative), "utf8").replaceAll(
    "\r\n",
    "\n",
  );
}

interface Manifest {
  readonly description?: unknown;
  readonly author?: unknown;
  readonly homepage?: unknown;
  readonly bugs?: unknown;
}

function manifest(dir: string): Manifest {
  return JSON.parse(read(`${dir}/package.json`)) as Manifest;
}

/** The README's description: its first line after the title, in bold. */
function readmeSentence(): string {
  const firstLine = read("README.md").split("\n")[2] ?? "";
  const match = /^\*\*(.+)\*\*$/.exec(firstLine);
  assert.ok(
    match?.[1] !== undefined,
    `README.md's first line after the title must be the one-line description in bold, alone on its line. It is: ${firstLine}`,
  );
  return match[1];
}

/** The quote that follows the description in the README. */
const QUOTE =
  "> A rule that exists only as prose is a rule that will eventually be violated.";

/** The sentence as a name for temple-bar ("Sets up temple-bar, the London
 * TypeScript workflow enforced on ..."): lower-case first letter, and the
 * first comma dropped, since the phrase after it now describes the name. */
function asAppositive(sentence: string): string {
  const comma = sentence.indexOf(", ");
  assert.ok(
    comma > 0,
    `the description needs a comma to name temple-bar by it: ${sentence}`,
  );
  const head = sentence.slice(0, comma);
  const tail = sentence.slice(comma + 2);
  return `${head.charAt(0).toLowerCase()}${head.slice(1)} ${tail}`;
}

void test("the README opens with the description, then the quote", () => {
  readmeSentence();
  assert.equal(
    read("README.md").split("\n")[4],
    QUOTE,
    "README.md's description must be followed, after a blank line, by the quote.",
  );
});

void test("temple-bar's npm description and package README match the README", () => {
  const sentence = readmeSentence();
  assert.equal(
    manifest("packages/temple-bar").description,
    sentence,
    "packages/temple-bar/package.json's description must be the README's first line, word for word.",
  );
  const lines = read("packages/temple-bar/README.md").split("\n");
  assert.equal(
    lines[2],
    `**${sentence}**`,
    "packages/temple-bar/README.md must open with the README's first line, in bold.",
  );
  assert.equal(
    lines[4],
    QUOTE,
    "packages/temple-bar/README.md's description must be followed by the same quote as the README.",
  );
});

void test("create-temple-bar names temple-bar by the same description", () => {
  const appositive = asAppositive(readmeSentence());
  assert.equal(
    manifest("packages/create-temple-bar").description,
    `Sets up temple-bar, ${appositive}`,
    "packages/create-temple-bar/package.json's description must be \"Sets up temple-bar, \" followed by the README's first line, lower-cased and without its first comma.",
  );
  assert.equal(
    read("packages/create-temple-bar/README.md").split("\n")[2],
    `The setup launcher for [temple-bar](https://github.com/londontypescript/temple-bar#readme), ${appositive}`,
    'packages/create-temple-bar/README.md must open with "The setup launcher for temple-bar, " followed by the same words.',
  );
});

for (const dir of ["packages/temple-bar", "packages/create-temple-bar"]) {
  void test(`${dir} names its author, home page and issue tracker`, () => {
    const { author, homepage, bugs } = manifest(dir);
    // The author is the maintainer, as a person; the links are the
    // project's own repository.
    assert.deepEqual(
      author,
      { name: "Nnsée Nain", url: "https://github.com/nnseenain" },
      `${dir}/package.json's author must be the maintainer: { "name": "Nnsée Nain", "url": "https://github.com/nnseenain" }.`,
    );
    assert.equal(
      homepage,
      "https://github.com/londontypescript/temple-bar#readme",
      `${dir}/package.json's homepage must be the repository's README.`,
    );
    assert.deepEqual(
      bugs,
      { url: "https://github.com/londontypescript/temple-bar/issues" },
      `${dir}/package.json's bugs must point at the repository's issues.`,
    );
  });
}
