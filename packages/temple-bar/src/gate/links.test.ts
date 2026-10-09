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
      "See [the guide](docs/guide.md) and ![logo](img/logo.png).",
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

void test("a cited path whose first folder exists must exist; from the repo root or the document's folder", () => {
  assert.deepEqual(
    broken(
      "docs/guide.md",
      "Read `docs/adr/0001-first.md`, `adr/0001-first.md` and `src/gone.ts`.",
    ),
    ["1 cited path src/gone.ts"],
  );
});

void test("a document in a folder doesn't make `owner/repo` a path by its own folder existing", () => {
  assert.deepEqual(
    broken(
      "docs/adr/0001-first.md",
      "`londontypescript/temple-bar` `origin/main` `docs/gone.md` `../guide.md`",
    ),
    ["1 cited path docs/gone.md"],
  );
});

void test("things that only look like paths are not cited paths", () => {
  assert.deepEqual(
    broken(
      "README.md",
      [
        "`@scope/name` `owner/repo` `refs/heads/main` `node_modules/.bin/x`",
        "`src/**/*.ts` `<dir>/hooks/` `pnpm run gate` `~/x/y` `a:b/c`",
        "`index.ts` (no folder, so not a cited path)",
      ].join("\n"),
    ),
    [],
  );
});

void test("checkLocalLinks reads the markdown git lists and leaves out cited paths git ignores", async () => {
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
    ["cited path docs/old.md", "link gone.md"],
  );
  assert.deepEqual(git.calls[0]?.args, [
    "check-ignore",
    "--no-index",
    "--",
    "docs/drafts/plan.md",
    "docs/old.md",
  ]);
});
