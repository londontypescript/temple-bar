// Runs a command asynchronously and collects its output. Async on purpose:
// the local registry (registry.ts) is served from this same process, so a
// blocking spawnSync would stop it answering the package manager it's
// waiting on.
//
// npm, pnpm and npx are `.cmd` shims on Windows, which only start through a
// shell. Test-only code with arguments the test itself builds, so each one
// is quoted rather than validated.

import { spawn } from "node:child_process";

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

function quoteForWindowsShell(arg: string): string {
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replaceAll('"', '""')}"` : arg;
}

export function run(
  command: string,
  args: readonly string[],
  options: RunOptions,
): Promise<RunResult> {
  const useShell = process.platform === "win32";
  return new Promise((resolve) => {
    const child = spawn(
      command,
      useShell ? args.map(quoteForWindowsShell) : [...args],
      {
        cwd: options.cwd,
        env: options.env,
        shell: useShell,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ code: 127, stdout, stderr: `${stderr}${error.message}\n` });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Describes a result for an assertion message. */
export function describe(result: RunResult): string {
  return `exit ${String(result.code)}\n--- stdout\n${result.stdout}\n--- stderr\n${result.stderr}`;
}
