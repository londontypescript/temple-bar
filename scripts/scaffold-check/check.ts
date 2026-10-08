import { lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  scaffolds,
  type ScaffoldFixture,
} from "../../packages/temple-bar/src/init/testing/scaffolds/index.ts";
import { environments } from "./environment.ts";
import { expectation } from "./expectation.ts";
import { commandText, recipes, scaffoldArgs } from "./recipes.ts";
import { londonDate, writeRecordings, type Recording } from "./record.ts";
import {
  prepareResources,
  type PrepareResources,
  type Resources,
} from "./resources.ts";
import { Interrupted, runProcess, type Runner } from "./runner.ts";
import { capture, compare } from "./snapshot.ts";
import { DEADLINES, failure, setup } from "./setup.ts";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export interface CheckOptions {
  readonly update: boolean;
  readonly runner?: Runner;
  readonly resources?: PrepareResources;
  readonly fixtures?: readonly ScaffoldFixture[];
  readonly inherited?: NodeJS.ProcessEnv;
  readonly tempRoot?: string;
  readonly fixtureDirectory?: string;
  readonly now?: () => Date;
  readonly signal?: AbortSignal;
  /** Told as each stage starts: a run takes minutes and prints its report
   * only at the end, so without this a working run looks like a dead one. */
  readonly progress?: (line: string) => void;
}

interface ScaffoldResult {
  readonly name: string;
  readonly statuses: readonly string[];
  readonly details: readonly string[];
}

export interface CheckResult {
  readonly code: number;
  readonly folder: string;
  readonly report: string;
  readonly results: readonly ScaffoldResult[];
}

