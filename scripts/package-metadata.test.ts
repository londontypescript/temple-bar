// temple-bar describes itself in one sentence, and that sentence appears in
// several places: the first sentence of the README, temple-bar's npm description and
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

import { readmeDescription } from "./check-about.ts";

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

/** The README's description: the first sentence of the paragraph it opens
 * with, under the header band. check-about.ts reads it the same way, so the
 * About text and these copies are compared with one sentence. */
function readmeSentence(): string {
  const sentence = readmeDescription(read("README.md"));
  assert.ok(
    sentence !== undefined,
    "README.md must open with a plain paragraph, after the header band and with no title, whose first sentence is the one-line description.",
  );
  return sentence;
}

/** The quote that follows the opening paragraph in the README, and the
 * description in temple-bar's package README. */
const QUOTE =
  "> A rule that exists only as prose is a rule that will eventually be violated.";

/** How the description starts: it names the project, then says what it is. */
const SUBJECT = "Temple Bar is ";

/** The sentence as a name for temple-bar ("Sets up temple-bar, the London
 * TypeScript workflow enforced on ..."): without "Temple Bar is ", and the
 * first comma dropped, since the phrase after it now describes the name. */
function asAppositive(sentence: string): string {
  assert.ok(
    sentence.startsWith(SUBJECT),
    `the description must start with "${SUBJECT}" to name temple-bar by the rest of it: ${sentence}`,
  );
  const rest = sentence.slice(SUBJECT.length);
  const comma = rest.indexOf(", ");
  assert.ok(
    comma > 0,
    `the description needs a comma to name temple-bar by it: ${sentence}`,
  );
  return `${rest.slice(0, comma)} ${rest.slice(comma + 2)}`;
}

void test("the README opens with the description, then the quote", () => {
  const sentence = readmeSentence();
  const lines = read("README.md").split("\n");
  // The opening paragraph runs from the line the description starts on to
  // the first blank line after it.
  const start = lines.findIndex((line) => line.startsWith(sentence));
  const end = lines.indexOf("", start);
  assert.deepEqual(
    start >= 0 && end > start ? lines.slice(end, end + 3) : [],
    ["", QUOTE, ""],
    `README.md's opening paragraph must be followed, after a blank line, by the quote on its own: ${QUOTE}`,
  );
});

void test("temple-bar's npm description and package README match the README", () => {
  const sentence = readmeSentence();
  assert.equal(
    manifest("packages/temple-bar").description,
    sentence,
    "packages/temple-bar/package.json's description must be the README's first sentence, word for word.",
  );
  const lines = read("packages/temple-bar/README.md").split("\n");
  assert.equal(
    lines[2],
    `**${sentence}**`,
    "packages/temple-bar/README.md must open with the README's first sentence, in bold.",
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
    'packages/create-temple-bar/package.json\'s description must be "Sets up temple-bar, " followed by the README\'s first sentence, without its opening "Temple Bar is " or its first comma.',
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
