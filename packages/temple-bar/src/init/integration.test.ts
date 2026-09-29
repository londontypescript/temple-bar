// Integration test: a real temp git repo, the real filesystem and the real
// hook installer (hooks/install.ts), with only gh and the prompt faked so
// nothing reaches GitHub.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createInitCommand } from "./command.ts";
import { createRealContext } from "../context.ts";
import { installHooks } from "../hooks/install.ts";
import {
  createFakeGh,
  createFakePrompt,
  createFakeWriter,
} from "../testing/fakes.ts";
import { initTestRepo } from "../testing/git-repo.ts";
import { createFsSeam } from "../seams/fs.ts";
import type { Context } from "../context.ts";
import type { GhResult } from "../seams/gh.ts";

function makeRepo(withCommit: boolean): string {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-init-integration-"));
  initTestRepo(dir);
  execFileSync(
    "git",
    ["remote", "add", "origin", "git@github.com:acme/widgets.git"],
    { cwd: dir },
  );
  if (withCommit) {
    execFileSync("git", ["commit", "--allow-empty", "-m", "initial"], {
      cwd: dir,
    });
  }
  return dir;
}

/** gh installed and signed in; GitHub already has the `main` ruleset. */
function fakeGhScript(args: readonly string[]): GhResult {
  if (args[0] === "--version") {
    return { code: 0, stdout: "gh 2.0.0", stderr: "", notFound: false };
  }
  if (args.some((a) => a.endsWith("/rulesets"))) {
    return {
      code: 0,
      stdout: '[{"target":"branch"}]',
      stderr: "",
      notFound: false,
    };
  }
  return { code: 0, stdout: "", stderr: "", notFound: false };
}

function gitConfig(dir: string, key: string): string {
  return execFileSync("git", ["config", "--local", "--get", key], {
    cwd: dir,
    encoding: "utf8",
  }).trim();
}

void test("integration: init sets up a real repo (AGENTS.md, scripts, real hooks), and a second run writes nothing", async () => {
  const dir = makeRepo(true);
  try {
    const stderr = createFakeWriter();
    const ctx: Context = {
      ...createRealContext(),
      fs: createFsSeam(),
      gh: createFakeGh(fakeGhScript),
      prompt: createFakePrompt({ interactive: false, answer: "no-terminal" }),
      stdout: createFakeWriter(),
      stderr,
      cwd: dir,
    };
    const command = createInitCommand({ installHooks });

    const firstStdout = createFakeWriter();
    const code = await command.run([], { ...ctx, stdout: firstStdout });

    assert.equal(code, 0, stderr.lines.join(""));
    // The setup is uncommitted and main now refuses direct commits, so the
    // first run says how to land it through a pull request.
    assert.match(firstStdout.lines.join(""), /git switch -c temple-bar-setup/);
    assert.match(firstStdout.lines.join(""), /gh pr create/);
    const agents = readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    assert.match(agents, /pull requests the user merges/);
    const pkg = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    assert.equal(pkg.scripts.prepare, "temple-bar hook install");
    assert.equal(pkg.scripts.gate, "temple-bar gate");
    assert.ok(existsSync(path.join(dir, ".githooks", "pre-commit")));
    assert.ok(existsSync(path.join(dir, ".githooks", "reference-transaction")));
    assert.equal(gitConfig(dir, "core.hooksPath"), ".githooks");
    assert.equal(gitConfig(dir, "pull.ff"), "only");

    const secondStdout = createFakeWriter();
    const secondCode = await command.run([], { ...ctx, stdout: secondStdout });

    assert.equal(secondCode, 0);
    const second = secondStdout.lines.join("");
    assert.match(second, /AGENTS\.md already exists; left it alone/);
    assert.match(second, /already has the required scripts; left it alone/);
    assert.match(second, /Git hooks already installed; left them alone/);
    assert.doesNotMatch(second, /Next:/, "nothing to land on a second run");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("integration: a repo with no commits and no origin stops before writing anything", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-init-integration-"));
  try {
    initTestRepo(dir);
    const stderr = createFakeWriter();
    const ctx: Context = {
      ...createRealContext(),
      fs: createFsSeam(),
      gh: createFakeGh(fakeGhScript),
      prompt: createFakePrompt({ interactive: true, answer: "yes" }),
      stdout: createFakeWriter(),
      stderr,
      cwd: dir,
    };
    const command = createInitCommand({ installHooks });

    const code = await command.run([], ctx);

    assert.equal(code, 1);
    assert.match(stderr.lines.join(""), /no commits yet/);
    assert.equal(existsSync(path.join(dir, "AGENTS.md")), false);
    assert.equal(existsSync(path.join(dir, ".githooks")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
