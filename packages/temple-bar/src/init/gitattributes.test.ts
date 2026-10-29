import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  describeGitattributes,
  ensureGitattributes,
  type GitattributesOutcome,
} from "./gitattributes.ts";
import { setupWriteTargets } from "./write-target.ts";
import {
  checkAttrAnswer,
  defaultGitScript,
} from "./testing/command-fixture.ts";
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
const STEPS = "  git rm --cached -r . && git reset --hard";

/** Runs setup's step against fake files, with git answering check-attr as
 * `answer` does and everything else as a finished setup's git does. */
async function ensure(
  fs: ReturnType<typeof createFakeFs>,
  answer: GitResult = checkAttrAnswer("auto", "lf"),
): Promise<GitattributesOutcome> {
  const git = createFakeGit((args) =>
    args.includes("check-attr") ? answer : defaultGitScript(args),
  );
  const ctx = createFakeContext({ fs, git });
  return ensureGitattributes(ctx, "/repo", setupWriteTargets(ctx, "/repo"));
}

void test("gitattributes: no file: writes the LF line, and a second run writes nothing", async () => {
  const fs = createFakeFs();
  assert.deepEqual(await ensure(fs), { kind: "wrote", committedCrlf: [] });
  assert.equal(fs.files.get(FILE), LINE);
  assert.deepEqual(await ensure(fs), { kind: "gives-lf", committedCrlf: [] });
  assert.equal(fs.writes.length, 1);
});

