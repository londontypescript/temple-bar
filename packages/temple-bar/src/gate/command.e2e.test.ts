// Integration tests against real temp git repos and the real seams (git,
// fs, proc), run with npm so these tests don't need pnpm on PATH. Sample
// projects: one passing, one with a failing test script, one with code but
// no scripts, one in another language, one with scripts missing or doing
// nothing, and one with only a README and no package.json.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { initTestRepo } from "../testing/git-repo.ts";
import { testGateCommand as gateCommand } from "./testing/fake-tools.ts";
import { detectPackageManager } from "./stack.ts";
import { installCore } from "./testing/core-fixture.ts";
import { realContext, stageAll } from "./testing/real-repo.ts";

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

void test("gate e2e: a passing project (every required script passes) exits 0, listing each check", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-pass-"));
  try {
    initTestRepo(dir);
    writePackageJson(dir, {
      typecheck: markerScript("typecheck"),
      lint: markerScript("lint"),
      "format:check": markerScript("format-check"),
      test: markerScript("test"),
    });
    writeFileSync(path.join(dir, "index.js"), "module.exports = 1;\n");
    await installCore(dir);
    stageAll(dir);

    const { ctx, stdout } = realContext(dir);
    const code = await gateCommand.run([], ctx);

    assert.equal(code, 0);
    for (const name of ["typecheck", "lint", "format-check", "test"]) {
      assert.equal(
        existsSync(path.join(dir, `${name}.marker`)),
        true,
        `${name} should have run`,
      );
    }
    const text = stdout.lines.join("");
    for (const check of ["typecheck", "lint", "format:check", "test"]) {
      assert.match(text, new RegExp(`^ {2}passed {3}${check}$`, "m"));
    }
    assert.match(text, /^ {2}passed {3}file-length cap \(all \d+ /m);
    assert.match(text, /^gate: passed$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("gate e2e: a failing test script exits 1, but the other scripts still ran", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-fail-"));
  try {
    initTestRepo(dir);
    writePackageJson(dir, {
      typecheck: markerScript("typecheck"),
      lint: markerScript("lint"),
      "format:check": markerScript("format-check"),
      test: markerScript("test", "process.exit(1)"),
    });
    writeFileSync(path.join(dir, "index.js"), "module.exports = 1;\n");
    await installCore(dir);
    stageAll(dir);

    const { ctx, stderr } = realContext(dir);
    const code = await gateCommand.run([], ctx);

    assert.equal(code, 1);
    for (const name of ["typecheck", "lint", "format-check", "test"]) {
      assert.equal(
        existsSync(path.join(dir, `${name}.marker`)),
        true,
        `${name} should have run`,
      );
    }
    assert.match(stderr.lines.join(""), /^ {2}failed {3}test \(exit 1\)$/m);
    assert.match(stderr.lines.join(""), /^gate: failed: test$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("gate e2e: code but no scripts in package.json exits 2, naming every required script", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-noscripts-"));
  try {
    initTestRepo(dir);
    writePackageJson(dir, {});
    writeFileSync(path.join(dir, "index.js"), "module.exports = 1;\n");
    await installCore(dir);
    stageAll(dir);

    const { ctx, stderr } = realContext(dir);
    const code = await gateCommand.run([], ctx);

    assert.equal(code, 2);
    const text = stderr.lines.join("");
    assert.match(
      text,
      /missing script\(s\): typecheck, lint, format:check, test\n/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("gate e2e: a fresh Rust project with no scripts exits 2 instead of skipping its checks", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-rust-"));
  try {
    initTestRepo(dir);
    writePackageJson(dir, {});
    writeFileSync(path.join(dir, "Cargo.toml"), '[package]\nname = "x"\n');
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "src", "main.rs"), "fn main() {}\n");
    await installCore(dir);
    stageAll(dir);

    const { ctx, stderr } = realContext(dir);
    const code = await gateCommand.run([], ctx);

    assert.equal(code, 2);
    assert.match(
      stderr.lines.join(""),
      /missing script\(s\): typecheck, lint, format:check, test\n/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("gate e2e: scripts that exist still run when another is missing or does nothing", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-gaps-"));
  try {
    initTestRepo(dir);
    writePackageJson(dir, {
      typecheck: markerScript("typecheck"),
      lint: "echo ok",
      test: markerScript("test", "process.exit(1)"),
    });
    writeFileSync(path.join(dir, "index.js"), "module.exports = 1;\n");
    await installCore(dir);
    stageAll(dir);

    const { ctx, stderr } = realContext(dir);
    const code = await gateCommand.run([], ctx);

    assert.equal(code, 2);
    for (const name of ["typecheck", "test"]) {
      assert.equal(
        existsSync(path.join(dir, `${name}.marker`)),
        true,
        `${name} should have run`,
      );
    }
    const text = stderr.lines.join("");
    assert.match(text, /missing script\(s\): format:check\n/);
    assert.match(text, /"lint" is "echo ok": replace it with /);
    assert.match(text, /^ {2}failed {3}test \(exit 1\)$/m);
    assert.match(text, /^gate: failed: lint, format:check, test$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("gate e2e: a repo with only a README and setup's files passes", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-docs-"));
  try {
    initTestRepo(dir);
    writeFileSync(path.join(dir, "README.md"), "# Sample\n\nDocs only.\n");
    await installCore(dir);
    stageAll(dir);

    const { ctx } = realContext(dir);
    const code = await gateCommand.run([], ctx);

    assert.equal(code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("gate e2e: CI=true reaches the scripts", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-ci-"));
  try {
    initTestRepo(dir);
    // npm echoes each script's own source text to stdout before running it
    // (a "> node -e ..." preamble), so the runtime marker is built by
    // concatenation: the contiguous string "CI-OK" never appears in the
    // script source itself, only in what it prints when it actually runs.
    const requiresCi =
      "node -e \"if (process.env.CI !== 'true') { process.exit(1) } else { console.log('CI' + '-OK') }\"";
    writePackageJson(dir, {
      typecheck: requiresCi,
      lint: requiresCi,
      "format:check": requiresCi,
      test: requiresCi,
    });
    writeFileSync(path.join(dir, "index.js"), "module.exports = 1;\n");
    await installCore(dir);
    stageAll(dir);

    const { ctx, stdout } = realContext(dir);
    const code = await gateCommand.run([], ctx);

    assert.equal(code, 0);
    const occurrences = stdout.lines.join("").match(/CI-OK/g) ?? [];
    assert.equal(occurrences.length, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("gate e2e: pnpm is detected from packageManager without needing pnpm on PATH (detection only, no run)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-pnpm-"));
  try {
    initTestRepo(dir);
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
    const { ctx } = realContext(dir);
    const manager = await detectPackageManager(ctx, {
      packageManager: "pnpm@10.34.5",
    });
    assert.equal(manager, "pnpm");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("gate e2e: a nested worktree inside the project leaves the gate passing", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-worktree-"));
  const nestedDir = path.join(dir, "nested-worktree");
  try {
    initTestRepo(dir);
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
    // After every commit and the worktree: from here on the hooks run, and
    // there is no temple-bar for them to find in this temp repo.
    await installCore(dir);

    const { ctx } = realContext(dir);
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

void test("gate e2e: a committed node_modules with symlinks is not code and never crashes the gate", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-vendored-"));
  try {
    initTestRepo(dir);
    writeFileSync(path.join(dir, "README.md"), "# Sample\n");
    const pkg = path.join(dir, "node_modules", "left-pad");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(path.join(pkg, "index.js"), "module.exports = 1;\n");
    // A directory symlink (like a workspace link), a file symlink and a
    // broken one, all committed (git mode 120000).
    mkdirSync(path.join(dir, "node_modules", "@scope"));
    symlinkSync(pkg, path.join(dir, "node_modules", "@scope", "dir-link"));
    symlinkSync(
      path.join(pkg, "index.js"),
      path.join(dir, "node_modules", "file-link.js"),
    );
    symlinkSync("nowhere", path.join(dir, "node_modules", "broken-link"));
    stageAll(dir);
    const modes = execFileSync("git", ["ls-files", "-s"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(modes.match(/^120000 /gm)?.length, 3);
    // After staging: setup's .gitignore leaves node_modules out of `git add`.
    await installCore(dir);

    const { ctx, stdout, stderr } = realContext(dir);
    const code = await gateCommand.run([], ctx);

    assert.equal(code, 0, stderr.lines.join(""));
    assert.doesNotMatch(stderr.lines.join(""), /EISDIR|missing script/);
    const text = stdout.lines.join("");
    assert.match(
      text,
      /^ {2}skipped {2}typecheck \(no content of its own yet\)$/m,
    );
    assert.match(text, /^gate: passed$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
