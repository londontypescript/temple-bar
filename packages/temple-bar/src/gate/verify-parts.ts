// `gate --verify-parts <folder> --leg <leg>`: proves a leg's part reports
// add up to one whole gate that passed. It works out the parts and each
// part's exact outcomes itself, from its own inventory and the check plan
// (plan.ts), never from the reports, then accepts the folder only when it
// holds exactly one well-formed report per part, each from this run, commit,
// leg, Node, pnpm and gate, with every expected outcome once and none the
// whole gate would count as failing. Every problem is reported, not just the
// first.
//
// It trusts reports produced in its own run: it proves completeness and
// agreement, not that a job wasn't tampered with
// (see docs/adr/0018-the-gate-by-parts.md).

import path from "node:path";

import type { Context } from "../context.ts";
import type { PartFiles } from "./part-files.ts";
import { refuseReservedPackages } from "./part-run.ts";
import {
  IDENTITY_FIELDS,
  parsePartReport,
  readIdentity,
  requireActionsRun,
  type Identity,
  type PartReport,
} from "./part-report.ts";
import { buildPlan, expectedOutcomes, partsOf } from "./plan.ts";
import { prepare } from "./plan-run.ts";
import { isFailure } from "./report.ts";

export interface VerifyOptions {
  readonly folder: string;
  readonly leg: string;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Found {
  readonly file: string;
  readonly report: PartReport;
}

/** Every entry of `folder` read as a report, and why the others aren't. */
async function readReports(
  files: PartFiles,
  folder: string,
): Promise<{ found: Found[]; problems: string[] }> {
  const found: Found[] = [];
  const problems: string[] = [];
  let names: string[];
  try {
    names = [...(await files.list(folder))].sort();
  } catch (error) {
    throw new Error(
      `could not read the reports' folder ${folder}: ${describe(error)}`,
      { cause: error },
    );
  }
  for (const file of names) {
    // Never followed: a link or a folder isn't a report this run wrote.
    let kind: string;
    try {
      kind = await files.kind(path.join(folder, file));
    } catch (error) {
      // One unreadable entry mustn't hide the other reports' problems.
      problems.push(`malformed: ${file} can't be examined: ${describe(error)}`);
      continue;
    }
    if (kind !== "file") {
      problems.push(`malformed: ${file} is a ${kind}, not a regular file`);
      continue;
    }
    if (!file.endsWith(".json")) {
      problems.push(`malformed: ${file} isn't a .json file`);
      continue;
    }
    let text: string;
    try {
      text = await files.read(path.join(folder, file));
    } catch (error) {
      problems.push(`malformed: ${file} can't be read: ${describe(error)}`);
      continue;
    }
    const report = parsePartReport(text);
    if (typeof report === "string") {
      problems.push(`malformed: ${file}: ${report}`);
      continue;
    }
    found.push({ file, report });
  }
  return { found, problems };
}

/** Where each identity field differs from this run's own. */
function mismatches(own: Identity, { file, report }: Found): string[] {
  return IDENTITY_FIELDS.filter((field) => report[field] !== own[field]).map(
    (field) =>
      `mismatched: ${file} (part ${report.part}): ${field} is ${JSON.stringify(report[field])}, but this run's is ${JSON.stringify(own[field])}`,
  );
}

/** Whether the whole gate would have accepted what the report says. */
function notAccepted({ file, report }: Found): string[] {
  const where = `${file} (part ${report.part})`;
  return [
    ...(report.exitCode === 0
      ? []
      : [
          `outcome not accepted: ${where}: exit code ${String(report.exitCode)}`,
        ]),
    ...report.outcomes
      .filter(isFailure)
      .map(
        (outcome) =>
          `outcome not accepted: ${where}: ${outcome.name} ${outcome.status}`,
      ),
  ];
}

/** Each expected outcome once, and nothing else. */
function notExact(expected: readonly string[], found: Found): string[] {
  const where = `${found.file} (part ${found.report.part})`;
  const counts = new Map<string, number>();
  for (const outcome of found.report.outcomes) {
    counts.set(outcome.name, (counts.get(outcome.name) ?? 0) + 1);
  }
  const problems: string[] = [];
  for (const name of expected) {
    const count = counts.get(name) ?? 0;
    if (count === 0) {
      problems.push(`outcomes not exact: ${where}: ${name} is absent`);
    } else if (count > 1) {
      problems.push(
        `outcomes not exact: ${where}: ${name} is reported ${String(count)} times`,
      );
    }
  }
  for (const name of counts.keys()) {
    if (!expected.includes(name)) {
      problems.push(`outcomes not exact: ${where}: ${name} isn't expected`);
    }
  }
  return problems;
}

export async function verifyParts(
  ctx: Context,
  files: PartFiles,
  options: VerifyOptions,
): Promise<number> {
  requireActionsRun(ctx, "--verify-parts");
  const prepared = await prepare(ctx);
  refuseReservedPackages(prepared);
  const { inventory } = prepared;
  if (inventory.outcome.status === "failed") {
    throw new Error(
      `can't work out the parts: the workspace inventory failed (${inventory.outcome.detail ?? "no detail"})`,
    );
  }
  const own = await readIdentity(
    ctx,
    prepared.launcher,
    options.leg,
    "--verify-parts",
  );
  const plan = buildPlan(inventory);
  const parts = partsOf(plan);
  const { found, problems } = await readReports(
    files,
    path.resolve(ctx.cwd, options.folder),
  );

  for (const part of parts) {
    const reports = found.filter((entry) => entry.report.part === part);
    if (reports.length === 0) {
      problems.push(`missing: no report for part ${part}`);
    } else if (reports.length > 1) {
      problems.push(
        `duplicated: part ${part} has ${String(reports.length)} reports: ${reports.map((entry) => entry.file).join(", ")}`,
      );
    }
  }
  for (const entry of found) {
    if (!parts.includes(entry.report.part)) {
      problems.push(
        `unexpected: ${entry.file} reports part ${entry.report.part}, which isn't one of this gate's parts (${parts.join(", ")})`,
      );
      continue;
    }
    problems.push(
      ...mismatches(own, entry),
      ...notAccepted(entry),
      ...notExact(expectedOutcomes(plan, entry.report.part), entry),
    );
  }

  if (problems.length > 0) {
    ctx.stderr.write(
      [
        `gate: the parts' reports in ${options.folder} don't add up to a passing gate:`,
        ...problems.map((problem) => `  ${problem}`),
        "",
      ].join("\n"),
    );
    return 1;
  }
  for (const { file, report } of found) {
    ctx.stdout.write(
      `gate: part ${report.part}: ${String(report.outcomes.length)} outcome(s), all accepted (${file})\n`,
    );
  }
  ctx.stdout.write(
    `gate: verified: ${String(parts.length)} part(s) add up to the whole gate on leg ${options.leg}\n`,
  );
  return 0;
}
