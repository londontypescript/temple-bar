import { spawn, type ChildProcess } from "node:child_process";

export interface Command {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly deadline: number;
  readonly signal?: AbortSignal;
}

export interface RunResult {
  readonly code: number;
  readonly output: string;
  /** Standard output alone, bounded the same way. Parse values from this,
   * never from `output`: npm prints warnings on the other stream, and the
   * two arrive mixed. */
  readonly stdout: string;
  readonly timedOut: boolean;
}

export type Runner = (command: Command) => Promise<RunResult>;

export class Interrupted extends Error {
  constructor(detail = "nothing was left running.") {
    super(`Interrupted; ${detail}`);
  }
}

/** A command that may have left processes running, left one holding its
 * output after it exited, or whose output never finished. Its result can't be
 * trusted, and nothing later may start beside such processes, so the caller
 * stops the whole check rather than moving on to the next scaffold. */
export class CleanupFailed extends Error {}

/** How long each wait after the command itself may take. Past any of them
 * the run fails, naming what didn't finish, instead of waiting forever. */
export interface Limits {
  /** For the tree-stop command (taskkill) to finish. */
  readonly stop: number;
  /** For the command to exit and its output to close once a stop reports
   * success. */
  readonly afterStop: number;
  /** For the output to close after the command exits on its own. */
  readonly closeGrace: number;
}

const LIMITS: Limits = { stop: 15_000, afterStop: 5_000, closeGrace: 5_000 };

interface StopOutcome {
  readonly stopped: boolean;
  readonly detail: string;
}

const seconds = (ms: number) => `${String(Math.round(ms / 100) / 10)} s`;

/** Runs one command with a deadline, keeping the last 64 KiB of both streams
 * in arrival order.
 *
 * Stopping is best effort, and the runner says so when it can't confirm it.
 * On POSIX the command leads its own process group, and SIGKILL goes to the
 * group; a descendant that starts its own session escapes it. On Windows
 * `taskkill /T` stops the tree, but it can be refused (a standard account
 * signed in over SSH is), and a pid can be reused once its process has gone,
 * so nothing is stopped by pid after the command has exited. */
