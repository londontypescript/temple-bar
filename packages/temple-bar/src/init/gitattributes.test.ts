import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  describeGitattributes,
  ensureGitattributes,
  type GitattributesOutcome,
} from "./gitattributes.ts";
import { setupWriteTargets } from "./write-target.ts";
import { checkAttrAnswer } from "./testing/command-fixture.ts";
import { createGitSeam } from "../seams/git.ts";
import { createFsSeam } from "../seams/fs.ts";
import { initTestRepo } from "../testing/git-repo.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
} from "../testing/fakes.ts";
import type { GitResult } from "../seams/git.ts";

const FILE = "/repo/.gitattributes";
const LINE = "* text=auto eol=lf\n";
const LEFT_ALONE = "an existing .gitattributes must never be rewritten";

/** Runs setup's step against fake files, with git answering check-attr as
 * `answer` does (and everything else as an empty success). */
async function ensure(
  fs: ReturnType<typeof createFakeFs>,
  answer: GitResult = checkAttrAnswer("auto", "lf"),
): Promise<GitattributesOutcome> {
  const git = createFakeGit((args) =>
    args[0] === "check-attr" ? answer : { code: 0, stdout: "", stderr: "" },
  );
  const ctx = createFakeContext({ fs, git });
  return ensureGitattributes(ctx, "/repo", setupWriteTargets(ctx, "/repo"));
}

void test("gitattributes: no file: writes the LF line, and a second run writes nothing", async () => {
  const fs = createFakeFs();
  assert.deepEqual(await ensure(fs), { kind: "wrote" });
  assert.equal(fs.files.get(FILE), LINE);
  assert.deepEqual(await ensure(fs), { kind: "gives-lf" });
  assert.equal(fs.writes.length, 1);
});

void test("gitattributes: a file that gives LF is left alone and no line is reported", async () => {
  const original = "*.png binary\n* text eol=lf\n";
  const fs = createFakeFs({ [FILE]: original });
  const outcome = await ensure(fs, checkAttrAnswer("set", "lf"));
  assert.equal(fs.files.get(FILE), original, LEFT_ALONE);
  assert.equal(fs.writes.length, 0, LEFT_ALONE);
  assert.deepEqual(outcome, { kind: "gives-lf" });
  assert.equal(
    describeGitattributes(outcome),
    ".gitattributes already gives text files LF line endings; left it alone.\n",
  );
});

for (const [text, eol] of [
  ["unset", "lf"],
  ["auto", "unspecified"],
  ["set", "crlf"],
]) {
  void test(`gitattributes: text ${text ?? ""} and eol ${eol ?? ""} doesn't give LF: left alone, the line reported`, async () => {
    const fs = createFakeFs({ [FILE]: "* -text\n" });
    const outcome = await ensure(fs, checkAttrAnswer(text ?? "", eol ?? ""));
    assert.deepEqual(outcome, { kind: "no-lf", path: "AGENTS.md" });
    assert.equal(fs.files.get(FILE), "* -text\n");
    assert.equal(fs.writes.length, 0);
    assert.ok(
      describeGitattributes(outcome).includes("\n  * text=auto eol=lf\n"),
    );
  });
}

for (const [why, answer] of [
  [
    "git fails",
    { code: 128, stdout: "", stderr: "fatal: not a git repository" },
  ],
  ["git prints nothing", { code: 0, stdout: "", stderr: "" }],
  [
    "git's answer is cut short",
    { code: 0, stdout: "AGENTS.md\0text", stderr: "" },
  ],
] as const) {
  void test(`gitattributes: ${why}: reported as possibly needed, never as present`, async () => {
    const fs = createFakeFs({ [FILE]: "* text=auto eol=lf\n" });
    const outcome = await ensure(fs, answer);
    assert.equal(outcome.kind, "unknown");
    assert.equal(fs.writes.length, 0);
    const said = describeGitattributes(outcome);
    assert.ok(
      said.includes("This line may be needed:\n  * text=auto eol=lf\n"),
    );
    assert.ok(!said.includes("already gives"));
  });
}

void test("gitattributes: git's error is quoted when it can't answer", () => {
  assert.ok(
    describeGitattributes({ kind: "unknown", detail: "fatal: boom" }).includes(
      "(fatal: boom)",
    ),
  );
});

void test("gitattributes: the checkout steps follow a new or missing line, never a file that gives LF", () => {
  const steps = "  git add --renormalize .";
  assert.ok(describeGitattributes({ kind: "wrote" }).includes(steps));
  assert.ok(
    describeGitattributes({ kind: "no-lf", path: "x" }).includes(steps),
  );
  assert.ok(!describeGitattributes({ kind: "gives-lf" }).includes(steps));
  assert.equal(describeGitattributes({ kind: "refused" }), "");
});

/** Real git on a real folder: what git resolves, not what the lines say. */
async function ensureOnDisk(content: string): Promise<{
  outcome: GitattributesOutcome;
  after: string;
}> {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gitattributes-"));
  try {
    initTestRepo(dir);
    writeFileSync(path.join(dir, ".gitattributes"), content);
    const ctx = createFakeContext({
      fs: createFsSeam(),
      git: createGitSeam(),
      cwd: dir,
    });
    const outcome = await ensureGitattributes(
      ctx,
      dir,
      setupWriteTargets(ctx, dir),
    );
    return {
      outcome,
      after: readFileSync(path.join(dir, ".gitattributes"), "utf8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void test("gitattributes, real git: the exact line gives LF", async () => {
  const { outcome } = await ensureOnDisk(`*.png binary\n${LINE}`);
  assert.deepEqual(outcome, { kind: "gives-lf" });
});

void test("gitattributes, real git: `* -text` doesn't give LF, and the file is untouched", async () => {
  const { outcome, after } = await ensureOnDisk("* -text\n");
  assert.equal(after, "* -text\n", LEFT_ALONE);
  assert.deepEqual(outcome, { kind: "no-lf", path: "AGENTS.md" });
});

void test("gitattributes, real git: a later line undoing eol=lf is seen, though the exact line is there", async () => {
  const content = `${LINE}*.ts eol=crlf\n`;
  const { outcome, after } = await ensureOnDisk(content);
  assert.deepEqual(outcome, { kind: "no-lf", path: "src/index.ts" });
  assert.equal(after, content);
});

void test("gitattributes, real git: text=auto alone leaves autocrlf in charge, so the line is reported", async () => {
  const { outcome } = await ensureOnDisk("* text=auto\n");
  assert.deepEqual(outcome, { kind: "no-lf", path: "AGENTS.md" });
});
