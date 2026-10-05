import assert from "node:assert/strict";
import test from "node:test";

import {
  createFakeContext,
  createFakeFs,
  createFakeGh,
} from "../testing/fakes.ts";
import { findClosingIssues, readPullRequestText } from "./closing-issues.ts";

void test("findClosingIssues reads GitHub's closing keywords, once per issue", () => {
  assert.deepEqual(
    findClosingIssues([
      "fix(hooks): protect main",
      "Closes #101, fixes #104.\nResolved: #125\nCloses #101 again",
    ]),
    ["#101", "#104", "#125"],
  );
});

void test("findClosingIssues keeps cross-repo references distinct", () => {
  assert.deepEqual(findClosingIssues(["Fixes a/b#7 and closes #7"]), [
    "a/b#7",
    "#7",
  ]);
});

void test("findClosingIssues ignores bare mentions, parenthesised numbers, comments and code", () => {
  assert.deepEqual(
    findClosingIssues([
      "fix(init): default branch (#102, #118)",
      "See #5. Relates to #6.\n<!-- Closes #7 -->\n```\nCloses #8\n```\nprefix #9",
    ]),
    [],
  );
});

void test("findClosingIssues reads around comments, and an unclosed comment hides the rest", () => {
  assert.deepEqual(
    findClosingIssues([
      "Closes #1 <!-- Closes #2 --> Closes #3\n<!-- Closes #4",
    ]),
    ["#1", "#3"],
  );
});

void test("findClosingIssues reads an issue's full URL", () => {
  assert.deepEqual(
    findClosingIssues([
      "Fixes https://github.com/o/r/issues/2 and closes https://github.com/o/r/pull/3",
    ]),
    ["o/r#2"],
  );
});

void test("findClosingIssues counts an issue in its own repository once, however written", () => {
  assert.deepEqual(
    findClosingIssues(
      [
        "Fixes #5",
        "Closes O/R#5, fixes https://github.com/o/r/issues/5 and fixes x/y#5",
      ],
      "o/r",
    ),
    ["#5", "x/y#5"],
  );
});

void test("findClosingIssues skips ~~~ fences, code spans and indented code", () => {
  assert.deepEqual(
    findClosingIssues([
      "~~~\nCloses #1\n~~~\nUse `Closes #2` or ``Closes #3``.\n\n    Closes #4\n\nCloses #5",
    ]),
    ["#5"],
  );
});

void test("readPullRequestText prefers the Actions event payload and needs no gh", async () => {
  const gh = createFakeGh();
  const ctx = createFakeContext({
    gh,
    env: { GITHUB_EVENT_PATH: "/event.json" },
    fs: createFakeFs({
      "/event.json": JSON.stringify({
        pull_request: { title: "T", body: null },
      }),
    }),
  });
  assert.deepEqual(await readPullRequestText(ctx), { title: "T", body: "" });
  assert.equal(gh.calls.length, 0);
});

void test("readPullRequestText reads the repository from the event's pull request URL", async () => {
  const ctx = createFakeContext({
    env: { GITHUB_EVENT_PATH: "/event.json" },
    fs: createFakeFs({
      "/event.json": JSON.stringify({
        pull_request: {
          title: "T",
          body: "B",
          html_url: "https://github.com/o/r/pull/3",
        },
      }),
    }),
  });
  assert.deepEqual(await readPullRequestText(ctx), {
    title: "T",
    body: "B",
    repository: "o/r",
  });
});

void test("readPullRequestText falls back to gh, and for a given number asks for that pull request", async () => {
  const gh = createFakeGh(() => ({
    code: 0,
    stdout: JSON.stringify({
      title: "T",
      body: "Closes #1",
      url: "https://github.com/o/r/pull/12",
    }),
    stderr: "",
    notFound: false,
  }));
  const ctx = createFakeContext({ gh });
  assert.deepEqual(await readPullRequestText(ctx, "12"), {
    title: "T",
    body: "Closes #1",
    repository: "o/r",
  });
  assert.deepEqual(gh.calls[0]?.args, [
    "pr",
    "view",
    "12",
    "--json",
    "title,body,url",
  ]);
});

void test("readPullRequestText is undefined when gh has no pull request", async () => {
  const ctx = createFakeContext({
    gh: createFakeGh(() => ({
      code: 1,
      stdout: "",
      stderr: "no pull requests found",
      notFound: false,
    })),
  });
  assert.equal(await readPullRequestText(ctx), undefined);
});
