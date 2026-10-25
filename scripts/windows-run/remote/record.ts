// The result record: the one line the Windows runner prints last, and the
// only thing the local side believes about how the run went. Its format lives
// here once; the local side imports it. Every field is checked when it is
// read, strings included, so a garbled or forged line is not a result. That
// guards against accidents, not against hostile code on the machine, which
// belongs to the same account.

/** What was asked for: the full run, or one test file (`--only`). A record
 * says which it answers, and is only believed for that request. */
export type RunRequest =
  { readonly mode: "full" } | { readonly mode: "only"; readonly file: string };
export type RunMode = RunRequest["mode"];

/** The steps of each kind of run, in order: the full run is CI's three, a
 * targeted run installs and then runs its one file. */
export const STEPS_FOR = {
  full: ["install", "check", "build"],
  only: ["install", "test"],
} as const;
export type StepName = (typeof STEPS_FOR)[RunMode][number];

// "skipped" is only ever a targeted run's install, when nothing it depends on
// changed since the last one that passed.
const STEP_STATUSES = [
  "passed",
  "failed",
  "timed-out",
  "not-run",
  "skipped",
] as const;
type StepStatus = (typeof STEP_STATUSES)[number];

/** Why a run ended before its steps could start. */
const REFUSALS = [
  "lock-held",
  "sweep-failed",
  "machine-not-ready",
  "fetch-failed",
  "checkout-failed",
  "commit-mismatch",
  "runner-error",
] as const;
export type Refusal = (typeof REFUSALS)[number];

/** A figure that could not be attributed with certainty is "unknown". */
export type Count = number | "unknown";

export interface StepRecord {
  readonly name: StepName;
  readonly status: StepStatus;
  readonly exitCode: number | null;
  readonly durationMs: number;
}

export interface ResultRecord {
  readonly runId: string;
  readonly sha: string;
  readonly mode: RunMode;
  /** The test file a targeted run ran; null for a full run. */
  readonly file: string | null;
  readonly refusal: Refusal | null;
  readonly steps: readonly StepRecord[];
  readonly versions: {
    readonly node: string | null;
    readonly pnpm: string | null;
    readonly git: string | null;
  };
  readonly windows: {
    readonly release: string;
    readonly version: string;
  } | null;
  readonly tests: {
    readonly tests: Count;
    readonly passed: Count;
    readonly failed: Count;
    readonly skipped: Count;
  };
  /** What the gate skipped. Null for a targeted run, which runs no gate. */
  readonly gate: {
    readonly skipped: Count;
    readonly noGithubOrigin: boolean;
  } | null;
  /** Cleanup problems, one line each. For the terminal; the summary only
   * counts them. */
  readonly cleanup: readonly string[];
}

export const RUN_ID_PATTERN = /^[0-9a-f]{8}$/;
export const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const WINDOWS_RELEASE_PATTERN = /^\d+\.\d+\.\d+$/;
const WINDOWS_VERSION_PATTERN = /^[A-Za-z0-9 .()_-]{1,60}$/;
const MAX_CLEANUP_LINES = 50;
const MAX_CLEANUP_LINE_LENGTH = 400;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

/** What every record line starts with. Carrying the run id means a line from
 * another run (or one a step printed by chance) is never taken for this one. */
export function markerFor(runId: string): string {
  return `windows-run result ${runId}: `;
}

export function formatRecord(record: ResultRecord): string {
  return markerFor(record.runId) + JSON.stringify(record);
}

/** Whether every step passed, a skipped install counting as passed. The one
 * definition of a pass, for the runner's exit code and the local verdict. */
