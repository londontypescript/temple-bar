import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureGitignore,
  GITIGNORE_LINES,
  ensurePackageJsonScripts,
  GATE_SCRIPT,
  PREPARE_SCRIPT,
  writeAgentsMdIfMissing,
  writeJudgeWorkflowIfMissing,
} from "./files.ts";
import { judgeWorkflow } from "../judge/workflow.ts";
import { createFakeContext, createFakeFs } from "../testing/fakes.ts";

void test("writeJudgeWorkflowIfMissing writes the judge workflow when there is none", async () => {
  const fs = createFakeFs();
  const wrote = await writeJudgeWorkflowIfMissing(
    createFakeContext({ fs }),
    "/repo",
  );
  assert.equal(wrote, true);
  assert.equal(
    fs.files.get("/repo/.github/workflows/temple-bar-judge.yml"),
    judgeWorkflow(),
  );
});

void test("writeJudgeWorkflowIfMissing leaves a copy that differs alone", async () => {
  const path = "/repo/.github/workflows/temple-bar-judge.yml";
  const fs = createFakeFs({ [path]: "# reviewed by the maintainer\n" });
  const wrote = await writeJudgeWorkflowIfMissing(
    createFakeContext({ fs }),
    "/repo",
  );
  assert.equal(wrote, false);
  assert.equal(fs.files.get(path), "# reviewed by the maintainer\n");
  assert.equal(fs.writes.length, 0);
});

void test("writeAgentsMdIfMissing writes a minimal file when none exists", async () => {
  const fs = createFakeFs();
  const ctx = createFakeContext({ fs });
  const wrote = await writeAgentsMdIfMissing(ctx, "/repo");
  assert.equal(wrote, true);
  const content = fs.files.get("/repo/AGENTS.md");
  assert.match(content ?? "", /pull requests the user merges/);
  assert.match(content ?? "", /ask the user what they want to build/);
});

void test("writeAgentsMdIfMissing leaves an existing AGENTS.md untouched", async () => {
  const fs = createFakeFs({ "/repo/AGENTS.md": "# My own rules\n" });
  const ctx = createFakeContext({ fs });
  const wrote = await writeAgentsMdIfMissing(ctx, "/repo");
  assert.equal(wrote, false);
  assert.equal(fs.files.get("/repo/AGENTS.md"), "# My own rules\n");
  assert.equal(fs.writes.length, 0);
});

void test("ensurePackageJsonScripts creates a minimal package.json when none exists", async () => {
  const fs = createFakeFs();
  const ctx = createFakeContext({ fs, cwd: "/repo" });
  const outcome = await ensurePackageJsonScripts(ctx, "/repo/my-app");
  assert.equal(outcome.wrote, true);
  assert.deepEqual(outcome.conflicts, []);
  const written = JSON.parse(
    fs.files.get("/repo/my-app/package.json") ?? "{}",
  ) as {
    name: string;
    private: boolean;
    scripts: Record<string, string>;
  };
  assert.equal(written.name, "my-app");
  assert.equal(written.private, true);
  assert.equal(written.scripts.prepare, PREPARE_SCRIPT);
  assert.equal(written.scripts.gate, GATE_SCRIPT);
});

void test("ensurePackageJsonScripts adds the scripts to an existing package.json", async () => {
  const fs = createFakeFs({
    "/repo/package.json": JSON.stringify({
      name: "existing",
      scripts: { test: "vitest" },
    }),
  });
  const ctx = createFakeContext({ fs });
  const outcome = await ensurePackageJsonScripts(ctx, "/repo");
  assert.equal(outcome.wrote, true);
  assert.deepEqual(outcome.conflicts, []);
  const written = JSON.parse(fs.files.get("/repo/package.json") ?? "{}") as {
    scripts: Record<string, string>;
  };
  assert.equal(written.scripts.test, "vitest");
  assert.equal(written.scripts.prepare, PREPARE_SCRIPT);
  assert.equal(written.scripts.gate, GATE_SCRIPT);
});

