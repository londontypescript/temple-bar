// Finding and stopping the processes a step (or a killed earlier run) left
// behind. The account can't use WMI, tasklist or taskkill, so this lists with
// PowerShell's Get-Process and stops with Node's process.kill. A process is
// identified by its pid and its start time together, because Windows reuses
// pids; the pair is checked again just before each kill.

import type { ProcInfo, Sys } from "./sys.ts";

const STOP_DEADLINE_MS = 15_000;
const POLL_MS = 500;
/** Processes the SSH server starts around a session, spared by the sweep when
 * they started this close before the session's shell. */
const SESSION_NAMES = new Set(["sshd", "sshd-session", "conhost"]);
const SESSION_WINDOW_MS = 30_000;

export function describeProcess(proc: ProcInfo): string {
  return `${proc.name} (pid ${String(proc.pid)})`;
}

/** Decides which of the account's own processes to stop. */
export type Pick = (proc: ProcInfo) => boolean;

/** Lines of `pid|name|startMs` (startMs empty when unreadable), as the
 * PowerShell script in real.ts prints them. A line that doesn't fit is
 * skipped rather than guessed at. */
export function parseProcessList(text: string): ProcInfo[] {
  const procs: ProcInfo[] = [];
  for (const line of text.split(/\r?\n/)) {
    const first = line.indexOf("|");
    const last = line.lastIndexOf("|");
    if (first <= 0 || last <= first) {
      continue;
    }
    const pid = Number(line.slice(0, first));
    const startText = line.slice(last + 1).trim();
    const startMs = startText === "" ? null : Number(startText);
    if (
      !Number.isSafeInteger(pid) ||
      (startMs !== null && !Number.isFinite(startMs))
    ) {
      continue;
    }
    procs.push({ pid, name: line.slice(first + 1, last), startMs });
  }
  return procs;
}

async function targets(sys: Sys, pick: Pick): Promise<ProcInfo[]> {
  const all = await sys.listProcesses();
  return all.filter(
    (proc) => proc.startMs !== null && proc.pid !== sys.self.pid && pick(proc),
  );
}

/**
 * Stops every own process `pick` chooses and returns the ones that would not
 * stop. It lists again and repeats until none are left or 15 seconds pass, so
 * a child started in the meantime is caught too. A process whose start time
 * changed since it was listed is a different process under a reused pid and
 * is never stopped.
 */
export async function stopProcesses(sys: Sys, pick: Pick): Promise<ProcInfo[]> {
  const end = sys.now() + STOP_DEADLINE_MS;
  for (;;) {
    const found = await targets(sys, pick);
    if (found.length === 0 || sys.now() >= end) {
      return found;
    }
    for (const proc of found) {
      if ((await sys.startOf(proc.pid)) !== proc.startMs) {
        continue;
      }
      try {
        sys.kill(proc.pid);
      } catch {
        // Already gone, or refused: the next listing says which.
      }
    }
    await sys.sleep(POLL_MS);
  }
}

/** Everything that started at or after `ms`: what a step left running. */
export function startedSince(ms: number): Pick {
  return (proc) => proc.startMs !== null && proc.startMs >= ms;
}

/** Everything that started after the runner did. */
export function startedAfter(ms: number): Pick {
  return (proc) => proc.startMs !== null && proc.startMs > ms;
}

/**
 * What a killed earlier run may have left: any own process that started
 * before the runner, whatever it is (a test can start anything), except this
 * session's own: the shell that launched the runner, and the SSH server's
 * processes that started within 30 seconds before that shell.
 */
export function leftoversBefore(
  runnerStartMs: number,
  all: readonly ProcInfo[],
  sys: Sys,
): Pick {
  const shellStart =
    all.find((proc) => proc.pid === sys.self.ppid)?.startMs ?? runnerStartMs;
  return (proc) => {
    if (proc.startMs === null || proc.startMs >= runnerStartMs) {
      return false;
    }
    if (proc.pid === sys.self.pid || proc.pid === sys.self.ppid) {
      return false;
    }
    const isSessionHelper =
      SESSION_NAMES.has(proc.name.toLowerCase().replace(/\.exe$/, "")) &&
      proc.startMs >= shellStart - SESSION_WINDOW_MS;
    return !isSessionHelper;
  };
}
