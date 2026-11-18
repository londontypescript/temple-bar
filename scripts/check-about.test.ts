import assert from "node:assert/strict";
import { test } from "node:test";

import { aboutProblem, readmeDescription } from "./check-about.ts";

const BAND = [
  "<p>",
  "  <picture>",
  '    <source media="(prefers-color-scheme: dark)" srcset="dark.svg">',
  '    <img alt="Band" src="light.svg" width="100%">',
  "  </picture>",
  "</p>",
].join("\n");

const README = `${BAND}\n\nOne line about it. More about it, which isn't the description.\n\n## Why\n\n> A quote.\n`;

void test("reads the first sentence of the paragraph under the band", () => {
  assert.equal(readmeDescription(README), "One line about it.");
  assert.equal(
    readmeDescription(README.replaceAll("\n", "\r\n")),
    "One line about it.",
  );
});

void test("the band is optional, and a paragraph's lines join into one", () => {
  assert.equal(
    readmeDescription("One line,\nwrapped about it. Then more.\n"),
    "One line, wrapped about it.",
  );
});

void test("a full stop inside a word doesn't end the sentence", () => {
  assert.equal(
    readmeDescription(`${BAND}\n\nRuns on Node.js and pnpm. Then more.\n`),
    "Runs on Node.js and pnpm.",
  );
});

void test("a README that opens with anything but a plain paragraph has no description", () => {
  for (const readme of [
    "# temple-bar\n\nOne line about it.\n",
    `${BAND}\n\n# temple-bar\n\nOne line about it.\n`,
    `${BAND}\n\n> One line about it.\n`,
    `${BAND}\n\n**One line about it.**\n`,
    "<p>\n  <img src='x.svg'>\n</p>\n\nOne line about it.\n",
    "<p>\n  <picture>\n\nOne line about it.\n",
    `${BAND}\n\nNo full stop at all\n`,
    `${BAND}\n`,
  ]) {
    assert.equal(readmeDescription(readme), undefined, readme);
  }
});

void test("an About text equal to the README's sentence passes", () => {
  assert.equal(aboutProblem(README, "One line about it."), undefined);
});

void test("a different or missing About text fails, showing both", () => {
  const problem = aboutProblem(README, "An older line.") ?? "";
  assert.match(problem, /About text differs/);
  assert.match(problem, /About: {2}An older line\./);
  assert.match(problem, /README: One line about it\./);
  assert.match(aboutProblem(README, null) ?? "", /About: {2}\(none\)/);
  assert.match(
    aboutProblem(README, "One line about it") ?? "",
    /About text differs/,
  );
});

void test("a README without an opening paragraph fails rather than passing", () => {
  assert.match(
    aboutProblem("# temple-bar\n\nPlain.\n", "Plain.") ?? "",
    /nothing to compare/,
  );
});
