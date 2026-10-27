// The gate's check plan: every check the gate runs, in the order it runs
// them, each tagged with the part of the gate it belongs to. The whole gate
// runs every entry; `gate --part <name>` runs one part's entries through the
// same code, so no check can exist in only one of the two, and CI can run
// the parts side by side and prove afterwards that together they were the
// whole gate (see docs/adr/0018-the-gate-by-parts.md).
//
// The parts:
//   - repo: every check that isn't a package's scripts (the workspace
//     inventory, coverage over the whole workspace, setup's core, and the
//     rest of the base checks);
//   - root: the root's four scripts;
//   - one per workspace package, named by its folder relative to the root,
//     exactly as the inventory gives it (`packages/app`).
//
// Each entry also declares the outcome names it reports, whatever happens
// (a skip or an error still reports them), so a part's exact outcomes are
// known before it runs, from this plan, never from what a run produced.

import { readProjectConfig } from "../config/project-config.ts";
import type { Context } from "../context.ts";
import { CORE_CHECK, runCoreCheck } from "./core.ts";
import { COVERAGE_CHECKS, runCoverageCheck } from "./coverage.ts";
import { LINKS_CHECK } from "./links.ts";
import {
  MARKDOWN_LINT_CHECK,
  runLinkCheck,
  runMarkdownLint,
} from "./markdown.ts";
import type { Launcher } from "./launcher.ts";
import {
  runPackageScripts,
  scriptCheckNames,
  type ScriptsTarget,
} from "./package-scripts.ts";
import { INVENTORY_CHECK, type Inventory } from "./packages.ts";
import type { CheckOutcome } from "./report.ts";
import { RULESET_CHECKS, runRulesetChecks } from "./ruleset.ts";
import {
  AGENTS_SIZE_CHECK,
  LENGTH_CHECK,
  runAgentsSizeCheck,
  runLengthCheck,
} from "./size-checks.ts";
import type { ScriptCommand } from "./stack.ts";
import type { GateTools } from "./tools.ts";
import { runUnusedCheck, UNUSED_CHECK } from "./unused.ts";
import { runWorkflowCopiesCheck, WORKFLOWS_CHECK } from "./workflow-copies.ts";

export const REPO_PART = "repo";
const ROOT_PART = "root";

/** What every entry may need, worked out once per run before any runs. */
export interface GateState {
  /** The paths git lists. */
  readonly listed: readonly string[];
  readonly launcher: Launcher;
  readonly inventory: Inventory;
  readonly tools: GateTools;
  /** How each script is started; asked only by the entries that run
   * scripts, and worked out once. */
  readonly commandFor: () => Promise<ScriptCommand | undefined>;
}

interface EntryResult {
  readonly outcomes: readonly CheckOutcome[];
  /** A required script is missing or does nothing, so the run exits 2. */
  readonly incomplete?: boolean;
  /** Said once every script has run, so it isn't buried under their
   * output. */
  readonly deferred?: string;
  /** Like `deferred`, but after every other deferred message: why some
   * packages' scripts may not have run at all. */
  readonly closing?: string;
}

export interface PlanEntry {
  readonly part: string;
  /** Scripts and the inventory run first; the base checks after them. */
  readonly stage: "stack" | "base";
  /** The names of the outcomes it reports, whatever happens. */
  readonly outcomes: readonly string[];
  readonly run: (ctx: Context, state: GateState) => Promise<EntryResult>;
}

/** One outcome as a whole result. */
async function single(outcome: Promise<CheckOutcome>): Promise<EntryResult> {
  return { outcomes: [await outcome] };
}

const INVENTORY_ENTRY: PlanEntry = {
  part: REPO_PART,
  stage: "stack",
  outcomes: [INVENTORY_CHECK],
  // The inventory itself is taken before any entry runs: every part needs
  // the package list and the launcher it found.
  run: (_ctx, { inventory }) =>
    Promise.resolve({
      outcomes: [inventory.outcome],
      ...(inventory.message === undefined
        ? {}
        : { closing: inventory.message }),
    }),
};

