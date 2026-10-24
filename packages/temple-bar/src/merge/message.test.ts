import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createGitSeam } from "../seams/git.ts";
import { createFakeContext, createFakeGit } from "../testing/fakes.ts";
import { commitFiles } from "../testing/git-commits.ts";
import { initTestRepo } from "../testing/git-repo.ts";
import {
  buildSquashMessage,
  readTrailers,
  topLevelBullets,
  type CommitTrailers,
} from "./message.ts";

const ADA = "Ada <ada@example.com>";
const SOL = "ChatGPT Sol 6.1";

/** What the reader makes of `stdout`, as `git log` would print it. */
async function readFrom(stdout: string): Promise<CommitTrailers> {
  const git = createFakeGit(() => ({ code: 0, stdout, stderr: "" }));
  return readTrailers(createFakeContext({ git }), "origin/main..HEAD", "/repo");
}

void test("takes only top-level bullets, joining a wrapped bullet's lines", () => {
  const body = [
    "Intro paragraph.",
    "",
    "- first change",
    "  that wraps",
    "  - a nested detail",
    "- second change",
    "",
    "* a star bullet is not a top-level dash bullet",
    "<!-- - a template example -->",
    "```",
    "- inside code",
    "```",
    "- third change",
    "",
    "🤖 Generated with a tool",
  ].join("\n");
  assert.deepEqual(topLevelBullets(body), [
    "first change that wraps",
    "second change",
    "third change",
  ]);
});

void test("the squash message is the title with the number, the bullets, then co-authors", () => {
  const message = buildSquashMessage(
    { number: 12, title: " fix(gate): x ", body: "- one\r\n- two\r\n" },
    { coAuthors: [ADA], reviewers: [] },
  );
  assert.equal(message.subject, "fix(gate): x (#12)");
  assert.equal(
    message.body,
    "- one\n- two\n\nCo-Authored-By: Ada <ada@example.com>",
  );
});

void test("without bullets, the squash message is the title alone, then co-authors", () => {
  const pullRequest = {
    number: 12,
    title: "chore: bump x",
    body: "Bumps x.\n\n```\n- not a bullet\n```\n",
  };
  assert.deepEqual(
    buildSquashMessage(pullRequest, { coAuthors: [ADA], reviewers: [] }),
    {
      subject: "chore: bump x (#12)",
      body: "Co-Authored-By: Ada <ada@example.com>",
    },
  );
  assert.deepEqual(
    buildSquashMessage(pullRequest, { coAuthors: [], reviewers: [] }),
    {
      subject: "chore: bump x (#12)",
      body: "",
    },
  );
});

void test("a maintainer-approved change gets a trailer naming it, before the co-authors", () => {
  const pullRequest = { number: 12, title: "docs(agents): x", body: "- one" };
  assert.equal(
    buildSquashMessage(pullRequest, { coAuthors: [ADA], reviewers: [] }, [
      "changes AGENTS.md",
      "changes docs/AGENTS.md",
    ]).body,
    "- one\n\nMaintainer-Approved: changes AGENTS.md; changes docs/AGENTS.md\nCo-Authored-By: Ada <ada@example.com>",
  );
  // With no bullets and no co-authors, the trailer stands alone.
  assert.equal(
    buildSquashMessage(
      { ...pullRequest, body: "" },
      { coAuthors: [], reviewers: [] },
      ["changes AGENTS.md"],
    ).body,
    "Maintainer-Approved: changes AGENTS.md",
  );
});

void test("a change that needed no yes carries no maintainer trailer", () => {
  const body = buildSquashMessage(
    { number: 12, title: "fix: x", body: "- one" },
    { coAuthors: [ADA], reviewers: [] },
  ).body;
  assert.doesNotMatch(body, /Maintainer-Approved/);
});

void test("reviewers follow the co-authors, after any maintainer trailer", () => {
  const pullRequest = { number: 12, title: "fix: x", body: "- one" };
  assert.equal(
    buildSquashMessage(
      pullRequest,
      { coAuthors: [ADA], reviewers: [SOL, "Grace"] },
      ["changes AGENTS.md"],
    ).body,
    "- one\n\nMaintainer-Approved: changes AGENTS.md\nCo-Authored-By: Ada <ada@example.com>\nReviewed-by: ChatGPT Sol 6.1\nReviewed-by: Grace",
  );
  assert.doesNotMatch(
    buildSquashMessage(pullRequest, { coAuthors: [ADA], reviewers: [] }).body,
    /Reviewed-by/,
  );
});

