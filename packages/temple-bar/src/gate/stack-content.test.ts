// When the four scripts become required: as soon as the repo has any file
// of its own, whatever its type, rather than only once it has a file with a
// JavaScript or TypeScript extension.

import assert from "node:assert/strict";
import test from "node:test";

import { createFakeContext, createFakeGit } from "../testing/fakes.ts";
import { ownContentExists } from "./stack.ts";

function withFiles(...paths: string[]): ReturnType<typeof createFakeContext> {
  const git = createFakeGit(() => ({
    code: 0,
    stdout: `${paths.join("\n")}\n`,
    stderr: "",
  }));
  return createFakeContext({ git });
}

void test("ownContentExists: false when the repo holds only the files every project starts with", async () => {
  const ctx = withFiles(
    "AGENTS.md",
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    ".gitignore",
    "temple-bar.config.json",
    "README.md",
    "LICENSE",
  );
  assert.equal(await ownContentExists(ctx), false);
});

void test("ownContentExists: true for a project in another language, such as a fresh `cargo init`", async () => {
  const ctx = withFiles(
    "package.json",
    "AGENTS.md",
    ".gitignore",
    "Cargo.toml",
    "src/main.rs",
  );
  assert.equal(await ownContentExists(ctx), true);
});

void test("ownContentExists: true for any file type, with no list of extensions", async () => {
  for (const file of [
    "src/App.svelte",
    "src/App.vue",
    "src/pages/index.astro",
    "main.go",
    "docs/plan.md",
    "Makefile",
    "src/index.ts",
  ]) {
    assert.equal(
      await ownContentExists(withFiles("package.json", file)),
      true,
      file,
    );
  }
});

void test("ownContentExists: a starting file's name only counts at the top of the repo", async () => {
  assert.equal(await ownContentExists(withFiles("docs/README.md")), true);
  assert.equal(
    await ownContentExists(withFiles("packages/app/package.json")),
    true,
  );
});

void test("ownContentExists: a nested worktree doesn't count, because git lists it as a directory entry", async () => {
  const ctx = withFiles("README.md", "nested-worktree/");
  assert.equal(await ownContentExists(ctx), false);
});

void test("ownContentExists: vendored or built files committed by mistake don't count, at any depth", async () => {
  const ctx = withFiles(
    "README.md",
    "node_modules/left-pad/index.js",
    "packages/app/node_modules/dep/lib.ts",
    "dist/index.js",
    "packages/app/coverage/lcov-report/prettify.js",
  );
  assert.equal(await ownContentExists(ctx), false);
});

void test("ownContentExists: the project's own files still count next to vendored ones", async () => {
  const ctx = withFiles("node_modules/left-pad/index.js", "src/lib.rs");
  assert.equal(await ownContentExists(ctx), true);
});

void test("ownContentExists: a file merely named like a vendored folder still counts", async () => {
  assert.equal(await ownContentExists(withFiles("src/dist.ts")), true);
  assert.equal(await ownContentExists(withFiles("my_node_modules/x.py")), true);
});
