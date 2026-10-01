// Unit tests for env-files.ts, through the fakes: which files are copied,
// which are left alone, and that a report never carries a value.

import assert from "node:assert/strict";
import test from "node:test";

import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
} from "../testing/fakes.ts";
import {
  checkEnvKeys,
  copyEnvFiles,
  describeEnv,
  envKeys,
} from "./env-files.ts";

const PRIMARY = "/primary";
const WORKTREE = "/worktree";

/** git as seen from both checkouts: `ignored` lists what `ls-files --others
 * --ignored` reports in the primary, `tracked` what `ls-files` reports in
 * the worktree. */
function gitFor(ignored: readonly string[], tracked: readonly string[]) {
  return createFakeGit((args, cwd) => {
    if (args[0] === "ls-files" && args.includes("--ignored")) {
      assert.equal(cwd, PRIMARY);
      return { code: 0, stdout: ignored.join("\0") + "\0", stderr: "" };
    }
    if (args[0] === "ls-files") {
      assert.equal(cwd, WORKTREE);
      return { code: 0, stdout: tracked.join("\0") + "\0", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "unexpected" };
  });
}

void test("env files: copies ignored .env files, at the root and in package folders, and never an .example or an ignored folder", async () => {
  const fs = createFakeFs({
    "/primary/.env": "A=1\n",
    "/primary/.env.local": "B=2\n",
    "/primary/packages/app/.env": "C=3\n",
    "/worktree/package.json": "{}",
    "/worktree/packages/app/index.ts": "",
  });
  const git = gitFor(
    [
      ".env",
      ".env.local",
      "node_modules/",
      "packages/app/.env",
      "notes.txt",
      ".env.example",
    ],
    [],
  );
  const ctx = createFakeContext({ fs, git });

  const copies = await copyEnvFiles(ctx, PRIMARY, WORKTREE);

  assert.deepEqual(copies, [
    { file: ".env", outcome: "copied" },
    { file: ".env.local", outcome: "copied" },
    { file: "packages/app/.env", outcome: "copied" },
  ]);
  assert.equal(fs.files.get("/worktree/.env"), "A=1\n");
  assert.equal(fs.files.get("/worktree/packages/app/.env"), "C=3\n");
  assert.equal(fs.files.has("/worktree/.env.example"), false);
});

void test("env files: an env file already in the worktree is kept as it is", async () => {
  const fs = createFakeFs({
    "/primary/.env": "A=from-primary\n",
    "/worktree/.env": "A=mine\n",
  });
  const ctx = createFakeContext({ fs, git: gitFor([".env"], []) });

  const copies = await copyEnvFiles(ctx, PRIMARY, WORKTREE);

  assert.deepEqual(copies, [{ file: ".env", outcome: "already-there" }]);
  assert.equal(fs.files.get("/worktree/.env"), "A=mine\n");
});

void test("env files: a file whose folder isn't on the new branch, or that is a link, is skipped", async () => {
  const fs = createFakeFs({
    "/primary/packages/gone/.env": "A=1\n",
    "/primary/.env": "B=2\n",
    "/worktree/package.json": "{}",
  });
  fs.symlinks.add("/primary/.env");
  const ctx = createFakeContext({
    fs,
    git: gitFor([".env", "packages/gone/.env"], []),
  });

  const copies = await copyEnvFiles(ctx, PRIMARY, WORKTREE);

  assert.deepEqual(copies, [
    { file: ".env", outcome: "not-a-file" },
    { file: "packages/gone/.env", outcome: "no-folder" },
  ]);
  assert.equal(fs.writes.length, 0);
});

void test("env keys: reads KEY= and export KEY= lines, and skips comments and blank lines", () => {
  const keys = envKeys(
    "# comment\nA=1\n\nexport B = two\n  C=\nnot a key\r\nD.E=x\r\n",
  );
  assert.deepEqual([...keys], ["A", "B", "C", "D.E"]);
});

void test("env keys: reports keys the template lists that the env file lacks, and a missing env file", async () => {
  const fs = createFakeFs({
    "/worktree/.env.example": "A=\nB=\nC=\n",
    "/worktree/.env": "A=secret-a\nB=secret-b\n",
    "/worktree/packages/app/.env.example": "D=\n",
    "/worktree/.env.local.example": "E=\n",
    "/worktree/.env.local": "E=secret-e\n",
  });
  const ctx = createFakeContext({
    fs,
    git: gitFor(
      [],
      [
        ".env.example",
        ".env.local.example",
        "README.md",
        "packages/app/.env.example",
      ],
    ),
  });

  const checks = await checkEnvKeys(ctx, WORKTREE);

  assert.deepEqual(checks, [
    { file: ".env", template: ".env.example", missingKeys: ["C"] },
    { file: ".env.local", template: ".env.local.example", missingKeys: [] },
    {
      file: "packages/app/.env",
      template: "packages/app/.env.example",
      missingKeys: undefined,
    },
  ]);
});

void test("env report: names files and keys only, never a value", () => {
  const lines = describeEnv(
    [
      { file: ".env", outcome: "copied" },
      { file: ".env.local", outcome: "already-there" },
      { file: "packages/gone/.env", outcome: "no-folder" },
    ],
    [
      { file: ".env", template: ".env.example", missingKeys: ["C", "D"] },
      { file: ".env.local", template: ".env.local.example", missingKeys: [] },
      { file: "x/.env", template: "x/.env.example", missingKeys: undefined },
    ],
  );

  assert.deepEqual(lines, [
    "copied .env from the primary checkout",
    "kept .env.local: this worktree already has one",
    "skipped packages/gone/.env: its folder isn't on this worktree's branch",
    ".env lacks keys that .env.example lists: C, D",
    "no x/.env here, though x/.env.example exists",
  ]);
});
