import assert from "node:assert/strict";
import test from "node:test";

import type { PullRequest } from "./github.ts";
import {
  checkOneConcern,
  hasOneConcernLine,
  oneConcernVerdict,
} from "./one-concern.ts";

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

void test("oneConcernVerdict needs the line for size or several issues alone", () => {
  const over = ["612 lines of source changed, limit 500"];
  assert.equal(oneConcernVerdict("Fixes #1.", ["#1"], []), "not needed");
  assert.equal(oneConcernVerdict("", ["#1", "#2"], []), "missing");
  assert.equal(oneConcernVerdict("", [], over), "missing");
  assert.equal(oneConcernVerdict("One concern: a rename.", [], over), "given");
  assert.equal(
    oneConcernVerdict("One concern: <!-- say why -->", ["#1", "#2"], []),
    "missing",
  );
});

void test("checkOneConcern refuses an oversized pull request without the line, naming each limit", () => {
  assert.throws(() => {
    checkOneConcern(pullRequest("Fixes #1."), REPOSITORY, [
      "612 lines of source changed, limit 500",
      "16 files touched, limit 15",
    ]);
  }, /^MergeRefusal: pull request #7 is over the size limits \(612 lines of source changed, limit 500; 16 files touched, limit 15\) but its description has no `One concern:` line\. Add a line to the description starting `One concern:` that says why it is a single change \(see AGENTS\.md section 2/);
});

void test("checkOneConcern names both reasons when a pull request is oversized and closes several issues", () => {
  assert.throws(() => {
    checkOneConcern(pullRequest("Fixes #1 and fixes #2."), REPOSITORY, [
      "16 files touched, limit 15",
    ]);
  }, /is over the size limits \(16 files touched, limit 15\) and closes 2 issues \(#1, #2\) but its description/);
});

void test("checkOneConcern lets an oversized pull request with the line through", () => {
  checkOneConcern(
    pullRequest("Fixes #1.\n\nOne concern: one rename across every file."),
    REPOSITORY,
    ["16 files touched, limit 15"],
  );
});
