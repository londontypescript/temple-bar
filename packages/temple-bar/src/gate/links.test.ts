import assert from "node:assert/strict";
import test from "node:test";

import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
} from "../testing/fakes.ts";
import {
  checkLocalLinks,
  extractLocalTargets,
  findBrokenTargets,
} from "./links.ts";

const LISTED = [
  "README.md",
  "docs/guide.md",
  "docs/adr/0001-first.md",
  "src/index.ts",
  "nested-worktree/",
];

function broken(file: string, content: string): string[] {
  return findBrokenTargets([{ file, content }], LISTED).map(
    (target) => `${String(target.line)} ${target.kind} ${target.target}`,
  );
}

void test("finds inline links, images, reference definitions and HTML links, but not web links", () => {
  const targets = extractLocalTargets(
    [
      "See [the guide](docs/guide.md), ![logo](img/logo.png), and [an ADR][ref].",
      "",
      "[ref]: ./docs/adr/0001-first.md",
      "",
      '<a href="docs/missing.md">x</a>',
      "[web](https://example.com/a.md) [mail](mailto:a@b.c) [top](#intro)",
      '[spaced](<docs/a b.md> "title")',
    ].join("\n"),
  ).map((target) => `${String(target.line)} ${target.target}`);
  assert.deepEqual(targets, [
    "1 docs/guide.md",
    "1 img/logo.png",
    "3 ./docs/adr/0001-first.md",
    "5 docs/missing.md",
    "6 #intro",
    "7 docs/a b.md",
  ]);
});

void test("text in fenced code blocks and link syntax inside a code span are examples, not links", () => {
  const targets = extractLocalTargets(
    [
      "```md",
      "[gone](gone.md) `docs/gone.md`",
      "```",
      "Write `[text](path.md)` to link.",
      "~~~~",
      "```",
      "[also gone](gone.md)",
      "~~~~",
    ].join("\n"),
  );
  assert.deepEqual(targets, []);
});

void test("a link resolves from its own file's folder; a leading / means the repo root", () => {
  assert.deepEqual(broken("docs/guide.md", "[a](adr/0001-first.md)"), []);
  assert.deepEqual(broken("docs/guide.md", "[a](/src/index.ts)"), []);
  assert.deepEqual(broken("docs/guide.md", "[a](../README.md#setup)"), []);
  assert.deepEqual(broken("docs/guide.md", "[a](docs/guide.md)"), [
    "1 link docs/guide.md",
  ]);
});

void test("a link to a folder counts when git lists something inside it", () => {
  assert.deepEqual(broken("README.md", "[adrs](docs/adr/) [d](docs)"), []);
});

void test("a link above the repo root, or to a missing file, is broken", () => {
  assert.deepEqual(broken("README.md", "[x](../outside.md)\n[y](gone.md)"), [
    "1 link ../outside.md",
    "2 link gone.md",
  ]);
});

void test("a bare #fragment and percent-encoded names are handled", () => {
  assert.deepEqual(broken("README.md", "[top](#intro) [g](docs%2Fguide.md)"), [
    "1 link docs%2Fguide.md",
  ]);
  assert.deepEqual(
    findBrokenTargets(
      [{ file: "README.md", content: "[s](my%20notes.md)" }],
      ["README.md", "my notes.md"],
    ),
    [],
  );
});

void test("inline code never asserts that a mentioned file exists", () => {
  assert.deepEqual(
    broken(
      "docs/guide.md",
      "`docs/gone.md` `src/gone.ts` `../guide.md` `node_modules/.bin/x`",
    ),
    [],
  );
});

void test("missing actual links fail even when inline citations name the same path", () => {
  assert.deepEqual(
    broken("README.md", "`docs/gone.md` [read it](docs/gone.md)"),
    ["1 link docs/gone.md"],
  );
});

void test("checkLocalLinks reads Git-listed Markdown without citation ignore queries", async () => {
  const git = createFakeGit((args) =>
    args[0] === "check-ignore"
      ? { code: 0, stdout: "docs/drafts/plan.md\n", stderr: "" }
      : { code: 0, stdout: "", stderr: "" },
  );
  const ctx = createFakeContext({
    git,
    fs: createFakeFs({
      "/repo/README.md":
        "Drafts go in `docs/drafts/plan.md`; see [gone](gone.md) and `docs/old.md`.\n",
      "/repo/docs/guide.md": "fine\n",
    }),
  });
  const result = await checkLocalLinks(ctx, ["README.md", "docs/guide.md"]);
  assert.equal(result.documents, 2);
  assert.deepEqual(
    result.broken.map((target) => `${target.kind} ${target.target}`),
    ["link gone.md"],
  );
  assert.deepEqual(git.calls, []);
});
