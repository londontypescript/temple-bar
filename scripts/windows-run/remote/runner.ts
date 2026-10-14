// What runs on the Windows machine: take the lock, sweep a killed run's
// leftovers, check the machine can do what CI's runners can, check the commit
// out in a fresh worktree (git hooks off), run install, check and build, clean
// up, and print the result record last.
// Everything it touches is under one folder in the account's home, and it is
// all reached through `Sys`, so the logic is tested with fakes.

import path from "node:path";

import { reportEnvironment } from "./environment.ts";
import { pathExists, removeWithRetry } from "./fsx.ts";
import {
  acquireLock,
  releaseLock,
  type LockDeps,
  type LockOwner,
} from "./lock.ts";
import { pruneLogs, RunLog } from "./log.ts";
import {
  describeProcess,
  leftoversBefore,
  startedAfter,
  stopProcesses,
} from "./processes.ts";
import { readinessProblems } from "./readiness.ts";
import { formatRecord, type Refusal, type ResultRecord } from "./record.ts";
import { CheckScanner } from "./scan.ts";
import { allNotRun, runSteps } from "./steps.ts";
import { layoutFor, REF_PREFIX, sweepFiles, type Layout } from "./sweep.ts";
import type { Sys } from "./sys.ts";

/** Two start times this close are the same process: Get-Process and Node
 * measure it slightly differently. */
const START_TOLERANCE_MS = 2_000;

class Failure extends Error {
  readonly refusal: Refusal;
  constructor(refusal: Refusal, message: string) {
    super(message);
    this.refusal = refusal;
  }
}

interface State {
  steps: ResultRecord["steps"];
  refusal: Refusal | null;
  versions: ResultRecord["versions"];
  windows: ResultRecord["windows"];
  cleanup: string[];
}

function lockDeps(sys: Sys): LockDeps {
  return {
    fs: sys.fs,
    sleep: (ms) => sys.sleep(ms),
    async isAlive(owner) {
      const proc = (await sys.listProcesses()).find(
        (candidate) => candidate.pid === owner.pid,
      );
      if (proc === undefined) {
        return false;
      }
      if (proc.startMs === null || owner.startMs === null) {
        return true;
      }
      return Math.abs(proc.startMs - owner.startMs) < START_TOLERANCE_MS;
    },
  };
}

/** The checkout: a persistent clone with no GitHub origin, and this run's own
 * detached worktree. Git hooks are off for the checkout: the clone's hooks
 * are the ones an earlier run's install wrote, pointing at a worktree since
 * deleted, and the install step is the only install, so it is recorded. */
async function checkOut(
  sys: Sys,
  layout: Layout,
  runId: string,
  sha: string,
  ref: string,
): Promise<string> {
  const worktree = path.join(layout.runs, runId);
  await sys.fs.mkdir(layout.clone);
  if (!(await pathExists(sys.fs, path.join(layout.clone, ".git")))) {
    const init = await sys.git(["init", "--quiet", layout.clone]);
    if (init.code !== 0) {
      throw new Failure("fetch-failed", "git init failed");
    }
  }
  // Before any checkout: node_modules paths are long.
  const configured = await sys.git(
    ["config", "core.longpaths", "true"],
    layout.clone,
  );
  if (configured.code !== 0) {
    throw new Failure("fetch-failed", "git config core.longpaths failed");
  }

  const bundle = path.join(layout.incoming, runId, "run.bundle");
  const fetched = await sys.git(
    ["fetch", "--quiet", bundle, `HEAD:${ref}`],
    layout.clone,
  );
  if (fetched.code !== 0) {
    throw new Failure(
      "fetch-failed",
      `git fetch failed: ${fetched.stderr.trim()}`,
    );
  }
  const added = await sys.git(
    [
      "-c",
      `core.hooksPath=${sys.devNull}`,
      "worktree",
      "add",
      "--detach",
      worktree,
      sha,
    ],
    layout.clone,
  );
  if (added.code !== 0) {
    throw new Failure(
      "checkout-failed",
      `git worktree add failed: ${added.stderr.trim()}`,
    );
  }
  const head = await sys.git(["rev-parse", "HEAD"], worktree);
  if (head.code !== 0 || head.stdout.trim() !== sha) {
    throw new Failure(
      "commit-mismatch",
      `the worktree is at ${head.stdout.trim() || "an unknown commit"}, not ${sha}`,
    );
  }
  return worktree;
}

async function cleanUp(
  sys: Sys,
  layout: Layout,
  runId: string,
  ref: string,
  runnerStart: number,
): Promise<string[]> {
  const problems: string[] = [];
  try {
    const survivors = await stopProcesses(sys, startedAfter(runnerStart));
    for (const proc of survivors) {
      problems.push(`${describeProcess(proc)} would not stop`);
    }
  } catch {
    // A failed listing can't be read as "nothing left": say so.
    problems.push("could not list processes to stop what the run left");
  }
  const remove = async (target: string, what: string): Promise<void> => {
    try {
      await removeWithRetry(sys.fs, (ms) => sys.sleep(ms), target);
    } catch {
      problems.push(`could not remove ${what}`);
    }
  };
  await remove(path.join(layout.runs, runId), "the run's worktree");
  if (await pathExists(sys.fs, path.join(layout.clone, ".git"))) {
    const pruned = await sys.git(["worktree", "prune"], layout.clone);
    if (pruned.code !== 0) {
      problems.push("git worktree prune failed");
    }
    const deleted = await sys.git(["update-ref", "-d", ref], layout.clone);
    if (deleted.code !== 0) {
      problems.push(`could not delete ${ref}`);
    }
  }
  await remove(path.join(layout.incoming, runId), "the run's staging folder");
  return problems;
}

