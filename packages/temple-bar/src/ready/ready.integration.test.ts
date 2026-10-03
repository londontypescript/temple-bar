// End to end for push-once: the real `ready` command with the real gate and
// seams, in a real repo with the real hooks installed, followed by a real
// `git push` through the pre-push hook. The gate runs the sample project's
// scripts with npm, so these tests don't need pnpm on PATH.

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { Context } from "../context.ts";
import {
  alignWithOrigin,
  createHookFixture,
  installRealHooks,
  runGit,
  type HookFixture,
} from "../hooks/testing/repo-fixture.ts";
import { createFsSeam } from "../seams/fs.ts";
import { createGhSeam } from "../seams/gh.ts";
import { createGitSeam } from "../seams/git.ts";
import { createProcSeam } from "../seams/proc.ts";
import {
  createFakeClock,
  createFakeHttp,
  createFakePrompt,
  createFakeWriter,
  type FakeWriter,
} from "../testing/fakes.ts";
import { readyCommand } from "./command.ts";

const PASS = 'node -e "process.exit(0)"';
const FAIL = 'node -e "process.exit(1)"';

function commitAll(dir: string, message: string): void {
  assert.equal(runGit(dir, ["add", "-A"]).code, 0);
  const commit = runGit(dir, ["commit", "-q", "-m", message]);
  assert.equal(commit.code, 0, commit.stderr);
}

/** A clone with the hooks installed, on a feature branch holding a small
 * project whose test script passes or fails as asked. */
function setUp(testScript: string): HookFixture {
  const fixture = createHookFixture();
  alignWithOrigin(fixture);
  assert.equal(installRealHooks(fixture).code, 0);
  runGit(fixture.repoDir, ["checkout", "-q", "-b", "feature"]);
  const manifest = {
    name: "sample",
    private: true,
    scripts: {
      typecheck: PASS,
      lint: PASS,
      "format:check": PASS,
      test: testScript,
    },
  };
  writeFileSync(
    path.join(fixture.repoDir, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(fixture.repoDir, ".gitignore"),
    "node_modules/\n",
    "utf8",
  );
  writeFileSync(path.join(fixture.repoDir, "index.js"), "export {};\n", "utf8");
  commitAll(fixture.repoDir, "feat: add the sample project");
  return fixture;
}

function runReady(dir: string): Promise<{
  code: number;
  stdout: FakeWriter;
  stderr: FakeWriter;
}> {
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const ctx: Context = {
    git: createGitSeam(process.env),
    gh: createGhSeam(process.env),
    http: createFakeHttp(),
    fs: createFsSeam(),
    clock: createFakeClock(),
    // No terminal, as for an agent.
    prompt: createFakePrompt(),
    proc: createProcSeam(),
    stdout,
    stderr,
    cwd: dir,
    env: process.env,
  };
  return readyCommand.run([], ctx).then((code) => ({ code, stdout, stderr }));
}

function pushFeature(fixture: HookFixture) {
  return runGit(fixture.repoDir, ["push", "origin", "feature"]);
}

void test("ready: a commit that passes the gate is marked, and then the push goes through", async () => {
  const fixture = setUp(PASS);
  try {
    const ready = await runReady(fixture.repoDir);
    assert.equal(ready.code, 0, ready.stderr.lines.join(""));
    assert.match(ready.stdout.lines.join(""), /gate: passed/);
    assert.match(ready.stdout.lines.join(""), /is marked ready to push/);

    const push = pushFeature(fixture);

    assert.equal(push.code, 0, push.stderr);
  } finally {
    fixture.cleanup();
  }
});

void test("ready: a failing gate marks nothing, so the push is refused", async () => {
  const fixture = setUp(FAIL);
  try {
    const ready = await runReady(fixture.repoDir);
    assert.equal(ready.code, 1);
    assert.match(ready.stderr.lines.join(""), /the gate did not pass/);

    const push = pushFeature(fixture);

    assert.notEqual(push.code, 0);
    assert.match(push.stderr, /has not been marked ready to push/);
  } finally {
    fixture.cleanup();
  }
});

void test("ready: a file that was never added is refused, since the push wouldn't carry it", async () => {
  const fixture = setUp(PASS);
  try {
    writeFileSync(path.join(fixture.repoDir, "forgotten.js"), "x\n", "utf8");

    const ready = await runReady(fixture.repoDir);

    assert.equal(ready.code, 1);
    assert.match(ready.stderr.lines.join(""), /\?\? forgotten\.js/);
    assert.notEqual(pushFeature(fixture).code, 0);
  } finally {
    fixture.cleanup();
  }
});

void test("ready: an AGENTS.md change without a terminal says to ask the user, and the push stays refused", async () => {
  const fixture = setUp(PASS);
  try {
    writeFileSync(path.join(fixture.repoDir, "AGENTS.md"), "# Rules\n", "utf8");
    commitAll(fixture.repoDir, "docs: add the rules");

    const ready = await runReady(fixture.repoDir);

    assert.equal(ready.code, 1);
    const out = ready.stderr.lines.join("");
    assert.match(
      out,
      /needs the user's yes before it is pushed: it changes AGENTS\.md/,
    );
    assert.match(
      out,
      /Ask the user to run `temple-bar ready` themselves, in a terminal/,
    );
    assert.notEqual(pushFeature(fixture).code, 0);
  } finally {
    fixture.cleanup();
  }
});
