// Fakes and builders shared by the windows-run tests.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

import { nodeFs } from "./remote/fsx.ts";
import {
  formatRecord,
  type ResultRecord,
  type StepRecord,
} from "./remote/record.ts";
import type {
  GitResult,
  ProcInfo,
  StepOutcome,
  StepSpec,
  Sys,
} from "./remote/sys.ts";

export const SHA = "0123456789abcdef0123456789abcdef01234567";
export const RUN_ID = "a1b2c3d4";

export function tempDir(t: TestContext, prefix = "tb-wr-test-"): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function passedSteps(): StepRecord[] {
  return (["install", "check", "build"] as const).map((name) => ({
    name,
    status: "passed",
    exitCode: 0,
    durationMs: 1500,
  }));
}

export function makeRecord(
  overrides: Partial<ResultRecord> = {},
): ResultRecord {
  return {
    runId: RUN_ID,
    sha: SHA,
    mode: "full",
    file: null,
    refusal: null,
    steps: passedSteps(),
    versions: { node: "24.20.0", pnpm: "10.34.5", git: "2.55.0" },
    windows: { release: "10.0.19045", version: "Windows 10 Pro" },
    tests: { tests: 1181, passed: 1181, failed: 0, skipped: 0 },
    gate: { skipped: 4, noGithubOrigin: true },
    cleanup: [],
    ...overrides,
  };
}

/** A passing targeted run of `file`, its install skipped. */
export function makeTargetedRecord(
  file: string,
  overrides: Partial<ResultRecord> = {},
): ResultRecord {
  return makeRecord({
    mode: "only",
    file,
    gate: null,
    steps: [
      { name: "install", status: "skipped", exitCode: null, durationMs: 0 },
      { name: "test", status: "passed", exitCode: 0, durationMs: 9000 },
    ],
    tests: { tests: 14, passed: 14, failed: 0, skipped: 0 },
    ...overrides,
  });
}

export function recordLine(record: ResultRecord = makeRecord()): string {
  return formatRecord(record);
}

export interface FakeSysOptions {
  home: string;
  /** What each step does: output lines, exit code, and processes it leaves. */
  steps?: Record<
    string,
    {
      lines?: string[];
      exitCode?: number | null;
      timedOut?: boolean;
      leaves?: ProcInfo[];
      takes?: number;
    }
  >;
  /** The commit the worktree reports. */
  headSha?: string;
  /** Blob ids by file, for `rev-parse <sha>:<file>`; a fixed id otherwise. */
  blobs?: Record<string, string>;
  /** What `node --version` and `pnpm --version` print. */
  versions?: { node?: string; pnpm?: string };
  /** What `rev-parse --show-toplevel` prints; the folder it runs in
   * otherwise. */
  toplevel?: string;
  refs?: string[];
  /** Every listing from this call on (1 = the first) fails. */
  failListingFrom?: number;
  /** Git calls (joined with spaces) that fail. */
  failGit?: (args: string) => boolean;
  /** Where `sh` resolves; Git's own by default. Null: not on PATH. */
  shAt?: string | null;
  /** Where a `sh.com` is on PATH, if anywhere. */
  shComAt?: string;
  /** What `sh -c "echo ready"` prints; null when it fails. */
  shSays?: string | null;
  /** How the trial tree for `taskkill /T` goes: how many levels start, what
   * taskkill exits with, and whether the levels below the top survive it. */
  tree?: {
    starts?: number;
    /** Null: the top had exited before the stop. */
    stopCode?: number | null;
    childrenSurvive?: boolean;
    /** The levels left are listed with no readable start time. */
    unreadable?: boolean;
  };
}

export interface FakeSys extends Sys {
  printed: string;
  gitCalls: { args: readonly string[]; cwd: string | undefined }[];
  procs: ProcInfo[];
  killed: number[];
  unkillable: Set<number>;
  clock: number;
  stepsRun: string[];
  listings: number;
  /** The pids running when each step began. */
  seenAtStep: Record<string, number[]>;
  deletedRefs: string[];
  /** The pids of the trial tree, top first, once it has started. */
  treePids: number[];
  /** Every step started, as it was asked for. */
  specs: StepSpec[];
  /** Every probe, with the folder it ran in. */
  probes: { command: string; cwd: string | undefined }[];
}

const GIT_EXEC_PATH = "C:/Program Files/Git/mingw64/libexec/git-core";
const GIT_SH = "C:\\Program Files\\Git\\usr\\bin\\sh.exe";

export const RUNNER_START = 1_000_000;

/** A Windows machine that is really a temp folder and a scripted process
 * table. The runner under test sees only `Sys`. */
