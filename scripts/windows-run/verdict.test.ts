import assert from "node:assert/strict";
import { test } from "node:test";

import { markerFor, type ResultRecord } from "./remote/record.ts";
import { makeRecord, recordLine, RUN_ID, SHA } from "./testing.ts";
import { summarize } from "./summary.ts";
import { judge } from "./verdict.ts";

const pass = (): string[] => ["  noise", recordLine()];
const failed = (): ResultRecord =>
  makeRecord({
    steps: [
      { name: "install", status: "passed", exitCode: 0, durationMs: 10 },
      { name: "check", status: "failed", exitCode: 1, durationMs: 10 },
      { name: "build", status: "not-run", exitCode: null, durationMs: 0 },
    ],
  });

void test("only a valid all-pass record with ssh exit 0 is a pass", () => {
  assert.equal(judge(pass(), RUN_ID, SHA, 0).code, 0);
});

void test("a passing record followed by ssh exit 255 is incomplete", () => {
  assert.equal(judge(pass(), RUN_ID, SHA, 255).code, 3);
});

void test("a failed-step record with the runner's exit 1 is 1, and 3 when the exit code disagrees", () => {
  assert.equal(judge([recordLine(failed())], RUN_ID, SHA, 1).code, 1);
  assert.equal(judge([recordLine(failed())], RUN_ID, SHA, 255).code, 3);
  assert.equal(judge([recordLine(failed())], RUN_ID, SHA, 0).code, 3);
  assert.equal(judge(pass(), RUN_ID, SHA, 1).code, 3);
});

void test("output with no record is incomplete, even after passing steps", () => {
  assert.equal(judge(["  install ok", "  check ok"], RUN_ID, SHA, 0).code, 3);
});

void test("a record that is not last, doubled, for another commit or short a step never passes", () => {
  assert.equal(
    judge([recordLine(), "windows-run: more"], RUN_ID, SHA, 0).code,
    3,
  );
  assert.equal(judge([recordLine(), recordLine()], RUN_ID, SHA, 0).code, 3);
  assert.equal(
    judge([recordLine(makeRecord({ sha: "f".repeat(40) }))], RUN_ID, SHA, 0)
      .code,
    3,
  );
  const short = { ...makeRecord(), steps: makeRecord().steps.slice(0, 2) };
  assert.equal(
    judge([recordLine(short as ResultRecord)], RUN_ID, SHA, 0).code,
    3,
  );
  const contradictory = makeRecord({
    steps: [
      { name: "install", status: "failed", exitCode: 1, durationMs: 1 },
      { name: "check", status: "passed", exitCode: 0, durationMs: 1 },
      { name: "build", status: "passed", exitCode: 0, durationMs: 1 },
    ],
  });
  assert.equal(judge([recordLine(contradictory)], RUN_ID, SHA, 0).code, 3);
  const badVersion = makeRecord({
    versions: { node: "C:\\Users\\bob", pnpm: "1.0.0", git: "1.0.0" },
  });
  assert.equal(judge([recordLine(badVersion)], RUN_ID, SHA, 0).code, 3);
});

void test("an indented line, or another run's record, is never read as the record", () => {
  const forged = `  ${recordLine()}`;
  assert.equal(judge([forged], RUN_ID, SHA, 0).code, 3);
  const other = recordLine(makeRecord({ runId: "bbbbbbbb" })).replace(
    markerFor("bbbbbbbb"),
    markerFor("bbbbbbbb"),
  );
  assert.equal(judge([other], RUN_ID, SHA, 0).code, 3);
  // The real record still wins when a step echoed the marker, indented.
  assert.equal(
    judge([`  ${markerFor(RUN_ID)}{}`, recordLine()], RUN_ID, SHA, 0).code,
    0,
  );
});

void test("summaries are built only from allowlisted fields", () => {
  const secrets = [
    "secret-host",
    "C:\\Users\\bob",
    "/Users/bob",
    "bob@secret-host",
  ];
  const dirty = makeRecord({
    cleanup: secrets.map((s) => `could not remove ${s}`),
  });
  const failedDirty = { ...failed(), cleanup: dirty.cleanup };
  const texts = [
    summarize({ kind: "result", record: dirty }),
    summarize({ kind: "result", record: failedDirty }),
    summarize({
      kind: "result",
      record: makeRecord({
        refusal: "lock-held",
        steps: makeRecord().steps.map((s) => ({
          ...s,
          status: "not-run",
          exitCode: null,
          durationMs: 0,
        })),
      }),
    }),
    summarize({ kind: "incomplete", sha: SHA, why: "unreachable" }),
    summarize({ kind: "incomplete", sha: SHA, why: "connection" }),
    ...(
      [
        "no-host",
        "bad-host",
        "dirty-tree",
        "not-a-checkout",
        "local-lock-held",
        "bundle-failed",
      ] as const
    ).map((reason) => summarize({ kind: "refused", reason })),
  ];
  for (const text of texts) {
    for (const secret of secrets) {
      assert.equal(text.includes(secret), false, text);
    }
  }
  assert.match(
    texts[0] ?? "",
    /Windows run on 0123456 \(Windows 10\.0\.19045, Node 24\.20\.0, pnpm 10\.34\.5, git 2\.55\.0\)/,
  );
  assert.match(texts[0] ?? "", /Cleanup problems on Windows: 4/);
  assert.match(texts[0] ?? "", /Passes locally; CI not yet seen\./);
  assert.match(texts[1] ?? "", /check failed \(.*exit 1/);
  assert.match(texts[1] ?? "", /build not run/);
});
