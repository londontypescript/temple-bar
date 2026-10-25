// The real processes, folders and clock behind the test run's lifecycle.
// The runner's global setup (anchor.ts) holds /tmp with these; tests use them
// to check the real process handling on whichever system runs the suite.

import { spawn } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import process from "node:process";

import { capture, createRealSys } from "../windows-run/remote/real.ts";
import { LineBuffer } from "../windows-run/remote/lines.ts";
import type { Ended, Proc, RunTestsDeps } from "./lifecycle.ts";

/** Enough of the anchor's stderr to say why it failed. */
const STDERR_KEEP = 4_000;

function startProcess(
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv },
): Proc {
  const lines = new LineBuffer();
  const listeners: ((line: string) => void)[] = [];
  let stderr = "";
  let settle: (ended: Ended) => void = () => undefined;
  const ended = new Promise<Ended>((resolve) => {
    settle = resolve;
  });
  // Hidden, with no stream shared, Node starts it on a console of its own
  // (CREATE_NO_WINDOW), so Ctrl+C in the runner's terminal doesn't reach it.
  const child = spawn(command, args, {
    env: options.env,
    stdio: "pipe",
    windowsHide: true,
  });
  child.on("error", (error) => {
    settle({ kind: "error", message: error.message });
  });
  child.on("exit", (code, signal) => {
    settle({ kind: "exit", code, signal });
  });
  // Closing the input of a process that has already gone fails with EPIPE;
  // its exit is what matters, and that is reported through `ended`.
  child.stdin.on("error", () => undefined);
  child.stdout.on("data", (chunk: Buffer) => {
    for (const line of lines.push(chunk)) {
      for (const listener of listeners) {
        listener(line);
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (text: string) => {
    stderr = (stderr + text).slice(0, STDERR_KEEP);
  });
  return {
    ended,
    onLine: (listener) => {
      listeners.push(listener);
    },
    stderr: () => stderr,
    closeStdin: () => {
      child.stdin.end();
    },
    kill: (signal) => {
      child.kill(signal);
    },
  };
}

function realDir(folder: string): string | null {
  try {
    // The native form gives the long name for a short one (RUNNER~1), so
    // two spellings of one folder compare equal.
    const real = realpathSync.native(folder);
    return statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

export function realDeps(): RunTestsDeps {
  const sys = createRealSys();
  return {
    platform: process.platform,
    env: process.env,
    tmpdir: tmpdir(),
    git: (args) => sys.git(args),
    where: (command) => sys.where(command),
    realpath: (file) => sys.realpath(file),
    start: startProcess,
    capture: (command, args, timeoutMs) =>
      capture(command, args, { timeoutMs }),
    realDir,
    timeout: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms).unref();
      }),
    print: (text) => {
      process.stderr.write(text);
    },
  };
}
