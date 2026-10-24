// Deciding how a run ended from what came back, and only from that. A pass
// needs everything at once: ssh exited 0, exactly one record for this run
// arrived last, it is valid and for the requested commit and the requested
// kind of run (the full run, or that one test file), and it lists every step
// as passed (install, check and build; or install, which may be skipped, and
// test). Anything less is not a pass.
//
// ssh exits with the runner's own exit code, which is 0 when every step
// passed and 1 when one failed or the run was refused. So the record and the
// exit code must agree: an all-pass record with exit 0 is 0, a failed or
// refused record with exit 1 is 1, and everything else (exit 255 when the
// connection dropped, a mismatch, no valid record) is 3, incomplete.

import {
  markerFor,
  stepsPassed,
  validateRecord,
  type ResultRecord,
  type RunRequest,
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
  request: RunRequest,
): Verdict {
  if (sshExit !== 0 && sshExit !== 1) {
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
  const record = validateRecord(parsed, runId, sha, request);
  if (record === undefined) {
    return { code: 3, reason: "no-result" };
  }
  const passed = record.refusal === null && stepsPassed(record.steps);
  if (sshExit !== (passed ? 0 : 1)) {
    return { code: 3, reason: "connection" };
  }
  return { code: passed ? 0 : 1, record };
}
