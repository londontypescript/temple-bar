// The test run's lifecycle, behind seams so it is tested with fakes on every
// system: start the runner, and on Windows start Git's shell that holds
// `/tmp` first, check where `/tmp` points, watch the shell for the whole run
// and close it at the end. scripts/run-tests.ts says why, and holds the real
// processes, files and clock.

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

/** A started process, as the run needs it. */
export interface Proc {
  /** Settles once, when the process ends or fails to start. */
  readonly ended: Promise<Ended>;
  /** Each whole line of stdout, for a piped process. */
  onLine(listener: (line: string) => void): void;
  /** The start of its stderr, for a piped process. */
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
  readonly execPath: string;
  readonly env: NodeJS.ProcessEnv;
  /** This process's own temp folder: the system's or the CI runner's, never
   * made or deleted by the suite. */
  readonly tmpdir: string;
  /** `piped` gives the process pipes for all three streams (the anchor);
   * otherwise it shares this process's terminal (the runner). */
  start(
    command: string,
    args: readonly string[],
    options: { env: NodeJS.ProcessEnv; piped: boolean },
  ): Proc;
  capture(
    command: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<Captured>;
  /** The folder's canonical path if it exists and is a folder, else null. */
  realDir(folder: string): string | null;
  timeout(ms: number): Promise<void>;
  onSignal(signal: NodeJS.Signals, handler: () => void): void;
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
  // Piped, so it has no part in this terminal: Ctrl+C stops the runner as it
  // always has, and the anchor holds /tmp while the runner winds down.
  const proc = deps.start(found.sh, ["-c", ANCHOR_SCRIPT], {
    env: withTemp(deps.env, deps.tmpdir),
    piped: true,
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

/** The runner's exit code, or 1 with a message if it has none. */
function exitCode(deps: RunTestsDeps, ended: Ended): number {
  if (ended.kind === "exit" && ended.code !== null) {
    return ended.code;
  }
  deps.print(`run-tests: the test runner ${describe(ended)}\n`);
  return 1;
}

/** Runs the suite and returns the exit code to leave with. */
export async function runTests(
  deps: RunTestsDeps,
  args: readonly string[],
): Promise<number> {
  const onWindows = deps.platform === "win32";
  let env = deps.env;
  let anchor: Proc | null = null;
  if (onWindows) {
    const started = await startAnchor(deps);
    if ("problem" in started) {
      deps.print(`run-tests: ${started.problem}\n`);
      return 1;
    }
    anchor = started.proc;
    env = { ...deps.env, [SHARED_TMP_VARIABLE]: started.tmp };
  }

  // Node's own arguments, passed on untouched: the root package.json's
  // `test` script names the setup files and `--test`, where tools that read
  // scripts (knip finds test files and setup files there) can see them.
  const runner = deps.start(deps.execPath, args, {
    env,
    piped: false,
  });
  if (onWindows) {
    // Ctrl+C reaches the runner from the terminal, as it always has. Staying
    // alive through it lets this wait for the runner, then close the anchor.
    deps.onSignal("SIGINT", () => undefined);
  } else {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      deps.onSignal(signal, () => {
        runner.kill(signal);
      });
    }
  }
  if (anchor === null) {
    return exitCode(deps, await runner.ended);
  }

  const first = await Promise.race([
    runner.ended.then((ended) => ({ who: "runner" as const, ended })),
    anchor.ended.then((ended) => ({ who: "anchor" as const, ended })),
  ]);
  if (first.who === "anchor") {
    deps.print(
      `run-tests: ${withStderr(
        `Git's sh holding /tmp ${describe(first.ended)} before the tests finished, so /tmp may have moved to a folder the suite deletes. The tests were stopped`,
        anchor.stderr(),
      )}\n`,
    );
    runner.kill();
    await Promise.race([runner.ended, deps.timeout(STOP_MS)]);
    return 1;
  }
  await stopAnchor(deps, anchor);
  return exitCode(deps, first.ended);
}