void test("gitattributes: a file that gives LF is left alone and no line is reported", async () => {
  const original = "*.png binary\n* text eol=lf\n";
  const fs = createFakeFs({ [FILE]: original });
  const outcome = await ensure(fs, checkAttrAnswer("set", "lf"));
  assert.equal(fs.files.get(FILE), original, LEFT_ALONE);
  assert.equal(fs.writes.length, 0, LEFT_ALONE);
  assert.deepEqual(outcome, { kind: "gives-lf", committedCrlf: [] });
  assert.equal(
    describeGitattributes(outcome),
    ".gitattributes gives the files setup writes LF line endings; left it alone.\n",
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
    assert.equal(fs.files.get(FILE), "* -text\n", LEFT_ALONE);
    assert.equal(fs.writes.length, 0, LEFT_ALONE);
    assert.deepEqual(outcome, {
      kind: "no-lf",
      path: "AGENTS.md",
      committedCrlf: [],
    });
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
  void test(`gitattributes: ${why}: reported as possibly needed, with the checkout steps, never as present`, async () => {
    const fs = createFakeFs({ [FILE]: LINE });
    const outcome = await ensure(fs, answer);
    assert.equal(outcome.kind, "unknown");
    assert.equal(fs.writes.length, 0);
    const said = describeGitattributes(outcome);
    assert.ok(
      said.includes("This line may be needed:\n  * text=auto eol=lf\n"),
    );
    assert.ok(said.includes(STEPS), said);
    assert.ok(!said.includes("gives the files setup writes"));
  });
}

void test("gitattributes: rules in .git/info/attributes, which a clone doesn't get, make the answer unknown", async () => {
  const fs = createFakeFs({
    [FILE]: "# comments only\n",
    "/repo/.git/info/attributes": "# local\n* text=auto eol=lf\n",
  });
  const outcome = await ensure(fs);
  assert.deepEqual(outcome, {
    kind: "unknown",
    detail:
      ".git/info/attributes has rules of its own, which a clone doesn't get",
    committedCrlf: [],
  });
});

void test("gitattributes: a .git/info/attributes that can't be read makes the answer unknown, and setup goes on", async () => {
  const fs = createFakeFs({ [FILE]: LINE });
  const readText = fs.readText.bind(fs);
  // Compared as the fake's keys are, so the source's path.join (backslashes
  // on Windows) matches.
  fs.readText = (file) =>
    path.normalize(file) === path.normalize("/repo/.git/info/attributes")
      ? Promise.reject(new Error("EISDIR: illegal operation on a directory"))
      : readText(file);
  const outcome = await ensure(fs);
  assert.deepEqual(outcome, {
    kind: "unknown",
    detail: "couldn't read .git/info/attributes",
    committedCrlf: [],
  });
});

void test("gitattributes: an absolute .git/info/attributes path, as a linked worktree gets, is read where git says", async () => {
  const fs = createFakeFs({
    [FILE]: LINE,
    "/main/.git/info/attributes": "* -text\n",
  });
  const git = createFakeGit((args) =>
    args[0] === "rev-parse" && args[1] === "--git-path"
      ? { code: 0, stdout: "/main/.git/info/attributes\n", stderr: "" }
      : defaultGitScript(args),
  );
  const ctx = createFakeContext({ fs, git });
  const outcome = await ensureGitattributes(
    ctx,
    "/repo",
    setupWriteTargets(ctx, "/repo"),
  );
  assert.deepEqual(outcome, {
    kind: "unknown",
    detail:
      ".git/info/attributes has rules of its own, which a clone doesn't get",
    committedCrlf: [],
  });
});

void test("gitattributes: a comment-only .git/info/attributes changes nothing", async () => {
  const fs = createFakeFs({
    [FILE]: LINE,
    "/repo/.git/info/attributes": "# git's sample\n\n",
  });
  assert.equal((await ensure(fs)).kind, "gives-lf");
});

void test("gitattributes: git's error is quoted when it can't answer", () => {
  assert.ok(
    describeGitattributes({
      kind: "unknown",
      detail: "fatal: boom",
      committedCrlf: [],
    }).includes("(fatal: boom)"),
  );
});

void test("gitattributes: the checkout steps follow a new or missing line, never a file that gives LF", () => {
  const none = { committedCrlf: [] };
  assert.ok(describeGitattributes({ kind: "wrote", ...none }).includes(STEPS));
  assert.ok(
    describeGitattributes({ kind: "no-lf", path: "x", ...none }).includes(
      STEPS,
    ),
  );
  assert.ok(
    !describeGitattributes({ kind: "gives-lf", ...none }).includes(STEPS),
  );
  assert.equal(describeGitattributes({ kind: "refused", ...none }), "");
});

void test("gitattributes: files committed with CRLF are counted, a few named, with the renormalise step, even when attributes give LF", () => {
  const said = describeGitattributes({
    kind: "gives-lf",
    committedCrlf: ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"],
  });
  assert.equal(
    said,
    ".gitattributes gives the files setup writes LF line endings; left it alone.\n" +
      "5 tracked file(s) are stored with CRLF line endings (a.txt, b.txt, c.txt and 2 more), " +
      "and attributes don't convert what's already committed. Store them with LF, then commit:\n" +
      "  git add --renormalize .\n",
  );
});

/** Real git on a real folder: what git resolves, not what the lines say.
 * `prepare` runs in the repo before the file is written. */
async function ensureOnDisk(
  content: string,
  prepare: (dir: string) => void = () => undefined,
): Promise<{ outcome: GitattributesOutcome; after: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gitattributes-"));
  try {
    initTestRepo(dir);
    prepare(dir);
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
  assert.deepEqual(outcome, { kind: "gives-lf", committedCrlf: [] });
});

void test("gitattributes, real git: `* -text` doesn't give LF, and the file is untouched", async () => {
  const { outcome, after } = await ensureOnDisk("* -text\n");
  assert.equal(after, "* -text\n", LEFT_ALONE);
  assert.equal(outcome.kind, "no-lf");
});

void test("gitattributes, real git: a later line undoing eol=lf is seen, though the exact line is there", async () => {
  const content = `${LINE}*.ts eol=crlf\n`;
  const { outcome, after } = await ensureOnDisk(content);
  assert.equal(after, content, LEFT_ALONE);
  assert.deepEqual(outcome, {
    kind: "no-lf",
    path: "src/index.ts",
    committedCrlf: [],
  });
});

void test("gitattributes, real git: a rule undoing LF for the guides under docs/ is seen", async () => {
  const { outcome } = await ensureOnDisk(`${LINE}docs/** eol=crlf\n`);
  assert.ok(
    outcome.kind === "no-lf" && outcome.path.startsWith("docs/"),
    JSON.stringify(outcome),
  );
});

void test("gitattributes, real git: text=auto alone leaves autocrlf in charge, so the line is reported", async () => {
  const { outcome } = await ensureOnDisk("* text=auto\n");
  assert.equal(outcome.kind, "no-lf");
});

void test("gitattributes, real git: an LF rule only in core.attributesFile, which a clone doesn't get, isn't LF", async () => {
  const { outcome } = await ensureOnDisk("# comments only\n", (dir) => {
    // Inside .git, so it goes with the repo and git never tracks it.
    const global = path.join(dir, ".git", "global-attributes");
    writeFileSync(global, LINE);
    execFileSync("git", ["config", "core.attributesFile", global], {
      cwd: dir,
    });
  });
  assert.equal(outcome.kind, "no-lf", JSON.stringify(outcome));
});

void test("gitattributes, real git: a file committed with CRLF before the attribute is named, though attributes give LF", async () => {
  const { outcome } = await ensureOnDisk(LINE, (dir) => {
    writeFileSync(path.join(dir, "old.txt"), "one\r\ntwo\r\n");
    writeFileSync(path.join(dir, "new.txt"), "one\ntwo\n");
    for (const args of [
      ["-c", "core.autocrlf=false", "add", "old.txt", "new.txt"],
      ["commit", "-q", "-m", "chore: before attributes"],
    ]) {
      execFileSync("git", args, { cwd: dir });
    }
  });
  assert.deepEqual(outcome, { kind: "gives-lf", committedCrlf: ["old.txt"] });
});

void test("gitattributes, real git: a CRLF file the project marks -text isn't named, a CRLF text file still is", async () => {
  const { outcome } = await ensureOnDisk(
    `${LINE}fixtures/** -text\n`,
    (dir) => {
      mkdirSync(path.join(dir, "fixtures"));
      writeFileSync(path.join(dir, "fixtures", "f.txt"), "one\r\n");
      writeFileSync(path.join(dir, "a.txt"), "one\r\n");
      for (const args of [
        ["-c", "core.autocrlf=false", "add", "fixtures/f.txt", "a.txt"],
        ["commit", "-q", "-m", "chore: before attributes"],
      ]) {
        execFileSync("git", args, { cwd: dir });
      }
    },
  );
  assert.deepEqual(outcome, { kind: "gives-lf", committedCrlf: ["a.txt"] });
});

void test("gitattributes, real git: .git/info/attributes as a folder makes the answer unknown, not a crash", async () => {
  const { outcome } = await ensureOnDisk(LINE, (dir) => {
    mkdirSync(path.join(dir, ".git", "info", "attributes"), {
      recursive: true,
    });
  });
  assert.equal(outcome.kind, "unknown", JSON.stringify(outcome));
});
