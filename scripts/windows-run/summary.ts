// The Markdown block to paste into a pull request. It is built from
// allowlisted fields only (short commit, tool versions, Windows release, step
// statuses and durations, test and gate totals, fixed wording, and a targeted
// run's test file as the local side validated it), never from free text: the
// input types hold no string that came from a machine or an error. The test
// file is the one checked here against the path rule and the commit's tree;
// the record's copy only has to equal it. Raw diagnostics stay in the
// terminal and the private logs.

import {
  stepsPassed,
  type Count,
  type ResultRecord,
  type StepRecord,
} from "./remote/record.ts";

export type LocalRefusal =
  | "no-host"
  | "bad-host"
  | "dirty-tree"
  | "not-a-checkout"
  | "local-lock-held"
  | "bundle-failed"
  | "not-a-test-file";

const REFUSAL_TEXT: Record<LocalRefusal, string> = {
  "no-host": "no Windows machine is saved",
  "bad-host": "the SSH destination is not valid",
  "dirty-tree": "the tree has uncommitted or untracked changes",
  "not-a-checkout": "this is not a usable checkout",
  "local-lock-held": "another run is in progress from this checkout",
  "bundle-failed": "the commit could not be bundled",
  "not-a-test-file": "that is not a tracked test file the suite runs",
};

const INCOMPLETE_TEXT = {
  unreachable: "the Windows machine could not be reached",
  connection: "the connection ended before the run finished",
  "no-result": "no valid result came back",
} as const;

/** `file` is a targeted run's test file, as validated here. */
export type SummaryInput =
  | { readonly kind: "refused"; readonly reason: LocalRefusal }
  | {
      readonly kind: "incomplete";
      readonly sha: string;
      readonly why: keyof typeof INCOMPLETE_TEXT;
      readonly file?: string;
    }
  | {
      readonly kind: "result";
      readonly record: ResultRecord;
      readonly file?: string;
    };

const WINDOWS_REFUSAL_TEXT: Record<
  NonNullable<ResultRecord["refusal"]>,
  string
> = {
  "lock-held": "another run was in progress on Windows",
  "sweep-failed": "a leftover process from an earlier run would not stop",
  "machine-not-ready":
    "the Windows machine can't yet do what CI's runners can (sh, links or taskkill)",
  "fetch-failed": "the commit could not be fetched",
  "checkout-failed": "the commit could not be checked out",
  "commit-mismatch": "the checkout was not the requested commit",
  "runner-error": "the runner hit an unexpected error",
};

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function seconds(ms: number): string {
  const total = Math.round(ms / 1000);
  return total >= 60
    ? `${String(Math.floor(total / 60))}m ${String(total % 60)}s`
    : `${String(total)}s`;
}

function plural(figure: Count, word: string): string {
  return `${String(figure)} ${word}`;
}

function describeStep(step: StepRecord, record: ResultRecord): string {
  if (step.status === "not-run") {
    return `${step.name} not run`;
  }
  if (step.status === "skipped") {
    return `${step.name} skipped (unchanged since the last install)`;
  }
  const label =
    step.status === "timed-out"
      ? `${step.name} timed out`
      : `${step.name} ${step.status}`;
  const details = [seconds(step.durationMs)];
  if (step.status === "failed" && step.exitCode !== null) {
    details.unshift(`exit ${String(step.exitCode)}`);
  }
  if (step.name === "check" || step.name === "test") {
    const { tests, failed, skipped } = record.tests;
    details.unshift(
      plural(tests, "tests"),
      ...(failed === 0 ? [] : [plural(failed, "failed")]),
      plural(skipped, "skipped"),
    );
  }
  if (step.name === "check" && record.gate !== null) {
    if (record.gate.skipped === "unknown") {
      details.push("gate skips unknown");
    } else if (record.gate.skipped !== 0) {
      details.push(
        `gate skipped ${String(record.gate.skipped)} GitHub checks${record.gate.noGithubOrigin ? ", no GitHub origin" : ""}`,
      );
    }
  }
  return `${label} (${details.join(", ")})`;
}

function runName(sha: string, file: string | undefined): string {
  return `Windows run ${file === undefined ? "" : `of ${file} `}on ${shortSha(sha)}`;
}

function headline(record: ResultRecord, file: string | undefined): string {
  const { node, pnpm, git } = record.versions;
  const tools = [
    ...(record.windows === null ? [] : [`Windows ${record.windows.release}`]),
    `Node ${node ?? "unknown"}`,
    `pnpm ${pnpm ?? "unknown"}`,
    `git ${git ?? "unknown"}`,
  ];
  return `${runName(record.sha, file)} (${tools.join(", ")}):`;
}

function summarizeResult(
  record: ResultRecord,
  file: string | undefined,
): string {
  const passed = record.refusal === null && stepsPassed(record.steps);
  const lines = [headline(record, file)];
  if (record.refusal !== null) {
    lines.push(`refused: ${WINDOWS_REFUSAL_TEXT[record.refusal]}.`);
  } else {
    lines.push(
      `${record.steps.map((step) => describeStep(step, record)).join("; ")}.`,
    );
  }
  if (record.cleanup.length > 0) {
    lines.push(
      `Cleanup problems on Windows: ${String(record.cleanup.length)} (see the terminal output).`,
    );
  }
  lines.push(
    !passed
      ? "Fails on Windows; do not push."
      : record.mode === "only"
        ? "This file passes on Windows; the rest of the suite was not run."
        : "Passes locally; CI not yet seen.",
  );
  return lines.join("\n");
}

export function summarize(input: SummaryInput): string {
  switch (input.kind) {
    case "refused":
      return `Windows run refused before contacting anything: ${REFUSAL_TEXT[input.reason]}.`;
    case "incomplete":
      return [
        `${runName(input.sha, input.file)} is incomplete: ${INCOMPLETE_TEXT[input.why]}.`,
        "Not a pass; run it again.",
      ].join("\n");
    case "result":
      return summarizeResult(input.record, input.file);
  }
}
