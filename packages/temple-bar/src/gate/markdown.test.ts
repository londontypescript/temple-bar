import assert from "node:assert/strict";
import test from "node:test";

import { createFakeContext, createFakeWriter } from "../testing/fakes.ts";
import { MARKDOWN_INTEGRITY_CONFIG, runMarkdownLint } from "./markdown.ts";
import { createFakeTools } from "./testing/fake-tools.ts";

void test("markdown lint gets only the markdown files git lists, never a nested worktree", async () => {
  const tools = createFakeTools();
  const outcome = await runMarkdownLint(createFakeContext(), tools, [
    "README.md",
    "docs/notes.markdown",
    "src/index.ts",
    "nested.md/",
  ]);
  assert.deepEqual(tools.linted, [["README.md", "docs/notes.markdown"]]);
  assert.equal(outcome.status, "passed");
});

void test("markdown lint is skipped, not passed, when there is no markdown", async () => {
  const tools = createFakeTools();
  const outcome = await runMarkdownLint(createFakeContext(), tools, [
    "src/index.ts",
  ]);
  assert.deepEqual(outcome, {
    name: "markdown lint",
    status: "skipped",
    detail: "no markdown files",
  });
  assert.deepEqual(tools.linted, []);
});

void test("a markdownlint that can't run fails the check instead of passing it", async () => {
  const stderr = createFakeWriter();
  const outcome = await runMarkdownLint(
    createFakeContext({ stderr }),
    createFakeTools({ markdownlint: 2 }),
    ["README.md"],
  );
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.detail, "could not run (exit 2)");
  assert.match(stderr.lines.join(""), /markdown lint could not run/);
});

void test("the fixed config enables only explicit undefined reference labels", () => {
  assert.deepEqual(MARKDOWN_INTEGRITY_CONFIG, {
    default: false,
    "temple-bar-reference-labels": true,
  });
});
