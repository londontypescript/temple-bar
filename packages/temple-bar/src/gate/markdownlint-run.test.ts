import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createFakeContext, createFakeWriter } from "../testing/fakes.ts";
import { MARKDOWN_INTEGRITY_CONFIG } from "./markdown.ts";
import { runMarkdownlint } from "./markdownlint-run.ts";

async function lintDocument(
  content: string,
  files: Record<string, string> = {},
) {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-md-integrity-"));
  const stderr = createFakeWriter();
  try {
    writeFileSync(path.join(dir, "README.md"), content);
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(path.join(dir, name), text);
    }
    const code = await runMarkdownlint(
      createFakeContext({ cwd: dir, stderr }),
      ["README.md"],
      MARKDOWN_INTEGRITY_CONFIG,
    );
    return { code, stderr: stderr.lines.join("") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void test("explicit full/collapsed labels including x are mandatory; undefined shortcut prose is not", async () => {
  const result = await lintDocument(
    "[full][missing]\n\n![collapsed][]\n\n[x][x]\n\n[ordinary prose]\n",
  );
  assert.equal(
    result.code,
    1,
    "mandatory explicit-reference integrity must reject undefined labels",
  );
  for (const label of ["missing", "collapsed", "x"]) {
    assert.match(
      result.stderr,
      new RegExp(`Missing link or image reference definition: "${label}"`),
    );
  }
  assert.doesNotMatch(result.stderr, /ordinary prose/);
});

void test("lint directives and all project settings formats cannot disable mandatory references", async () => {
  const result = await lintDocument(
    "<!-- markdownlint-disable MD052 temple-bar-reference-labels -->\n\n[full][missing]\n",
    {
      ".markdownlint.json": '{"default":false}',
      ".markdownlint.jsonc": '{"MD052":false}',
      ".markdownlint.yaml": "MD052: false\n",
      ".markdownlint.mjs": 'throw new Error("must not load project config")',
    },
  );
  assert.equal(result.code, 1);
  assert.match(result.stderr, /README\.md:3.* temple-bar-reference-labels/);
  assert.doesNotMatch(result.stderr, /could not run/);
});

void test("universal style rules stay off even beside malformed or strict project settings", async () => {
  const result = await lintDocument(
    "## Title!\n\n#### Skipped\n\nhttps://example.com\n\n```\nexample\n```\n\n[text]()\n\n| One | Two |\n| --- | --- |\n| a |\n",
    {
      ".markdownlint.json": "malformed",
      ".markdownlint.jsonc": '{"default":true}',
      ".markdownlint.yaml": "MD041: true\n",
    },
  );
  assert.deepEqual(result, { code: 0, stderr: "" });
});

void test("literal code, comments and escaped explicit reference examples pass", async () => {
  assert.equal(
    (
      await lintDocument(
        "`[code][missing]`\n\n<!-- [comment][missing] -->\n\n\\[escaped][missing]\n\n    [indented][missing]\n",
      )
    ).code,
    0,
  );
});

void test("a missing document is a tooling failure, never a clean result", async () => {
  const stderr = createFakeWriter();
  const code = await runMarkdownlint(
    createFakeContext({ cwd: "/missing-repository", stderr }),
    ["README.md"],
    MARKDOWN_INTEGRITY_CONFIG,
  );
  assert.equal(code, 2);
  assert.match(stderr.lines.join(""), /markdownlint could not run/);
});

void test("resolved Unicode, container and nested references pass while multiline undefined images fail", async () => {
  const valid = await lintDocument(
    [
      "[full][SS] ![full image][SS] [outer ![nested][SS]][SS]",
      "",
      "[ß]: docs/a.md",
      "",
      "> [full][multi",
      "> label] ![multi",
      "> label][]",
      ">",
      "> [multi",
      "> label]: docs/b.md",
    ].join("\n"),
  );
  assert.deepEqual(valid, { code: 0, stderr: "" });
  const invalid = await lintDocument(
    "> ![full image][multi\n> missing]\n\n![collapsed][]\n",
  );
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /README\.md:1:3 temple-bar-reference-labels/);
  assert.match(invalid.stderr, /multi > missing/);
  assert.match(invalid.stderr, /collapsed/);
});

void test("HTML raw-text examples spanning inline tokens do not become reference findings", async () => {
  const result = await lintDocument(
    [
      "Text <script>[full][missing]</script> [prose]",
      "",
      "Text <textarea>[full][missing]</textarea> ",
      "",
      "Text <style>[full][missing]</style>",
      "",
      "<div>",
      "[literal][missing]",
      "</div>",
    ].join("\n"),
  );
  assert.deepEqual(result, { code: 0, stderr: "" });
  const afterBlock = await lintDocument(
    "<div>\n[literal][missing]\n</div>\n\n[real][undefined]\n",
  );
  assert.equal(afterBlock.code, 1);
  assert.match(afterBlock.stderr, /README\.md:5:1 temple-bar-reference-labels/);
  assert.match(afterBlock.stderr, /definition: "undefined"/);
  assert.doesNotMatch(afterBlock.stderr, /definition: "missing"/);
});

void test("reference errors after raw-text close and front matter retain their actual source position", async () => {
  const result = await lintDocument(
    [
      "---",
      "literal: '[no][missing]'",
      "---",
      "Text <script>[no][missing]</script> [yes][undefined]",
    ].join("\n"),
  );
  assert.equal(result.code, 1);
  assert.match(result.stderr, /README\.md:4:37 temple-bar-reference-labels/);
  assert.match(result.stderr, /definition: "undefined"/);
  assert.doesNotMatch(result.stderr, /definition: "missing"/);
});
