// The test run's lifecycle on Windows, behind seams so it is tested with fakes
// on every system: before the first test file starts, start Git's shell that
// holds `/tmp`, check where `/tmp` points, watch the shell for the whole run
// and close it at the end. Off Windows it does nothing.
//
// Why: Git for Windows' shells share one `/tmp`, taken from the temp folder
// of the first shell to start and kept while any of them (or a program one
// started) is alive. Each test file gets its own temp folder, deleted when the
// file ends, so without this shell a test's folder could become every shell's
// `/tmp` and then vanish, and each shell started after that warns that it
// can't find `/tmp`. Started first, with the runner's own temp folder (which
// the suite never deletes), the shell holds `/tmp` there.
//
// The test runner starts it: every `test` script names ./anchor.ts as Node's
// `--test-global-setup`, which the runner loads once, in its own process,
// awaiting `globalSetup` before any test file and `globalTeardown` after the
// last. An `--import` module can't do this job: the runner loads those only in
// each test file's process. anchor.ts gives these the real processes, files
// and clock (real.ts) and leaves the run on a problem.

import path from "node:path";

import { findGitSh, type GitShDeps } from "../windows-run/remote/git-sh.ts";

/** The anchor's whole command, fixed text: nothing from the environment or the
 * arguments reaches it. It says it is ready, then waits for its input to
 * close, which happens when the run ends (or when this process dies). Passed
 * with `-c` rather than fed through stdin, so the pipe carries no code: this
 * process never writes to it, only closes it. It has to be a shell, the one
 * place outside a hook shim where this repo runs one: only a process of Git's
 * own runtime can hold that runtime's shared /tmp (docs/agents-rationale.md). */
const ANCHOR_SCRIPT = "echo ready; read _; exit 0";
const READY_LINE = "ready";
/** Asked of a fresh shell, which joins the anchor's shared state. */
const WHERE_TMP_SCRIPT = "/usr/bin/cygpath -w /tmp";

/** Where the run's `/tmp` is, as checked before the first test, for the test
 * that confirms it stays put. */
export const SHARED_TMP_VARIABLE = "TEMPLE_BAR_TEST_SHARED_TMP";

const READY_MS = 30_000;
const CHECK_MS = 30_000;
const STOP_MS = 10_000;

export type Ended =
  | {
      readonly kind: "exit";
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }
  | { readonly kind: "error"; readonly message: string };

/** A started process, as the run needs it: piped, with no part in the
 * runner's terminal. */
export interface Proc {
  /** Settles once, when the process ends or fails to start. */
  readonly ended: Promise<Ended>;
  /** Each whole line of stdout. */
  onLine(listener: (line: string) => void): void;
  /** The start of its stderr. */
  stderr(): string;
  closeStdin(): void;
  kill(signal?: NodeJS.Signals): void;
}