/**
 * Runs everything and prints the result record last. Returns the exit code:
 * 0 only if every step passed, otherwise 1. A cleanup problem is reported and
 * never changes the result.
 */
export async function runRemote(
  runId: string,
  sha: string,
  sys: Sys,
): Promise<number> {
  const say = (line: string): void => {
    sys.print(`${line}\n`);
  };
  const layout = layoutFor(sys.home);
  const ref = `${REF_PREFIX}${runId}`;
  const state: State = {
    steps: allNotRun(),
    refusal: null,
    versions: { node: null, pnpm: null, git: null },
    windows: null,
    cleanup: [],
  };
  const scanner = new CheckScanner();
  const log = new RunLog(sys.fs, path.join(layout.logs, `${runId}.log`));
  const deps = lockDeps(sys);
  let holdsLock = false;
  let cleanupNeeded = false;

  const finish = async (): Promise<number> => {
    if (holdsLock) {
      try {
        await releaseLock(deps, layout.lock, runId);
      } catch {
        state.cleanup.push("could not release the lock");
      }
    }
    // After the lock is released, so a failed release keeps the log, and on
    // every path (a runner error included).
    await settleLog(sys, layout, log, state);
    const totals = scanner.totals();
    const record: ResultRecord = {
      runId,
      sha,
      refusal: state.refusal,
      steps: state.steps,
      versions: state.versions,
      windows: state.windows,
      tests: {
        tests: totals.tests,
        passed: totals.passed,
        failed: totals.failed,
        skipped: totals.skipped,
      },
      gate: {
        skipped: totals.gateSkipped,
        noGithubOrigin: totals.gateNoGithubOrigin,
      },
      cleanup: state.cleanup.slice(0, 50).map((line) => line.slice(0, 400)),
    };
    for (const line of record.cleanup) {
      say(`windows-run: cleanup problem: ${line}`);
    }
    sys.print(`${formatRecord(record)}\n`);
    return record.refusal === null &&
      record.steps.every((step) => step.status === "passed")
      ? 0
      : 1;
  };

  try {
    for (const dir of [layout.runs, layout.logs, layout.incoming]) {
      await sys.fs.mkdir(dir);
    }
    const startList = await sys.listProcesses();
    const runnerStart =
      startList.find((proc) => proc.pid === sys.self.pid)?.startMs ??
      sys.self.startMs;
    const owner: LockOwner = {
      pid: sys.self.pid,
      startMs: runnerStart,
      runId,
    };

    const lock = await acquireLock(deps, layout.lock, owner);
    if (lock.kind === "held") {
      state.refusal = "lock-held";
      say(
        `windows-run: another run is in progress (lock held${lock.holder === undefined ? "" : ` by run ${lock.holder.runId}`}). If it is not, delete ${layout.lock} on this machine.`,
      );
      return await finish();
    }
    holdsLock = true;
    if (lock.tookOver !== undefined) {
      say(`windows-run: took over ${lock.tookOver}`);
    }

    const survivors = await stopProcesses(
      sys,
      leftoversBefore(runnerStart, startList, sys),
    );
    if (survivors.length > 0) {
      state.refusal = "sweep-failed";
      for (const proc of survivors) {
        state.cleanup.push(
          `${describeProcess(proc)} left by an earlier run would not stop`,
        );
      }
      return await finish();
    }
    state.cleanup.push(...(await sweepFiles(sys, layout, runId, say)));

    cleanupNeeded = true;
    try {
      const unready = await readinessProblems(
        sys,
        path.join(layout.incoming, runId, "readiness"),
      );
      for (const problem of unready) {
        say(`windows-run: machine not ready: ${problem}`);
      }
      if (unready.length > 0) {
        throw new Failure(
          "machine-not-ready",
          "this machine can't do what CI's runners can (see above)",
        );
      }
      const worktree = await checkOut(sys, layout, runId, sha, ref);
      const { steps, problems } = await runSteps(
        sys,
        worktree,
        log,
        scanner,
        say,
      );
      state.steps = steps;
      state.cleanup.push(...problems);
    } catch (error) {
      if (error instanceof Failure) {
        state.refusal = error.refusal;
        say(`windows-run: refused: ${error.message}`);
      } else {
        throw error;
      }
    }
    const environment = await reportEnvironment(sys, say);
    state.versions = environment.versions;
    state.windows = environment.windows;
    state.cleanup.push(
      ...(await cleanUp(sys, layout, runId, ref, runnerStart)),
    );
    cleanupNeeded = false;
    return await finish();
  } catch (error) {
    state.refusal = "runner-error";
    say(
      `windows-run: runner error: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (cleanupNeeded) {
      try {
        state.cleanup.push(
          ...(await cleanUp(sys, layout, runId, ref, sys.self.startMs)),
        );
      } catch {
        state.cleanup.push("cleanup after an error failed");
      }
    }
    return await finish();
  }
}

async function settleLog(
  sys: Sys,
  layout: Layout,
  log: RunLog,
  state: State,
): Promise<void> {
  try {
    // Flushed first: a write failure only shows once the text is written.
    await log.flush();
    if (log.problem !== undefined) {
      state.cleanup.push(log.problem);
    }
    const clean =
      state.refusal === null &&
      state.cleanup.length === 0 &&
      state.steps.every((step) => step.status === "passed");
    if (clean) {
      await log.delete((ms) => sys.sleep(ms));
    }
    await pruneLogs(sys.fs, (ms) => sys.sleep(ms), layout.logs);
  } catch {
    state.cleanup.push("could not tidy the logs folder");
  }
}
