// The test-shapes check on one file's code. The first tests are the example
// table approved for #512, row by row with its verdict; every example is
// held as a string, never as a real test file, so this repository's own
// gate never reads one as code.

import assert from "node:assert/strict";
import test from "node:test";

import { findShapes } from "./test-shapes-code.ts";
import { check, P, PARSERS, R, U } from "./testing/shape-rows.ts";

void test("shape 1: a replace that deletes markup tags is refused", () => {
  check([
    ["1.1", "html.replace(/<[^>]+>/g, '')", R],
    ["1.2", 'html.replaceAll(/<[^>]*>/g, "")', R],
    ["1.3", "html.replace(/<[^>]+>/g, ' ')", R],
    ["1.4", "html.replace(/<\\/?[a-z][^>]*>/gi, '')", R],
    ["1.5", "html.replace(/<.*?>/g, '')", R],
    ["1.6", "html.replace(/<br\\s*\\/?>/g, '\\n')", R],
    ["1.7", "html.replace(/<b>(.*?)<\\/b>/g, '$1')", R],
    ["1.8", "html.replace(/\\x3c[^>]+>/g, '')", R],
    ["1.8", "html.replace(/\\u{3c}[^>]+>/gu, '')", R],
    ["1.9", "html.replace(/[<][^>]+>/g, '')", R],
    ["1.9", "html.replace(/[<-<]b>/g, '')", R],
    ["1.9", "html.replace(/[[<]]b>/gv, '')", R],
    ["1.9", "html.replace(/[[<]&&[<]]b>/gv, '')", R],
    ["1.9", "html.replace(/[[<]--[a]]b>/gv, '')", R],
    ["1.9", "html.replace(/[\\q{<}]b>/gv, '')", R],
    ["1.10", "html.replace(/<[^>]+>/, '')", R],
    ["1.11", "html.replace(new RegExp('<[^>]+>', 'g'), '')", R],
    [
      "1.12",
      "const TAG = /<[^>]+>/g;\nfunction f(html: string) { return html.replace(TAG, ''); }",
      R,
    ],
    ["1.13", "const EMPTY = '';\nhtml.replace(/<[^>]+>/g, EMPTY);", R],
    ["1.14", "html.replace(/<[^>]+>/g, () => '')", R],
    ["1.15", "html?.replace(/<[^>]+>/g, '')", R],
    ["1.15", "html['replace'](/<[^>]+>/g, '')", R],
    ["1.16", "html.replace(/<!--.*?-->/gs, '')", R],
    ["1.16", "html.replace(/<!-- -->/g, '')", R],
    [
      "1.17",
      "html.replace(new RegExp(`<${RegExp.escape(tag)}[^>]*>`, 'g'), '')",
      R,
    ],
    ["1.18", "html.replace(/<!DOCTYPE[^>]*>/i, '')", R],
    ["1.19", "html.replace(/\\s*<br>\\s*/g, '')", R],
    ["1.20", "html.replace(/<(?:b|i)>/g, '')", R],
    ["1.21", "const SEP = ' ';\nhtml.replace(/<[^>]+>/g, flag ? '' : SEP);", R],
    ["1.21", "html.replace(/<b>/g, flag ? () => '' : 'kept')", R],
    ["1.22", "html.replace(/<[^>]+>/g, '' as string)", R],
    [
      "1.23",
      "const TAG = new RegExp('<[^>]+>', 'g');\nhtml.replace(TAG, '');",
      R,
    ],
    ["1.24", "html.replace(/<[^>]+>/g, ``)", R],
    ["1.25", "html.replace(new RegExp(/<[^>]+>/, 'g'), '')", R],
    ["1.26", "html.replace(new RegExp('<[^>]+>', flags), '')", R],
    ["1.27", "html.replace(flag ? /<b>/g : /<i>/g, '')", R],
    [
      "1.28",
      "html.replace(new RegExp(parts.map(RegExp.escape).join('<br>'), 'g'), '')",
      R,
    ],
    ["1.29", "html.replace(new RegExp('<\\u212A>', flags), '')", R],
    ["1.30", "const a = RegExp('<b>', 'g');\nhtml.replace(a, '');", R],
    ["1.31", "(html.replace as Replace)(/<b>/g, '')", R],
    ["1.32", "template.replace(/<VERSION>/g, '')", R],
    ["1.33", "text.replace(/<(?![A-Za-z/!])[^>]+>/g, '')", R],
    ["1.33", "text.replace(/([0-9])<\\1>/g, '')", R],
    ["1.34", "html.replace(/<b>(?<t>.*?)<\\/b>/g, '$<t>')", R],
    ["1.35", "html.replace(/(?:(<b>)|<i>)/g, '$1')", R],
    [
      "1.36",
      "html.replace(new RegExp(`<[a--[${RegExp.escape(x)}]]>`, 'gv'), '')",
      R,
    ],
    ["1.37", "html.replace(/(<b>)|(<i>)/g, '$1$2')", R],
    [
      "1.38",
      "html.replace(new RegExp(`<[^A-Za-z/!${RegExp.escape(x)}]>`, 'g'), '')",
      R,
    ],
  ]);
});