export interface Captured {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Everything the run touches outside itself, so tests can fake it. */
export interface RunTestsDeps extends GitShDeps {
  /** Only "win32" starts the anchor. Faking another platform on Windows is
   * the test seam that runs the suite without it. */
  readonly platform: NodeJS.Platform;
  /** The runner's environment. The checked `/tmp` is set on it, and the
   * runner passes it on to every test file. */
  readonly env: NodeJS.ProcessEnv;
  /** This process's own temp folder: the system's or the CI runner's, never
   * made or deleted by the suite. */
  readonly tmpdir: string;
  start(
    command: string,
    args: readonly string[],
    options: { env: NodeJS.ProcessEnv },
  ): Proc;
  capture(
    command: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<Captured>;
  /** The folder's canonical path if it exists and is a folder, else null. */
  realDir(folder: string): string | null;
  timeout(ms: number): Promise<void>;
  print(text: string): void;
}

function describe(ended: Ended): string {
  if (ended.kind === "error") {
    return `could not start (${ended.message})`;
  }
  return ended.signal === null
    ? `exited with code ${String(ended.code)}`
    : `was stopped by ${ended.signal}`;
}

function withStderr(message: string, text: string): string {
  const said = text.trim();
  return said === "" ? message : `${message}. It said: ${said}`;
}

/** The environment with TEMP and TMP replaced. Windows names variables
 * without regard to case, so any spelling of them goes first: two spellings
 * in one environment would leave which one wins to chance. */
export function withTemp(
  env: NodeJS.ProcessEnv,
  dir: string,
): NodeJS.ProcessEnv {
  const kept = Object.entries(env).filter(
    ([name]) => !["TEMP", "TMP"].includes(name.toUpperCase()),
  );
  return { ...Object.fromEntries(kept), TEMP: dir, TMP: dir };
}

function isInside(
  child: string,
  parent: string,
  platform: NodeJS.Platform,
): boolean {
  // Windows' relative() already ignores case, as Windows does.
  const paths = platform === "win32" ? path.win32 : path.posix;
  const relative = paths.relative(parent, child);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${paths.sep}`) &&
    !paths.isAbsolute(relative)
  );
}

/** Whatever `/tmp` is now (the anchor's, or that of a shell already running
 * when the run began), it must exist and must not be one of the suite's own
 * folders, which are made inside this process's temp folder and deleted. */
async function checkSharedTmp(
  deps: RunTestsDeps,
  sh: string,
): Promise<{ tmp: string } | { problem: string }> {
  const asked = await deps.capture(sh, ["-c", WHERE_TMP_SCRIPT], CHECK_MS);
  const reported = asked.stdout.trim();
  if (asked.code !== 0 || reported === "") {
    return {
      problem: withStderr(
        `Git's sh could not say where /tmp is (cygpath exited with code ${String(asked.code)})`,
        asked.stderr,
      ),
    };
  }
  const close =
    "close every Git Bash and sh (and anything started from one), then run the tests again";
  const real = deps.realDir(reported);
  if (real === null) {
    return {
      problem: `Git's shared /tmp is ${reported}, which does not exist: a Git shell started with a temp folder since deleted still holds it. To free it, ${close}`,
    };
  }
  const own = deps.realDir(deps.tmpdir) ?? deps.tmpdir;
  if (isInside(real, own, deps.platform)) {
    return {
      problem: `Git's shared /tmp is ${reported}, inside this run's temp folder ${own}, where the suite makes and deletes its own folders. To free it, ${close}`,
    };
  }
  return { tmp: real };
}

/** Closes the anchor's input and waits, briefly, for the exit that brings. */
async function stopAnchor(deps: RunTestsDeps, anchor: Proc): Promise<void> {
  anchor.closeStdin();
  const ended = await Promise.race([
    anchor.ended,
    deps.timeout(STOP_MS).then(() => null),
  ]);
  if (ended === null) {
    anchor.kill();
    deps.print(
      `run-tests: Git's sh holding /tmp did not exit within ${String(STOP_MS / 1000)}s of its input closing, so it was stopped\n`,
    );
  } else if (ended.kind !== "exit" || ended.code !== 0) {
    deps.print(
      `run-tests: Git's sh holding /tmp ${describe(ended)} when the run ended, where 0 was expected\n`,
    );
  }
}

/** Starts the anchor, waits until it is ready, and checks where `/tmp` now
 * points. */