export function stepsPassed(steps: readonly StepRecord[]): boolean {
  return steps.every(
    (step) => step.status === "passed" || step.status === "skipped",
  );
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Obj, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

function matching(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function versionOrNull(value: unknown): string | null | undefined {
  return value === null ? null : matching(value, VERSION_PATTERN);
}

function count(value: unknown): Count | undefined {
  if (value === "unknown") {
    return value;
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function parseStep(value: unknown, name: StepName): StepRecord | undefined {
  if (
    !isObj(value) ||
    !hasExactKeys(value, ["name", "status", "exitCode", "durationMs"])
  ) {
    return undefined;
  }
  const { status, exitCode, durationMs } = value;
  if (
    value.name !== name ||
    !STEP_STATUSES.some((known) => known === status) ||
    !(exitCode === null || Number.isSafeInteger(exitCode)) ||
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    durationMs > MAX_DURATION_MS
  ) {
    return undefined;
  }
  return value as unknown as StepRecord;
}

/** The steps must tell one story: passed ones first (exit 0), at most one
 * that did not pass, and nothing after it but not-run. A refused run ran
 * nothing. A skipped step ran nothing either (no exit code), and only a
 * targeted run's install may be skipped; it counts as passed. */
function storyIsConsistent(
  steps: readonly StepRecord[],
  refusal: Refusal | null,
  mode: RunMode,
): boolean {
  let stopped = false;
  for (const step of steps) {
    if (stopped || refusal !== null) {
      if (step.status !== "not-run" || step.exitCode !== null) {
        return false;
      }
    } else if (step.status === "skipped") {
      if (
        mode !== "only" ||
        step.name !== "install" ||
        step.exitCode !== null
      ) {
        return false;
      }
    } else if (step.status === "passed") {
      if (step.exitCode !== 0) {
        return false;
      }
    } else {
      stopped = true;
      if (step.status === "not-run" && step.exitCode !== null) {
        return false;
      }
    }
  }
  return true;
}

function parseSteps(value: unknown, mode: RunMode): StepRecord[] | undefined {
  const names = STEPS_FOR[mode];
  if (!Array.isArray(value) || value.length !== names.length) {
    return undefined;
  }
  const steps: StepRecord[] = [];
  for (const [index, name] of names.entries()) {
    const step = parseStep(value[index], name);
    if (step === undefined) {
      return undefined;
    }
    steps.push(step);
  }
  return steps;
}

function parseCleanup(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > MAX_CLEANUP_LINES ||
    !value.every(
      (line) =>
        typeof line === "string" && line.length <= MAX_CLEANUP_LINE_LENGTH,
    )
  ) {
    return undefined;
  }
  return value as string[];
}

function figuresAreValid(value: Obj, mode: RunMode): boolean {
  const { versions, windows, tests, gate } = value;
  if (
    !isObj(versions) ||
    !hasExactKeys(versions, ["node", "pnpm", "git"]) ||
    versionOrNull(versions.node) === undefined ||
    versionOrNull(versions.pnpm) === undefined ||
    versionOrNull(versions.git) === undefined
  ) {
    return false;
  }
  if (
    windows !== null &&
    !(
      isObj(windows) &&
      hasExactKeys(windows, ["release", "version"]) &&
      matching(windows.release, WINDOWS_RELEASE_PATTERN) !== undefined &&
      matching(windows.version, WINDOWS_VERSION_PATTERN) !== undefined
    )
  ) {
    return false;
  }
  if (
    !isObj(tests) ||
    !hasExactKeys(tests, ["tests", "passed", "failed", "skipped"]) ||
    [tests.tests, tests.passed, tests.failed, tests.skipped].some(
      (figure) => count(figure) === undefined,
    )
  ) {
    return false;
  }
  if (mode === "only") {
    return gate === null;
  }
  return (
    isObj(gate) &&
    hasExactKeys(gate, ["skipped", "noGithubOrigin"]) &&
    count(gate.skipped) !== undefined &&
    typeof gate.noGithubOrigin === "boolean"
  );
}

/** The record if `value` is exactly one, for this run, this commit and what
 * was asked for: a targeted request is never answered by a full record, nor
 * by a record for another file, and the other way round. */
export function validateRecord(
  value: unknown,
  runId: string,
  sha: string,
  request: RunRequest,
): ResultRecord | undefined {
  if (
    !isObj(value) ||
    !hasExactKeys(value, [
      "runId",
      "sha",
      "mode",
      "file",
      "refusal",
      "steps",
      "versions",
      "windows",
      "tests",
      "gate",
      "cleanup",
    ]) ||
    value.runId !== runId ||
    value.sha !== sha ||
    value.mode !== request.mode ||
    value.file !== (request.mode === "only" ? request.file : null)
  ) {
    return undefined;
  }
  const refusal = value.refusal;
  if (refusal !== null && !REFUSALS.some((known) => known === refusal)) {
    return undefined;
  }
  const steps = parseSteps(value.steps, request.mode);
  const cleanup = parseCleanup(value.cleanup);
  if (
    steps === undefined ||
    cleanup === undefined ||
    !storyIsConsistent(steps, refusal as Refusal | null, request.mode) ||
    !figuresAreValid(value, request.mode)
  ) {
    return undefined;
  }
  return value as unknown as ResultRecord;
}