export function createRunner(
  platform: NodeJS.Platform,
  launch: typeof spawn = spawn,
  limits: Limits = LIMITS,
): Runner {
  return (request) =>
    new Promise((resolve, reject) => {
      if (request.signal?.aborted) {
        reject(new Interrupted("the command never started."));
        return;
      }
      const windows = platform === "win32";
      // npm and pnpm are `.cmd` shims on Windows, which start only through a
      // shell. A real executable (node) starts directly, so its arguments keep
      // Node's own quoting: cmd.exe's `""` would garble a `\"` inside one.
      const shell = windows && !/\.exe$/i.test(request.command);
      const child = launch(
        request.command,
        shell
          ? request.args.map((arg) => `"${arg.replaceAll('"', '""')}"`)
          : [...request.args],
        {
          cwd: request.cwd,
          env: request.env,
          shell,
          detached: !windows,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let tail = Buffer.alloc(0);
      let stdoutTail = Buffer.alloc(0);
      let timedOut = false;
      let interrupted = false;
      let exited = false;
      let closed = false;
      let settled = false;
      let exitCode: number | null = null;
      // Set when a command exits but something it started keeps its output
      // open: the result is untrustworthy even once that process is stopped.
      let leftoverProblem: string | undefined;
      let stopping: Promise<void> | undefined;
      let stopOutcome: StopOutcome | undefined;
      let killer: ChildProcess | undefined;
      const problems: string[] = [];
      const timers = new Set<NodeJS.Timeout>();
      const after = (ms: number, action: () => void) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          action();
        }, ms);
        timers.add(timer);
        return timer;
      };
      const cancel = (timer: NodeJS.Timeout) => {
        clearTimeout(timer);
        timers.delete(timer);
      };
      const append = (chunk: Buffer) => {
        tail = Buffer.concat([tail, chunk]).subarray(-64 * 1024);
      };

      // The one way out: every path ends here exactly once, releasing every
      // timer, listener and stream so nothing keeps Node alive afterwards.
      const settle = (problem?: string) => {
        if (settled) return;
        settled = true;
        if (leftoverProblem !== undefined) problems.push(leftoverProblem);
        if (problem !== undefined) problems.push(problem);
        if (stopOutcome?.stopped === false)
          problems.unshift(stopOutcome.detail);
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        request.signal?.removeEventListener("abort", abort);
        if (!closed) {
          child.stdout.destroy();
          child.stderr.destroy();
        }
        // A process that couldn't be stopped is let go, not waited on: the
        // failure below names it, and the check stops.
        if (!exited) child.unref();
        if (killer?.exitCode === null) {
          killer.kill();
          killer.unref();
        }
        if (interrupted) {
          reject(
            new Interrupted(
              problems.length > 0
                ? `could not confirm the command stopped: ${problems.join("; ")}.`
                : `${stopOutcome?.detail ?? "the command had finished"}.`,
            ),
          );
        } else if (problems.length > 0) {
          const output = tail.toString("utf8");
          reject(
            new CleanupFailed(
              `${[request.command, ...request.args].join(" ")}: ${problems.join("; ")}.${output ? `\n${output}` : ""}`,
            ),
          );
        } else {
          resolve({
            code: exitCode ?? 1,
            output: tail.toString("utf8"),
            stdout: stdoutTail.toString("utf8"),
            timedOut,
          });
        }
      };

      const stopTree = (): Promise<StopOutcome> => {
        const pid = child.pid;
        if (pid === undefined)
          return Promise.resolve({ stopped: true, detail: "it never started" });
        if (!windows) {
          try {
            process.kill(-pid, "SIGKILL");
            return Promise.resolve({
              stopped: true,
              detail: "sent SIGKILL to its process group",
            });
          } catch (error) {
            return Promise.resolve(
              (error as NodeJS.ErrnoException).code === "ESRCH"
                ? {
                    stopped: true,
                    detail: "its process group had already ended",
                  }
                : {
                    stopped: false,
                    detail: `could not signal its process group: ${String(error)}`,
                  },
            );
          }
        }
        return new Promise((done) => {
          const limit = after(limits.stop, () => {
            done({
              stopped: false,
              detail: `taskkill did not finish within ${seconds(limits.stop)}`,
            });
          });
          const started = launch(
            "taskkill",
            ["/pid", String(pid), "/T", "/F"],
            {
              env: request.env,
              cwd: request.cwd,
              stdio: "ignore",
              windowsHide: true,
            },
          );
          killer = started;
          started.on("error", (error) => {
            cancel(limit);
            done({
              stopped: false,
              detail: `could not run taskkill: ${error.message}`,
            });
          });
          started.on("close", (code) => {
            cancel(limit);
            done(
              code === 0
                ? { stopped: true, detail: "taskkill stopped its process tree" }
                : { stopped: false, detail: `taskkill exited ${String(code)}` },
            );
          });
        });
      };

      const requestStop = () => {
        if (settled || stopping !== undefined) return;
        // The pid may already belong to another process: the close grace
        // decides what an exited command's held output means.
        if (exited && windows) return;
        // Each part is bounded: taskkill by its own limit, and what follows a
        // successful stop by the after-stop limit.
        stopping = stopTree().then((outcome) => {
          stopOutcome = outcome;
          if (!outcome.stopped || closed) {
            settle();
            return;
          }
          after(limits.afterStop, () => {
            settle(
              exited
                ? `its output was still open ${seconds(limits.afterStop)} after the stop`
                : `it was still running ${seconds(limits.afterStop)} after the stop`,
            );
          });
        });
      };

      const abort = () => {
        interrupted = true;
        requestStop();
      };
      request.signal?.addEventListener("abort", abort, { once: true });
      const deadline = after(request.deadline, () => {
        timedOut = true;
        requestStop();
      });

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutTail = Buffer.concat([stdoutTail, chunk]).subarray(-64 * 1024);
        append(chunk);
      });
      child.stderr.on("data", append);
      child.on("error", (error) => {
        append(Buffer.from(`${error.message}\n`));
        // Without a pid it never started: a failed result, nothing to stop.
        if (child.pid === undefined) {
          exited = true;
          closed = true;
          exitCode = 127;
          settle();
        }
      });
      child.on("exit", (code) => {
        exited = true;
        exitCode = code;
        // After a failed stop the runner has already given up on it: a late
        // exit must not start a timer that keeps Node alive.
        if (settled) return;
        cancel(deadline);
        after(limits.closeGrace, () => {
          if (closed || settled || stopping !== undefined) return;
          if (windows)
            settle(
              `its output was still open ${seconds(limits.closeGrace)} after it exited, so a process it started may still be running`,
            );
          else {
            leftoverProblem = `it exited but left a process holding its output, which was sent SIGKILL with its process group`;
            requestStop();
          }
        });
      });
      child.on("close", (code) => {
        closed = true;
        if (!exited) {
          exited = true;
          exitCode = code;
        }
        // A stop under way settles once its outcome is known.
        if (stopping !== undefined && stopOutcome === undefined) return;
        settle();
      });
      if (request.signal?.aborted) abort();
    });
}

export const runProcess: Runner = createRunner(process.platform);
