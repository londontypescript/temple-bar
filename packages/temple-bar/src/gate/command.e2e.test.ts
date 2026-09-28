// Integration tests against real temp git repos and the real seams (git,
// fs, proc), run with npm so these tests don't need pnpm on PATH. Sample
// projects from the plan's "done when": one passing, one with a failing
// test script, one with code but no scripts, one docs-only with no
// package.json.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createGitSeam } from "../seams/git.ts";
import { createGhSeam } from "../seams/gh.ts";
import { createFsSeam } from "../seams/fs.ts";
import { createProcSeam } from "../seams/proc.ts";
import { createFakeClock, createFakePrompt } from "../testing/fakes.ts";
import type { Context } from "../context.ts";
import { gateCommand } from "./command.ts";
import { detectPackageManager } from "./stack.ts";

function initRepo(dir: string): void {
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
}

function stageAll(dir: string): void {
  // Untracked-but-not-ignored files are already picked up by
  // `git ls-files --others --exclude-standard`, but staging keeps the
  // fixtures closer to a real mid-development repo and exercises
  // `--cached` too.
  execFileSync("git", ["add", "-A"], { cwd: dir });
}

interface Recorded {
  lines: string[];
  write(text: string): void;
}

function recorder(): Recorded {
  const lines: string[] = [];
  return {
    lines,
    write(text: string) {
      lines.push(text);
    },
  };
}

function makeContext(cwd: string): {
  ctx: Context;
  stdout: Recorded;
  stderr: Recorded;
} {
  const stdout = recorder();
  const stderr = recorder();
  const ctx: Context = {
    git: createGitSeam(),
    gh: createGhSeam(),
    fs: createFsSeam(),
    clock: createFakeClock(),
    prompt: createFakePrompt(),
    proc: createProcSeam(),
    stdout,
    stderr,
    cwd,
    env: process.env,
  };
  return { ctx, stdout, stderr };
}

function writePackageJson(dir: string, scripts: Record<string, string>): void {
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "sample", version: "0.0.0", scripts }, null, 2),
  );
}

/**
 * A script that proves it actually ran by writing a marker file, rather
 * than by matching its own stdout: npm's "> node -e ..." preamble echoes a
 * script's source text to stdout regardless of whether it runs, so a text
 * match on stdout can't tell "ran" from "merely printed by npm".
 */
function markerScript(name: string, extra = ""): string {
  return `node -e "require('fs').writeFileSync('${name}.marker', '1')${extra ? `; ${extra}` : ""}"`;
}

void test("gate e2e: a passing project (typecheck, lint, test all pass) exits 0", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-pass-"));
  try {
    initRepo(dir);
    writePackageJson(dir, {
      typecheck: markerScript("typecheck"),
      lint: markerScript("lint"),
      test: markerScript("test"),
    });
    writeFileSync(path.join(dir, "index.js"), "module.exports = 1;\n");
    stageAll(dir);

    const { ctx } = makeContext(dir);
    const code = await gateCommand.run([], ctx);

    assert.equal(code, 0);
    for (const name of ["typecheck", "lint", "test"]) {
      assert.equal(
        existsSync(path.join(dir, `${name}.marker`)),
        true,
        `${name} should have run`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("gate e2e: a failing test script exits 1, but typecheck and lint still ran", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-fail-"));
  try {
    initRepo(dir);
    writePackageJson(dir, {
      typecheck: markerScript("typecheck"),
      lint: markerScript("lint"),
      test: markerScript("test", "process.exit(1)"),
    });
    writeFileSync(path.join(dir, "index.js"), "module.exports = 1;\n");
    stageAll(dir);

    const { ctx, stderr } = makeContext(dir);
    const code = await gateCommand.run([], ctx);

    assert.equal(code, 1);
    for (const name of ["typecheck", "lint", "test"]) {
      assert.equal(
        existsSync(path.join(dir, `${name}.marker`)),
        true,
        `${name} should have run`,
      );
    }
    assert.match(stderr.lines.join(""), /failed: test/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("gate e2e: code but no scripts in package.json exits 2, naming all three", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-noscripts-"));
  try {
    initRepo(dir);
    writePackageJson(dir, {});
    writeFileSync(path.join(dir, "index.js"), "module.exports = 1;\n");
    stageAll(dir);

    const { ctx, stderr } = makeContext(dir);
    const code = await gateCommand.run([], ctx);

    assert.equal(code, 2);
    const text = stderr.lines.join("");
    assert.match(text, /typecheck/);
    assert.match(text, /lint/);
    assert.match(text, /test/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("gate e2e: a docs-only project with no package.json passes", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-docs-"));
  try {
    initRepo(dir);
    writeFileSync(path.join(dir, "README.md"), "# Sample\n\nDocs only.\n");
    stageAll(dir);

    const { ctx } = makeContext(dir);
    const code = await gateCommand.run([], ctx);

    assert.equal(code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("gate e2e: CI=true reaches the scripts", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-ci-"));
  try {
    initRepo(dir);
    // npm echoes each script's own source text to stdout before running it
    // (a "> node -e ..." preamble), so the runtime marker is built by
    // concatenation: the contiguous string "CI-OK" never appears in the
    // script source itself, only in what it prints when it actually runs.
    const requiresCi =
      "node -e \"if (process.env.CI !== 'true') { process.exit(1) } else { console.log('CI' + '-OK') }\"";
    writePackageJson(dir, {
      typecheck: requiresCi,
      lint: requiresCi,
      test: requiresCi,
    });
    writeFileSync(path.join(dir, "index.js"), "module.exports = 1;\n");
    stageAll(dir);

    const { ctx, stdout } = makeContext(dir);
    const code = await gateCommand.run([], ctx);

    assert.equal(code, 0);
    const occurrences = stdout.lines.join("").match(/CI-OK/g) ?? [];
    assert.equal(occurrences.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("gate e2e: pnpm is detected from packageManager without needing pnpm on PATH (detection only, no run)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-pnpm-"));
  try {
    initRepo(dir);
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "sample",
        packageManager: "pnpm@10.34.5",
        scripts: {},
      }),
    );
    stageAll(dir);

    // detectPackageManager is pure: it never runs anything, so this proves
    // detection picks pnpm without pnpm needing to be on PATH.
    const { ctx } = makeContext(dir);
    const manager = await detectPackageManager(ctx, {
      packageManager: "pnpm@10.34.5",
    });
    assert.equal(manager, "pnpm");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("gate e2e: a nested worktree inside the project leaves the gate passing (P3.7)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-worktree-"));
  const nestedDir = path.join(dir, "nested-worktree");
  try {
    initRepo(dir);
    writeFileSync(path.join(dir, "README.md"), "# Sample\n\nDocs only.\n");
    execFileSync("git", ["commit", "--allow-empty", "-m", "root"], {
      cwd: dir,
    });
    stageAll(dir);
    execFileSync("git", ["commit", "-m", "add readme"], { cwd: dir });

    mkdirSync(nestedDir);
    execFileSync("git", ["worktree", "add", "-b", "nested-branch", nestedDir], {
      cwd: dir,
    });
    // Give the nested worktree its own oversized, badly-scripted project —
    // none of it should ever be seen by the outer gate.
    writeFileSync(path.join(nestedDir, "big.ts"), "line\n".repeat(1000));

    const { ctx } = makeContext(dir);
    const code = await gateCommand.run([], ctx);

    assert.equal(code, 0);
  } finally {
    try {
      execFileSync("git", ["worktree", "remove", "--force", nestedDir], {
        cwd: dir,
      });
    } catch {
      // Best-effort: the outer rmSync below removes everything regardless.
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
