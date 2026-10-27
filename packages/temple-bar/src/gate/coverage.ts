// The gate's coverage check: every TypeScript file the project tracks is
// checked by a typecheck script, and every test file is run by a test
// script. A file in no tsconfig, or matched by no test pattern, passes
// every other check while nothing looks at it. Reported as two outcomes,
// "type-check coverage" and "test coverage".
//
// It is bound to what the gate actually runs, not to tsconfig.json: each
// package's own scripts (the root's and every listed package's) are read
// (coverage-scripts.ts) and the tools they run are asked which files they
// check or run (coverage-typescript.ts, coverage-tests.ts). The union of
// every package's listings is compared with the files the repo requires,
// so a root Vitest run and per-package runs both count. A script whose
// form can't be listed, or a listing that fails, fails the outcome: a
// missing listing would otherwise name every file, or none.
//
// Files are compared by their real path on disk, which settles a tracked
// link and a name git spells in another letter case than the disk; the
// git path is kept for messages. Stated limit: a file list proves a file
// is included, not that checking is strict (`noCheck` could still switch
// it off). See docs/adr/0016-agent-rules-and-the-merge-loop.md.

import path from "node:path";

import type { Context } from "../context.ts";
import {
  createListings,
  type Listing,
  type ListingContext,
} from "./coverage-listing.ts";
import {
  readTestScript,
  readTypecheckScript,
  unsupportedFormMessage,
} from "./coverage-scripts.ts";
import {
  exclusionSummary,
  requiredFiles,
  type Obligation,
} from "./coverage-files.ts";
import { listTests } from "./coverage-tests.ts";
import { listTypeScript } from "./coverage-typescript.ts";
import type { Launcher } from "./launcher.ts";
import type { Inventory } from "./packages.ts";
import type { CheckOutcome } from "./report.ts";
import { isNoOpScript, readPackageManifest, scriptsOf } from "./stack.ts";
import { attributeFindings, ROOT_OWNER } from "./unused-attribution.ts";

const EXCLUSIONS_HINT = `list it under "coverageExclusions" in temple-bar.config.json`;

/** One of the two outcomes: which files it requires, and how it says so. */
interface Coverage {
  readonly name: string;
  readonly script: "typecheck" | "test";
  readonly requires: (file: string) => boolean;
  /** The files it requires, counted: "TypeScript file(s)". */
  readonly files: string;
  /** The skip's detail when the repo has no such file. */
  readonly none: string;
  /** Said of the files nothing covers. */
  readonly uncovered: string;
  /** What a listing's tool does with its files, in the log. */
  readonly verb: "checks" | "runs";
  /** Said of the files a pass covers, and of those a failure misses. */
  readonly done: string;
  readonly missed: string;
  readonly fix: string;
  /** The listings a script makes, or undefined when its form isn't one
   * the gate can list. */
  readonly plan: (
    command: string,
  ) => ((lc: ListingContext) => Promise<Listing[]>)[] | undefined;
}

const DECLARATION_FILE = /\.d\.(?:ts|mts|cts)$/;

const COVERAGES: readonly Coverage[] = [
  {
    name: "type-check coverage",
    script: "typecheck",
    // JavaScript isn't required: whether a project checks it is its own
    // choice, and this check proves inclusion, not strictness.
    requires: (file) =>
      /\.(?:ts|tsx|mts|cts)$/.test(file) && !DECLARATION_FILE.test(file),
    files: "TypeScript file(s)",
    none: "no TypeScript files",
    uncovered: "that no typecheck script checks",
    verb: "checks",
    done: "checked",
    missed: "unchecked",
    fix: `include each file in a tsconfig a typecheck script checks, or ${EXCLUSIONS_HINT}`,
    plan: (command) =>
      readTypecheckScript(command)?.map(
        (part) => (lc) => listTypeScript(lc, part),
      ),
  },
  {
    name: "test coverage",
    script: "test",
    // This check's own definition of a test file, by name alone.
    requires: (file) =>
      /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path.posix.basename(file)),
    files: "test file(s)",
    none: "no test files",
    uncovered: "that no test script runs",
    verb: "runs",
    done: "run",
    missed: "not run",
    fix: `make a test script's run include each file, or ${EXCLUSIONS_HINT}`,
    plan: (command) =>
      readTestScript(command)?.map((part) => async (lc) => [
        await listTests(lc, part),
      ]),
  },
];

