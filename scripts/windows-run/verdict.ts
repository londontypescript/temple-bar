// Deciding how a run ended from what came back, and only from that. A pass
// needs everything at once: ssh exited 0, exactly one record for this run
// arrived last, it is valid and for the requested commit, and it lists
// install, check and build as passed. Anything less is not a pass.
//
// Precedence: an ssh that did not exit 0, or no valid record, is 3 (the run
// is incomplete) whatever a record says; otherwise a valid record with a
// failed, refused or not-run step is 1; only a valid all-pass record with ssh
// exit 0 is 0.

import {
  markerFor,
  validateRecord,
  type ResultRecord,
} from "./remote/record.ts";

type IncompleteReason = "connection" | "no-result";

export type Verdict =
  | { readonly code: 0 | 1; readonly record: ResultRecord }
  | { readonly code: 3; readonly reason: IncompleteReason };

/**
 * `lines` are the runner's stdout lines, split on line ends. Only lines that
 * start with this run's marker are candidates: every line a step prints is
 * indented by the runner, so none can.
 */
export function judge(
  lines: readonly string[],
  runId: string,
  sha: string,
  sshExit: number,
): Verdict {
  if (sshExit !== 0) {
    return { code: 3, reason: "connection" };
  }
  const marker = markerFor(runId);
  const candidates = lines.filter((line) => line.startsWith(marker));
  const lastLine = [...lines].reverse().find((line) => line.trim() !== "");
  const only = candidates[0];
  if (candidates.length !== 1 || only === undefined || only !== lastLine) {
    return { code: 3, reason: "no-result" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(only.slice(marker.length));
  } catch {
    return { code: 3, reason: "no-result" };
  }
  const record = validateRecord(parsed, runId, sha);
  if (record === undefined) {
    return { code: 3, reason: "no-result" };
  }
  const passed =
    record.refusal === null &&
    record.steps.every((step) => step.status === "passed");
  return { code: passed ? 0 : 1, record };
}
