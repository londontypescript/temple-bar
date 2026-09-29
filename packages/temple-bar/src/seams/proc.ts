// Runs an external command (npm/pnpm, for the gate's stack checks) and
// streams its output live through the context's writers, rather than
// inheriting the real process's stdio. That keeps this seam consistent with
// every other seam on Context: output goes through ctx.stdout/ctx.stderr, so
// a test can capture it with the fakes in testing/fakes.ts instead of
// touching real file descriptors or a pty. It is still "live": each chunk is
// written to the Writer as soon as it arrives on a `data` event, not
// buffered until the process exits.
//
// Windows can't start `npm` or `pnpm` directly — they are `.cmd` shims, and
// `child_process.spawn`/`execFile` refuse to launch those without a shell.
// So this seam sets `shell: true` for exactly those two commands, and only
// on win32. Once a shell is in the picture, the whole command line is
// subject to shell parsing, so nothing that reaches it may be attacker- or
// caller-controlled text: a shelled `npm`/`pnpm` call is refused unless every
// argument matches /^[A-Za-z0-9:_-]+$/ (covers script names like "typecheck"
// and flags like "run"). Every other command, on every platform, runs with
// `shell` false, so the OS execs the binary directly and never interprets
// the arguments at all: no such check is needed there.

import { spawn } from "node:child_process";
import type { Writer } from "./io.ts";

export interface ProcRunOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdout: Writer;
  readonly stderr: Writer;
}

export interface ProcSeam {
  /**
   * Runs `command args...` in `cwd`, streaming stdout/stderr live to
   * `options.stdout`/`options.stderr`. Never throws: resolves the process's
   * exit code, or a non-zero code (127) when it could not be started at all
   * — a missing executable, or (Windows only) a command/argument this seam
   * refuses to hand to a shell.
   */
  run(
    command: string,
    args: readonly string[],
    options: ProcRunOptions,
  ): Promise<number>;
}

/** The only commands this seam will ever run through a shell. */
const SHELLABLE_COMMANDS = new Set(["npm", "pnpm"]);

/** What an argument must look like to be safe to hand to a shell: this is
 * deliberately narrow (covers "run" and script names like "typecheck"), not
 * a general shell-escaping attempt. */
const SAFE_SHELL_ARG = /^[A-Za-z0-9:_-]+$/;

export function isAllowedShellCommand(command: string): boolean {
  return SHELLABLE_COMMANDS.has(command);
}

export function isSafeShellArg(arg: string): boolean {
  return SAFE_SHELL_ARG.test(arg);
}

/** True when `command`/`args` are safe to run with `shell: true`. Exported
 * mainly so tests can exercise the guard without needing to run on
 * win32 to observe it. */
export function isSafeForShell(
  command: string,
  args: readonly string[],
): boolean {
  return isAllowedShellCommand(command) && args.every(isSafeShellArg);
}

export function createProcSeam(): ProcSeam {
  return {
    run(command, args, options) {
      return new Promise((resolve) => {
        const useShell =
          process.platform === "win32" && isAllowedShellCommand(command);

        if (useShell && !isSafeForShell(command, args)) {
          options.stderr.write(
            `proc: refusing to run "${[command, ...args].join(" ")}" through a shell on Windows: an argument is not safely quotable\n`,
          );
          resolve(127);
          return;
        }

        let child;
        try {
          child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            shell: useShell,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch {
          // Node throws synchronously for some unstartable commands (on
          // Windows, a `.cmd`/`.bat` without a shell is EINVAL): report it
          // like any other start failure rather than rejecting.
          resolve(127);
          return;
        }

        child.stdout.on("data", (chunk: Buffer) => {
          options.stdout.write(chunk.toString("utf8"));
        });
        child.stderr.on("data", (chunk: Buffer) => {
          options.stderr.write(chunk.toString("utf8"));
        });

        // Could not start at all (e.g. ENOENT): never throw, report it as a
        // failing exit code instead.
        child.on("error", () => {
          resolve(127);
        });

        child.on("close", (code) => {
          resolve(code ?? 1);
        });
      });
    },
  };
}
