// Runs rows of the regex-shapes check's example table: each row is code held
// as a string, never as a real test file, so this repository's own gate
// never reads an example as code. The parsers come through the check's own
// loader, as they do when the gate runs.

import assert from "node:assert/strict";

import { findShapes, type CodeFinding } from "../regex-shapes-code.ts";
import { loadParsers } from "../regex-shapes.ts";

export const PARSERS = await loadParsers();

export type Verdict = "refused" | "passed" | "reported";

export const R: Verdict = "refused";
export const P: Verdict = "passed";
export const U: Verdict = "reported";

function verdictOf(findings: readonly CodeFinding[]): Verdict {
  if (
    findings.some(
      (finding) =>
        finding.kind !== "deletes-tags" && finding.kind !== "unescaped-regexp",
    )
  ) {
    return "reported";
  }
  return findings.length > 0 ? "refused" : "passed";
}

/** Checks each row's verdict: [id, code, verdict, file name]. */
export function check(
  rows: readonly (readonly [string, string, Verdict, string?])[],
): void {
  for (const [id, code, expected, file = "a.test.ts"] of rows) {
    const findings = findShapes(file, code, PARSERS);
    assert.equal(
      verdictOf(findings),
      expected,
      `row ${id}: ${code}\n${JSON.stringify(findings)}`,
    );
  }
}
