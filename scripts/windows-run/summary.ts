// The Markdown block to paste into a pull request. It is built from
// allowlisted fields only (short commit, tool versions, Windows release, step
// statuses and durations, test and gate totals, fixed wording), never from
// free text: the input types hold no string that came from a machine or an
// error. Raw diagnostics stay in the terminal and the private logs.

import type { Count, ResultRecord, StepRecord } from "./remote/record.ts";

export type LocalRefusal =
  | "no-host"
  | "bad-host"
  | "dirty-tree"
  | "not-a-checkout"
  | "local-lock-held"
  | "bundle-failed";

const REFUSAL_TEXT: Record<LocalRefusal, string> = {
  "no-host": "no Windows machine is saved",
  "bad-host": "the SSH destination is not valid",
  "dirty-tree": "the tree has uncommitted or untracked changes",
  "not-a-checkout": "this is not a usable checkout",
  "local-lock-held": "another run is in progress from this checkout",
  "bundle-failed": "the commit could not be bundled",
};

const INCOMPLETE_TEXT = {
  unreachable: "the Windows machine could not be reached",
  connection: "the connection ended before the run finished",
  "no-result": "no valid result came back",
} as const;

export type SummaryInput =
  | { readonly kind: "refused"; readonly reason: LocalRefusal }
  | {
      readonly kind: "incomplete";
      readonly sha: string;
      readonly why: keyof typeof INCOMPLETE_TEXT;
    }
  | { readonly kind: "result"; readonly record: ResultRecord };

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
  const label =
    step.status === "timed-out"
      ? `${step.name} timed out`
      : `${step.name} ${step.status}`;
  const details = [seconds(step.durationMs)];
  if (step.status === "failed" && step.exitCode !== null) {
    details.unshift(`exit ${String(step.exitCode)}`);
  }
  if (step.name === "check") {
    const { tests, failed, skipped } = record.tests;
    details.unshift(
      plural(tests, "tests"),
      ...(failed === 0 ? [] : [plural(failed, "failed")]),
      plural(skipped, "skipped"),
    );
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

function headline(record: ResultRecord): string {
  const { node, pnpm, git } = record.versions;
  const tools = [
    ...(record.windows === null ? [] : [`Windows ${record.windows.release}`]),
    `Node ${node ?? "unknown"}`,
    `pnpm ${pnpm ?? "unknown"}`,
    `git ${git ?? "unknown"}`,
  ];
  return `Windows run on ${shortSha(record.sha)} (${tools.join(", ")}):`;
}

function summarizeResult(record: ResultRecord): string {
  const passed =
    record.refusal === null &&
    record.steps.every((step) => step.status === "passed");
  const lines = [headline(record)];
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
    passed
      ? "Passes locally; CI not yet seen."
      : "Fails on Windows; do not push.",
  );
  return lines.join("\n");
}

export function summarize(input: SummaryInput): string {
  switch (input.kind) {
    case "refused":
      return `Windows run refused before contacting anything: ${REFUSAL_TEXT[input.reason]}.`;
    case "incomplete":
      return [
        `Windows run on ${shortSha(input.sha)} is incomplete: ${INCOMPLETE_TEXT[input.why]}.`,
        "Not a pass; run it again.",
      ].join("\n");
    case "result":
      return summarizeResult(input.record);
  }
}
