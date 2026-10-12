import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { configureTestRepoForScripts } from "./local-testing.ts";
import { runLocal } from "./local.ts";
import { hostFile } from "./host.ts";
import { git as realGit } from "./real.ts";
import { nodeFs } from "./remote/fsx.ts";
import { makeRecord, recordLine, RUN_ID, tempDir } from "./testing.ts";
import type { LocalDeps, Ssh } from "./seams.ts";

interface Rig {
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

function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function rig(t: TestContext, linked = false): Rig {
  const primary = tempDir(t);
  configureTestRepoForScripts(primary);
  const remote = path.join(primary, "scripts", "windows-run", "remote");
  mkdirSync(remote, { recursive: true });
  writeFileSync(path.join(remote, "main.ts"), "export const committed = 1;\n");
  writeFileSync(path.join(remote, "other.ts"), "export const other = 2;\n");
  writeFileSync(path.join(primary, ".gitignore"), ".temple-bar/\n");
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

const saved = (r: Rig): unknown =>
  existsSync(hostFile(r.primary))
    ? JSON.parse(readFileSync(hostFile(r.primary), "utf8"))
    : undefined;

void test("--host is saved in the primary checkout, also from a linked worktree, and a later run uses it", async (t) => {
  const r = rig(t, true);
  assert.equal(await runLocal(["--host", "win-box"], r.deps), 0);
  assert.deepEqual(saved(r), { host: "win-box" });
  assert.equal(existsSync(path.join(r.repo, ".temple-bar")), false);
  r.calls.length = 0;
  assert.equal(await runLocal([], r.deps), 0);
  assert.ok(
    r.calls.every((call) => call.includes("win-box")),
    r.calls.join("|"),
  );
  assert.ok(r.calls.some((call) => call.startsWith("exec win-box node ")));
});

void test("nothing saved and no --host is exit 2 with the command to set it, contacting nothing", async (t) => {
  const r = rig(t);
  assert.equal(await runLocal([], r.deps), 2);
  assert.match(r.err.join(""), /pnpm windows-run --host <ssh-destination>/);
  assert.deepEqual(r.calls, []);
  assert.equal(r.tempMade, 0);
});

void test("bad destinations are refused, given or saved, and nothing is saved", async (t) => {
  for (const bad of [
    "-oProxyCommand=x",
    "a b",
    "host:22",
    "h/ost",
    "[::1]",
    "ssh://h",
    "u@@h",
    "",
  ]) {
    const r = rig(t);
    assert.equal(await runLocal(["--host", bad], r.deps), 2, bad);
    assert.equal(saved(r), undefined);
    assert.deepEqual(r.calls, []);
  }
  for (const content of ["{not json", '{"host":"-bad"}', '{"host":5}', "[]"]) {
    const r = rig(t);
    mkdirSync(path.dirname(hostFile(r.primary)), { recursive: true });
    writeFileSync(hostFile(r.primary), content);
    assert.equal(await runLocal([], r.deps), 2, content);
    assert.match(r.err.join(""), /windows-run\.json/);
    assert.deepEqual(r.calls, []);
  }
});

void test("a dirty tree or an untracked file is exit 2 before any bundle or connection, and keeps the saved host", async (t) => {
  for (const change of ["edit", "untracked"]) {
    const r = rig(t);
    mkdirSync(path.dirname(hostFile(r.primary)), { recursive: true });
    writeFileSync(hostFile(r.primary), '{"host":"old-box"}');
    if (change === "edit") {
      writeFileSync(
        path.join(r.repo, "scripts/windows-run/remote/main.ts"),
        "x",
      );
    } else {
      writeFileSync(path.join(r.repo, "new.txt"), "x");
    }
    assert.equal(await runLocal(["--host", "new-box"], r.deps), 2);
    assert.deepEqual(r.calls, []);
    assert.equal(r.tempMade, 0);
    assert.deepEqual(saved(r), { host: "old-box" });
  }
});

void test("the local lock is taken before anything is copied and released after a failure", async (t) => {
  const r = rig(t);
  r.onCopy = () => 255;
  assert.equal(await runLocal(["--host", "win-box"], r.deps), 3);
  assert.ok(r.calls.some((call) => call.startsWith("copy")));
  assert.equal(
    existsSync(path.join(r.primary, ".temple-bar", "windows-run.lock")),
    false,
  );
  assert.match(r.err.join(""), /win-box/);
  assert.match(r.out.join(""), /incomplete/);
});

void test("an unreachable machine is incomplete and the saved host is not switched", async (t) => {
  const r = rig(t);
  r.onRun.exit = 255;
  assert.equal(await runLocal(["--host", "win-box"], r.deps), 3);
  assert.deepEqual(saved(r), { host: "win-box" });
});

void test("a live local holder refuses; a dead one is taken over and reported", async (t) => {
  const r = rig(t);
  const lock = path.join(r.primary, ".temple-bar", "windows-run.lock");
  mkdirSync(lock, { recursive: true });
  writeFileSync(
    path.join(lock, "owner.json"),
    JSON.stringify({ pid: 7, startMs: 1, runId: "deadbeef" }),
  );
  r.alive = true;
  assert.equal(await runLocal(["--host", "win-box"], r.deps), 2);
  assert.match(r.err.join(""), /another run is in progress/);
  assert.match(r.err.join(""), /windows-run\.lock/);
  assert.deepEqual(r.calls, []);
  assert.equal(saved(r), undefined);
  assert.ok(existsSync(path.join(lock, "owner.json")));
  r.alive = false;
  assert.equal(await runLocal(["--host", "win-box"], r.deps), 0);
  assert.match(r.err.join(""), /took over/);
});

void test("what is sent comes from the recorded commit, not from files on disk", async (t) => {
  const r = rig(t);
  let seen = "";
  r.onCopy = (local) => {
    if (local.endsWith("scripts")) {
      seen = readFileSync(
        path.join(local, "windows-run/remote/main.ts"),
        "utf8",
      );
    }
    return 0;
  };
  // Edited after the commit was recorded (the dirty check is already past).
  const real = r.deps.git;
  r.deps = {
    ...r.deps,
    git: {
      async run(args, cwd) {
        const result = await real.run(args, cwd);
        if (args[0] === "rev-parse") {
          writeFileSync(
            path.join(r.repo, "scripts/windows-run/remote/main.ts"),
            "tampered",
          );
        }
        return result;
      },
    },
  };
  assert.equal(await runLocal(["--host", "win-box"], r.deps), 0);
  assert.equal(seen, "export const committed = 1;\n");
  sh(r.repo, "checkout", "--", ".");
});

void test("the exit code follows the record: a failed step is 1, a forged or missing one is 3", async (t) => {
  const r = rig(t);
  r.onRun.lines = (sha) => [
    recordLine(
      makeRecord({
        sha,
        steps: [
          { name: "install", status: "failed", exitCode: 1, durationMs: 5 },
          { name: "check", status: "not-run", exitCode: null, durationMs: 0 },
          { name: "build", status: "not-run", exitCode: null, durationMs: 0 },
        ],
      }),
    ),
  ];
  // The runner exits 1 after a failed step, and ssh passes that on.
  r.onRun.exit = 1;
  assert.equal(await runLocal(["--host", "win-box"], r.deps), 1);
  assert.match(r.out.join(""), /Fails on Windows/);
  r.onRun.lines = () => ["  all steps passed"];
  r.onRun.exit = 0;
  assert.equal(await runLocal([], r.deps), 3);
  r.onRun.lines = (sha) => [recordLine(makeRecord({ sha }))];
  r.onRun.exit = 255;
  assert.equal(await runLocal([], r.deps), 3);
});

void test("the final summary holds none of the host or paths", async (t) => {
  const r = rig(t);
  assert.equal(await runLocal(["--host", "bob@secret-host"], r.deps), 0);
  const text = r.out.join("");
  const summary = text.slice(text.lastIndexOf("Windows run on"));
  assert.match(summary, /Passes locally; CI not yet seen\./);
  for (const secret of ["secret-host", "bob", r.primary, r.repo]) {
    assert.equal(summary.includes(secret), false);
  }
});

void test("a bundle failure changes nothing, the saved host included", async (t) => {
  const r = rig(t);
  const real = r.deps.git;
  r.deps = {
    ...r.deps,
    git: {
      run: (args, cwd) =>
        args[0] === "bundle" && args[1] === "create"
          ? Promise.resolve({ code: 1, stdout: "", stderr: "no" })
          : real.run(args, cwd),
    },
  };
  assert.equal(await runLocal(["--host", "new-box"], r.deps), 2);
  assert.equal(saved(r), undefined);
  assert.deepEqual(r.calls, []);
});