/** The four scripts of the root (no target) or of one package. */
function scriptsEntry(part: string, target?: ScriptsTarget): PlanEntry {
  return {
    part,
    stage: "stack",
    outcomes: scriptCheckNames(target?.relative ?? ""),
    async run(ctx, state) {
      const result = await runPackageScripts(
        ctx,
        target ?? { relative: "", folder: ctx.cwd },
        await state.commandFor(),
      );
      return {
        outcomes: result.outcomes,
        incomplete: result.incomplete,
        deferred: result.message,
      };
    },
  };
}

/** Every check that isn't a package's scripts, after the scripts. */
const BASE_ENTRIES: readonly PlanEntry[] = [
  {
    part: REPO_PART,
    stage: "base",
    outcomes: COVERAGE_CHECKS,
    run: async (ctx, { listed, launcher, inventory }) => ({
      outcomes: await runCoverageCheck(ctx, {
        listed,
        launcher,
        inventory,
        exclusions: (await readProjectConfig(ctx)).coverageExclusions,
      }),
    }),
  },
  {
    part: REPO_PART,
    stage: "base",
    outcomes: [CORE_CHECK],
    run: (ctx) => single(runCoreCheck(ctx)),
  },
  {
    part: REPO_PART,
    stage: "base",
    outcomes: [WORKFLOWS_CHECK],
    run: (ctx) => single(runWorkflowCopiesCheck(ctx)),
  },
  {
    part: REPO_PART,
    stage: "base",
    outcomes: [LENGTH_CHECK],
    run: (ctx) => single(runLengthCheck(ctx)),
  },
  {
    part: REPO_PART,
    stage: "base",
    outcomes: [AGENTS_SIZE_CHECK],
    run: (ctx) => single(runAgentsSizeCheck(ctx)),
  },
  {
    part: REPO_PART,
    stage: "base",
    outcomes: [MARKDOWN_LINT_CHECK],
    run: (ctx, { tools, listed }) =>
      single(runMarkdownLint(ctx, tools, listed)),
  },
  {
    part: REPO_PART,
    stage: "base",
    outcomes: [LINKS_CHECK],
    run: (ctx, { listed }) => single(runLinkCheck(ctx, listed)),
  },
  {
    part: REPO_PART,
    stage: "base",
    outcomes: [UNUSED_CHECK],
    run: (ctx, { tools, inventory }) =>
      single(runUnusedCheck(ctx, tools, inventory)),
  },
  {
    part: REPO_PART,
    stage: "base",
    outcomes: RULESET_CHECKS,
    run: async (ctx) => ({ outcomes: await runRulesetChecks(ctx) }),
  },
];

/** The whole gate, in order: the inventory's outcome, the root's scripts,
 * each package's in the inventory's order, then the base checks. */
export function buildPlan(inventory: Inventory): readonly PlanEntry[] {
  return [
    INVENTORY_ENTRY,
    scriptsEntry(ROOT_PART),
    ...inventory.packages.map((member) =>
      scriptsEntry(member.relative, member),
    ),
    ...BASE_ENTRIES,
  ];
}

/** Every part the plan has, each once, in the order it first appears. */
export function partsOf(plan: readonly PlanEntry[]): string[] {
  return [...new Set(plan.map((entry) => entry.part))];
}

/** The outcome names a part reports, from the plan alone. */
export function expectedOutcomes(
  plan: readonly PlanEntry[],
  part: string,
): string[] {
  return plan
    .filter((entry) => entry.part === part)
    .flatMap((entry) => entry.outcomes);
}

/** Packages whose folder would be read as the repo or root part. */
export function reservedPackages(inventory: Inventory): string[] {
  return inventory.packages
    .map((member) => member.relative)
    .filter((relative) => relative === REPO_PART || relative === ROOT_PART);
}
