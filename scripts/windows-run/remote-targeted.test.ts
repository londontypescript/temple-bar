import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { main } from "./remote/main.ts";
import type { RunRequest } from "./remote/record.ts";
import { runRemote } from "./remote/runner.ts";
import { summarize } from "./summary.ts";
import {
  fakeSys,
  lastRecord,
  RUN_ID,
  SHA,
  tempDir,
  type FakeSysOptions,
} from "./testing.ts";
import { judge } from "./verdict.ts";

const ROOT = "temple-bar-windows-run";
const FILE = "scripts/windows-run/verdict.test.ts";
const only = (file = FILE): RunRequest => ({ mode: "only", file });

function testLines(): string[] {
  return ["ℹ tests 14", "ℹ pass 14", "ℹ fail 0", "ℹ skipped 0"];
}

/** Runs a targeted run of FILE in `home`, as many times as asked, each on a
 * fresh fake machine sharing that home. */
async function targeted(home: string, options: Partial<FakeSysOptions> = {}) {
  const sys = fakeSys({
    home,
    steps: { test: { lines: testLines() } },
    ...options,
  });
  const code = await runRemote(RUN_ID, SHA, sys, only());
  return { sys, code, record: lastRecord(sys.printed) };
}

const installRecord = (home: string): string =>
  path.join(home, ROOT, "only-install.json");

void test("a targeted run runs exactly the named file, from its workspace's folder, and nothing else", async (t) => {
  const cases = [
    {
      file: FILE,
      cwd: [] as string[],
      args: [
        "scripts/run-tests.ts",
        "--import",
        "./scripts/isolate-git-config.ts",
        "--import",
        "./scripts/isolate-temp-folder.ts",
        "--test",
        FILE,
      ],
    },
    {
      file: "packages/temple-bar/src/gate/core.test.ts",
      cwd: ["packages", "temple-bar"],
      args: [
        "../../scripts/run-tests.ts",
        "--import",
        "../../scripts/isolate-git-config.ts",
        "--import",
        "../../scripts/isolate-temp-folder.ts",
        "--test",
        "src/gate/core.test.ts",
      ],
    },
  ];
  for (const { file, cwd, args } of cases) {
    const home = tempDir(t);
    const sys = fakeSys({ home, steps: { test: { lines: testLines() } } });
    assert.equal(await runRemote(RUN_ID, SHA, sys, only(file)), 0);
    assert.deepEqual(sys.stepsRun, ["install", "test"]);
    const worktree = path.join(home, ROOT, "only");
    assert.deepEqual(sys.specs[1], {
      command: "node",
      args,
      cwd: path.join(worktree, ...cwd),
    });
    const record = lastRecord(sys.printed);
    assert.equal(record.mode, "only");
    assert.equal(record.file, file);
    assert.equal(record.gate, null);
    assert.deepEqual(
      record.steps.map((step) => `${step.name} ${step.status}`),
      ["install passed", "test passed"],
    );
    assert.deepEqual(record.tests, {
      tests: 14,
      passed: 14,
      failed: 0,
      skipped: 0,
    });
    // The worktree is kept for the next targeted run; its ref is not.
    assert.ok(existsSync(worktree));
    assert.deepEqual(sys.deletedRefs, [`refs/windows-run/${RUN_ID}`]);
  }
});

void test("a failing file fails the run with its own output, and the local side says do not push", async (t) => {
  const sys = fakeSys({
    home: tempDir(t),
    steps: {
      test: { exitCode: 1, lines: ["not ok 1 - boom", ...testLines()] },
    },
  });
  const exit = await runRemote(RUN_ID, SHA, sys, only());
  assert.equal(exit, 1);
  assert.match(sys.printed, /\n {2}not ok 1 - boom\n/);
  const record = lastRecord(sys.printed);
  assert.deepEqual(record.steps[1], {
    name: "test",
    status: "failed",
    exitCode: 1,
    durationMs: 1000,
  });
  const lines = sys.printed.split("\n");
  const verdict = judge(lines, RUN_ID, SHA, exit, only());
  assert.equal(verdict.code, 1);
  const summary = summarize({
    kind: "result",
    record: verdict.record,
    file: FILE,
  });
  assert.match(
    summary,
    /^Windows run of scripts\/windows-run\/verdict\.test\.ts on 0123456 /,
  );
  assert.match(summary, /test failed \(14 tests, 0 skipped, exit 1, 1s\)/);
  assert.match(summary, /Fails on Windows; do not push\.$/);
});

void test("a matching install record skips the install, and the summary says so", async (t) => {
  const home = tempDir(t);
  const first = await targeted(home);
  assert.deepEqual(first.sys.stepsRun, ["install", "test"]);
  assert.ok(existsSync(installRecord(home)));

  const second = await targeted(home);
  assert.equal(second.code, 0);
  assert.deepEqual(second.sys.stepsRun, ["test"]);
  assert.deepEqual(second.record.steps[0], {
    name: "install",
    status: "skipped",
    exitCode: null,
    durationMs: 0,
  });
  assert.match(second.sys.printed, /step install: skipped/);
  const verdict = judge(second.sys.printed.split("\n"), RUN_ID, SHA, 0, only());
  assert.equal(verdict.code, 0);
  assert.equal(
    summarize({ kind: "result", record: verdict.record, file: FILE }),
    [
      "Windows run of scripts/windows-run/verdict.test.ts on 0123456 (Windows 10.0.19045, Node 24.20.0, pnpm 10.34.5, git 2.55.0):",
      "install skipped (unchanged since the last install); test passed (14 tests, 0 skipped, 1s).",
      "This file passes on Windows; the rest of the suite was not run.",
    ].join("\n"),
  );
});

