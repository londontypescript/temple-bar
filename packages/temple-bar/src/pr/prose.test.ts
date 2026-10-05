import assert from "node:assert/strict";
import test from "node:test";

import { CODE_SPAN, proseLines } from "./prose.ts";

void test("proseLines keeps one line per input line", () => {
  assert.deepEqual(proseLines("a\r\nb\n\nc"), ["a", "b", "", "c"]);
});

void test("a fence closes only on a run of its own marker at least as long", () => {
  assert.deepEqual(proseLines("````\n```\n~~~~\nhidden\n````\nshown"), [
    "",
    "",
    "",
    "",
    "",
    "shown",
  ]);
});

void test("an unclosed fence hides the rest", () => {
  assert.deepEqual(proseLines("a\n~~~\nb\nc"), ["a", "", "", ""]);
});

void test("a comment never joins the words either side of it", () => {
  assert.deepEqual(proseLines("Clo<!-- x -->ses #1"), ["Clo ses #1"]);
});

void test("a multi-line comment hides its lines and keeps what follows it", () => {
  assert.deepEqual(proseLines("<!--\nhidden\n--> shown"), ["", "", "  shown"]);
});

void test("comment markers inside a code span are code, not a comment", () => {
  assert.deepEqual(proseLines("`<!--` then text\nnext"), [
    `${CODE_SPAN} then text`,
    "next",
  ]);
});

void test("an unmatched backtick run is literal text", () => {
  assert.deepEqual(proseLines("a ``b` c"), ["a ``b` c"]);
});

void test("indented lines are code after a blank line, but not in a list or a paragraph", () => {
  assert.deepEqual(
    proseLines(
      [
        "para",
        "    lazy continuation",
        "",
        "    code",
        "",
        "    more code",
        "back",
        "- item",
        "",
        "    item continued",
        "",
        "Paragraph ends the list.",
        "",
        "\tcode again",
      ].join("\n"),
    ),
    [
      "para",
      "    lazy continuation",
      "",
      "",
      "",
      "",
      "back",
      "- item",
      "",
      "    item continued",
      "",
      "Paragraph ends the list.",
      "",
      "",
    ],
  );
});
