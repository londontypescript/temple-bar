// The one place this package spawns a child process, so tests can inject a
// fake instead. The real command, `pnpm`, inherits stdio: `temple-bar init`
// prompts interactively (gh sign-in, repo creation, the ruleset), and that
// only works if it can see the real terminal.

import { spawn } from "node:child_process";

export interface RunOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /** Collect the child's standard output into the result instead of showing
   * it. For commands whose answer the launcher reads; never for ones that
   * prompt. Standard error and input still go to the terminal. */
  readonly capture?: boolean;
}

export interface RunResult {
  readonly code: number | null;
  /** The child's standard output; only set when `capture` was asked for. */
  readonly stdout?: string;
}

export type ProcessRunner = (
  command: string,
  args: readonly string[],
  options: RunOptions,
) => Promise<RunResult>;

// The only commands this package ever spawns. `command` always comes from
// package-manager.ts's fixed command lines, never from user input, but
// this allowlist is a second, load-bearing check: it's what makes `shell:
// true` on Windows safe below.
const ALLOWED_COMMANDS = new Set(["pnpm"]);

// What every argument must look like before it can reach a Windows shell:
// flags, subcommands and a package spec such as
// "@londontypescript/temple-bar@1.2.3". Nothing a shell treats as special.
const SAFE_ARG = /^[A-Za-z0-9@/._:=-]+$/;

export function createProcessRunner(): ProcessRunner {
  return (command, args, options) => {
    if (!ALLOWED_COMMANDS.has(command)) {
      throw new Error(`refusing to run an unexpected command: ${command}`);
    }
    const unsafe = args.find((arg) => !SAFE_ARG.test(arg));
    if (unsafe !== undefined) {
      throw new Error(
        `refusing to run ${command} with an unsafe argument: ${unsafe}`,
      );
    }

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: options.capture ? ["inherit", "pipe", "inherit"] : "inherit",
        windowsHide: true,
        // On Windows, pnpm is a .cmd shim, which
        // node:child_process can only launch through a shell. This is safe
        // here specifically because `command` is checked against
        // ALLOWED_COMMANDS above and every argument against SAFE_ARG (they
        // are fixed strings from package-manager.ts, or a package spec built
        // from this package's own version, but the check doesn't rely on it).
        shell: process.platform === "win32",
      });
      let stdout = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          resolve({ code: null });
          return;
        }
        reject(error);
      });
      // "close", not "exit": it fires after all captured output was read.
      child.on("close", (code) => {
        resolve(options.capture ? { code, stdout } : { code });
      });
    });
  };
}