void test("shape 1: encoding, matching and other shapes pass", () => {
  check([
    ["1.p1", "text.replace(/</g, '&lt;')", P],
    ["1.p2", "text.replace(/[<>&]/g, (c) => entities[c])", P],
    ["1.p3", "html.replace(/>\\s+</g, '><')", P],
    ["1.p4", "svg.replace(/^<\\?xml[^>]*>\\n/, '')", P],
    ["1.p5", "s.replace(/(?<=<)b/g, 'strong')", P],
    ["1.p6", "s.replace(/(?<word>\\w+)/g, '$<word>')", P],
    ["1.p7", "html.replace(/<b>/g, '<strong>')", P],
    ["1.p8", "template.replace(/<VERSION>/g, version)", P],
    ["1.p13", "expect(html).toMatch(/<h1>Title<\\/h1>/)", P],
    ["1.p14", "s.replace(/<=/g, '≤').replace(/< /g, '')", P],
    ["1.p18", "text.replace(/[^\\w]+/g, '-')", P],
    ["1.p19", "text.replace(/<\\d+>/g, '')", P],
    [
      "1.p20",
      "const TAG = /<[^>]+>/g;\nfunction f(TAG: RegExp) { return html.replace(TAG, ''); }",
      P,
    ],
    ["1.p21", "html.replace(/\\s+/g, ' ')", P],
    ["1.p22", "html.replace(/<(?=[a-z])/g, '')", P],
    ["1.p23", "router.replace('/home')", P],
    ["1.p24", "out.replace(new RegExp(RegExp.escape(tmp) + '/', 'g'), '')", P],
    ["1.p25", "html.replace(/(<b>)/g, '$1')", P],
    ["1.p26", "html.replace(/<b>/g, () => '$1')", P],
    ["1.p26", "html.replace(/<b>/g, async () => '')", P],
    ["1.p26", "html.replace(/<b>/g, flag ? () => '$1' : '<i>')", P],
    [
      "1.p27",
      "text.replace(new RegExp('[a-' + RegExp.escape(end) + ']', 'g'), '')",
      P,
    ],
  ]);
});

