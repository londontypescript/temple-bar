import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { rig, saved, type Rig } from "./local-testing.ts";
import { runLocal } from "./local.ts";
import { makeTargetedRecord, recordLine, RUN_ID } from "./testing.ts";

const ROOT_FILE = "scripts/a.test.ts";
const PACKAGE_FILE = "packages/p/src/b.test.ts";

/** A repo tracking a root and a package test file, a tracked file that is
 * not a test, a test file outside the test folders, and an ignored test
 * file on disk that git does not track. */
function onlyRig(t: TestContext): Rig {
  const r = rig(
    t,
    false,
    [ROOT_FILE, PACKAGE_FILE, "scripts/notes.ts", "docs/c.test.ts"],
    ["scripts/ignored.test.ts"],
  );
  r.onRun.lines = (sha) => [recordLine(makeTargetedRecord(ROOT_FILE, { sha }))];
  return r;
}

void test("--only sends the file as the runner's last argument, with --host in either order", async (t) => {
  for (const args of [
    ["--only", ROOT_FILE, "--host", "win-box"],
    ["--host", "win-box", "--only", ROOT_FILE],
  ]) {
    const r = onlyRig(t);
    assert.equal(await runLocal(args, r.deps), 0, args.join(" "));
    const run = r.calls.find((call) => call.startsWith("exec win-box node "));
    assert.ok(run?.endsWith(` ${RUN_ID} ${r.sha} ${ROOT_FILE}`), run);
    const summary = r.out.join("");
    assert.match(summary, /Windows run of scripts\/a\.test\.ts on /);
    assert.match(summary, /install skipped .*; test passed \(14 tests/);
    assert.match(
      summary,
      /This file passes on Windows; the rest of the suite was not run\./,
    );
  }
  // A package's file goes through the same way.
  const r = onlyRig(t);
  r.onRun.lines = (sha) => [
    recordLine(makeTargetedRecord(PACKAGE_FILE, { sha })),
  ];
  assert.equal(
    await runLocal(["--host", "h", "--only", PACKAGE_FILE], r.deps),
    0,
  );
});

void test("a repeated, unknown or valueless option is the usage error", async (t) => {
  for (const args of [
    ["--only", ROOT_FILE, "--only", ROOT_FILE],
    ["--host", "a", "--host", "b"],
    ["--only"],
    ["--only", ROOT_FILE, "--host"],
    ["--test", ROOT_FILE],
    [ROOT_FILE],
  ]) {
    const r = onlyRig(t);
    assert.equal(await runLocal(args, r.deps), 2, args.join(" "));
    assert.match(r.err.join(""), /Usage: pnpm windows-run \[--host/);
    assert.deepEqual(r.calls, []);
  }
});

void test("what isn't a tracked test file the suite runs is refused before anything is contacted", async (t) => {
  for (const file of [
    "scripts/ignored.test.ts",
    "scripts/missing.test.ts",
    "scripts/notes.ts",
    "docs/c.test.ts",
    "scripts/../scripts/a.test.ts",
    "scripts/a.test.ts&calc",
    "scripts/a b.test.ts",
    "/scripts/a.test.ts",
    "scripts",
  ]) {
    const r = onlyRig(t);
    assert.equal(
      await runLocal(["--host", "win-box", "--only", file], r.deps),
      2,
      file,
    );
    assert.deepEqual(r.calls, [], file);
    assert.equal(r.tempMade, 0, file);
    assert.equal(saved(r), undefined, file);
    assert.match(
      r.out.join(""),
      /^Windows run refused before contacting anything: that is not a tracked test file the suite runs\.\n$/,
      file,
    );
    assert.match(r.err.join(""), /windows-run: .*not a/, file);
  }
});

void test("a record for another file is incomplete, never a result", async (t) => {
  const r = onlyRig(t);
  r.onRun.lines = (sha) => [
    recordLine({
      ...makeTargetedRecord(ROOT_FILE, { sha }),
      file: PACKAGE_FILE,
    }),
  ];
  assert.equal(await runLocal(["--host", "h", "--only", ROOT_FILE], r.deps), 3);
  assert.match(
    r.out.join(""),
    /Windows run of scripts\/a\.test\.ts on .* is incomplete/,
  );
});

void test("a failed file is exit 1 and says do not push", async (t) => {
  const r = onlyRig(t);
  r.onRun.lines = (sha) => [
    recordLine(
      makeTargetedRecord(ROOT_FILE, {
        sha,
        steps: [
          { name: "install", status: "passed", exitCode: 0, durationMs: 5 },
          { name: "test", status: "failed", exitCode: 1, durationMs: 5 },
        ],
      }),
    ),
  ];
  r.onRun.exit = 1;
  assert.equal(await runLocal(["--host", "h", "--only", ROOT_FILE], r.deps), 1);
  assert.match(r.out.join(""), /test failed \(.*exit 1/);
  assert.match(r.out.join(""), /Fails on Windows; do not push\.\n$/);
});
