import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
} from "../testing/fakes.ts";
import {
  makeFixture,
  defaultGitScript,
  runInitFor,
} from "./testing/command-fixture.ts";
import { classifyDiskTarget, setupWriteTargets } from "./write-target.ts";
import { ensureGitignore, writeSetupFiles } from "./files.ts";

void test("write safety: the three literal Claude link targets are accepted without normalising", async () => {
  for (const stored of ["AGENTS.md", "./AGENTS.md", ".\\AGENTS.md"]) {
    const fs = createFakeFs({ "/repo/AGENTS.md": "ordinary rules\n" });
    fs.linkTargets.set("/repo/CLAUDE.md", stored);
    const targets = setupWriteTargets(createFakeContext({ fs }), "/repo");
    assert.equal(
      (await targets.inspect("CLAUDE.md")).kind,
      "claude-link",
      stored,
    );
    assert.equal(await targets.readText("CLAUDE.md"), undefined);
    assert.equal(await targets.writeText("CLAUDE.md", "wrong"), false);
    assert.equal(fs.files.get("/repo/AGENTS.md"), "ordinary rules\n");
    assert.deepEqual(fs.writes, []);
  }
});

void test("write safety: non-ENOENT classification errors propagate, never become missing", async () => {
  const fs = createFakeFs();
  const error = Object.assign(new Error("permission denied"), {
    code: "EACCES",
  });
  fs.classificationErrors.set(path.normalize("/repo/docs"), error);
  const ctx = createFakeContext({ fs });
  await assert.rejects(
    classifyDiskTarget(ctx, "/repo", "docs/conventions.md"),
    (caught) => caught === error,
  );
  await assert.rejects(
    writeSetupFiles(ctx, "/repo"),
    (caught) => caught === error,
  );
});

void test("write safety: failing index command is an error, never an empty index", async () => {
  const ctx = createFakeContext({
    git: createFakeGit(() => ({ code: 1, stdout: "", stderr: "index locked" })),
  });
  await assert.rejects(
    ensureGitignore(ctx, "/repo"),
    /Could not inspect setup's git index: index locked/,
  );
});

void test("write safety: index queries include all paths and folders in one NUL-separated call", async () => {
  const git = createFakeGit();
  const targets = setupWriteTargets(createFakeContext({ git }), "/repo");
  await targets.inspect("AGENTS.md");
  assert.equal(git.calls.length, 1);
  const args = git.calls[0]?.args ?? [];
  assert.deepEqual(args.slice(0, 4), ["ls-files", "-s", "-z", "--"]);
  for (const file of [
    "docs",
    "docs/adr",
    ".github",
    ".github/workflows",
    "CLAUDE.md",
    "package.json",
  ])
    assert.ok(args.includes(file));
});

for (const relative of ["AGENTS.md", "docs", "CLAUDE.md"]) {
  void test(`write safety: multiple index stages at ${relative} are refused`, async () => {
    const ctx = createFakeContext({
      git: createFakeGit(() => ({
        code: 0,
        stdout: `100644 aaaa 1\t${relative}\0` + `100644 bbbb 2\t${relative}\0`,
        stderr: "",
      })),
    });
    const state = await setupWriteTargets(ctx, "/repo").inspect(
      relative === "docs" ? "docs/conventions.md" : relative,
    );
    assert.equal(state.kind, "refused");
    assert.match(state.reason, /unresolved git index stages/);
  });
}

void test("write safety: index folder symlink is refused even when disk says ordinary folder", async () => {
  const fs = createFakeFs({ "/repo/docs/conventions.md": "keep\n" });
  const ctx = createFakeContext({
    fs,
    git: createFakeGit(() => ({
      code: 0,
      stdout: "120000 aaaa 0\tdocs\0",
      stderr: "",
    })),
  });
  const targets = setupWriteTargets(ctx, "/repo");
  assert.equal(
    await targets.writeText("docs/conventions.md", "changed"),
    false,
  );
  assert.equal(fs.files.get("/repo/docs/conventions.md"), "keep\n");
});