void test("shape 1: the known gaps pass on purpose", () => {
  check([
    ["1.p9", "import { TAG } from './tags';\nhtml.replace(TAG, '');", P],
    ["1.p10", "html.replaceAll('<b>', '')", P],
    ["1.p11", "html.split(/<[^>]+>/).join('')", P],
    ["1.p12", "String.prototype.replace.call(html, /<[^>]+>/g, '')", P],
    ["1.p15", "html.replace(/<[^>]+>/g, (tag) => tag.toLowerCase())", P],
    [
      "1.p16",
      "function strip(html: string, sep: string) { return html.replace(/<[^>]+>/g, sep); }",
      P,
    ],
    ["1.p17", "let TAG = /<[^>]+>/g;\nhtml.replace(TAG, '');", P],
    [
      "1.p28",
      "const tag = /safe/g;\ntag.compile('<b>', 'g');\nhtml.replace(tag, '');",
      P,
    ],
    [
      "1.p29",
      "const parts = { map: () => [text] };\nhtml.replace(new RegExp(parts.map(RegExp.escape).join(''), 'g'), '');",
      P,
    ],
  ]);
});

void test("shape 2: a RegExp from a value the check can't prove escaped is refused", () => {
  check([
    ["2.1", "function f(name: string) { return new RegExp(name); }", R],
    ["2.2", "new RegExp(`^${name}$`)", R],
    ["2.3", "RegExp('^' + name)", R],
    ["2.4", "new RegExp(path.replaceAll('.', '\\\\.'))", R],
    ["2.5", "new RegExp(MESSAGE.slice(0, 40))", R],
    ["2.6", "new RegExp(WORDS.join('|'))", R],
    ["2.7", "new RegExp(`${String.fromCharCode(27)}\\\\[[0-9;]*m`, 'g')", R],
    ["2.8", "new RegExp(escapeRegExp(name))", R],
    ["2.9", "new globalThis.RegExp(name)", R],
    ["2.10", "new RegExp(dedent`^${x}$`)", R],
    ["2.11", "let p = 'a.b';\nnew RegExp(p);", R],
    ["2.12", "import { PATTERN } from './x';\nnew RegExp(PATTERN);", R],
    ["2.13", "new RegExp(RegExp.escape(glob).replaceAll('\\\\*', '.*'))", R],
    ["2.14", "new RegExp(cond ? name : 'b')", R],
    ["2.15", "new RegExp(name as string)", R],
    ["2.16", "for (const name of ['a', 'b']) new RegExp(`^${name}`);", R],
    [
      "2.17",
      "const p = 'x';\nfunction f(p: string) { return new RegExp(p); }",
      R,
    ],
    [
      "2.18",
      "function f(re: RegExp) { return new RegExp(re.source, 'g'); }",
      R,
    ],
    ["2.19", "(RegExp as RegExpConstructor)(name)", R],
    ["2.19", "(0, RegExp)(name)", R],
    [
      "2.20",
      "const RegExp = { escape: (x: string) => x };\nnew globalThis.RegExp(RegExp.escape(name));",
      R,
    ],
    [
      "2.21",
      "function globalMatcher(re: RegExp) { return new RegExp(re, 'g'); }",
      R,
    ],
    [
      "2.22",
      "String = { raw: () => input };\nnew RegExp(String.raw`safe`);",
      R,
      "a.test.js",
    ],
    [
      "2.23",
      "const p = 'safe';\nfunction f() { { function p() {} } return new RegExp(p); }",
      R,
      "a.test.js",
    ],
  ]);
});

