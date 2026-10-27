// The report `gate --part` writes, and the verifier reads back: which run,
// commit, leg and tools produced it, which part it is, its exit code and
// every outcome. Read strictly: a missing or extra key, a wrong type, or a
// format or version this gate doesn't know makes a report malformed, never
// something to guess about.

import type { Context } from "../context.ts";
import { readOwnVersion } from "../package-info.ts";
import type { Launcher } from "./launcher.ts";
import { CHECK_STATUSES, type CheckOutcome } from "./report.ts";

const FORMAT = "temple-bar-gate-part";
const VERSION = 1;

/** The Actions variables the split modes need. */
const ACTIONS_VARIABLES = [
  "GITHUB_REPOSITORY",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_ATTEMPT",
] as const;

/** Where and with what a part ran: every field must match between a part's
 * report and the verifier's own. */
export interface Identity {
  readonly repository: string;
  readonly commit: string;
  readonly run: string;
  readonly attempt: string;
  readonly leg: string;
  readonly node: string;
  readonly pnpm: "javascript" | "native";
  readonly gate: string;
}

export const IDENTITY_FIELDS: readonly (keyof Identity)[] = [
  "repository",
  "commit",
  "run",
  "attempt",
  "leg",
  "node",
  "pnpm",
  "gate",
];

export interface PartReport extends Identity {
  readonly format: typeof FORMAT;
  readonly version: typeof VERSION;
  readonly part: string;
  readonly exitCode: number;
  readonly outcomes: readonly CheckOutcome[];
}

type ActionsRun = Readonly<Record<(typeof ACTIONS_VARIABLES)[number], string>>;

/**
 * The split modes run only in GitHub Actions: a report names its run, and
 * the verifier trusts only reports from its own. Returns the run's
 * variables; throws, naming each one missing, outside Actions.
 */
export function requireActionsRun(ctx: Context, mode: string): ActionsRun {
  const missing: string[] = [];
  if (ctx.env.GITHUB_ACTIONS !== "true") {
    missing.push("GITHUB_ACTIONS=true");
  }
  for (const name of ACTIONS_VARIABLES) {
    if ((ctx.env[name] ?? "") === "") {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `${mode} runs only in GitHub Actions; missing: ${missing.join(", ")}`,
    );
  }
  return {
    GITHUB_REPOSITORY: ctx.env.GITHUB_REPOSITORY ?? "",
    GITHUB_RUN_ID: ctx.env.GITHUB_RUN_ID ?? "",
    GITHUB_RUN_ATTEMPT: ctx.env.GITHUB_RUN_ATTEMPT ?? "",
  };
}

/** This run's identity; throws, saying why, when it can't be known. */
export async function readIdentity(
  ctx: Context,
  launcher: Launcher,
  leg: string,
  mode: string,
): Promise<Identity> {
  const run = requireActionsRun(ctx, mode);
  if (launcher.kind !== "javascript" && launcher.kind !== "native") {
    throw new Error(
      `${mode} needs the gate started through pnpm (npm_execpath), so its report can say how pnpm ran: run it as \`pnpm gate ${mode} ...\``,
    );
  }
  const head = await ctx.git.run(["rev-parse", "--verify", "HEAD"], ctx.cwd);
  const commit = head.stdout.trim();
  if (head.code !== 0 || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)) {
    throw new Error(`${mode} could not read the commit checked out (HEAD)`);
  }
  return {
    repository: run.GITHUB_REPOSITORY,
    commit,
    run: run.GITHUB_RUN_ID,
    attempt: run.GITHUB_RUN_ATTEMPT,
    leg,
    node: process.version,
    pnpm: launcher.kind,
    gate: readOwnVersion(),
  };
}

export function buildPartReport(
  identity: Identity,
  part: string,
  exitCode: number,
  outcomes: readonly CheckOutcome[],
): PartReport {
  return {
    format: FORMAT,
    version: VERSION,
    ...identity,
    part,
    exitCode,
    outcomes: outcomes.map((outcome) => ({
      name: outcome.name,
      status: outcome.status,
      ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
    })),
  };
}

const REPORT_KEYS = [
  "format",
  "version",
  ...IDENTITY_FIELDS,
  "part",
  "exitCode",
  "outcomes",
];
const STRING_KEYS = [...IDENTITY_FIELDS, "part"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The keys `value` lacks and those it shouldn't have, said in a line. */
function keyProblem(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): string | undefined {
  const keys = Object.keys(value);
  const absent = required.filter((key) => !keys.includes(key));
  const extra = keys.filter(
    (key) => !required.includes(key) && !optional.includes(key),
  );
  const problems = [
    ...(absent.length > 0 ? [`missing ${absent.join(", ")}`] : []),
    ...(extra.length > 0 ? [`unexpected ${extra.join(", ")}`] : []),
  ];
  return problems.length > 0 ? problems.join("; ") : undefined;
}

function outcomeProblem(value: unknown, index: number): string | undefined {
  const where = `outcomes[${String(index)}]`;
  if (!isRecord(value)) {
    return `${where} isn't an object`;
  }
  const keys = keyProblem(value, ["name", "status"], ["detail"]);
  if (keys !== undefined) {
    return `${where}: ${keys}`;
  }
  if (typeof value.name !== "string") {
    return `${where}.name isn't a string`;
  }
  if (!(CHECK_STATUSES as readonly unknown[]).includes(value.status)) {
    return `${where}.status ${JSON.stringify(value.status)} isn't a check status`;
  }
  if ("detail" in value && typeof value.detail !== "string") {
    return `${where}.detail isn't a string`;
  }
  return undefined;
}

/** The report in `text`, or why it is malformed. */
export function parsePartReport(text: string): PartReport | string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return "not JSON";
  }
  if (!isRecord(value)) {
    return "not a JSON object";
  }
  if (value.format !== FORMAT) {
    return `format ${JSON.stringify(value.format)} isn't ${FORMAT}`;
  }
  if (value.version !== VERSION) {
    return `version ${JSON.stringify(value.version)} isn't one this gate reads (${String(VERSION)})`;
  }
  const keys = keyProblem(value, REPORT_KEYS);
  if (keys !== undefined) {
    return keys;
  }
  const notString = STRING_KEYS.find((key) => typeof value[key] !== "string");
  if (notString !== undefined) {
    return `${notString} isn't a string`;
  }
  if (value.pnpm !== "javascript" && value.pnpm !== "native") {
    return `pnpm ${JSON.stringify(value.pnpm)} isn't javascript or native`;
  }
  if (!Number.isInteger(value.exitCode)) {
    return "exitCode isn't a whole number";
  }
  if (!Array.isArray(value.outcomes)) {
    return "outcomes isn't a list";
  }
  for (const [index, outcome] of (value.outcomes as unknown[]).entries()) {
    const problem = outcomeProblem(outcome, index);
    if (problem !== undefined) {
      return problem;
    }
  }
  return value as unknown as PartReport;
}
