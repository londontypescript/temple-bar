// Running a run's steps in order, each timed, logged and followed by a sweep
// of whatever it left running. A failed step stops the rest. The full run's
// steps are CI's three, in CI's order; a targeted run's are in targeted.ts.

import type { RunLog } from "./log.ts";
import { describeProcess, startedSince, stopProcesses } from "./processes.ts";
import {
  STEPS_FOR,
  type RunMode,
  type StepName,
  type StepRecord,
} from "./record.ts";
import type { CheckScanner } from "./scan.ts";
import type { Sys } from "./sys.ts";

export const MINUTE = 60_000;

export interface StepPlan {
  readonly name: StepName;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  /** Whether its output holds the test totals the summary reports. */
  readonly scan: boolean;
  /** Not run, and recorded as skipped, with this reason for the terminal. */
  readonly skipped?: string;
  /** Runs once the step has passed, its leftovers stopped. */
  readonly afterPass?: () => Promise<void>;
}

// Fixed commands and arguments only: pnpm is a .cmd on Windows and needs a
// shell, so nothing but these may ever reach it. The check takes tens of
// minutes on this machine.
function pnpmPlan(
  name: StepName,
  args: string[],
  minutes: number,
  worktree: string,
): StepPlan {
  return {
    name,
    command: "pnpm",
    args,
    cwd: worktree,
    timeoutMs: minutes * MINUTE,
    scan: name === "check",
  };
}

/** The frozen install, the first step of either kind of run. */
export function installPlan(worktree: string): StepPlan {
  return pnpmPlan("install", ["install", "--frozen-lockfile"], 20, worktree);
}

/** The full run's steps. */
export function fullPlans(worktree: string): StepPlan[] {
  return [
    installPlan(worktree),
    pnpmPlan("check", ["check"], 120, worktree),
    pnpmPlan("build", ["build"], 20, worktree),
  ];
}

export function notRun(name: StepName): StepRecord {
  return { name, status: "not-run", exitCode: null, durationMs: 0 };
}

export function allNotRun(mode: RunMode): StepRecord[] {
  return STEPS_FOR[mode].map(notRun);
}

export interface StepsResult {
  readonly steps: StepRecord[];
  /** Processes a step left that would not stop, and the like. */
  readonly problems: string[];
}

export async function runSteps(
  sys: Sys,
  plans: readonly StepPlan[],
  log: RunLog,
  scanner: CheckScanner,
  say: (line: string) => void,
): Promise<StepsResult> {
  const steps: StepRecord[] = [];
  const problems: string[] = [];
  let stopped = false;

  for (const plan of plans) {
    if (stopped) {
      steps.push(notRun(plan.name));
      continue;
    }
    if (plan.skipped !== undefined) {
      say(`windows-run: step ${plan.name}: skipped (${plan.skipped})`);
      steps.push({
        name: plan.name,
        status: "skipped",
        exitCode: null,
        durationMs: 0,
      });
      continue;
    }
    const command = [plan.command, ...plan.args].join(" ");
    say(`windows-run: step ${plan.name}: ${command}`);
    log.startStep(command);
    const startedAt = sys.now();
    const outcome = await sys.runStep(
      { command: plan.command, args: plan.args, cwd: plan.cwd },
      plan.timeoutMs,
      (line) => {
        // Indented, so nothing a step prints can look like the runner's own
        // lines, the result record above all.
        sys.print(`  ${line}\n`);
        log.line(line);
        if (plan.scan) {
          scanner.feed(line);
        }
      },
    );
    const durationMs = sys.now() - startedAt;
    let status: StepRecord["status"] = outcome.timedOut
      ? "timed-out"
      : outcome.exitCode === 0
        ? "passed"
        : "failed";
    if (outcome.timedOut) {
      // Said before the stop, which can take a while: the step's own process
      // has been told to stop, but what it started may still be running.
      say(
        `windows-run: step ${plan.name} passed its ${String(plan.timeoutMs / MINUTE)}-minute deadline: stopping it and everything it started`,
      );
    }

    // Nothing from one step may overlap the next. If something won't stop,
    // this decides the result: the step fails and the rest are not run.
    const survivors = await stopProcesses(sys, startedSince(startedAt));
    if (outcome.timedOut) {
      say(
        survivors.length === 0
          ? `windows-run: step ${plan.name} stopped, with everything it started`
          : `windows-run: step ${plan.name}: could not stop ${survivors.map(describeProcess).join(", ")}`,
      );
    }
    if (survivors.length > 0) {
      for (const proc of survivors) {
        problems.push(
          `${describeProcess(proc)} left by ${plan.name} would not stop`,
        );
      }
      status = status === "passed" ? "failed" : status;
    }
    steps.push({
      name: plan.name,
      status,
      exitCode: outcome.exitCode,
      durationMs,
    });
    stopped = status !== "passed";
    if (!stopped && plan.afterPass !== undefined) {
      await plan.afterPass();
    }
  }
  return { steps, problems };
}
