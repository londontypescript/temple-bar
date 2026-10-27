// `gate --part <name> --leg <leg> --report <file>`: one part of the gate,
// from the same check plan as the whole gate (plan.ts), then a report of it
// for the verifier (verify-parts.ts). The report on stdout and stderr is the
// whole gate's, for this part's checks only.

import path from "node:path";

import type { Context } from "../context.ts";
import type { PartFiles } from "./part-files.ts";
import {
  buildPartReport,
  readIdentity,
  requireActionsRun,
} from "./part-report.ts";
import {
  buildPlan,
  partsOf,
  REPO_PART,
  reservedPackages,
  type PlanEntry,
} from "./plan.ts";
import { exitCodeOf, prepare, runEntries, type Prepared } from "./plan-run.ts";
import { writeReport } from "./report.ts";
import type { GateTools } from "./tools.ts";

export interface PartOptions {
  readonly part: string;
  readonly leg: string;
  readonly report: string;
}

/** Throws when a package's folder would be read as another part's name:
 * its report could never be told apart. Only the split modes need this. */
export function refuseReservedPackages(prepared: Prepared): void {
  const reserved = reservedPackages(prepared.inventory);
  if (reserved.length > 0) {
    throw new Error(
      `the gate can't be split by part here: ${reserved.join(" and ")} is a workspace package's folder, and the name of one of the gate's own parts`,
    );
  }
}

/** The entries of `part`; throws when this run can't run it as the whole
 * gate would. */
function partEntries(prepared: Prepared, part: string): readonly PlanEntry[] {
  const { inventory } = prepared;
  // Without a trustworthy package list, a package or the root's scripts
  // could run against the wrong set; only the repo part reports why.
  if (part !== REPO_PART && inventory.outcome.status === "failed") {
    throw new Error(
      `part ${part} can't run: the workspace inventory failed (${inventory.outcome.detail ?? "no detail"}); its own part, ${REPO_PART}, reports it`,
    );
  }
  const plan = buildPlan(inventory);
  const parts = partsOf(plan);
  if (!parts.includes(part)) {
    throw new Error(
      `there is no part named ${part}: the parts are ${parts.join(", ")}`,
    );
  }
  return plan.filter((entry) => entry.part === part);
}

export async function runPart(
  ctx: Context,
  tools: GateTools,
  files: PartFiles,
  options: PartOptions,
): Promise<number> {
  requireActionsRun(ctx, "--part");
  const reportPath = path.resolve(ctx.cwd, options.report);
  // Checked again, atomically, when the report is written; this only saves
  // running every check first.
  if ((await files.kind(reportPath)) !== "missing") {
    throw new Error(
      `--report ${options.report} already exists; a part's report is never overwritten`,
    );
  }

  const prepared = await prepare(ctx);
  refuseReservedPackages(prepared);
  const entries = partEntries(prepared, options.part);
  const identity = await readIdentity(
    ctx,
    prepared.launcher,
    options.leg,
    "--part",
  );

  const run = await runEntries(ctx, prepared, tools, entries);
  writeReport(ctx, run.outcomes);
  const exitCode = exitCodeOf(run);
  const report = buildPartReport(
    identity,
    options.part,
    exitCode,
    run.outcomes,
  );
  try {
    await files.createNew(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `could not write the report ${options.report}: ${message}`,
      { cause: error },
    );
  }
  ctx.stdout.write(`gate: part ${options.part}'s report: ${options.report}\n`);
  return exitCode;
}