void test("a reviewer with no co-authors and no bullets stands alone", () => {
  assert.equal(
    buildSquashMessage(
      { number: 12, title: "fix: x", body: "" },
      { coAuthors: [], reviewers: [SOL] },
    ).body,
    "Reviewed-by: ChatGPT Sol 6.1",
  );
});

void test("the reader asks git log for both trailers, unfolded, oldest commit first", async () => {
  const git = createFakeGit(() => ({ code: 0, stdout: "", stderr: "" }));
  await readTrailers(createFakeContext({ git }), "origin/main..HEAD", "/repo");
  assert.deepEqual(git.calls[0]?.args, [
    "log",
    "--reverse",
    "--format=%(trailers:key=Co-authored-by,key=Reviewed-by,unfold)",
    "origin/main..HEAD",
  ]);
});

void test("co-authors are listed once each, compared without case, in first-seen order", async () => {
  assert.deepEqual(
    await readFrom(
      "Co-authored-by: Bob <bob@example.com>\n\nCo-Authored-By: Ada <ada@example.com>\nco-authored-by: bob  <BOB@example.com>\n\n",
    ),
    { coAuthors: ["Bob <bob@example.com>", ADA], reviewers: [] },
  );
});

void test("one reviewer, or the same one on several commits, is listed once", async () => {
  assert.deepEqual(await readFrom("Reviewed-by: ChatGPT Sol 6.1\n\n"), {
    coAuthors: [],
    reviewers: [SOL],
  });
  assert.deepEqual(
    await readFrom(
      "Reviewed-by: ChatGPT Sol 6.1\n\n\nReviewed-by: ChatGPT Sol 6.1\n\n",
    ),
    { coAuthors: [], reviewers: [SOL] },
  );
});

void test("two reviewers are listed in commit order", async () => {
  assert.deepEqual(
    await readFrom("Reviewed-by: Grace\n\nReviewed-by: ChatGPT Sol 6.1\n\n"),
    { coAuthors: [], reviewers: ["Grace", SOL] },
  );
});

void test("a reviewer typed with other case and spacing is listed once, as first spelled", async () => {
  assert.deepEqual(
    await readFrom(
      "Reviewed-by: ChatGPT Sol 6.1\n\nreviewed-by: chatgpt  SOL 6.1\n\n",
    ),
    { coAuthors: [], reviewers: [SOL] },
  );
});

void test("a co-author and a reviewer on one commit go to their own lists", async () => {
  assert.deepEqual(
    await readFrom(
      "Co-Authored-By: Ada <ada@example.com>\nReviewed-by: ChatGPT Sol 6.1\n\n",
    ),
    { coAuthors: [ADA], reviewers: [SOL] },
  );
});

void test("the reader parses real git output, whatever case each commit spells the key in", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-message-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  initTestRepo(dir);
  const base = commitFiles(dir, { "a.txt": "a" });
  let tip = base;
  for (const message of [
    "feat: one\n\nCo-Authored-By: Ada <ada@example.com>\nReviewed-by: ChatGPT Sol 6.1",
    "fix: two\n\nco-authored-by: Bob <bob@example.com>\nReviewed-by: ChatGPT Sol 6.1\nSigned-off-by: Test <test@example.com>",
    // A value folded onto a second line is one name.
    "chore: three\n\nCo-authored-by: ada <ADA@example.com>\nReviewed-by: Grace\n  Hopper",
  ]) {
    tip = execFileSync(
      "git",
      ["commit-tree", `${base}^{tree}`, "-p", tip, "-m", message],
      { cwd: dir, encoding: "utf8" },
    ).trim();
  }
  const ctx = createFakeContext({ git: createGitSeam(), cwd: dir });
  assert.deepEqual(await readTrailers(ctx, `${base}..${tip}`, dir), {
    coAuthors: [ADA, "Bob <bob@example.com>"],
    reviewers: [SOL, "Grace Hopper"],
  });
});

void test("topLevelBullets skips bullets inside comments and fenced code, and after an unclosed comment", () => {
  assert.deepEqual(
    topLevelBullets(
      "- kept\n<!--\n- hidden\n-->\n```\n- example\n```\n- also kept\n<!-- unclosed\n- gone",
    ),
    ["kept", "also kept"],
  );
});
