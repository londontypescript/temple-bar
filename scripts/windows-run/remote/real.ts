// The real machine behind `Sys`. Not unit-tested on other systems: the
// process listing and the shell for pnpm are Windows behaviour, exercised by
// running the command for real. The pure parts it leans on (process list
// parsing, line splitting) are tested.

import { spawn } from "node:child_process";
import { devNull, homedir, release, tmpdir, version } from "node:os";
import process from "node:process";

import { nodeFs } from "./fsx.ts";
import { LineBuffer } from "./lines.ts";
import { parseProcessList } from "./processes.ts";
import type { GitResult, ProcInfo, StepOutcome, StepSpec, Sys } from "./sys.ts";

const IS_WINDOWS = process.platform === "win32";
/** How long to wait for a step's output streams to close after the step has
 * exited: a leftover grandchild can hold them open forever. */
const STREAM_GRACE_MS = 3_000;
const PROBE_TIMEOUT_MS = 30_000;
/** What an argument must look like to be handed to a shell, for the one
 * command that needs one (pnpm is a .cmd file on Windows). */
const SAFE_SHELL_ARG = /^[A-Za-z0-9:_-]+$/;

// Own processes only have a readable start time, so those are the ones that
// report one. The listing process leaves itself out of its own list.
const LIST_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Get-Process | Where-Object { $_.Id -ne $PID } | ForEach-Object {
  $s = ''
  try { $s = [string]([DateTimeOffset]$_.StartTime).ToUnixTimeMilliseconds() } catch {}
  '{0}|{1}|{2}' -f $_.Id, $_.ProcessName, $s
}`;

function startScript(pid: number): string {
  return `
$ErrorActionPreference = 'SilentlyContinue'
$p = Get-Process -Id ${String(pid)}
if ($p) {
  try { [string]([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds() } catch {}
}`;
}

interface Captured {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function capture(
  command: string,
  args: readonly string[],
  options: { cwd?: string; shell?: boolean; timeoutMs?: number },
): Promise<Captured> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        shell: options.shell ?? false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ code: 127, stdout: "", stderr: String(error) });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (text: string) => (stdout += text));
    child.stderr.on("data", (text: string) => (stderr += text));
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => child.kill(), options.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + String(error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function powershell(script: string): Promise<Captured> {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return capture(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    { timeoutMs: PROBE_TIMEOUT_MS },
  );
}

function needsShell(command: string, args: readonly string[]): boolean {
  if (!IS_WINDOWS || command !== "pnpm") {
    return false;
  }
  if (!args.every((arg) => SAFE_SHELL_ARG.test(arg))) {
    throw new Error(`refusing to give "${args.join(" ")}" to a shell`);
  }
  return true;
}

function runStep(
  spec: StepSpec,
  timeoutMs: number,
  onLine: (line: string) => void,
): Promise<StepOutcome> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        shell: needsShell(spec.command, spec.args),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      onLine(`could not start ${spec.command}: ${String(error)}`);
      resolve({ exitCode: null, timedOut: false });
      return;
    }
    const buffers = [new LineBuffer(), new LineBuffer()];
    const streams = [child.stdout, child.stderr] as const;
    let finished = false;
    let timedOut = false;
    for (const [index, stream] of streams.entries()) {
      stream.on("data", (chunk: Buffer) => {
        if (!finished) {
          for (const line of buffers[index]?.push(chunk) ?? []) {
            onLine(line);
          }
        }
      });
    }
    const finish = (exitCode: number | null): void => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(deadline);
      for (const buffer of buffers) {
        for (const line of buffer.end()) {
          onLine(line);
        }
      }
      for (const stream of streams) {
        stream.destroy();
      }
      resolve({ exitCode: timedOut ? null : exitCode, timedOut });
    };
    const deadline = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid !== undefined) {
          process.kill(child.pid);
        }
      } catch {
        // Already gone.
      }
      // What it left behind is stopped by the caller; don't wait for streams.
      setTimeout(() => {
        finish(null);
      }, STREAM_GRACE_MS);
    }, timeoutMs);
    child.on("error", (error) => {
      onLine(`could not start ${spec.command}: ${error.message}`);
      finish(null);
    });
    // The step is over when its process exits, not when its streams close.
    child.on("exit", (code) => {
      setTimeout(() => {
        finish(code);
      }, STREAM_GRACE_MS).unref();
    });
    child.on("close", (code) => {
      finish(code);
    });
  });
}

export function createRealSys(): Sys {
  return {
    home: process.env.USERPROFILE ?? homedir(),
    devNull,
    tmpdir: tmpdir(),
    osRelease: release(),
    osVersion: version(),
    self: {
      pid: process.pid,
      ppid: process.ppid,
      startMs: Date.now() - process.uptime() * 1000,
    },
    fs: nodeFs,
    now: () => Date.now(),
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    print(text) {
      process.stdout.write(text);
    },
    async listProcesses(): Promise<ProcInfo[]> {
      const result = await powershell(LIST_SCRIPT);
      return result.code === 0 ? parseProcessList(result.stdout) : [];
    },
    async startOf(pid) {
      if (!Number.isSafeInteger(pid)) {
        return null;
      }
      const text = (await powershell(startScript(pid))).stdout.trim();
      return /^\d+$/.test(text) ? Number(text) : null;
    },
    kill(pid) {
      process.kill(pid);
    },
    async git(args, cwd): Promise<GitResult> {
      return capture("git", args, cwd === undefined ? {} : { cwd });
    },
    runStep,
    async probe(command, args) {
      const result = await capture(command, args, {
        shell: needsShell(command, args),
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      return result.code === 0 ? result.stdout : null;
    },
    async where(command) {
      const result = await capture(IS_WINDOWS ? "where" : "which", [command], {
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      const first = result.stdout.split(/\r?\n/)[0] ?? "";
      return result.code === 0 && first !== "" ? first : null;
    },
  };
}