export async function check(options: CheckOptions): Promise<CheckResult> {
  const folder = mkdtempSync(
    path.join(options.tempRoot ?? tmpdir(), "temple-bar-scaffold-check-"),
  );
  const runner = options.runner ?? runProcess;
  const progress = options.progress ?? (() => undefined);
  const results: ScaffoldResult[] = [];
  const recordings: Recording[] = [];
  const globalDetails: string[] = [];
  let resources: Resources | undefined;
  let failed = false;
  const run = (
    command: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    deadline: number,
  ) => {
    if (options.signal?.aborted) throw new Interrupted();
    return runner({
      command,
      args,
      cwd,
      env,
      deadline,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  };
  try {
    // No scaffolder starts unless both delivery artifacts were built and packed.
    progress(
      "scaffold-check: building and packing temple-bar from this checkout",
    );
    resources = await (options.resources ?? prepareResources)(folder);
    if (options.signal?.aborted) throw new Interrupted();
    const env = environments(
      folder,
      options.inherited ?? process.env,
      resources.registry,
    );
    const pnpm = await run(
      "pnpm",
      ["--version"],
      folder,
      env.scaffolding,
      DEADLINES.other,
    );
    if (
      pnpm.code !== 0 ||
      pnpm.timedOut ||
      !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(pnpm.stdout.trim())
    )
      throw new Error(
        `Couldn't resolve running pnpm version: ${failure(pnpm)}`,
      );
    const pnpmVersion = pnpm.stdout.trim();
    for (const fixture of options.fixtures ?? scaffolds) {
      const recipe = recipes[fixture.name];
      const details: string[] = [];
      if (recipe === undefined)
        throw new Error(`No recipe for ${fixture.name}`);
      const cwd = path.join(folder, fixture.name);
      mkdirSync(cwd);
      let snapshot;
      let version = "";
      let command = commandText("pnpm", ["view", recipe.package, "version"]);
      progress(`${fixture.name}: ${command}`);
      try {
        const lookup = await run(
          "pnpm",
          ["view", recipe.package, "version"],
          cwd,
          env.scaffolding,
          DEADLINES.version,
        );
        if (
          lookup.code !== 0 ||
          lookup.timedOut ||
          !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(lookup.stdout.trim())
        )
          throw new Error(`${command}: ${failure(lookup)}`);
        version = lookup.stdout.trim();
        const args = scaffoldArgs(recipe, version);
        command = commandText("pnpm", args);
        progress(`${fixture.name}: ${command}`);
        const scaffold = await run(
          "pnpm",
          args,
          cwd,
          env.scaffolding,
          DEADLINES.scaffold,
        );
        if (scaffold.code !== 0 || scaffold.timedOut)
          throw new Error(`${command}: ${failure(scaffold)}`);
        const project = path.join(cwd, recipe.project);
        if (!lstatSync(project, { throwIfNoEntry: false })?.isDirectory())
          throw new Error(
            `${command}: no project folder ${recipe.project}\n${failure(scaffold)}`,
          );
        snapshot = capture(project);
      } catch (error) {
        if (error instanceof Interrupted || options.signal?.aborted)
          throw new Interrupted();
        results.push({
          name: fixture.name,
          statuses: ["couldn't run"],
          // Each stage's error already names the command it ran.
          details: [error instanceof Error ? error.message : String(error)],
        });
        continue;
      }
      const comparison = compare(snapshot, fixture, version);
      details.push(...comparison.differences, ...comparison.information);
      const statuses: string[] =
        comparison.differences.length > 0 ? ["differs"] : [];
      if (options.update && comparison.differences.length > 0)
        recordings.push({ fixture, recipe, snapshot, version, command });
      try {
        progress(
          `${fixture.name}: installing the packed temple-bar and checking setup`,
        );
        const installed = await setup(
          path.join(cwd, recipe.project),
          snapshot,
          env.setup,
          runner,
          resources,
          pnpmVersion,
          options.signal,
        );
        details.push(
          ...installed.unknown.map((value) => `no expectation: ${value}`),
          ...installed.findings.map((value) => `finding: ${value}`),
          ...installed.information,
        );
        if (installed.unknown.length > 0) statuses.push("no expectation");
        else if (installed.findings.length > 0) statuses.push("setup failed");
      } catch (error) {
        if (error instanceof Interrupted || options.signal?.aborted)
          throw new Interrupted();
        const unknown = expectation(snapshot).unknown;
        statuses.push(unknown.length > 0 ? "no expectation" : "setup failed");
        details.push(
          ...unknown.map((value) => `no expectation: ${value}`),
          `setup: ${String(error)}`,
        );
      }
      if (statuses.length === 0) statuses.push("same");
      results.push({ name: fixture.name, statuses, details });
    }
    if (recordings.length > 0) {
      progress(
        `scaffold-check: recording ${String(recordings.length)} fixture(s)`,
      );
      const written = writeRecordings(
        recordings,
        options.fixtureDirectory ??
          path.join(repo, "packages/temple-bar/src/init/testing/scaffolds"),
        londonDate((options.now ?? (() => new Date()))()),
        pnpmVersion,
        process.versions.node,
      );
      const formatted = await run(
        "pnpm",
        ["exec", "prettier", "--write", ...written],
        repo,
        env.scaffolding,
        DEADLINES.other,
      );
      if (formatted.code !== 0 || formatted.timedOut)
        throw new Error(`Fixture formatting failed: ${failure(formatted)}`);
      globalDetails.push(`Recorded snapshots: ${written.join(", ")}`);
    }
  } catch (error) {
    failed = true;
    globalDetails.push(
      resources === undefined
        ? `Packing failed before scaffolding: ${String(error)}`
        : String(error),
    );
  } finally {
    try {
      await resources?.close();
    } catch (error) {
      failed = true;
      globalDetails.push(`Registry close failed: ${String(error)}`);
    }
  }
  const code =
    !failed &&
    results.length > 0 &&
    results.every(
      (result) => result.statuses.length === 1 && result.statuses[0] === "same",
    )
      ? 0
      : 1;
  if (code === 0) rmSync(folder, { recursive: true, force: true });
  else globalDetails.push(`Kept run folder: ${folder}`);
  const report =
    [
      ...results.map(
        (result) => `${result.name}: ${result.statuses.join("; ")}`,
      ),
      ...results
        .filter((result) => result.details.length > 0)
        .map((result) => `\n${result.name}:\n${result.details.join("\n")}`),
      ...globalDetails,
    ].join("\n") + "\n";
  return { code, folder, report, results };
}
