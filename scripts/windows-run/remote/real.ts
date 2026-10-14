// The real machine behind `Sys`. Not unit-tested on other systems: the
// process listing and the shell for pnpm are Windows behaviour, exercised by
// running the command for real. The pure parts it leans on (process list
// parsing, line splitting) are tested.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { devNull, homedir, release, tmpdir, version } from "node:os";
import process from "node:process";

import { nodeFs } from "./fsx.ts";
import { LineBuffer } from "./lines.ts";
import { processesFromListing } from "./processes.ts";
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

// One level of the readiness check's trial tree: print its pid, start the
// next level with its output passed up, and stay alive a while. It exits on
// its own after two minutes, so a level nothing stops can't run forever.
const TREE_SCRIPT = `
const { spawn } = require('node:child_process');
const depth = Number(process.argv[1]);
process.stdout.write(process.pid + '\\n');
if (depth > 1) {
  const child = spawn(process.execPath, ['-e', 'eval(process.env.TB_TREE)', String(depth - 1)], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  child.stdout.pipe(process.stdout);
}
setTimeout(() => {}, 120000);`;

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

/** Resolves when the process exits, then gives its output streams a short
 * grace to finish: a grandchild can hold them open forever. A timeout kills
 * the process and resolves after the same grace. */
export function capture(
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    shell?: boolean;
    timeoutMs?: number;
    graceMs?: number;
  },
): Promise<Captured> {
  const graceMs = options.graceMs ?? STREAM_GRACE_MS;
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
    let done = false;
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (text: string) => {
      if (!done) stdout += text;
    });
    child.stderr.on("data", (text: string) => {
      if (!done) stderr += text;
    });
    const finish = (code: number): void => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(deadline);
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ code: timedOut ? 124 : code, stdout, stderr });
    };
    const deadline = setTimeout(
      () => {
        timedOut = true;
        try {
          if (child.pid !== undefined) {
            process.kill(child.pid);
          }
        } catch {
          // Already gone.
        }
        setTimeout(() => {
          finish(124);
        }, graceMs).unref();
      },
      options.timeoutMs ?? 2 ** 31 - 1,
    );
    child.on("error", (error) => {
      stderr += String(error);
      finish(127);
    });
    child.on("exit", (code) => {
      // The process is over: no deadline may fire now (it could kill a
      // reused pid), and the streams get only a short grace.
      clearTimeout(deadline);
      setTimeout(() => {
        finish(code ?? 1);
      }, graceMs).unref();
    });
    child.on("close", (code) => {
      finish(code ?? 1);
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

/** `start` is how the process is started: tests pass a fake process, so
 * timing is checked with a fake clock rather than a real process's speed. */
export function runStep(
  spec: StepSpec,
  timeoutMs: number,
  onLine: (line: string) => void,
  graceMs = STREAM_GRACE_MS,
  start: typeof spawn = spawn,
): Promise<StepOutcome> {
  return new Promise((resolve) => {
    let child;
    try {
      child = start(spec.command, spec.args, {
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
      }, graceMs).unref();
    }, timeoutMs);
    child.on("error", (error) => {
      onLine(`could not start ${spec.command}: ${error.message}`);
      finish(null);
    });
    // The step is over when its process exits, not when its streams close.
    child.on("exit", (code) => {
      // Over: the deadline must not fire now and kill a reused pid.
      clearTimeout(deadline);
      setTimeout(() => {
        finish(code);
      }, graceMs).unref();
    });
    child.on("close", (code) => {
      finish(code);
    });
  });
}

/** The top of the trial tree, kept so the stop can check it is its own. */
let treeTop: ChildProcess | undefined;

function taskkillSync(args: readonly string[]): number {
  const result = spawnSync("taskkill", args, {
    timeout: PROBE_TIMEOUT_MS,
    windowsHide: true,
    stdio: "ignore",
  });
  return result.status ?? 124;
}

/**
 * Stops the trial tree from its top with `taskkill /T`, and returns
 * taskkill's exit code, or null (running nothing) when the top has exited
 * or isn't the tree's. Run synchronously on purpose: Node closes a child's
 * process handle only when the event loop handles its exit, and Windows never
 * reuses a pid while a handle to it is open. With the loop blocked from the
 * check to the end of taskkill, the pid can't pass to another process even if
 * the top exits meanwhile; taskkill then just fails.
 */
export function stopTreeFrom(
  top: Pick<ChildProcess, "pid" | "exitCode" | "signalCode"> | undefined,
  pid: number,
  run: (args: readonly string[]) => number = taskkillSync,
): number | null {
  if (top?.pid !== pid || top.exitCode !== null || top.signalCode !== null) {
    return null;
  }
  return run(["/T", "/F", "/PID", String(pid)]);
}

function startTree(depth: number): Promise<number[]> {
  return new Promise((resolve) => {
    const pids: number[] = [];
    let child: ChildProcess;
    try {
      child = spawn(
        process.execPath,
        ["-e", "eval(process.env.TB_TREE)", String(depth)],
        {
          env: { ...process.env, TB_TREE: TREE_SCRIPT },
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
    } catch {
      resolve(pids);
      return;
    }
    treeTop = child;
    const stdout = child.stdout;
    if (stdout === null) {
      resolve(pids);
      return;
    }
    const buffer = new LineBuffer();
    let done = false;
    const finish = (): void => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(deadline);
      stdout.destroy();
      resolve(pids);
    };
    // Whatever started by then is reported; the run's cleanup stops it.
    const deadline = setTimeout(finish, PROBE_TIMEOUT_MS);
    stdout.on("data", (chunk: Buffer) => {
      for (const line of buffer.push(chunk)) {
        if (/^\d+$/.test(line)) {
          pids.push(Number(line));
        }
      }
      if (pids.length >= depth) {
        finish();
      }
    });
    child.on("error", finish);
    child.on("exit", finish);
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
      // The listing's own PowerShell (and the console host Windows may start
      // for it) began after this moment: never mistake them for leftovers.
      const asked = Date.now();
      return processesFromListing(await powershell(LIST_SCRIPT), asked);
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
    startTree,
    stopTree: (pid) => Promise.resolve(stopTreeFrom(treeTop, pid)),
  };
}