void test("ensurePackageJsonScripts leaves a different `prepare` script alone and reports it", async () => {
  const fs = createFakeFs({
    "/repo/package.json": JSON.stringify({
      name: "existing",
      scripts: { prepare: "husky install" },
    }),
  });
  const ctx = createFakeContext({ fs });
  const outcome = await ensurePackageJsonScripts(ctx, "/repo");
  assert.deepEqual(outcome.conflicts, [
    { name: "prepare", expected: PREPARE_SCRIPT },
  ]);
  const written = JSON.parse(fs.files.get("/repo/package.json") ?? "{}") as {
    scripts: Record<string, string>;
  };
  assert.equal(written.scripts.prepare, "husky install", "must not overwrite");
  assert.equal(written.scripts.gate, GATE_SCRIPT, "gate still gets added");
});

void test("ensurePackageJsonScripts is a no-op the second time (idempotent)", async () => {
  const fs = createFakeFs({
    "/repo/package.json": JSON.stringify(
      {
        name: "existing",
        scripts: { prepare: PREPARE_SCRIPT, gate: GATE_SCRIPT },
      },
      null,
      2,
    ),
  });
  const ctx = createFakeContext({ fs });
  const outcome = await ensurePackageJsonScripts(ctx, "/repo");
  assert.equal(outcome.wrote, false);
  assert.deepEqual(outcome.conflicts, []);
  assert.equal(fs.writes.length, 0);
});

void test("ensureGitignore: creates the file with every required line", async () => {
  const fs = createFakeFs();
  const ctx = createFakeContext({ fs });
  assert.equal(await ensureGitignore(ctx, "/repo"), true);
  const lines = (fs.files.get("/repo/.gitignore") ?? "").split("\n");
  for (const line of GITIGNORE_LINES) {
    assert.ok(lines.includes(line), line);
  }
  assert.ok(lines.includes("# Dependencies and build output"));
  assert.ok(lines.includes(".temple-bar/"));
});

void test("ensureGitignore: ignores the folder where Claude Code puts worktrees", async () => {
  // Claude Code creates worktrees inside the repo. Unignored, each one shows
  // up as untracked and tools that follow .gitignore would scan its copy.
  const fs = createFakeFs();
  const ctx = createFakeContext({ fs });
  await ensureGitignore(ctx, "/repo");
  const lines = (fs.files.get("/repo/.gitignore") ?? "").split("\n");
  assert.ok(lines.includes(".claude/worktrees/"), "fresh .gitignore");

  const existing = createFakeFs({ "/repo/.gitignore": "node_modules/\n" });
  await ensureGitignore(createFakeContext({ fs: existing }), "/repo");
  const appended = (existing.files.get("/repo/.gitignore") ?? "").split("\n");
  assert.ok(appended.includes(".claude/worktrees/"), "existing .gitignore");
});

void test("ensureGitignore: appends only missing lines, keeps the rest in order, and a second run writes nothing", async () => {
  const original = "dist/\n# mine\nnode_modules/\n.env";
  const fs = createFakeFs({ "/repo/.gitignore": original });
  const ctx = createFakeContext({ fs });
  assert.equal(await ensureGitignore(ctx, "/repo"), true);
  const after = fs.files.get("/repo/.gitignore") ?? "";
  // dist/ and node_modules/ were already there, so they aren't repeated.
  assert.ok(
    after.startsWith(`${original}\n\n# Added by temple-bar\ncoverage/\n`),
    after,
  );
  assert.equal(
    after.split("\n").filter((l) => l === "node_modules/").length,
    1,
  );
  const writes = fs.writes.length;
  assert.equal(await ensureGitignore(ctx, "/repo"), false);
  assert.equal(fs.writes.length, writes);
});

void test("ensurePackageJsonScripts keeps the file's indent and final newline", async () => {
  for (const [indent, newline] of [
    ["\t", "\n"],
    ["    ", "\n"],
    ["  ", ""],
  ] as const) {
    const original = `${JSON.stringify({ name: "x" }, null, indent)}${newline}`;
    const fs = createFakeFs({ "/repo/package.json": original });
    const ctx = createFakeContext({ fs });
    await ensurePackageJsonScripts(ctx, "/repo");
    const after = fs.files.get("/repo/package.json") ?? "";
    assert.ok(after.includes(`\n${indent}"scripts": {`), JSON.stringify(after));
    assert.equal(after.endsWith("\n"), newline === "\n");
  }
});
