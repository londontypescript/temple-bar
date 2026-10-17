// A fake machine for the test run's lifecycle: processes that end when a test
// says, a resolver for Git's sh, a `cygpath` answer, a set of folders that
// exist, and waits that expire only when a test asks them to.

import type { Captured, Ended, Proc, RunTestsDeps } from "./lifecycle.ts";

export const EXEC_PATH = "C:\\node\\node.exe";
export const GIT_SH = "C:\\Program Files\\Git\\usr\\bin\\sh.exe";
export const OWN_TEMP = "C:\\Users\\dev\\AppData\\Local\\Temp";
export const SETUP = [
  "--import",
  "./scripts/isolate-git-config.ts",
  "--import",
  "./scripts/isolate-temp-folder.ts",
];

export const exited = (code: number): Ended => ({
  kind: "exit",
  code,
  signal: null,
});
export const signalled = (signal: NodeJS.Signals): Ended => ({
  kind: "exit",
  code: null,
  signal,
});

export class FakeProc implements Proc {
  readonly ended: Promise<Ended>;
  readonly kills: (NodeJS.Signals | undefined)[] = [];
  stdinClosed = false;
  stderrText = "";
  isOver = false;
  /** What closing its input does; nothing at all when undefined. */
  onClose: (() => void) | undefined;
  #settle: (ended: Ended) => void = () => undefined;
  readonly #listeners: ((line: string) => void)[] = [];

  constructor() {
    this.ended = new Promise((resolve) => {
      this.#settle = resolve;
    });
  }

  end(ended: Ended): void {
    this.isOver = true;
    this.#settle(ended);
  }

  say(line: string): void {
    for (const listener of this.#listeners) {
      listener(line);
    }
  }

  onLine(listener: (line: string) => void): void {
    this.#listeners.push(listener);
  }

  stderr(): string {
    return this.stderrText;
  }

  closeStdin(): void {
    this.stdinClosed = true;
    this.onClose?.();
  }

  kill(signal?: NodeJS.Signals): void {
    this.kills.push(signal);
    this.end(signalled(signal ?? "SIGTERM"));
  }
}

export interface Scenario {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Where `where sh.exe` finds sh; Git's own unless given. */
  shAt?: string | null;
  anchor?: {
    /** Says it is ready unless this is false. */
    ready?: boolean;
    endsBeforeReady?: Ended;
    endsDuringCheck?: Ended;
    endsDuringRun?: Ended;
    /** How it ends when its input closes: exit 0 unless given. */
    onClose?: Ended | "hangs";
    stderr?: string;
  };
  cygpath?: Captured;
  /** The folders that exist, each mapped to its canonical path. */
  dirs?: Record<string, string>;
  /** How the runner ends: exit 0 unless given. */
  runner?: Ended | "until-killed";
  /** The waits, by length in ms, that run out instead of waiting forever. */
  expire?: number[];
}

export interface Started {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly piped: boolean;
  readonly proc: FakeProc;
}

export function harness(scenario: Scenario = {}) {
  const printed: string[] = [];
  const started: Started[] = [];
  const asked: string[] = [];
  const signals = new Map<NodeJS.Signals, () => void>();
  const anchorSpec = scenario.anchor ?? {};
  const byRole = (role: "runner" | "anchor"): FakeProc | undefined =>
    started.find((one) => (one.command === EXEC_PATH) === (role === "runner"))
      ?.proc;

  const deps: RunTestsDeps = {
    platform: scenario.platform ?? "win32",
    execPath: EXEC_PATH,
    env: scenario.env ?? { PATH: "C:\\bin" },
    tmpdir: OWN_TEMP,
    git: (args) => {
      asked.push(`git ${args.join(" ")}`);
      return Promise.resolve({
        code: 0,
        stdout: "C:\\Program Files\\Git\\mingw64\\libexec\\git-core\n",
      });
    },
    where: (command) => {
      asked.push(`where ${command}`);
      return Promise.resolve(
        command === "sh.exe"
          ? scenario.shAt === undefined
            ? GIT_SH
            : scenario.shAt
          : null,
      );
    },
    start(command, args, options) {
      const proc = new FakeProc();
      started.push({ command, args, ...options, proc });
      if (command === EXEC_PATH) {
        const ends = scenario.runner ?? exited(0);
        if (ends !== "until-killed") {
          queueMicrotask(() => {
            proc.end(ends);
          });
        }
        const during = anchorSpec.endsDuringRun;
        const anchor = byRole("anchor");
        if (during !== undefined && anchor !== undefined) {
          queueMicrotask(() => {
            anchor.end(during);
          });
        }
        return proc;
      }
      proc.stderrText = anchorSpec.stderr ?? "";
      const onClose = anchorSpec.onClose ?? exited(0);
      if (onClose !== "hangs") {
        proc.onClose = () => {
          proc.end(onClose);
        };
      }
      queueMicrotask(() => {
        if (anchorSpec.endsBeforeReady !== undefined) {
          proc.end(anchorSpec.endsBeforeReady);
        } else if (anchorSpec.ready !== false) {
          proc.say("ready");
        }
      });
      return proc;
    },
    capture(command, args) {
      asked.push(`${command} ${args.join(" ")}`);
      const during = anchorSpec.endsDuringCheck;
      if (during !== undefined) {
        byRole("anchor")?.end(during);
      }
      return Promise.resolve(
        scenario.cygpath ?? { code: 0, stdout: `${OWN_TEMP}\n`, stderr: "" },
      );
    },
    realDir: (folder) =>
      (scenario.dirs ?? { [OWN_TEMP]: OWN_TEMP })[folder] ?? null,
    timeout: (ms) =>
      scenario.expire?.includes(ms) === true
        ? Promise.resolve()
        : new Promise(() => undefined),
    onSignal(signal, handler) {
      signals.set(signal, handler);
    },
    print(text) {
      printed.push(text);
    },
  };
  return {
    deps,
    started,
    asked,
    signals,
    printed: () => printed.join(""),
    runner: () => byRole("runner"),
    anchor: () => byRole("anchor"),
  };
}
