import assert from "node:assert/strict";
import { test } from "node:test";

import type { ResultRecord, RunRequest } from "./remote/record.ts";
import {
  makeRecord,
  makeTargetedRecord,
  recordLine,
  RUN_ID,
  SHA,
} from "./testing.ts";
import { judge } from "./verdict.ts";

const FILE = "scripts/windows-run/verdict.test.ts";
const FULL: RunRequest = { mode: "full" };
const ONLY: RunRequest = { mode: "only", file: FILE };

const code = (record: unknown, request: RunRequest, exit = 0): number =>
  judge([recordLine(record as ResultRecord)], RUN_ID, SHA, exit, request).code;

void test("a targeted record round-trips, with its install skipped or run", () => {
  const skipped = makeTargetedRecord(FILE);
  const verdict = judge([recordLine(skipped)], RUN_ID, SHA, 0, ONLY);
  assert.equal(verdict.code, 0);
  assert.deepEqual(verdict.record, skipped);
  const installed = makeTargetedRecord(FILE, {
    steps: [
      { name: "install", status: "passed", exitCode: 0, durationMs: 60_000 },
      { name: "test", status: "passed", exitCode: 0, durationMs: 9_000 },
    ],
  });
  assert.equal(code(installed, ONLY), 0);
});

void test("skipped is only ever a targeted run's install", () => {
  const skippedTest = makeTargetedRecord(FILE, {
    steps: [
      { name: "install", status: "passed", exitCode: 0, durationMs: 1 },
      { name: "test", status: "skipped", exitCode: null, durationMs: 0 },
    ],
  });
  assert.equal(code(skippedTest, ONLY), 3);
  const fullSkipped = makeRecord({
    steps: [
      { name: "install", status: "skipped", exitCode: null, durationMs: 0 },
      { name: "check", status: "passed", exitCode: 0, durationMs: 1 },
      { name: "build", status: "passed", exitCode: 0, durationMs: 1 },
    ],
  });
  assert.equal(code(fullSkipped, FULL), 3);
  // A skip carries no exit code: nothing ran.
  const withExit = makeTargetedRecord(FILE, {
    steps: [
      { name: "install", status: "skipped", exitCode: 0, durationMs: 0 },
      { name: "test", status: "passed", exitCode: 0, durationMs: 1 },
    ],
  });
  assert.equal(code(withExit, ONLY), 3);
});

void test("a record for another kind of run or another file is incomplete", () => {
  assert.equal(code(makeTargetedRecord(FILE), FULL), 3);
  assert.equal(code(makeRecord(), ONLY), 3);
  assert.equal(code(makeTargetedRecord("scripts/other.test.ts"), ONLY), 3);
  // The right file under the wrong mode, or a full record naming a file.
  assert.equal(code({ ...makeRecord(), file: FILE }, FULL), 3);
  assert.equal(code({ ...makeTargetedRecord(FILE), mode: "full" }, ONLY), 3);
});

void test("a targeted record has the targeted steps and no gate figures", () => {
  assert.equal(
    code({ ...makeTargetedRecord(FILE), gate: makeRecord().gate }, ONLY),
    3,
  );
  assert.equal(code({ ...makeRecord(), gate: null }, FULL), 3);
  assert.equal(
    code({ ...makeTargetedRecord(FILE), steps: makeRecord().steps }, ONLY),
    3,
  );
});

void test("a skipped install and a passed test agree only with exit 0", () => {
  assert.equal(code(makeTargetedRecord(FILE), ONLY, 1), 3);
  const failed = makeTargetedRecord(FILE, {
    steps: [
      { name: "install", status: "skipped", exitCode: null, durationMs: 0 },
      { name: "test", status: "failed", exitCode: 1, durationMs: 1 },
    ],
  });
  assert.equal(code(failed, ONLY, 1), 1);
  assert.equal(code(failed, ONLY, 0), 3);
});
