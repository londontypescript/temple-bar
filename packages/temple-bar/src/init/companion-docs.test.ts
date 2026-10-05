// Tests for how setup brings an existing CLAUDE.md up to what it needs:
// a heading at the top and the AGENTS.md import, added, never removed.

import assert from "node:assert/strict";
import test from "node:test";

import { COMPANION_FILES, fixClaudeMd } from "./companion-docs.ts";
import { updateClaudeMd, writeSetupFiles } from "./files.ts";
import { createFakeContext, createFakeFs } from "../testing/fakes.ts";

const OURS = COMPANION_FILES.find((file) => file.path === "CLAUDE.md");

void test("Next.js's one-line CLAUDE.md gains a heading and becomes exactly setup's own", () => {
  assert.deepEqual(fixClaudeMd("@AGENTS.md\n"), {
    content: OURS?.content,
    added: ["a heading"],
  });
});

void test("a CLAUDE.md with a heading but no import gains the import at the end, the rest kept", () => {
  assert.deepEqual(fixClaudeMd("# Notes\n\nUse pnpm."), {
    content: "# Notes\n\nUse pnpm.\n\n@AGENTS.md\n",
    added: ["the AGENTS.md import"],
  });
});

void test("a CLAUDE.md with neither gains both, and its own text stays between them", () => {
  assert.deepEqual(fixClaudeMd("Use pnpm.\n"), {
    content: "# Claude Code\n\nUse pnpm.\n\n@AGENTS.md\n",
    added: ["a heading", "the AGENTS.md import"],
  });
});

void test("an empty CLAUDE.md becomes setup's own", () => {
  assert.equal(fixClaudeMd("\n")?.content, OURS?.content);
});

void test("a CLAUDE.md that already has both is left as it is", () => {
  for (const content of [
    OURS?.content ?? "",
    "# Ours\r\n\r\nSee @./AGENTS.md below.\r\n@./AGENTS.md\r\n",
  ]) {
    assert.equal(fixClaudeMd(content), undefined, content);
  }
});

void test("updateClaudeMd fixes the file once, and a second run writes nothing", async () => {
  const fs = createFakeFs({ "/repo/CLAUDE.md": "@AGENTS.md\n" });
  const ctx = createFakeContext({ fs });
  assert.deepEqual(await updateClaudeMd(ctx, "/repo"), ["a heading"]);
  assert.equal(fs.files.get("/repo/CLAUDE.md"), OURS?.content);
  assert.deepEqual(await updateClaudeMd(ctx, "/repo"), []);
  assert.equal(fs.writes.length, 1);
});

void test("writeSetupFiles reports what it added to a framework's CLAUDE.md, and nothing for its own", async () => {
  const framework = createFakeFs({ "/repo/CLAUDE.md": "@AGENTS.md\n" });
  const outcome = await writeSetupFiles(
    createFakeContext({ fs: framework, cwd: "/repo" }),
    "/repo",
  );
  assert.deepEqual(outcome.claudeMdAdded, ["a heading"]);
  assert.equal(outcome.wroteCompanions.includes("CLAUDE.md"), false);

  const fresh = await writeSetupFiles(
    createFakeContext({ fs: createFakeFs(), cwd: "/repo" }),
    "/repo",
  );
  assert.deepEqual(fresh.claudeMdAdded, []);
  assert.equal(fresh.wroteCompanions.includes("CLAUDE.md"), true);
});
