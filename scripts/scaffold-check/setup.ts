import { writeFileSync } from "node:fs";
import path from "node:path";
import { expectation } from "./expectation.ts";
import type { Resources } from "./resources.ts";
import type { Runner, RunResult } from "./runner.ts";
import type { Snapshot } from "./snapshot.ts";
import { readOrdinary, validateFiles } from "./validate-files.ts";
import { validateManifest } from "./validate-manifest.ts";
import {
  gitState,
  validateCommit,
  validateGate,
  validateRefusal,
  validateSource,
} from "./validation.ts";

export const DEADLINES = {
  version: 120_000,
  scaffold: 300_000,
  install: 600_000,
  other: 120_000,
};

export interface SetupResult {
  readonly findings: readonly string[];
  readonly unknown: readonly string[];
  readonly information: readonly string[];
}

export function failure(result: RunResult): string {
  return `${result.timedOut ? "deadline reached" : `exit ${String(result.code)}`}\n${result.output.trimEnd().split("\n").slice(-40).join("\n")}`;
}

function report(result: RunResult): string {
  return `${result.timedOut ? "deadline reached" : `exit ${String(result.code)}`}\n${result.output}`;
}

export async function setup(
  project: string,
  snapshot: Snapshot,
  env: NodeJS.ProcessEnv,
  runner: Runner,
  resources: Resources,
  pnpmVersion: string,
  signal?: AbortSignal,
): Promise<SetupResult> {
  const expected = expectation(snapshot);
  const information: string[] = [];
  const findings: string[] = [];
  const run = (
    command: string,
    args: readonly string[],
    deadline = DEADLINES.other,
  ) =>
    runner({
      command,
      args,
      cwd: project,
      env,
      deadline,
      ...(signal === undefined ? {} : { signal }),
    });
  const checked = async (args: readonly string[]) => {
    const result = await run("git", args);
    if (result.code !== 0 || result.timedOut)
      throw new Error(`git ${args.join(" ")}: ${failure(result)}`);
  };
  for (const args of [
    ["init", "-b", "main"],
    ["config", "core.autocrlf", "false"],
    ["config", "core.symlinks", "true"],
    ["add", "-A", "--force"],
    ["commit", "-q", "-m", "Initial commit"],
    ["remote", "add", "origin", "git@github.com:acme/widgets.git"],
  ])
    await checked(args);
  const before = gitState(project);
  const launch = await run(
    "pnpm",
    [
      `--package=${resources.tarballs.createTempleBar}`,
      "dlx",
      "create-temple-bar",
    ],
    DEADLINES.install,
  );
  information.push(`launcher report:\n${report(launch)}`);
  if (launch.output.includes("fake gh: unexpected call"))
    findings.push("launcher: fake gh: unexpected call in output");
  if (expected.refusal !== undefined) {
    const status = await run("git", ["status", "--porcelain", "--ignored"]);
    findings.push(
      ...validateRefusal(project, before, status, launch, expected.refusal),
    );
    return { findings, unknown: expected.unknown, information };
  }
  // Unknown conflicts can legitimately make setup return non-zero. A person
  // must add their expectations before judging any resulting partial setup.
  if (expected.unknown.length > 0)
    return { findings, unknown: expected.unknown, information };
  if (launch.code !== 0 || launch.timedOut)
    findings.push(`launcher: setup did not exit 0 (${failure(launch)})`);
  const pkg = validateManifest(
    snapshot,
    readOrdinary(project, "package.json")?.toString("utf8"),
    resources.version,
    pnpmVersion,
  );
  findings.push(
    ...pkg.findings,
    ...validateSource(project, resources.registry, resources.version),
    ...validateFiles(project, snapshot),
  );
  information.push(...pkg.information);
  // A deadlined install may leave an incomplete project. Don't run more of it.
  if (launch.timedOut) return { findings, unknown: [], information };
  findings.push(
    ...validateCommit(
      await run("git", ["commit", "--allow-empty", "-m", "direct"]),
    ),
  );
  writeFileSync(path.join(project, "index.js"), "export {};\n");
  await checked([
    "remote",
    "set-url",
    "origin",
    "https://git.example.invalid/acme/widgets.git",
  ]);
  const gate = await run("pnpm", ["run", "gate"]);
  findings.push(...validateGate(snapshot, gate));
  information.push(`gate report (information):\n${report(gate)}`);
  return { findings, unknown: [], information };
}
