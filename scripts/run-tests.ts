// Runs the test suite: starts Node with the arguments given, passed on
// exactly. `pnpm test` runs this with the two setup files every test file
// loads and `--test` (see the root package.json), and pnpm adds any files
// named after them.
//
// On Windows it first starts one long-lived shell of Git's own install, and
// keeps it for the whole run. Git for Windows' shells share one `/tmp`, taken
// from the temp folder of the first shell to start and kept while any of them
// (or a program one started) is alive. Each test file gets its own temp
// folder, deleted when the file ends, so without this shell a test's folder
// could become every shell's `/tmp` and then vanish, and each shell started
// after that warns that it can't find `/tmp`. Started first, with this
// process's own temp folder (which the suite never deletes), the shell holds
// `/tmp` there. docs/agents-rationale.md says why this one command is a shell
// and not Node.

import { spawn } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  runTests,
  type Ended,
  type Proc,
  type RunTestsDeps,
} from "./run-tests/lifecycle.ts";
import { LineBuffer } from "./windows-run/remote/lines.ts";
import { capture, createRealSys } from "./windows-run/remote/real.ts";

/** Enough of the anchor's stderr to say why it failed. */
const STDERR_KEEP = 4_000;

function startProcess(
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; piped: boolean },
): Proc {
  const lines = new LineBuffer();
  const listeners: ((line: string) => void)[] = [];
  let stderr = "";
  let settle: (ended: Ended) => void = () => undefined;
  const ended = new Promise<Ended>((resolve) => {
    settle = resolve;
  });
  // Hidden only when piped: hidden, with no stream shared, Node starts it on
  // a console of its own (CREATE_NO_WINDOW), so Ctrl+C here doesn't reach
  // it. The runner shares this terminal, as it always has.
  const child = spawn(command, args, {
    env: options.env,
    stdio: options.piped ? "pipe" : "inherit",
    windowsHide: options.piped,
  });
  child.on("error", (error) => {
    settle({ kind: "error", message: error.message });
  });
  child.on("exit", (code, signal) => {
    settle({ kind: "exit", code, signal });
  });
  // Closing the input of a process that has already gone fails with EPIPE;
  // its exit is what matters, and that is reported through `ended`.
  child.stdin?.on("error", () => undefined);
  child.stdout?.on("data", (chunk: Buffer) => {
    for (const line of lines.push(chunk)) {
      for (const listener of listeners) {
        listener(line);
      }
    }
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (text: string) => {
    stderr = (stderr + text).slice(0, STDERR_KEEP);
  });
  return {
    ended,
    onLine: (listener) => {
      listeners.push(listener);
    },
    stderr: () => stderr,
    closeStdin: () => {
      child.stdin?.end();
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
    execPath: process.execPath,
    env: process.env,
    tmpdir: tmpdir(),
    git: (args) => sys.git(args),
    where: (command) => sys.where(command),
    start: startProcess,
    capture: (command, args, timeoutMs) =>
      capture(command, args, { timeoutMs }),
    realDir,
    timeout: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms).unref();
      }),
    onSignal: (signal, handler) => {
      process.on(signal, handler);
    },
    print: (text) => {
      process.stderr.write(text);
    },
  };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const code = await runTests(realDeps(), process.argv.slice(2));
  // Leave once the output is flushed, even if a runner that was told to stop
  // is still running.
  process.stderr.write("", () => {
    process.exit(code);
  });
}
