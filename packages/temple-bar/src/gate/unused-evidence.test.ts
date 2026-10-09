import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { ReporterOptions } from "knip";

import { createUnusedReport as evidence } from "./testing/unused-report.ts";
import { reportedFilePaths } from "./unused-evidence.ts";
import captureUnusedReport from "./unused-reporter.ts";

void test("only complete nonempty file findings without other failure causes qualify", () => {
  assert.deepEqual(reportedFilePaths(evidence()), ["/repo/empty.ts"]);
  for (const value of [
    null,
    {},
    { ...evidence(), hasConfigLoadErrors: true },
    { ...evidence(), isTreatConfigHintsAsErrors: true },
    { ...evidence(), tagHintCount: 1, isTreatTagHintsAsErrors: true },
    { ...evidence(), configurationHintCount: -1 },
  ])
    assert.equal(reportedFilePaths(value), undefined);
  const changed = evidence();
  changed.issues.exports = {
    "code.ts": { x: { type: "exports", filePath: "/repo/code.ts" } },
  };
  changed.counters.exports = 1;
  assert.equal(reportedFilePaths(changed), undefined);
  const empty = evidence();
  empty.issues.files = {};
  empty.counters.files = 0;
  assert.equal(reportedFilePaths(empty), undefined);
  const unknown = evidence();
  unknown.issues.future = {};
  assert.equal(reportedFilePaths(unknown), undefined);
  const mismatch = evidence();
  mismatch.counters.files = 2;
  assert.equal(reportedFilePaths(mismatch), undefined);
});

void test("capture reporter records public evidence without mutating it and refuses overwrites", async () => {
  const folder = await fs.mkdtemp(path.join(tmpdir(), "temple-bar-reporter-"));
  try {
    const outputPath = path.join(folder, "report.json");
    const input = {
      ...evidence(),
      configurationHints: [{ type: "package-entry", identifier: "empty.js" }],
      tagHints: new Set(),
      options: JSON.stringify({ outputPath }),
    } as unknown as ReporterOptions;
    const before = JSON.stringify(input);
    captureUnusedReport(input);
    assert.equal(JSON.stringify(input), before);
    assert.deepEqual(
      reportedFilePaths(JSON.parse(await fs.readFile(outputPath, "utf8"))),
      ["/repo/empty.ts"],
    );
    assert.throws(() => {
      captureUnusedReport(input);
    });
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
