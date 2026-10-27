// Running entries of the check plan (plan.ts): the whole gate's or one
// part's. What every mode shares happens here once, so the whole gate and a
// part can't drift apart: the same preparation, the same order of messages,
// the same exit codes, and the same check that the run reported exactly the
// outcomes the plan says it would.

import type { Context } from "../context.ts";
import { listGitPaths } from "./lengths.ts";
import { resolveLauncher, type Launcher } from "./launcher.ts";
import { takeInventory, type Inventory } from "./packages.ts";
import type { GateState, PlanEntry } from "./plan.ts";
import type { CheckOutcome } from "./report.ts";
import {
  readPackageManifest,
  scriptCommandFor,
  type ScriptCommand,
} from "./stack.ts";
import type { GateTools } from "./tools.ts";

export interface Prepared {
  readonly listed: readonly string[];
  readonly launcher: Launcher;
  readonly inventory: Inventory;
}

/** What every mode takes first: git's file list, the launcher, and the
 * workspace inventory listed through it. */
export async function prepare(ctx: Context): Promise<Prepared> {
  const listed = await listGitPaths(ctx);
  // Once, so the package list and every script use the same package
  // manager.
  const launcher = await resolveLauncher(ctx);
  const inventory = await takeInventory(ctx, listed, launcher);
  return { listed, launcher, inventory };
}

export interface PlanRun {
  readonly outcomes: readonly CheckOutcome[];
  /** A required script is missing or does nothing. */
  readonly incomplete: boolean;
}

/** Sorted, so two lists compare as sets with their repeats. */
function sorted(names: readonly string[]): string[] {
  return [...names].sort();
}

/**
 * Runs `entries` in order and returns their outcomes. Every stack entry's
 * message waits until the last of them has run; then the base checks run.
 * Throws when the outcomes aren't exactly the ones the entries declare: a
 * run that reported a check twice, or left one out, would prove nothing.
 */
export async function runEntries(
  ctx: Context,
  prepared: Prepared,
  tools: GateTools,
  entries: readonly PlanEntry[],
): Promise<PlanRun> {
  let command: Promise<ScriptCommand | undefined> | undefined;
  const state: GateState = {
    ...prepared,
    tools,
    commandFor: () =>
      (command ??= readPackageManifest(ctx).then((manifest) =>
        scriptCommandFor(ctx, manifest, prepared.launcher),
      )),
  };

  const outcomes: CheckOutcome[] = [];
  const deferred: string[] = [];
  const closing: string[] = [];
  let incomplete = false;
  let flushed = false;
  // Written after the scripts' own output, so it isn't buried under it.
  const flush = (): void => {
    for (const message of [...deferred, ...closing]) {
      if (message !== "") {
        ctx.stderr.write(message);
      }
    }
  };

  for (const entry of entries) {
    if (entry.stage === "base" && !flushed) {
      flush();
      flushed = true;
    }
    const result = await entry.run(ctx, state);
    outcomes.push(...result.outcomes);
    incomplete ||= result.incomplete === true;
    deferred.push(result.deferred ?? "");
    closing.push(result.closing ?? "");
  }
  if (!flushed) {
    flush();
  }

  const expected = sorted(entries.flatMap((entry) => entry.outcomes));
  const reported = sorted(outcomes.map((outcome) => outcome.name));
  if (JSON.stringify(expected) !== JSON.stringify(reported)) {
    throw new Error(
      `the checks reported ${JSON.stringify(reported)}, but the check plan expects ${JSON.stringify(expected)}`,
    );
  }
  return { outcomes, incomplete };
}

/** 2 when a required script is missing or does nothing, else 1 when a
 * check failed, else 0. */
export function exitCodeOf(run: PlanRun): number {
  if (run.incomplete) {
    return 2;
  }
  return run.outcomes.some((outcome) => outcome.status === "failed") ? 1 : 0;
}
