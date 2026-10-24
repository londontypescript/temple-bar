// The local side's test rig: a real git repo committing as a known identity,
// and fakes for ssh and everything else the local side reaches through
// `LocalDeps`, recording what was contacted.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TestContext } from "node:test";

import { hostFile } from "./host.ts";
import { git as realGit } from "./real.ts";
import { nodeFs } from "./remote/fsx.ts";
import type { LocalDeps, Ssh } from "./seams.ts";
import { makeRecord, recordLine, RUN_ID, tempDir } from "./testing.ts";

export function configureTestRepoForScripts(dir: string): void {
  execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
}

export interface Rig {
  primary: string;
  repo: string;
  sha: string;
  calls: string[];
  out: string[];
  err: string[];
  tempMade: number;
  deps: LocalDeps;
  /** Runs when the runner is started. */
  onRun: { lines: (sha: string) => string[]; exit: number };
  onCopy: (local: string, dest: string) => number;
  alive: boolean;
}

export function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** `files` are committed too, by repo-relative path; `ignored` are written
 * to disk and gitignored, so the tree stays clean without tracking them. */
export function rig(
  t: TestContext,
  linked = false,
  files: readonly string[] = [],
  ignored: readonly string[] = [],
): Rig {
  const primary = tempDir(t);
  configureTestRepoForScripts(primary);
  const remote = path.join(primary, "scripts", "windows-run", "remote");
  mkdirSync(remote, { recursive: true });
  writeFileSync(path.join(remote, "main.ts"), "export const committed = 1;\n");
  writeFileSync(path.join(remote, "other.ts"), "export const other = 2;\n");
  for (const file of [...files, ...ignored]) {
    mkdirSync(path.dirname(path.join(primary, file)), { recursive: true });
    writeFileSync(path.join(primary, file), "export {};\n");
  }
  writeFileSync(
    path.join(primary, ".gitignore"),
    [".temple-bar/", ...ignored, ""].join("\n"),
  );
  sh(primary, "add", ".");
  sh(primary, "commit", "-qm", "initial");
  let repo = primary;
  if (linked) {
    repo = path.join(tempDir(t), "wt");
    sh(primary, "worktree", "add", "-q", "--detach", repo);
  }
  const sha = sh(repo, "rev-parse", "HEAD");
  const r: Rig = {
    primary,
    repo,
    sha,
    calls: [],
    out: [],
    err: [],
    tempMade: 0,
    deps: undefined as unknown as LocalDeps,
    onRun: { lines: (s) => [recordLine(makeRecord({ sha: s }))], exit: 0 },
    onCopy: () => 0,
    alive: false,
  };
  const ssh: Ssh = {
    exec(host, remote, onStdout) {
      r.calls.push(`exec ${host} ${remote.join(" ")}`);
      if (remote[0] === "node") {
        for (const line of r.onRun.lines(r.sha)) {
          onStdout(Buffer.from(`${line}\n`));
        }
        return Promise.resolve(r.onRun.exit);
      }
      return Promise.resolve(
        remote[0] === "mkdir" && r.onRun.exit === 255 ? 255 : 0,
      );
    },
    copy(host, local, dest) {
      // The lock is already taken by the time anything is copied.
      assert.ok(
        existsSync(path.join(primary, ".temple-bar", "windows-run.lock")),
      );
      r.calls.push(`copy ${host} ${dest}`);
      return Promise.resolve(r.onCopy(local, dest));
    },
  };
  r.deps = {
    cwd: repo,
    git: realGit,
    ssh,
    fs: nodeFs,
    stdout: { write: (s) => void r.out.push(s) },
    stderr: { write: (s) => void r.err.push(s) },
    makeTempDir: async () => {
      r.tempMade++;
      const dir = path.join(tempDir(t), "send");
      await nodeFs.mkdir(dir);
      return dir;
    },
    randomHex: () => RUN_ID,
    self: { pid: 4242, startMs: 1000 },
    sleep: () => Promise.resolve(),
    isAlive: () => Promise.resolve(r.alive),
  };
  return r;
}

export const saved = (r: Rig): unknown =>
  existsSync(hostFile(r.primary))
    ? JSON.parse(readFileSync(hostFile(r.primary), "utf8"))
    : undefined;
