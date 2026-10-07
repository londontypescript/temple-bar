// Integration test: a real temp git repo, the real filesystem and the real
// hook installer (hooks/install.ts), with only gh and the prompt faked so
// nothing reaches GitHub.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { freshAgentsMd } from "./agents-template.ts";
import { createInitCommand } from "./command.ts";
import { COMPANION_FILES } from "./companion-docs.ts";
import { JUDGE_RULESET_NAME } from "./judge-ruleset.ts";
import { codeScanningAnswer } from "./testing/code-scanning-fake.ts";
import { PNPM_USER_AGENT } from "./testing/command-fixture.ts";
import { CHECKED_WORKFLOWS } from "./workflows.ts";
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

/** gh installed and signed in; GitHub already has both rulesets, and
 * requires CodeQL. */
function fakeGhScript(args: readonly string[]): GhResult {
  if (args[0] === "--version") {
    return { code: 0, stdout: "gh 2.0.0", stderr: "", notFound: false };
  }
  const codeScanning = codeScanningAnswer(args, "required");
  if (codeScanning !== undefined) {
    return codeScanning;
  }
  if (args.some((a) => a.endsWith("/rulesets"))) {
    return {
      code: 0,
      stdout: JSON.stringify([
        { target: "branch", name: "main: pull requests only" },
        { target: "branch", name: JUDGE_RULESET_NAME },
      ]),
      stderr: "",
      notFound: false,
    };
  }
  return { code: 0, stdout: "", stderr: "", notFound: false };
}

/** The real context, run as `pnpm exec` runs setup, whatever runs the
 * tests: pnpm's version comes from this, and setup records it. */
function realContext(): Context {
  return {
    ...createRealContext(),
    env: { ...process.env, npm_config_user_agent: PNPM_USER_AGENT },
  };
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
      ...realContext(),
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
    assert.equal(agents, freshAgentsMd());
    for (const file of COMPANION_FILES) {
      assert.equal(
        readFileSync(path.join(dir, file.path), "utf8"),
        file.content,
      );
    }
    for (const workflow of CHECKED_WORKFLOWS) {
      const file = path.join(dir, workflow.path);
      assert.ok(existsSync(file), `the ${workflow.label} is written`);
      assert.equal(readFileSync(file, "utf8"), workflow.content);
    }
    const pkg = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    ) as { packageManager: string; scripts: Record<string, string> };
    assert.equal(pkg.scripts.prepare, "temple-bar hook install");
    assert.equal(pkg.scripts.gate, "temple-bar gate");
    assert.equal(pkg.packageManager, "pnpm@10.34.5");
    assert.ok(existsSync(path.join(dir, ".git", "hooks", "pre-commit")));
    assert.ok(
      existsSync(path.join(dir, ".git", "hooks", "reference-transaction")),
    );
    assert.ok(existsSync(path.join(dir, ".git", "hooks", "post-checkout")));
    // Unset, so git runs the hooks from the folder every worktree shares.
    assert.throws(() => gitConfig(dir, "core.hooksPath"));
    assert.equal(gitConfig(dir, "pull.ff"), "only");

    const secondStdout = createFakeWriter();
    const secondCode = await command.run([], { ...ctx, stdout: secondStdout });

    assert.equal(secondCode, 0);
    const second = secondStdout.lines.join("");
    assert.match(
      second,
      /AGENTS\.md already has temple-bar's rules; left it alone/,
    );
    assert.equal(readFileSync(path.join(dir, "AGENTS.md"), "utf8"), agents);
    assert.match(second, /already has the required scripts; left it alone/);
    assert.match(second, /Git hooks already installed; left them alone/);
    assert.doesNotMatch(second, /Next:/, "nothing to land on a second run");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("integration: an empty repo, yes: first commit has setup's files and no node_modules/, then GitHub, then hooks; a second run changes nothing", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-init-integration-"));
  try {
    initTestRepo(dir);
    mkdirSync(path.join(dir, "node_modules", "dep"), { recursive: true });
    writeFileSync(path.join(dir, "node_modules", "dep", "index.js"), "x");
    writeFileSync(path.join(dir, "keep.txt"), "already here");
    const ghCalls: string[] = [];
    const stderr = createFakeWriter();
    const ctx: Context = {
      ...realContext(),
      fs: createFsSeam(),
      // `gh repo create` is faked, but does what the real one does to the
      // local repo: adds origin. The hooks must not exist yet at that point.
      gh: createFakeGh((args) => {
        if (args[0] === "repo") {
          ghCalls.push(args.join(" "));
          assert.equal(
            existsSync(path.join(dir, ".git", "hooks", "pre-commit")),
            false,
          );
          execFileSync(
            "git",
            ["remote", "add", "origin", "git@github.com:acme/widgets.git"],
            { cwd: dir },
          );
          return { code: 0, stdout: "", stderr: "", notFound: false };
        }
        return fakeGhScript(args);
      }),
      prompt: createFakePrompt({ interactive: true, answer: "yes" }),
      stdout: createFakeWriter(),
      stderr,
      cwd: dir,
    };
    const command = createInitCommand({ installHooks });

    const code = await command.run([], ctx);

    assert.equal(code, 0, stderr.lines.join(""));
    assert.equal(ghCalls.length, 1);
    assert.match(ghCalls[0] ?? "", /--push$/);
    const tracked = execFileSync("git", ["ls-files"], {
      cwd: dir,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    assert.deepEqual(tracked, [
      ".github/workflows/temple-bar-gate.yml",
      ".github/workflows/temple-bar-judge.yml",
      ".github/workflows/temple-bar-pr-title.yml",
      ".gitignore",
      "AGENTS.md",
      "CLAUDE.md",
      "docs/adr/0000-template.md",
      "docs/agents-rationale.md",
      "docs/conventions.md",
      "docs/phase-boundaries.md",
      "keep.txt",
      "package.json",
    ]);
    assert.ok(existsSync(path.join(dir, ".git", "hooks", "pre-commit")));

    // Second run: origin exists now, so nothing is offered or written.
    const before = readFileSync(path.join(dir, ".gitignore"), "utf8");
    const secondCode = await command.run([], ctx);
    assert.equal(secondCode, 0);
    assert.equal(readFileSync(path.join(dir, ".gitignore"), "utf8"), before);
    assert.equal(ghCalls.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
