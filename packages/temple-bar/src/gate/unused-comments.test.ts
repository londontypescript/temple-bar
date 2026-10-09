import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

import { containsOnlyComments } from "./unused-comments.ts";

void test("ordinary comments and whitespace qualify; directives and every code token do not", () => {
  for (const text of [
    "",
    "\ufeff// license",
    "/* block */\r\n// line\u2028",
    "/* commented-out export const x = 1; */",
    "// line\u2029",
  ])
    assert.equal(containsOnlyComments(text), true, text);
  for (const text of [
    "/// <reference types='node' />",
    "#!node\n",
    "/* open",
    "//line\u2028export {}",
    "//line\u2029export {}",
    "/*closed*/export {}",
    '"/* string */"',
    "`//template`",
    "/regex/",
    "<!--html-->",
    "import 'x';",
    "declare const x: string;",
    "\u0085",
    ";",
  ])
    assert.equal(containsOnlyComments(text), false, text);
});

void test("accepted generated combinations contain only TypeScript scanner trivia", () => {
  const parts = [
    " ",
    "\n",
    "\r\n",
    "\t",
    "\v",
    "\f",
    "\u00a0",
    "\u2007",
    "\u202f",
    "\ufeff",
    "\u2028",
    "\u2029",
    "//line\n",
    "/*block*/",
    "//line\u2028",
    "export {}",
    '"/*literal*/"',
    "/// <reference types='node' />",
    "/*open",
    ";",
    "/",
  ];
  const trivia = new Set([
    ts.SyntaxKind.WhitespaceTrivia,
    ts.SyntaxKind.NewLineTrivia,
    ts.SyntaxKind.SingleLineCommentTrivia,
    ts.SyntaxKind.MultiLineCommentTrivia,
  ]);
  let accepted = 0;
  for (let n = 0; n < 2000; n++) {
    let text = "";
    for (let j = 0; j < 4; j++)
      text += parts[(n * (j + 3) + j * j) % parts.length] ?? "";
    if (!containsOnlyComments(text)) continue;
    accepted++;
    let errors = 0;
    const scanner = ts.createScanner(
      ts.ScriptTarget.Latest,
      false,
      ts.LanguageVariant.Standard,
      text,
      () => errors++,
    );
    for (
      let token = scanner.scan();
      token !== ts.SyntaxKind.EndOfFileToken;
      token = scanner.scan()
    )
      assert.ok(trivia.has(token), text);
    assert.equal(errors, 0, text);
  }
  assert.ok(accepted > 500);
});
