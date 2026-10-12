// Reads the totals out of `pnpm check`'s output as it streams past: the test
// runner's own summary, and the gate's closing report of what it skipped. A
// figure that can't be attributed with certainty (the summary is missing, or
// appears more than once) is "unknown": a guess in a pull-request summary is
// worse than an honest gap.

import { stripVTControlCharacters } from "node:util";

import type { Count } from "./record.ts";

const SUMMARY_LINE = /^(?:ℹ|#) (tests|pass|fail|skipped) (\d+)$/;
// The gate prints one row per check: two spaces, the status, the check's name.
const GATE_ROW = /^ {2}(passed|failed|missing|no-op|skipped)\s+(.+)$/;
const NO_GITHUB_SUFFIX = " (origin is not on GitHub)";

export interface CheckTotals {
  readonly tests: Count;
  readonly passed: Count;
  readonly failed: Count;
  readonly skipped: Count;
  readonly gateSkipped: Count;
  readonly gateNoGithubOrigin: boolean;
}

export class CheckScanner {
  readonly #figures = new Map<string, number[]>();
  #reports = 0;
  #inReport = false;
  #skippedRows: string[] = [];

  feed(rawLine: string): void {
    // Colour codes would hide a summary line from the patterns below.
    const line = stripVTControlCharacters(rawLine).trimEnd();
    const summary = SUMMARY_LINE.exec(line);
    if (summary?.[1] !== undefined && summary[2] !== undefined) {
      const seen = this.#figures.get(summary[1]) ?? [];
      seen.push(Number(summary[2]));
      this.#figures.set(summary[1], seen);
      return;
    }
    if (line === "gate: checks:") {
      this.#reports++;
      this.#inReport = true;
      this.#skippedRows = [];
    } else if (this.#inReport) {
      if (/^gate: (?:passed|failed)/.test(line)) {
        this.#inReport = false;
      } else {
        const row = GATE_ROW.exec(line);
        if (row?.[1] === "skipped" && row[2] !== undefined) {
          this.#skippedRows.push(row[2]);
        }
      }
    }
  }

  #figure(key: string): Count {
    const seen = this.#figures.get(key);
    return seen?.length === 1 && seen[0] !== undefined ? seen[0] : "unknown";
  }

  totals(): CheckTotals {
    const reportRead = this.#reports === 1 && !this.#inReport;
    return {
      tests: this.#figure("tests"),
      passed: this.#figure("pass"),
      failed: this.#figure("fail"),
      skipped: this.#figure("skipped"),
      gateSkipped: reportRead ? this.#skippedRows.length : "unknown",
      gateNoGithubOrigin:
        reportRead &&
        this.#skippedRows.length > 0 &&
        this.#skippedRows.every((row) => row.endsWith(NO_GITHUB_SUFFIX)),
    };
  }
}