void test("shape 2: literals, escaped text and local constants pass", () => {
  check([
    ["2.p1", "new RegExp('^v\\\\d+$')", P],
    ["2.p2", "new RegExp(`^${RegExp.escape(name)}$`, 'm')", P],
    ["2.p3", "new RegExp('^' + RegExp.escape(name) + '$')", P],
    [
      "2.p4",
      "const SEMVER = '\\\\d+\\\\.\\\\d+';\nnew RegExp(`^v${SEMVER}$`);",
      P,
    ],
    ["2.p5", "new RegExp(/a+/, 'g')", P],
    ["2.p6", "const BASE = /^v\\d+/;\nnew RegExp(BASE.source + '$');", P],
    ["2.p7", "new RegExp(names.map(RegExp.escape).join('|'))", P],
    ["2.p7", "new RegExp(names.map(RegExp.escape).join(flag ? '|' : ','))", P],
    ["2.p8", "new RegExp(names.map((n) => RegExp.escape(n)).join('|'))", P],
    ["2.p9", "new RegExp(String.raw`\\d+\\.\\d+`)", P],
    ["2.p10", "new RegExp()", P],
    ["2.p11", "new RegExp(isWin ? '\\\\\\\\' : '/')", P],
    ["2.p12", "const R2 = RegExp;\nnew R2(name);", P],
    ["2.p13", "new RegExp(`a${RegExp.escape(x)}b`, flags)", P],
    [
      "2.p14",
      "it('x', () => { const p = 'a'; expect(s).toMatch(new RegExp(p)); });\nit('y', () => { const p = 'b'; expect(s).toMatch(new RegExp(p)); });",
      P,
    ],
    ["2.p15", "expect(() => new RegExp('(')).toThrow()", P],
    [
      "2.p16",
      "import x from 'y';\nconst p = 'safe';\n{ function p() {} }\nnew RegExp(p);",
      P,
    ],
  ]);
});

void test("files: every JS and TS form parses, and what can't be read is reported", () => {
  check([
    ["f.1", "const x = ;", U],
    [
      "f.2",
      "const el = <div>{html.replace(/<[^>]+>/g, '')}</div>;",
      R,
      "a.test.js",
    ],
    ["f.3", "const f = <T,>(x: T) => x;", P, "a.test.tsx"],
    ["f.3", "const f = <T>(x: T) => x;", P, "a.test.ts"],
    ["f.5", "html.replace(/(?<a>x)|(?<a>y)<b/g, '')", R],
    ["f.5", "html.replace(/(?i:<B)/g, '')", R],
    ["f.6", "html.replace(/(/g, '')", U],
    [
      "f.12",
      "if (process.platform !== 'win32') return;\nhtml.replace(/<b>/g, '');",
      R,
      "a.test.js",
    ],
    ["f.12", "await setup();\nhtml.replace(/<b>/g, '');", R, "a.test.js"],
    ["f.12", "if (skip) return;", U, "a.test.mjs"],
  ]);
});

void test("files: a byte-order mark, a hashbang and CRLF lines keep the right line", () => {
  const findings = findShapes(
    "a.test.mjs",
    "\u{FEFF}#!/usr/bin/env node\r\nconst s = 'é😀';\r\nhtml.replace(/<[^>]+>/g, '');\r\n",
    PARSERS,
  );
  assert.deepEqual(findings, [{ kind: "deletes-tags", line: 3 }]);
});

void test("files: an unparseable file reports the module error's line and reason", () => {
  const [finding] = findShapes("a.test.ts", "ok();\nconst x = ;\n", PARSERS);
  if (finding?.kind !== "unparseable") assert.fail(JSON.stringify(finding));
  assert.equal(finding.line, 2);
  assert.match(finding.reason, /\S/);
});

void test("files: lines count every JavaScript line terminator, CRLF once", () => {
  const findings = findShapes(
    "a.test.ts",
    "a();\rb();\u2028c();\u2029d();\r\nhtml.replace(/<b>/g, '');",
    PARSERS,
  );
  assert.deepEqual(findings, [{ kind: "deletes-tags", line: 5 }]);
});

void test("patterns: only a syntax error lets a reading pass; anything else the pattern parser throws fails the check", () => {
  const throwing = {
    ...PARSERS,
    createPatternParser: () =>
      ({
        parsePattern: () => {
          throw new RangeError("Maximum call stack size exceeded");
        },
      }) as unknown as ReturnType<typeof PARSERS.createPatternParser>,
  };
  assert.throws(
    () =>
      findShapes(
        "a.test.ts",
        "html.replace(new RegExp(`<${RegExp.escape(x)}>`), '')",
        throwing,
      ),
    /Maximum call stack size exceeded/,
  );
});
