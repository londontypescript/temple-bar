import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { collectTrailers } from "../merge/message.ts";
import { initTestRepo } from "../testing/git-repo.ts";
import {
  descriptionTrailers,
  finalTrailerBlock,
} from "./description-trailers.ts";

const ADA = "Ada <ada@example.com>";
const SOL = "ChatGPT Sol 6.1";

/** Descriptions and who they credit: the parser's verdicts, and the cases
 * the agreement test below hands to git. */
const CASES: readonly (readonly [string, string, readonly string[]])[] = [
  [
    "bullets, a blank line, then trailers",
    `- one change\n- another\n\nCo-Authored-By: ${ADA}\nReviewed-by: ${SOL}\n`,
    [ADA, SOL],
  ],
  ["only trailers", `Co-Authored-By: ${ADA}`, [ADA]],
  [
    "CRLF line endings",
    `- one change\r\n\r\nCo-Authored-By: ${ADA}\r\nReviewed-by: ${SOL}\r\n`,
    [ADA, SOL],
  ],
  [
    "a value wrapped onto an indented line",
    "- one\n\nCo-Authored-By: Ada\n  <ada@example.com>\n",
    [ADA],
  ],
  [
    "trailing blank lines and spaces",
    `- one\n\nCo-Authored-By: ${ADA}\n\n   \n\t\n`,
    [ADA],
  ],
  [
    "other trailers in the block",
    `- one\n\nCloses: #12\nCo-Authored-By: ${ADA}\nReviewed-by: ${SOL}`,
    [ADA, SOL],
  ],
  ["a space before the colon", `- one\n\nCo-Authored-By : ${ADA}`, [ADA]],
  [
    "a horizontal rule earlier in the description",
    `- one\n\n---\n\nCo-Authored-By: ${ADA}`,
    [ADA],
  ],
  [
    "trailers followed by a line of prose in the same paragraph",
    `- one\n\nCo-Authored-By: ${ADA}\nThanks all`,
    [],
  ],
  [
    "trailers inside a closing code fence",
    `- one\n\n\`\`\`\nCo-Authored-By: ${ADA}\n\`\`\``,
    [],
  ],
  [
    "trailers then an HTML comment",
    `- one\n\nCo-Authored-By: ${ADA}\n<!-- template -->`,
    [],
  ],
  [
    "trailers earlier, prose last",
    `Co-Authored-By: ${ADA}\n\nSome closing words.`,
    [],
  ],
  [
    "a trailer on the bullet's own paragraph",
    `- one\nCo-Authored-By: ${ADA}`,
    [],
  ],
  [
    "a block opening with an indented line",
    `- one\n\n  Co-Authored-By: ${ADA}`,
    [],
  ],
  ["no description", "", []],
];

const named = (trailers: {
  coAuthors: readonly string[];
  reviewers: readonly string[];
}) => [...trailers.coAuthors, ...trailers.reviewers];

for (const [name, description, credited] of CASES) {
  void test(`description trailers: ${name}`, () => {
    assert.deepEqual(named(descriptionTrailers(description)), credited);
  });
}

void test("finalTrailerBlock: returns the block's lines, wrapped values joined, nothing else", () => {
  assert.equal(
    finalTrailerBlock(
      "- one\n\nCo-Authored-By: Ada\n  <ada@example.com>\nReviewed-by: X\n",
    ),
    "Co-Authored-By: Ada <ada@example.com>\nReviewed-by: X",
  );
  assert.equal(finalTrailerBlock("- one\n\nnot a trailer"), undefined);
  assert.equal(finalTrailerBlock("\n\n"), undefined);
});

void test("descriptionTrailers matches names as merge does: without case, spacing collapsed, each once", () => {
  assert.deepEqual(
    descriptionTrailers(
      "co-authored-by: ada  <ADA@example.com>\nCo-Authored-By: Ada <ada@example.com>\nREVIEWED-BY: sol",
    ),
    collectTrailers(
      "co-authored-by: ada  <ADA@example.com>\nCo-Authored-By: Ada <ada@example.com>\nREVIEWED-BY: sol",
    ),
  );
});

// With setup's squash defaults, a merge on the site makes the description
// the commit body. Whatever the parser credits, git must read from such a
// commit too, or the check would pass a description whose trailers the
// squash commit loses; and the other way round, or it would refuse one
// that is fine.
void test("agreement: git reads the same trailers from a squash commit whose body is the description", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "description-trailers-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  initTestRepo(dir);
  const run = (args: readonly string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const tree = run(["write-tree"]).trim();
  for (const [name, description] of CASES) {
    // commit-tree stores the message exactly as given, as GitHub does.
    const file = path.join(dir, "message.txt");
    writeFileSync(file, `feat: a change (#1)\n\n${description}`);
    const commit = run(["commit-tree", tree, "-F", file]).trim();
    const read = run([
      "log",
      "-1",
      "--format=%(trailers:key=Co-authored-by,key=Reviewed-by,unfold)",
      commit,
    ]);
    assert.deepEqual(
      descriptionTrailers(description),
      collectTrailers(read),
      name,
    );
  }
});
