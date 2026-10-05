import assert from "node:assert/strict";
import test from "node:test";

import type { PullRequest } from "./github.ts";
import { checkOneConcern, hasOneConcernLine } from "./one-concern.ts";

const REPOSITORY = "acme/widgets";

function pullRequest(body: string): PullRequest {
  return {
    number: 7,
    title: "fix: one change",
    body,
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "fix/x",
    headRefOid: "abc",
    isCrossRepository: false,
  };
}

void test("a plain, bulleted, bold or quoted One concern line counts", () => {
  for (const line of [
    "One concern: same cause.",
    "one concern: same cause.",
    "- One concern: same cause.",
    "**One concern:** same cause.",
    "**One concern**: same cause.",
    "- **One concern:** same cause.",
    "> One concern: same cause.",
    "One concern: both touch `size.ts`",
  ]) {
    assert.equal(hasOneConcernLine(`Intro.\n\n${line}\n`), true, line);
  }
});

void test("a One concern line with no reason does not count", () => {
  for (const line of [
    "One concern:",
    "One concern:   ",
    "**One concern:**",
    "- **One concern**:  ",
    "One concern: <!-- say why -->",
  ]) {
    assert.equal(hasOneConcernLine(`Intro.\n\n${line}\n`), false, line);
  }
});

void test("a One concern line inside a comment or code does not count", () => {
  for (const body of [
    "<!-- One concern: same cause. -->",
    "<!--\nOne concern: same cause.\n-->",
    "```\nOne concern: same cause.\n```",
    "~~~md\nOne concern: same cause.\n~~~",
    "Intro.\n\n    One concern: same cause.",
    "`One concern: same cause.`",
    "Notes <!-- unclosed\n\nOne concern: same cause.",
  ]) {
    assert.equal(hasOneConcernLine(body), false, body);
  }
});

void test("the line counts again once a comment or fence has closed", () => {
  assert.equal(
    hasOneConcernLine("<!-- why -->\n```\ncode\n```\nOne concern: same cause."),
    true,
  );
});

void test("checkOneConcern refuses two closed issues without the line", () => {
  assert.throws(() => {
    checkOneConcern(
      pullRequest(
        "Fixes #1\nFixes https://github.com/acme/widgets/issues/2\n<!-- One concern: why -->",
      ),
      REPOSITORY,
    );
  }, /closes 2 issues \(#1, #2\) but its description has no `One concern:` line/);
});

void test("checkOneConcern allows two closed issues with a bulleted line", () => {
  checkOneConcern(
    pullRequest("Fixes #1 and fixes #2.\n\n- One concern: same cause.\n"),
    REPOSITORY,
  );
});

void test("checkOneConcern counts one issue written two ways as one", () => {
  checkOneConcern(
    pullRequest("Fixes #5, and fixes acme/widgets#5 too."),
    REPOSITORY,
  );
});

void test("checkOneConcern ignores references GitHub doesn't read", () => {
  checkOneConcern(
    pullRequest(
      "Fixes #1.\n\n~~~\nFixes #2\n~~~\n\nExample: `Fixes #3`\n\n    Fixes #4\n",
    ),
    REPOSITORY,
  );
});
