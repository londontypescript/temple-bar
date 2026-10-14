import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { devNull } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { configureTestRepoForScripts } from "./local-testing.ts";
import { capture } from "./remote/real.ts";
import { runRemote } from "./remote/runner.ts";
import { fakeSys, lastRecord, RUN_ID, tempDir } from "./testing.ts";

function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

void test("the clone gets the bundle's tags, and keeps no tag the bundle lacks", async (t) => {
  const source = tempDir(t);
  configureTestRepoForScripts(source);
  writeFileSync(path.join(source, "a.txt"), "a\n");
  sh(source, "add", ".");
  sh(source, "commit", "-qm", "first");
  sh(source, "tag", "v0.0.1");
  writeFileSync(path.join(source, "a.txt"), "b\n");
  sh(source, "commit", "-qam", "second");
  sh(source, "tag", "v0.0.2");
  const sha = sh(source, "rev-parse", "HEAD");

  // A clone left by an earlier run, holding a tag since deleted.
  const home = tempDir(t);
  const root = path.join(home, "temple-bar-windows-run");
  const clone = path.join(root, "clone");
  mkdirSync(clone, { recursive: true });
  sh(clone, "init", "-q");
  sh(clone, "fetch", "-q", source, "HEAD:refs/heads/old");
  sh(clone, "tag", "v0.0.0-gone", "refs/heads/old");

  const incoming = path.join(root, "incoming", RUN_ID);
  mkdirSync(incoming, { recursive: true });
  sh(
    source,
    "bundle",
    "create",
    path.join(incoming, "run.bundle"),
    "HEAD",
    "--tags",
  );

  // Real git for the checkout; the machine check still asks the fake where
  // Git lives, since this isn't Windows.
  const sys = fakeSys({ home });
  const fakeGit = sys.git.bind(sys);
  sys.git = (args, cwd) =>
    args[0] === "--exec-path"
      ? fakeGit(args, cwd)
      : capture("git", args, cwd === undefined ? {} : { cwd });
  Object.assign(sys, { devNull });
  assert.equal(await runRemote(RUN_ID, sha, sys), 0);
  assert.equal(lastRecord(sys.printed).refusal, null);
  assert.deepEqual(sh(clone, "tag", "--list").split("\n"), [
    "v0.0.1",
    "v0.0.2",
  ]);
});
