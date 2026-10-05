import assert from "node:assert/strict";
import { test } from "node:test";

import { aboutProblem, readmeDescription } from "./check-about.ts";

const README = "# temple-bar\n\n**One line about it.**\n\n> A quote.\n";

void test("reads the README's bold first line as the description", () => {
  assert.equal(readmeDescription(README), "One line about it.");
  assert.equal(
    readmeDescription(README.replaceAll("\n", "\r\n")),
    "One line about it.",
  );
  assert.equal(readmeDescription("# temple-bar\n\nNot bold.\n"), undefined);
});

void test("an About text equal to the README's line passes", () => {
  assert.equal(aboutProblem(README, "One line about it."), undefined);
});

void test("a different or missing About text fails, showing both", () => {
  const problem = aboutProblem(README, "An older line.") ?? "";
  assert.match(problem, /About text differs/);
  assert.match(problem, /About: {2}An older line\./);
  assert.match(problem, /README: One line about it\./);
  assert.match(aboutProblem(README, null) ?? "", /About: {2}\(none\)/);
});

void test("a README without the bold line fails rather than passing", () => {
  assert.match(
    aboutProblem("# temple-bar\n\nPlain.\n", "Plain.") ?? "",
    /nothing to compare/,
  );
});
