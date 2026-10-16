// The four required scripts in one package's folder, the root's or a
// workspace package's: which are missing or do nothing, and running every
// other one, whatever the others return, so one gap never hides another
// script's failures.
//
// The root keeps one allowance: a repo of only its starting files (see
// ownContentExists) may lack the scripts, since they'd have nothing to
// check yet. A workspace package gets no such allowance: it needs all four,
// real, from the moment pnpm lists it (see
// docs/adr/0015-every-package-checked-and-guarded.md).

import type { Context } from "../context.ts";
import type { CheckOutcome } from "./report.ts";
import {
  isNoOpScript,
  missingRequiredScripts,
  ownContentExists,
  readPackageManifest,
  runRequiredScripts,
  REQUIRED_SCRIPTS,
  SCRIPT_PURPOSE,
  scriptsOf,
  type RequiredScript,
  type ScriptCommand,
  type ScriptRunResult,
} from "./stack.ts";

export interface ScriptsTarget {
  /** "" for the root; otherwise the package's folder relative to the root,
   * "/"-separated. */
  readonly relative: string;
  /** Where its package.json is and its scripts run. */
  readonly folder: string;
}

export interface ScriptsResult {
  readonly outcomes: CheckOutcome[];
  /** A required script is missing or does nothing, so the gate exits 2. */
  readonly incomplete: boolean;
  /** What is missing or does nothing, said in full, to write after every
   * script's output so it isn't buried; empty when nothing is. */
  readonly message: string;
}

/** package.json, or a package's, relative to the root. */
function manifestLabel(target: ScriptsTarget): string {
  return target.relative === ""
    ? "package.json"
    : `${target.relative}/package.json`;
}

/** The report's name for one script: the root's keep their plain names. */
function checkName(target: ScriptsTarget, script: RequiredScript): string {
  return target.relative === "" ? script : `${script} (${target.relative})`;
}

function formatMissingScripts(
  target: ScriptsTarget,
  missing: readonly RequiredScript[],
): string {
  const label = manifestLabel(target);
  const lines = [
    target.relative === ""
      ? `gate: the repo has files of its own, but package.json is missing script(s): ${missing.join(", ")}`
      : `gate: ${label} is missing script(s): ${missing.join(", ")}`,
  ];
  for (const name of missing) {
    lines.push(
      `  add "${name}" to "scripts" in ${label}: ${SCRIPT_PURPOSE[name]}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function formatNoOpScripts(
  target: ScriptsTarget,
  noOps: readonly { name: RequiredScript; command: string }[],
): string {
  const lines = [
    `gate: ${manifestLabel(target)} has script(s) that check nothing: ${noOps.map(({ name }) => name).join(", ")}`,
  ];
  for (const { name, command } of noOps) {
    lines.push(
      `  "${name}" is ${JSON.stringify(command)}: replace it with ${SCRIPT_PURPOSE[name]}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

async function runEach(
  ctx: Context,
  target: ScriptsTarget,
  commandFor: ScriptCommand,
  scripts: readonly RequiredScript[],
): Promise<ScriptRunResult[]> {
  const results: ScriptRunResult[] = [];
  for (const script of scripts) {
    // A package's output would otherwise be hard to tell from the root's.
    if (target.relative !== "") {
      ctx.stdout.write(`gate: running ${script} in ${target.relative}\n`);
    }
    results.push(
      ...(await runRequiredScripts(ctx, commandFor, target.folder, [script])),
    );
  }
  return results;
}

/** Runs the four scripts in `target`'s folder, each through `commandFor`,
 * and reports each one's outcome. Without `commandFor` (the gate can't
 * start its package manager again) nothing runs: each script that would
 * have run is "not run", and missing or empty ones are still named. */
export async function runPackageScripts(
  ctx: Context,
  target: ScriptsTarget,
  commandFor: ScriptCommand | undefined,
): Promise<ScriptsResult> {
  const manifest = await readPackageManifest(ctx, target.folder);
  const missing = missingRequiredScripts(manifest);

  if (
    target.relative === "" &&
    missing.length > 0 &&
    !(await ownContentExists(ctx))
  ) {
    return {
      outcomes: REQUIRED_SCRIPTS.map((name) => ({
        name,
        status: "skipped",
        detail: "no content of its own yet",
      })),
      incomplete: false,
      message: "",
    };
  }

  // A script that isn't a string is left for the package manager to reject
  // when it runs.
  const scripts = scriptsOf(manifest);
  const noOps = REQUIRED_SCRIPTS.flatMap((name) => {
    const command = scripts[name];
    return typeof command === "string" && isNoOpScript(command)
      ? [{ name, command }]
      : [];
  });
  const runnable = REQUIRED_SCRIPTS.filter(
    (name) =>
      !missing.includes(name) && !noOps.some((noOp) => noOp.name === name),
  );
  const results =
    commandFor === undefined
      ? []
      : await runEach(ctx, target, commandFor, runnable);

  const where = `not in ${manifestLabel(target)}`;
  return {
    outcomes: REQUIRED_SCRIPTS.map((script): CheckOutcome => {
      const name = checkName(target, script);
      const noOp = noOps.find((entry) => entry.name === script);
      if (noOp !== undefined) {
        return { name, status: "no-op", detail: JSON.stringify(noOp.command) };
      }
      if (commandFor === undefined && runnable.includes(script)) {
        return {
          name,
          status: "not-run",
          detail: "the gate can't start its package manager",
        };
      }
      const result = results.find((entry) => entry.script === script);
      if (result === undefined) {
        return { name, status: "missing", detail: where };
      }
      return result.exitCode === 0
        ? { name, status: "passed" }
        : { name, status: "failed", detail: `exit ${String(result.exitCode)}` };
    }),
    incomplete: missing.length > 0 || noOps.length > 0,
    message:
      (missing.length > 0 ? formatMissingScripts(target, missing) : "") +
      (noOps.length > 0 ? formatNoOpScripts(target, noOps) : ""),
  };
}