void test("a missing record, a changed lockfile or workspace file, or another Node or pnpm installs, removing the record first and writing it after", async (t) => {
  const changes: Partial<FakeSysOptions>[] = [
    { blobs: { "pnpm-lock.yaml": "c".repeat(40) } },
    { blobs: { "pnpm-workspace.yaml": "d".repeat(40) } },
    { versions: { node: "24.21.0" } },
    { versions: { pnpm: "10.35.0" } },
  ];
  for (const change of [undefined, ...changes]) {
    const home = tempDir(t);
    if (change !== undefined) {
      await targeted(home);
    }
    const sys = fakeSys({ home, ...change });
    const realRunStep = sys.runStep.bind(sys);
    let recordAtInstall: boolean | undefined;
    sys.runStep = (spec, timeout, onLine) => {
      if (spec.args[0] === "install") {
        recordAtInstall = existsSync(installRecord(home));
      }
      return realRunStep(spec, timeout, onLine);
    };
    assert.equal(await runRemote(RUN_ID, SHA, sys, only()), 0);
    const why = JSON.stringify(change);
    assert.deepEqual(sys.stepsRun, ["install", "test"], why);
    assert.equal(recordAtInstall, false, why);
    const written: unknown = JSON.parse(
      readFileSync(installRecord(home), "utf8"),
    );
    assert.deepEqual(written, {
      lockfile: change?.blobs?.["pnpm-lock.yaml"] ?? "b".repeat(40),
      workspace: change?.blobs?.["pnpm-workspace.yaml"] ?? "b".repeat(40),
      node: change?.versions?.node ?? "24.20.0",
      pnpm: change?.versions?.pnpm ?? "10.34.5",
    });
  }
});

void test("a failed install writes no record, runs no test and fails the run", async (t) => {
  const home = tempDir(t);
  const { sys, code, record } = await targeted(home, {
    steps: { install: { exitCode: 1 } },
  });
  assert.equal(code, 1);
  assert.deepEqual(sys.stepsRun, ["install"]);
  assert.equal(existsSync(installRecord(home)), false);
  assert.deepEqual(
    record.steps.map((step) => step.status),
    ["failed", "not-run"],
  );
  // So the next run installs again.
  assert.deepEqual((await targeted(home)).sys.stepsRun, ["install", "test"]);
});

void test("the kept worktree is updated in place with hooks off, and one that can't be is made again and forgets the record", async (t) => {
  const home = tempDir(t);
  await targeted(home);
  const updated = await targeted(home);
  const worktree = path.join(home, ROOT, "only");
  const inWorktree = updated.sys.gitCalls
    .filter((call) => call.cwd === worktree)
    .map((call) => call.args.join(" "));
  assert.deepEqual(inWorktree, [
    "rev-parse --show-toplevel",
    `-c core.hooksPath=NUL checkout --quiet --detach --force ${SHA}`,
    "-c core.hooksPath=NUL clean -ffdx --quiet -e node_modules",
    "rev-parse HEAD",
  ]);
  assert.equal(
    updated.sys.gitCalls.some((call) => call.args.includes("add")),
    false,
  );

  const remade = await targeted(home, {
    failGit: (args) => args.includes(" checkout "),
  });
  assert.equal(remade.code, 0);
  assert.match(remade.sys.printed, /kept worktree could not be updated/);
  assert.ok(remade.sys.gitCalls.some((call) => call.args.includes("add")));
  assert.deepEqual(remade.sys.stepsRun, ["install", "test"]);

  // A second failure, making it afresh, refuses the run.
  const failing = await targeted(home, {
    failGit: (args) => args.includes(" checkout ") || args.includes(" add "),
  });
  assert.equal(failing.code, 1);
  assert.equal(failing.record.refusal, "checkout-failed");
  assert.deepEqual(failing.sys.stepsRun, []);
});

void test("a kept worktree at another commit is a commit mismatch", async (t) => {
  const home = tempDir(t);
  await targeted(home);
  const { code, record, sys } = await targeted(home, {
    headSha: "f".repeat(40),
  });
  assert.equal(code, 1);
  assert.equal(record.refusal, "commit-mismatch");
  assert.deepEqual(sys.stepsRun, []);
});

void test("the entry point refuses a third argument that is not a test file the suite runs", async () => {
  const started: RunRequest[] = [];
  const start = (
    _runId: string,
    _sha: string,
    _sys: unknown,
    request?: RunRequest,
  ): Promise<number> => {
    started.push(request ?? { mode: "full" });
    return Promise.resolve(0);
  };
  for (const bad of [
    "../x.test.ts",
    "scripts/a.ts",
    "docs/a.test.ts",
    "scripts/a b.test.ts",
    "scripts/a&b.test.ts",
  ]) {
    assert.equal(await main([RUN_ID, SHA, bad], start), 2, bad);
  }
  assert.equal(await main([RUN_ID, SHA, FILE, "extra"], start), 2);
  assert.deepEqual(started, []);
  assert.equal(await main([RUN_ID, SHA, FILE], start), 0);
  assert.equal(await main([RUN_ID, SHA], start), 0);
  assert.deepEqual(started, [only(), { mode: "full" }]);
});