export function fakeSys(options: FakeSysOptions): FakeSys {
  const sys: FakeSys = {
    home: options.home,
    devNull: "NUL",
    tmpdir: "C:\\fake\\tmp",
    osRelease: "10.0.19045",
    osVersion: "Windows 10 Pro",
    self: { pid: 100, ppid: 90, startMs: RUNNER_START },
    fs: nodeFs,
    printed: "",
    gitCalls: [],
    killed: [],
    unkillable: new Set(),
    clock: RUNNER_START + 5_000,
    stepsRun: [],
    listings: 0,
    seenAtStep: {},
    deletedRefs: [],
    treePids: [],
    specs: [],
    probes: [],
    procs: [
      { pid: 100, name: "node", startMs: RUNNER_START },
      { pid: 90, name: "cmd", startMs: RUNNER_START - 1_000 },
      { pid: 80, name: "sshd-session", startMs: RUNNER_START - 2_000 },
      { pid: 70, name: "conhost", startMs: RUNNER_START - 900 },
      { pid: 4, name: "System", startMs: null },
    ],
    now: () => sys.clock,
    sleep(ms) {
      sys.clock += ms;
      return Promise.resolve();
    },
    print(text) {
      sys.printed += text;
    },
    listProcesses() {
      sys.listings++;
      if (
        options.failListingFrom !== undefined &&
        sys.listings >= options.failListingFrom
      ) {
        return Promise.reject(new Error("the process listing failed"));
      }
      return Promise.resolve(sys.procs.map((proc) => ({ ...proc })));
    },
    startOf: (pid) =>
      Promise.resolve(sys.procs.find((p) => p.pid === pid)?.startMs ?? null),
    kill(pid) {
      sys.killed.push(pid);
      if (!sys.unkillable.has(pid)) {
        sys.procs = sys.procs.filter((proc) => proc.pid !== pid);
      }
    },
    async git(args, cwd): Promise<GitResult> {
      sys.gitCalls.push({ args, cwd });
      const ok: GitResult = { code: 0, stdout: "", stderr: "" };
      if (options.failGit?.(args.join(" ")) === true) {
        return { code: 1, stdout: "", stderr: "fake failure" };
      }
      const verb = args.includes("worktree") ? "worktree" : args[0];
      if (verb === "init") {
        await nodeFs.mkdir(path.join(args.at(-1) ?? "", ".git"));
      } else if (verb === "worktree" && args.includes("add")) {
        // A linked worktree's .git is a file naming the clone.
        const worktree = args.at(-2) ?? "";
        await nodeFs.mkdir(worktree);
        await nodeFs.writeFile(path.join(worktree, ".git"), "gitdir: x\n");
      } else if (verb === "--exec-path") {
        return { ...ok, stdout: `${GIT_EXEC_PATH}\n` };
      } else if (verb === "rev-parse" && args.includes("--verify")) {
        const file = (args.at(-1) ?? "").split(":")[1] ?? "";
        return {
          ...ok,
          stdout: `${options.blobs?.[file] ?? "b".repeat(40)}\n`,
        };
      } else if (verb === "rev-parse" && args.includes("--show-toplevel")) {
        return { ...ok, stdout: `${options.toplevel ?? cwd ?? ""}\n` };
      } else if (verb === "rev-parse") {
        return { ...ok, stdout: `${options.headSha ?? SHA}\n` };
      } else if (verb === "for-each-ref") {
        return { ...ok, stdout: (options.refs ?? []).join("\n") };
      } else if (verb === "update-ref") {
        sys.deletedRefs.push(args.at(-1) ?? "");
      }
      return ok;
    },
    async runStep(spec: StepSpec, _timeout, onLine): Promise<StepOutcome> {
      sys.specs.push(spec);
      const name = spec.command === "node" ? "test" : (spec.args[0] ?? "");
      sys.stepsRun.push(name);
      sys.seenAtStep[name] = sys.procs.map((proc) => proc.pid);
      const script = options.steps?.[name] ?? {};
      for (const line of script.lines ?? []) {
        onLine(line);
      }
      sys.clock += script.takes ?? 1_000;
      sys.procs.push(...(script.leaves ?? []));
      const exitCode = script.timedOut === true ? null : (script.exitCode ?? 0);
      if (name === "install" && exitCode === 0) {
        // What pnpm writes once an install has finished.
        await nodeFs.mkdir(path.join(spec.cwd, "node_modules"));
        await nodeFs.writeFile(
          path.join(spec.cwd, "node_modules", ".modules.yaml"),
          "",
        );
      }
      return Promise.resolve({
        exitCode: script.timedOut === true ? null : (script.exitCode ?? 0),
        timedOut: script.timedOut ?? false,
      });
    },
    probe: (command, _args, cwd) => {
      sys.probes.push({ command, cwd });
      return Promise.resolve(
        command === "node"
          ? `v${options.versions?.node ?? "24.20.0"}\n`
          : command === "pnpm"
            ? `${options.versions?.pnpm ?? "10.34.5"}\n`
            : command === "sh"
              ? options.shSays === undefined
                ? "ready\n"
                : options.shSays
              : "git version 2.55.0.windows.1\n",
      );
    },
    realpath: (file) => Promise.resolve(file),
    where: (command) =>
      Promise.resolve(
        command === "sh.com"
          ? (options.shComAt ?? null)
          : command === "sh.exe"
            ? options.shAt === undefined
              ? GIT_SH
              : options.shAt
            : `C:\\tools\\${command}.exe`,
      ),
    startTree(depth) {
      const starts = Math.min(depth, options.tree?.starts ?? depth);
      sys.treePids = Array.from({ length: starts }, (_, level) => 500 + level);
      for (const pid of sys.treePids) {
        sys.procs.push({ pid, name: "node", startMs: sys.clock });
      }
      return Promise.resolve([...sys.treePids]);
    },
    stopTree(pid) {
      const code =
        options.tree?.stopCode === undefined ? 0 : options.tree.stopCode;
      if (options.tree?.unreadable === true) {
        sys.procs = sys.procs.map((proc) =>
          sys.treePids.includes(proc.pid) ? { ...proc, startMs: null } : proc,
        );
      }
      if (code === 0) {
        const stopped =
          options.tree?.childrenSurvive === true ? [pid] : sys.treePids;
        sys.procs = sys.procs.filter((proc) => !stopped.includes(proc.pid));
      }
      return Promise.resolve(code);
    },
  };
  return sys;
}

/** The record the runner printed last. */
export function lastRecord(printed: string): ResultRecord {
  const lines = printed.split("\n").filter((line) => line !== "");
  const last = lines.at(-1) ?? "";
  const marker = `windows-run result ${RUN_ID}: `;
  if (!last.startsWith(marker)) {
    throw new Error(`the last line is not a record: ${last}`);
  }
  return JSON.parse(last.slice(marker.length)) as ResultRecord;
}
