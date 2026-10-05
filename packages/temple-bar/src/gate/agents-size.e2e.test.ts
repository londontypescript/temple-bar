// The AGENTS.md size check against a real temp git repo and the real seams:
// a 201-line AGENTS.md refuses, the same file trimmed to 200 lines passes.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { Context } from "../context.ts";
import { createFsSeam } from "../seams/fs.ts";
import { createGhSeam } from "../seams/gh.ts";
import { createGitSeam } from "../seams/git.ts";
import { createProcSeam } from "../seams/proc.ts";
import {
  createFakeClock,
  createFakePrompt,
  createFakeWriter,
  createFakeHttp,
} from "../testing/fakes.ts";
import { initTestRepo } from "../testing/git-repo.ts";
import { testGateCommand as gateCommand } from "./testing/fake-tools.ts";
import { installCore } from "./testing/core-fixture.ts";

function linesOf(count: number): string {
  return `${Array.from({ length: count }, (_, i) => `rule ${String(i)}`).join("\n")}\n`;
}

async function runGateIn(dir: string) {
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const ctx: Context = {
    git: createGitSeam(),
    gh: createGhSeam(),
    http: createFakeHttp(),
    fs: createFsSeam(),
    clock: createFakeClock(),
    prompt: createFakePrompt(),
    proc: createProcSeam(),
    stdout,
    stderr,
    cwd: dir,
    env: process.env,
  };
  const code = await gateCommand.run([], ctx);
  return { code, out: stdout.lines.join(""), err: stderr.lines.join("") };
}

void test("gate e2e: a 201-line AGENTS.md is refused, and trimmed to 200 lines it passes", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-agents-"));
  try {
    initTestRepo(dir);
    writeFileSync(path.join(dir, "README.md"), "hello\n");
    // After setup, which would otherwise add its own rules to the file.
    await installCore(dir);
    writeFileSync(path.join(dir, "AGENTS.md"), linesOf(201));
    execFileSync("git", ["add", "-A"], { cwd: dir });

    const over = await runGateIn(dir);
    // The refusal message comes first so a failure shows what the check
    // should have said, not just a wrong exit code.
    assert.match(over.err, /gate: AGENTS\.md is over its size limit:/);
    assert.match(over.err, /201 lines \(limit 200\)/);
    assert.equal(over.code, 1);

    writeFileSync(path.join(dir, "AGENTS.md"), linesOf(200));
    const trimmed = await runGateIn(dir);
    assert.equal(trimmed.code, 0);
    assert.match(trimmed.out, /passed {3}AGENTS\.md size/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
