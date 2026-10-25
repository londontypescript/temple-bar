// A fake machine for the test run's lifecycle: an anchor that ends when a
// test says, a resolver for Git's sh, a `cygpath` answer, a set of folders
// that exist, and waits that expire only when a test asks them to.

import type { Captured, Ended, Proc, RunTestsDeps } from "./lifecycle.ts";

export const GIT_SH = "C:\\Program Files\\Git\\usr\\bin\\sh.exe";
export const OWN_TEMP = "C:\\Users\\dev\\AppData\\Local\\Temp";

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
    /** How it ends when its input closes: exit 0 unless given. */
    onClose?: Ended | "hangs";
    stderr?: string;
  };
  cygpath?: Captured;
  /** The folders that exist, each mapped to its canonical path. */
  dirs?: Record<string, string>;
  /** The waits, by length in ms, that run out instead of waiting forever. */
  expire?: number[];
}

interface Started {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly proc: FakeProc;
}

export function harness(scenario: Scenario = {}) {
  const printed: string[] = [];
  const started: Started[] = [];
  const asked: string[] = [];
  const left: number[] = [];
  const anchorSpec = scenario.anchor ?? {};
  // The only process the run starts is the anchor.
  const anchor = (): FakeProc | undefined => started[0]?.proc;

  const deps: RunTestsDeps = {
    platform: scenario.platform ?? "win32",
    env: { ...(scenario.env ?? { PATH: "C:\\bin" }) },
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
    realpath: (file) => Promise.resolve(file),
    start(command, args, options) {
      const proc = new FakeProc();
      started.push({ command, args, ...options, proc });
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
        anchor()?.end(during);
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
    print(text) {
      printed.push(text);
    },
  };
  return {
    deps,
    started,
    asked,
    /** The exit codes the run tried to leave with, in order. */
    left,
    /** Records the code; settles at once, so a test can see what follows. */
    leave: (code: number): Promise<void> => {
      left.push(code);
      return Promise.resolve();
    },
    printed: () => printed.join(""),
    anchor,
  };
}
