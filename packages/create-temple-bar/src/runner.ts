// The one place this package spawns a child process, so tests can inject a
// fake instead. Real commands (`pnpm`, `npm`, `yarn`, `bun`, `npx`, `bunx`)
// inherit stdio: `temple-bar init` prompts interactively (gh sign-in, repo
// creation, the ruleset), and that only works if it can see the real
// terminal.

import { spawn } from "node:child_process";

export interface RunOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export interface RunResult {
  readonly code: number | null;
}

export type ProcessRunner = (
  command: string,
  args: readonly string[],
  options: RunOptions,
) => Promise<RunResult>;

// The only commands this package ever spawns. `command` always comes from
// package-manager.ts's own switch statements, never from user input, but
// this allowlist is a second, load-bearing check: it's what makes `shell:
// true` on Windows safe below.
const ALLOWED_COMMANDS = new Set(["pnpm", "npm", "yarn", "bun", "npx", "bunx"]);

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
        stdio: "inherit",
        windowsHide: true,
        // On Windows, npm/pnpm/yarn/bun/npx/bunx are .cmd shims, which
        // node:child_process can only launch through a shell. This is safe
        // here specifically because `command` is checked against
        // ALLOWED_COMMANDS above and every argument against SAFE_ARG (they
        // are fixed strings from package-manager.ts, or a package spec built
        // from this package's own version, but the check doesn't rely on it).
        shell: process.platform === "win32",
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          resolve({ code: null });
          return;
        }
        reject(error);
      });
      child.on("exit", (code) => {
        resolve({ code });
      });
    });
  };
}
