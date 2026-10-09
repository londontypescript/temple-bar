import assert from "node:assert/strict";
import test from "node:test";

import { extractLocalTargets } from "./links-parse.ts";
import { findBrokenTargets } from "./links.ts";

void test("balanced destinations keep parentheses, escaped punctuation and nested labels", () => {
  const content = [
    "[nested [label]](docs/a(b(c)).md)",
    "![image](images/a\\(b\\).png)",
    '[spaced](<docs/a (b).md> "title (not a path)")',
    '[multiline](\n docs/multi.md\n "title")',
  ].join("\n");
  assert.deepEqual(extractLocalTargets(content), [
    { line: 1, target: "docs/a(b(c)).md", kind: "link" },
    { line: 2, target: "images/a(b).png", kind: "link" },
    { line: 3, target: "docs/a (b).md", kind: "link" },
    { line: 5, target: "docs/multi.md", kind: "link" },
  ]);
  const listed = [
    "docs/a(b(c)).md",
    "images/a(b).png",
    "docs/a (b).md",
    "docs/multi.md",
  ];
  assert.deepEqual(
    findBrokenTargets([{ file: "README.md", content }], listed),
    [],
  );
  assert.equal(
    findBrokenTargets([{ file: "README.md", content }], listed.slice(1))[0]
      ?.target,
    "docs/a(b(c)).md",
  );
});

void test("comments, front matter, indented examples and container fences are not links", () => {
  const content = [
    "---",
    "example: '[no](frontmatter.md)'",
    "---",
    "",
    "<!--",
    '[no](comment.md) <a href="comment.md">',
    "-->",
    "",
    "    [no](indented.md) `docs/no.md`",
    "",
    "> ```md",
    "> [no](quoted.md)",
    "> ```",
    "",
    "- ~~~md",
    "  [no](list-code.md)",
    "  ~~~",
    "",
    "Text <!-- inline --> [yes](docs/yes.md)",
    "Escaped \\[no](escaped.md) and ``[no](span.md)``.",
  ].join("\n");
  assert.deepEqual(extractLocalTargets(content), [
    { line: 19, target: "docs/yes.md", kind: "link" },
  ]);
});

void test("definitions are parsed only in definition contexts and preserve source lines", () => {
  assert.deepEqual(
    extractLocalTargets(
      [
        "[full][label] ![collapsed][] [shortcut]",
        "",
        "> [label]: docs/a(b).md",
        "",
        "[collapsed]:",
        "  <images/a b.png>",
        "",
        "[shortcut]: docs/s.md",
        "",
        "Text [fake]: fake.md",
        "",
        "    [code]: code.md",
      ].join("\n"),
    ),
    [
      { line: 3, target: "docs/a(b).md", kind: "link" },
      { line: 6, target: "images/a b.png", kind: "link" },
      { line: 8, target: "docs/s.md", kind: "link" },
    ],
  );
});

void test("HTML targets come from real attributes, including multiline quoted values", () => {
  assert.deepEqual(
    extractLocalTargets(
      [
        '<a title="example href=\'fake.md\'" href="docs/a>b.md">a</a>',
        "",
        "<img",
        ' src="images/a.png"',
        " alt='src=fake.png'>",
        "",
        '<!-- <img src="comment.png"> -->',
        "",
        '<script src="scripts/a.js">',
        'const sample = "<img src=example.png>";',
        "</script>",
        "",
        '<div data-example="href=fake.md">',
        "[not markdown here](fake.md)",
        '<a href="docs/real.md">real</a>',
        "</div>",
      ].join("\n"),
    ),
    [
      { line: 1, target: "docs/a>b.md", kind: "link" },
      { line: 4, target: "images/a.png", kind: "link" },
      { line: 9, target: "scripts/a.js", kind: "link" },
      { line: 15, target: "docs/real.md", kind: "link" },
    ],
  );
});

void test("cited paths remain blocking and directives cannot hide missing actual links", () => {
  const content =
    "<!-- markdownlint-disable -->\nRead ``docs/gone.md`` and [gone](docs/gone(a).md).";
  assert.deepEqual(
    findBrokenTargets([{ file: "README.md", content }], ["docs/kept.md"]),
    [
      {
        file: "README.md",
        line: 2,
        target: "docs/gone.md",
        kind: "cited path",
      },
      { file: "README.md", line: 2, target: "docs/gone(a).md", kind: "link" },
    ],
  );
});

void test("HTML pre contains real links; raw text elements and escaped examples do not", () => {
  const content = [
    '<pre><a href="docs/gone.md">real link</a> &lt;a href="literal.md"&gt;</pre>',
    "",
    'Text <script>"<a href=\'fake.md\'>"</script> <a href="docs/after.md">real</a>',
    "",
    'Text <style>"<a href=\'fake.md\'>"</style> <a href="docs/after.md">real</a>',
    "",
    'Text <textarea><a href="fake.md">literal</a></textarea> [real](docs/after.md)',
  ].join("\n");
  assert.deepEqual(extractLocalTargets(content), [
    { line: 1, target: "docs/gone.md", kind: "link" },
    { line: 3, target: "docs/after.md", kind: "link" },
    { line: 5, target: "docs/after.md", kind: "link" },
    { line: 7, target: "docs/after.md", kind: "link" },
  ]);
  assert.equal(
    findBrokenTargets([{ file: "README.md", content }], ["docs/after.md"])[0]
      ?.target,
    "docs/gone.md",
  );
});

void test("HTML URL boundary whitespace is trimmed while internal filename spaces remain", () => {
  assert.deepEqual(
    extractLocalTargets(
      'Text <a href=" https://example.com ">web</a> <a href=" docs/a b.md ">local</a>',
    ),
    [{ line: 1, target: "docs/a b.md", kind: "link" }],
  );
});
