// The three steps CI runs, in CI's order, each timed, logged and followed by
// a sweep of whatever it left running. A failed step stops the rest.

import type { RunLog } from "./log.ts";
import { describeProcess, startedSince, stopProcesses } from "./processes.ts";
import type { StepName, StepRecord } from "./record.ts";
import { STEP_NAMES } from "./record.ts";
import type { CheckScanner } from "./scan.ts";
import type { Sys } from "./sys.ts";

const MINUTE = 60_000;

interface StepPlan {
  readonly name: StepName;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

// Fixed commands and arguments only: pnpm is a .cmd on Windows and needs a
// shell, so nothing but these may ever reach it. The check takes tens of
// minutes on this machine.
const PLANS: readonly StepPlan[] = [
  {
    name: "install",
    args: ["install", "--frozen-lockfile"],
    timeoutMs: 20 * MINUTE,
  },
  { name: "check", args: ["check"], timeoutMs: 120 * MINUTE },
  { name: "build", args: ["build"], timeoutMs: 20 * MINUTE },
];

function notRun(name: StepName): StepRecord {
  return { name, status: "not-run", exitCode: null, durationMs: 0 };
}

export function allNotRun(): StepRecord[] {
  return STEP_NAMES.map(notRun);
}

export interface StepsResult {
  readonly steps: StepRecord[];
  /** Processes a step left that would not stop, and the like. */
  readonly problems: string[];
}

export async function runSteps(
  sys: Sys,
  worktree: string,
  log: RunLog,
  scanner: CheckScanner,
  say: (line: string) => void,
): Promise<StepsResult> {
  const steps: StepRecord[] = [];
  const problems: string[] = [];
  let stopped = false;

  for (const plan of PLANS) {
    if (stopped) {
      steps.push(notRun(plan.name));
      continue;
    }
    const command = `pnpm ${plan.args.join(" ")}`;
    say(`windows-run: step ${plan.name}: ${command}`);
    log.startStep(command);
    const startedAt = sys.now();
    const outcome = await sys.runStep(
      { command: "pnpm", args: plan.args, cwd: worktree },
      plan.timeoutMs,
      (line) => {
        // Indented, so nothing a step prints can look like the runner's own
        // lines, the result record above all.
        sys.print(`  ${line}\n`);
        log.line(line);
        if (plan.name === "check") {
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
      say(
        `windows-run: step ${plan.name} passed its ${String(plan.timeoutMs / MINUTE)}-minute deadline and was stopped`,
      );
    }

    // Nothing from one step may overlap the next. If something won't stop,
    // this decides the result: the step fails and the rest are not run.
    const survivors = await stopProcesses(sys, startedSince(startedAt));
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
  }
  return { steps, problems };
}