void test("write safety: classification is repeated between read and write", async () => {
  const fs = createFakeFs({ "/repo/.gitignore": "keep\n" });
  const read = fs.readText.bind(fs);
  fs.readText = async (file) => {
    const content = await read(file);
    fs.linkTargets.set(file, "outside");
    return content;
  };
  const ctx = createFakeContext({ fs });
  assert.equal(await ensureGitignore(ctx, "/repo"), false);
  assert.deepEqual(
    fs.writes,
    [],
    "link installed after read stops the later write",
  );
});

void test("write safety: an index folder refusal stops disk probes below it", async () => {
  const fs = createFakeFs({ "/repo/docs/conventions.md": "keep" });
  fs.classificationErrors.set(
    path.normalize("/repo/docs/conventions.md"),
    new Error("must not probe below the tracked link"),
  );
  const ctx = createFakeContext({
    fs,
    git: createFakeGit(() => ({
      code: 0,
      stdout: "120000 aaaa 0\tdocs\0",
      stderr: "",
    })),
  });
  const state = await setupWriteTargets(ctx, "/repo").inspect(
    "docs/conventions.md",
  );
  assert.equal(state.kind, "refused");
  assert.match(state.reason, /tracked symlink docs/);
});

void test("write safety: a linked folder is reported before a tracked descendant", async () => {
  const fs = createFakeFs();
  fs.linkTargets.set("/repo/docs", "../outside");
  const ctx = createFakeContext({
    fs,
    git: createFakeGit(() => ({
      code: 0,
      stdout: "120000 aaaa 0\tdocs/conventions.md\0",
      stderr: "",
    })),
  });
  const state = await setupWriteTargets(ctx, "/repo").inspect(
    "docs/conventions.md",
  );
  assert.equal(state.kind, "refused");
  assert.match(state.reason, /linked folder docs/);
  assert.match(state.fix, /replace docs with an ordinary folder/);
});

void test("write safety: early gitignore refusal is reported before origin stops setup", async () => {
  const fs = createFakeFs();
  fs.linkTargets.set("/repo/.gitignore", "missing");
  const fixture = makeFixture({
    fs,
    git: createFakeGit((args) =>
      args[0] === "remote" && args[1] === "get-url"
        ? { code: 1, stdout: "", stderr: "no origin" }
        : defaultGitScript(args),
    ),
  });
  assert.equal(await runInitFor(fixture), 1);
  assert.match(
    fixture.stderr.lines[0] ?? "",
    /^\.gitignore is a symlink.*Fix:/,
  );
  assert.equal(fs.writes.length, 0);
});

void test("write safety: origin's first-commit path reports refusals before returning", async () => {
  const fs = createFakeFs();
  fs.linkTargets.set("/repo/AGENTS.md", "missing");
  const fixture = makeFixture(
    {
      fs,
      git: createFakeGit((args) =>
        (args[0] === "remote" && args[1] === "get-url") ||
        (args[0] === "rev-parse" && args[1] === "HEAD")
          ? { code: 1, stdout: "", stderr: "unborn" }
          : defaultGitScript(args),
      ),
    },
    "yes",
  );
  assert.equal(await runInitFor(fixture), 1);
  assert.ok(
    fixture.stderr.lines.some(
      (line) =>
        line.startsWith("AGENTS.md is a symlink") && line.includes("Fix:"),
    ),
  );
  assert.ok(
    fs.files.has("/repo/package.json"),
    "other files are written before commit-needed return",
  );
});

void test("fs fake: stored targets distinguish dangling and live symlinks", async () => {
  const fs = createFakeFs({ "/outside/file": "bytes" });
  fs.linkTargets.set("/repo/live", "../outside/file");
  fs.linkTargets.set("/repo/dangling", "missing");
  assert.equal(await fs.classify("/repo/live"), "symlink");
  assert.equal(await fs.classify("/repo/dangling"), "symlink");
  assert.equal(await fs.readlink("/repo/live"), "../outside/file");
  assert.equal(await fs.readText("/repo/live"), "bytes");
  assert.equal(await fs.readText("/repo/dangling"), undefined);
});