/** A package whose scripts the check reads; the root is one. */
interface Target {
  /** "" for the root, else the folder relative to the root. */
  readonly relative: string;
  readonly folder: string;
  readonly realFolder: string;
  /** "the root" or `relative`. */
  readonly where: string;
}

export interface CoverageInput {
  /** Every path git lists, as the other checks read them. */
  readonly listed: readonly string[];
  readonly launcher: Launcher;
  readonly inventory: Pick<Inventory, "packages" | "outcome">;
  /** Exact paths, or folders ending in "/", relative to the root. */
  readonly exclusions: readonly string[];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What a run of one coverage's scripts gathered. */
interface Gathered {
  readonly listings: Listing[];
  /** Messages for scripts whose form can't be listed. */
  readonly unsupported: string[];
  /** Lines for packages with no such script, by the package's name. */
  readonly notes: Map<string, string>;
}

async function gather(
  ctx: Context,
  coverage: Coverage,
  targets: readonly Target[],
  listingsFor: Awaited<ReturnType<typeof createListings>>,
): Promise<Gathered> {
  const gathered: Gathered = {
    listings: [],
    unsupported: [],
    notes: new Map(),
  };
  for (const target of targets) {
    const command = scriptsOf(await readPackageManifest(ctx, target.folder))[
      coverage.script
    ];
    // A script that is missing or does nothing contributes no listing:
    // the gate has already failed it, and its package's files are
    // reported like any other.
    if (command === undefined) {
      gathered.notes.set(
        target.where,
        `${target.where} has no ${coverage.script} script (reported above)`,
      );
      continue;
    }
    if (typeof command === "string" && isNoOpScript(command)) {
      gathered.notes.set(
        target.where,
        `${target.where}'s ${coverage.script} script checks nothing (reported above)`,
      );
      continue;
    }
    const text =
      typeof command === "string" ? command : JSON.stringify(command);
    const plan =
      typeof command === "string" ? coverage.plan(command) : undefined;
    if (plan === undefined) {
      gathered.unsupported.push(
        unsupportedFormMessage(coverage.script, target.where, text),
      );
      continue;
    }
    const lc = listingsFor({
      ...target,
      script: coverage.script,
      command: text,
    });
    for (const list of plan) {
      gathered.listings.push(...(await list(lc)));
    }
  }
  return gathered;
}

/** How the "listings made" line names a listing. */
async function entry(listing: Listing): Promise<string> {
  const note =
    "explainEmpty" in listing ? await listing.explainEmpty() : listing.note;
  return `${listing.command}${note === undefined ? "" : ` (${note})`}${
    listing.where === ROOT_OWNER ? "" : ` in ${listing.where}`
  }`;
}

async function uncoveredMessage(
  ctx: Context,
  coverage: Coverage,
  missing: readonly Obligation[],
  targets: readonly Target[],
  gathered: Gathered,
  listings: readonly Listing[],
): Promise<string> {
  const owners = attributeFindings(
    [ctx.cwd],
    targets.slice(1).map((target) => target.relative),
    missing.map((file) => path.join(ctx.cwd, ...file.path.split("/"))),
  );
  const made: string[] = [];
  for (const listing of listings) {
    made.push(await entry(listing));
  }
  return [
    `gate: ${String(missing.length)} ${coverage.files} ${coverage.uncovered}:`,
    ...owners.flatMap((owner) => [
      `  ${owner.name}:`,
      ...[gathered.notes.get(owner.name)].flatMap((note) =>
        note === undefined ? [] : [`    ${note}`],
      ),
      ...owner.files.map((file) => `    ${file}`),
    ]),
    `  listings made: ${made.length === 0 ? "none" : made.join(", ")}`,
    `  fix: ${coverage.fix}`,
    "",
  ].join("\n");
}

async function checkOne(
  ctx: Context,
  coverage: Coverage,
  input: CoverageInput,
  targets: readonly Target[],
  listingsFor: Awaited<ReturnType<typeof createListings>>,
): Promise<CheckOutcome> {
  const { name } = coverage;
  const { required, excluded } = await requiredFiles(
    ctx,
    input.listed,
    coverage.requires,
    input.exclusions,
  );
  // Decided for the whole repository, so a project with nothing to cover
  // is never asked to explain its scripts.
  if (required.length === 0) {
    return {
      name,
      status: "skipped",
      detail:
        excluded > 0
          ? `all ${String(excluded)} ${coverage.files} excluded`
          : coverage.none,
    };
  }

  const gathered = await gather(ctx, coverage, targets, listingsFor);
  const listings = [
    ...new Map(
      gathered.listings.map((listing) => [listing.key, listing]),
    ).values(),
  ];
  const failed = listings.flatMap((listing) =>
    "failure" in listing
      ? [
          `gate: listing the files ${listing.command} ${coverage.verb} in ${listing.where} failed: ${listing.failure}\n`,
        ]
      : [],
  );
  if (gathered.unsupported.length > 0 || failed.length > 0) {
    for (const message of [...gathered.unsupported, ...failed]) {
      ctx.stderr.write(message);
    }
    const reasons = [
      ...(gathered.unsupported.length > 0 ? ["unsupported script form"] : []),
      ...(failed.length > 0 ? ["listing failed"] : []),
    ];
    return { name, status: "failed", detail: reasons.join(", ") };
  }

  const covered = new Set(
    listings.flatMap((listing) =>
      "files" in listing ? [...listing.files] : [],
    ),
  );
  const missing = required.filter((file) => !covered.has(file.real));
  const exclusions = exclusionSummary(input.listed, input.exclusions);
  if (missing.length === 0) {
    return {
      name,
      status: "passed",
      detail: `all ${String(required.length)} ${coverage.files} ${coverage.done} by ${String(listings.length)} listing(s)${exclusions}`,
    };
  }
  ctx.stderr.write(
    await uncoveredMessage(ctx, coverage, missing, targets, gathered, listings),
  );
  return {
    name,
    status: "failed",
    detail: `${String(missing.length)} file(s) ${coverage.missed}${exclusions}`,
  };
}

/** The two outcomes this check reports on every path, in order. */
export const COVERAGE_CHECKS: readonly string[] = COVERAGES.map(
  ({ name }) => name,
);

/** Both outcomes failed, with why no listing could be trusted. */
function notChecked(reason: string): CheckOutcome[] {
  return COVERAGES.map(({ name }) => ({
    name,
    status: "failed",
    detail: `not checked: ${reason}`,
  }));
}

/**
 * Both coverage outcomes, type-check then test, each listing in turn, in
 * the inventory's order. Never throws: anything it can't determine is a
 * failure with a message.
 */
export async function runCoverageCheck(
  ctx: Context,
  input: CoverageInput,
): Promise<CheckOutcome[]> {
  // Without the package list, or a package manager to ask, no listing can
  // be trusted; the gate has already said why.
  const { launcher, inventory } = input;
  if (launcher.kind === "refused") {
    return notChecked("the gate can't start its package manager");
  }
  if (inventory.outcome.status === "failed") {
    return notChecked(
      inventory.outcome.detail ?? "the workspace inventory failed",
    );
  }
  try {
    const targets: Target[] = [
      {
        relative: "",
        folder: ctx.cwd,
        realFolder: await ctx.fs.realpath(ctx.cwd),
        where: ROOT_OWNER,
      },
      ...inventory.packages.map((member) => ({
        relative: member.relative,
        folder: member.folder,
        realFolder: member.folder,
        where: member.relative,
      })),
    ];
    const listingsFor = await createListings(
      ctx,
      launcher,
      await readPackageManifest(ctx),
    );
    const outcomes: CheckOutcome[] = [];
    for (const coverage of COVERAGES) {
      outcomes.push(await checkOne(ctx, coverage, input, targets, listingsFor));
    }
    return outcomes;
  } catch (error) {
    ctx.stderr.write(`gate: could not check coverage: ${describe(error)}\n`);
    return COVERAGES.map(({ name }) => ({
      name,
      status: "failed",
      detail: "could not check",
    }));
  }
}
