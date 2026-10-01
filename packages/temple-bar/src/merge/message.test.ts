import assert from "node:assert/strict";
import test from "node:test";

import { createFakeContext, createFakeGit } from "../testing/fakes.ts";
import {
  buildSquashMessage,
  readCoAuthors,
  topLevelBullets,
} from "./message.ts";

void test("takes only top-level bullets, joining a wrapped bullet's lines", () => {
  const body = [
    "Intro paragraph.",
    "",
    "- first change",
    "  that wraps",
    "  - a nested detail",
    "- second change",
    "",
    "* a star bullet is not a top-level dash bullet",
    "<!-- - a template example -->",
    "```",
    "- inside code",
    "```",
    "- third change",
    "",
    "🤖 Generated with a tool",
  ].join("\n");
  assert.deepEqual(topLevelBullets(body), [
    "first change that wraps",
    "second change",
    "third change",
  ]);
});

void test("the squash message is the title with the number, the bullets, then co-authors", () => {
  const message = buildSquashMessage(
    { number: 12, title: " fix(gate): x ", body: "- one\r\n- two\r\n" },
    ["Ada <ada@example.com>"],
  );
  assert.equal(message.subject, "fix(gate): x (#12)");
  assert.equal(
    message.body,
    "- one\n- two\n\nCo-Authored-By: Ada <ada@example.com>",
  );
});

void test("co-authors are listed once each, compared without case, in first-seen order", async () => {
  const git = createFakeGit(() => ({
    code: 0,
    stdout:
      "Bob <bob@example.com>\n\nAda <ada@example.com>\nbob  <BOB@example.com>\n\n",
    stderr: "",
  }));
  const authors = await readCoAuthors(
    createFakeContext({ git }),
    "origin/main..HEAD",
    "/repo",
  );
  assert.deepEqual(authors, ["Bob <bob@example.com>", "Ada <ada@example.com>"]);
  assert.deepEqual(git.calls[0]?.args, [
    "log",
    "--reverse",
    "--format=%(trailers:key=Co-authored-by,valueonly)",
    "origin/main..HEAD",
  ]);
});
