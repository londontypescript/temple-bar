// The test-shapes check's reading of values: the work budget, flags,
// when RegExp.escape and String.raw are trusted, and JavaScript's scope
// rules for following a local constant. Examples are strings, as in
// test-shapes-code.test.ts.

import test from "node:test";

import { check, P, R, U } from "./testing/shape-rows.ts";

void test("budget: a value past the work budget is reported, never guessed", () => {
  const doubling = ["const a0 = '<b>';"];
  for (let index = 1; index <= 20; index++) {
    doubling.push(
      `const a${String(index)} = a${String(index - 1)} + a${String(index - 1)};`,
    );
  }
  doubling.push("html.replace(new RegExp(a20), '');");
  const chain = ["const c0 = 'a';"];
  for (let index = 1; index <= 33; index++) {
    chain.push(`const c${String(index)} = c${String(index - 1)};`);
  }
  chain.push("new RegExp(c33);");
  check([
    ["f.14", doubling.join("\n"), U],
    [
      "f.14",
      `new RegExp(${Array.from({ length: 6 }, (_, i) => `(c${String(i)} ? 'a' : 'b')`).join(" + ")})`,
      U,
    ],
    ["b.1", chain.join("\n"), U],
    // Only following a constant counts towards the depth: a long
    // concatenation of known text is still known text.
    [
      "b.2",
      `new RegExp(${Array.from({ length: 40 }, (_, i) => `'l${String(i)}'`).join(" + ")})`,
      P,
    ],
    [
      "b.3",
      `html.replace(/<b>/g, ${Array.from({ length: 40 }, () => "''").join(" + ")})`,
      R,
    ],
  ]);
});

void test("flags: a regex source keeps flags it doesn't know, and flags spread in aren't known", () => {
  check([
    ["g.1", "html.replace(new RegExp(new RegExp('<\\u212A>', flags)), '')", R],
    ["g.2", "html.replace(new RegExp('<\\u212A>', ...flags), '')", R],
    ["g.3", "html.replace(new RegExp(/<\\u212A>/), '')", P],
  ]);
});

void test("trust: RegExp.escape proves nothing once RegExp is shadowed or reassigned", () => {
  check([
    [
      "t.1",
      "function f(RegExp: { escape(x: string): string }) { return new globalThis.RegExp(RegExp.escape(name)); }",
      R,
    ],
    [
      "t.2",
      "RegExp.escape = (x) => x;\nnew RegExp(RegExp.escape(name));",
      R,
      "a.test.js",
    ],
    [
      "t.3",
      "globalThis.String = { raw: () => input };\nnew RegExp(String.raw`x`);",
      R,
      "a.test.js",
    ],
    ["t.4", "new RegExp(RegExp.escape(name))", P],
  ]);
});

void test("scopes: shadowing, hoisting and blocks", () => {
  check([
    ["s.1", "const p = 'a';\ntry { x(); } catch (p) { new RegExp(p); }", R],
    ["s.2", "const p = 'a';\nfunction f() { new RegExp(p); var p = g(); }", R],
    ["s.3", "function f() { return new RegExp(P); }\nconst P = 'later';", P],
    ["s.4", "const p = 'a';\nfunction f(q = new RegExp(p)) { return q; }", P],
    [
      "s.5",
      "const p = 'a';\nfunction f(p = 'b', q = new RegExp(p)) { return q; }",
      R,
    ],
    [
      "s.6",
      "const p = 'a';\nswitch (new RegExp(p).source) { case 'x': { const p = g(); } }",
      P,
    ],
    [
      "s.7",
      "const p = 'a';\nclass A { static { const p = g(); new RegExp(p); } }",
      R,
    ],
    [
      "s.8",
      "const p = 'a';\nconst f = function p() { return new RegExp(p); };",
      R,
    ],
    ["s.9", "const p = 'a', q = p;\nnew RegExp(q);", P],
    ["s.10", "const { p } = { p: 'a' };\nnew RegExp(p);", R],
    ["s.11", "const a = b;\nconst b = a;\nnew RegExp(a);", R],
    ["s.12", "export const P = 'a';\nnew RegExp(P);", P],
  ]);
});
