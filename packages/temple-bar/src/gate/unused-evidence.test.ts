import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { ReporterOptions } from "knip";

import { createUnusedReport as evidence } from "./testing/unused-report.ts";
import { reportedFilePaths, reportedFindings } from "./unused-evidence.ts";
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

void test("findings in the selected groups are each located; anything unfamiliar is refused", () => {
  const mixed = evidence();
  mixed.issues.exports = {
    "/repo/code.ts": {
      a: { type: "exports", filePath: "/repo/code.ts" },
      b: { type: "exports", filePath: "/repo/code.ts" },
    },
  };
  mixed.issues.types = {
    "/repo/kinds.ts": { T: { type: "types", filePath: "/repo/kinds.ts" } },
  };
  mixed.counters.exports = 2;
  mixed.counters.types = 1;
  assert.deepEqual(reportedFindings(mixed), [
    { group: "files", filePath: "/repo/empty.ts" },
    { group: "exports", filePath: "/repo/code.ts" },
    { group: "exports", filePath: "/repo/code.ts" },
    { group: "types", filePath: "/repo/kinds.ts" },
  ]);
  // Only unused files can be comment-only.
  assert.equal(reportedFilePaths(mixed), undefined);

  const unselected = evidence();
  unselected.issues.dependencies = {
    "/repo/package.json": {
      x: { type: "dependencies", filePath: "/repo/package.json" },
    },
  };
  unselected.counters.dependencies = 1;
  assert.equal(reportedFindings(unselected), undefined);

  const miscounted = structuredClone(mixed);
  miscounted.counters.exports = 1;
  assert.equal(reportedFindings(miscounted), undefined);

  const mistyped = structuredClone(mixed);
  mistyped.issues.types = {
    "/repo/kinds.ts": { T: { type: "exports", filePath: "/repo/kinds.ts" } },
  };
  assert.equal(reportedFindings(mistyped), undefined);
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