async function startAnchor(
  deps: RunTestsDeps,
): Promise<{ proc: Proc; tmp: string } | { problem: string }> {
  const found = await findGitSh(deps);
  if ("problem" in found) {
    return found;
  }
  // Piped and hidden, so it has no part in this terminal: Ctrl+C reaches the
  // runner, which handles it itself, and the anchor holds /tmp while the
  // runner winds down.
  const proc = deps.start(found.sh, ["-c", ANCHOR_SCRIPT], {
    env: withTemp(deps.env, deps.tmpdir),
  });
  const ready = new Promise<"ready">((resolve) => {
    proc.onLine((line) => {
      if (line.trim() === READY_LINE) {
        resolve("ready");
      }
    });
  });
  const first = await Promise.race([
    ready,
    proc.ended,
    deps.timeout(READY_MS).then(() => "late" as const),
  ]);
  if (first !== "ready") {
    proc.kill();
    const why =
      first === "late"
        ? `did not say it was ready within ${String(READY_MS / 1000)}s`
        : describe(first);
    return {
      problem: withStderr(
        `Git's sh (${found.sh}), started to hold /tmp for the run, ${why}`,
        proc.stderr(),
      ),
    };
  }
  const state: { early: Ended | null } = { early: null };
  void proc.ended.then((ended) => {
    state.early = ended;
  });
  const checked = await checkSharedTmp(deps, found.sh);
  if ("problem" in checked) {
    await stopAnchor(deps, proc);
    return checked;
  }
  if (state.early !== null) {
    return {
      problem: withStderr(
        `Git's sh holding /tmp ${describe(state.early)} before the tests started`,
        proc.stderr(),
      ),
    };
  }
  return { proc, tmp: checked.tmp };
}

/** Git's shared `/tmp`, held for the run. */
export interface SharedTmpHold {
  /** The folder checked before the first test; null off Windows. */
  readonly tmp: string | null;
  /** Stops watching the anchor, then closes it and waits for it to exit. */
  release(): Promise<void>;
}

/** On Windows, starts the anchor and checks `/tmp`, then watches the anchor
 * until the hold is released: `onLost` hears, with what went wrong, if it ends
 * before that. Off Windows it starts nothing. */
export async function holdSharedTmp(
  deps: RunTestsDeps,
  onLost: (problem: string) => void,
): Promise<SharedTmpHold | { problem: string }> {
  if (deps.platform !== "win32") {
    return { tmp: null, release: () => Promise.resolve() };
  }
  const started = await startAnchor(deps);
  if ("problem" in started) {
    return started;
  }
  const anchor = started.proc;
  // Armed until release: the anchor's exit when its input closes at the end
  // is the expected one, not a loss. A `then` on a promise already settled
  // still runs, so an exit just before this line is heard too.
  const watch = { armed: true };
  void anchor.ended.then((ended) => {
    if (watch.armed) {
      onLost(
        withStderr(
          `Git's sh holding /tmp ${describe(ended)} before the tests finished, so /tmp may have moved to a folder the suite deletes. The tests were stopped`,
          anchor.stderr(),
        ),
      );
    }
  });
  return {
    tmp: started.tmp,
    release: async () => {
      watch.armed = false;
      await stopAnchor(deps, anchor);
    },
  };
}

/** Node's global setup and teardown for the test run. */
export interface TestRunHooks {
  readonly globalSetup: () => Promise<void>;
  readonly globalTeardown: () => Promise<void>;
}

/**
 * The hooks over `deps`. `leave` ends the run with an exit code once the
 * output is flushed (in real use it never settles, so nothing runs after it).
 * A problem leaves with code 1 and the message rather than a throw, which the
 * runner would show as a stack trace.
 */
export function testRunHooks(
  deps: RunTestsDeps,
  leave: (code: number) => Promise<void>,
): TestRunHooks {
  let hold: SharedTmpHold | null = null;
  const fail = (problem: string): Promise<void> => {
    deps.print(`run-tests: ${problem}\n`);
    return leave(1);
  };
  return {
    async globalSetup() {
      // Leaving ends the runner's process, so no test file starts after it;
      // any already running are left to end on their own.
      const held = await holdSharedTmp(deps, (problem) => {
        void fail(problem);
      });
      if ("problem" in held) {
        await fail(held.problem);
        return;
      }
      hold = held;
      if (held.tmp !== null) {
        deps.env[SHARED_TMP_VARIABLE] = held.tmp;
      }
    },
    // Not run if the runner is killed: then the anchor's input closes as the
    // runner's process ends, and the anchor exits on its own.
    async globalTeardown() {
      const held = hold;
      hold = null;
      await held?.release();
    },
  };
}
