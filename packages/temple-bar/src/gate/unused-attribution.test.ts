import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { attributeFindings } from "./unused-attribution.ts";

const root = path.resolve("/repo");
const at = (...parts: string[]): string => path.join(root, ...parts);

void test("a finding in nested package folders belongs to the deepest one", () => {
  assert.deepEqual(
    attributeFindings(
      [root],
      ["packages/outer", "packages/outer/inner"],
      [
        at("packages", "outer", "inner", "src", "a.ts"),
        at("packages", "outer", "src", "b.ts"),
      ],
    ),
    [
      { name: "packages/outer", files: ["packages/outer/src/b.ts"] },
      {
        name: "packages/outer/inner",
        files: ["packages/outer/inner/src/a.ts"],
      },
    ],
  );
});

void test("a finding outside every package belongs to the root, even beside a package's name", () => {
  assert.deepEqual(
    attributeFindings(
      [root],
      ["apps/web"],
      [at("apps", "web-old", "x.ts"), at("tools", "y.ts")],
    ),
    [{ name: "the root", files: ["apps/web-old/x.ts", "tools/y.ts"] }],
  );
});

void test("a finding outside the repo is named as it is, never dropped", () => {
  const outside = path.resolve("/elsewhere/z.ts");
  assert.deepEqual(attributeFindings([root], ["apps/web"], [outside]), [
    { name: outside, files: [outside] },
  ]);
});

void test("a finding under the root's resolved spelling is placed too", () => {
  const real = path.resolve("/private/repo");
  assert.deepEqual(
    attributeFindings(
      [root, real],
      ["apps/web"],
      [path.join(real, "apps", "web", "a.ts")],
    ),
    [{ name: "apps/web", files: ["apps/web/a.ts"] }],
  );
});
