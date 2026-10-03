// How the gate reads a project's markdownlint settings without
// markdownlint-cli2: JSON with comments, and formats it doesn't read.

import assert from "node:assert/strict";
import test from "node:test";

import {
  createFakeContext,
  createFakeFs,
  createFakeWriter,
} from "../testing/fakes.ts";
import { runMarkdownlint, stripJsonc } from "./markdownlint-run.ts";

void test("stripJsonc: comments and trailing commas go, strings stay as written", () => {
  const text = [
    "{",
    "  // turn one rule off",
    '  "heading-increment": false, /* and keep this */',
    '  "url": "http://example.com/a//b /* not a comment */",',
    '  "list": [1, 2,],',
    "}",
  ].join("\n");
  assert.deepEqual(JSON.parse(stripJsonc(text)), {
    "heading-increment": false,
    url: "http://example.com/a//b /* not a comment */",
    list: [1, 2],
  });
});

void test("a settings file in a format the gate doesn't read fails, saying where to move it", async () => {
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    fs: createFakeFs({ "/repo/.markdownlint.yaml": "MD001: false\n" }),
    stderr,
    cwd: "/repo",
  });
  assert.equal(await runMarkdownlint(ctx, ["README.md"], {}), 2);
  assert.match(
    stderr.lines.join(""),
    /reads markdownlint settings only from \.markdownlint\.jsonc or \.markdownlint\.json at the top of the repo: move the settings in \.markdownlint\.yaml there/,
  );
});
