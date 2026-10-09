import { spawn } from "node:child_process";

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
  constructor() {
    super("Interrupted; stopped the running process group.");
  }
}

/** A single bounded tail combines both streams in their arrival order. */
export function createRunner(
  platform: NodeJS.Platform,
  launch: typeof spawn = spawn,
): Runner {
  return (request) =>
    new Promise((resolve, reject) => {
      if (request.signal?.aborted) {
        reject(new Interrupted());
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
      let stopping: Promise<void> | undefined;
      const append = (chunk: Buffer) => {
        tail = Buffer.concat([tail, chunk]).subarray(-64 * 1024);
      };
      const killGroup = () => {
        if (child.pid === undefined || stopping !== undefined) return;
        if (windows) {
          // Windows has no POSIX process groups; taskkill's tree mode is its equivalent.
          const killer = launch(
            "taskkill",
            ["/pid", String(child.pid), "/T", "/F"],
            {
              env: request.env,
              cwd: request.cwd,
              stdio: "ignore",
              windowsHide: true,
            },
          );
          stopping = new Promise((finished) => {
            killer.on("error", (error) => {
              append(
                Buffer.from(`Could not stop process tree: ${error.message}\n`),
              );
              finished();
            });
            killer.on("close", (code) => {
              if (code !== 0)
                append(
                  Buffer.from(
                    `Could not stop process tree: taskkill exited ${String(code)}\n`,
                  ),
                );
              finished();
            });
          });
        } else {
          stopping = Promise.resolve();
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH")
              append(
                Buffer.from(`Could not stop process group: ${String(error)}\n`),
              );
          }
        }
      };
      const abort = () => {
        interrupted = true;
        killGroup();
      };
      request.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        killGroup();
      }, request.deadline);
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutTail = Buffer.concat([stdoutTail, chunk]).subarray(-64 * 1024);
        append(chunk);
      });
      child.stderr.on("data", append);
      const clean = () => {
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", abort);
      };
      child.on("error", (error) => {
        clean();
        append(Buffer.from(`${error.message}\n`));
        resolve({
          code: 127,
          output: tail.toString("utf8"),
          stdout: stdoutTail.toString("utf8"),
          timedOut,
        });
      });
      child.on("close", (code) => {
        clean();
        // Parent exit can precede taskkill's remaining descendant cleanup.
        // A returned result must include completion of the requested stop.
        void (stopping ?? Promise.resolve()).then(() => {
          if (interrupted) reject(new Interrupted());
          else
            resolve({
              code: code ?? 1,
              output: tail.toString("utf8"),
              stdout: stdoutTail.toString("utf8"),
              timedOut,
            });
        });
      });
    });
}

export const runProcess: Runner = createRunner(process.platform);
