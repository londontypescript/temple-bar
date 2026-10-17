// Checks, before anything is installed, that the Windows account can do what
// the suite needs and CI's runners can always do. Without these the suite
// fails in ways that say nothing about the code: about a hundred tests run
// hook shims through `sh`, about forty make symbolic links, and the scaffold
// runner stops a command with `taskkill /T`, which hangs a test when the
// account may not use it. A standard account over SSH has none of them until
// the machine is set up, so a run on an unready machine is refused instead.

import path from "node:path";

import { findGitSh } from "./git-sh.ts";
import type { ProcInfo, Sys } from "./sys.ts";

/** How deep the trial tree goes: a child's child is the case `taskkill /T`
 * exists for, and the one that hung. */
const TREE_DEPTH = 3;
const STOP_WAIT_MS = 10_000;
const POLL_MS = 500;

/** `sh` must be Git for Windows' own, and must run a command. */
async function shProblem(sys: Sys): Promise<string | null> {
  const found = await findGitSh(sys);
  if ("problem" in found) {
    return found.problem;
  }
  const ran = await sys.probe("sh", ["-c", "echo ready"]);
  if (ran?.trim() !== "ready") {
    return `sh at ${found.sh} is on PATH but would not run a command`;
  }
  return null;
}

/** The kinds of link the suite makes: to a file, to a folder, and to
 * nothing. Made in a scratch folder the run's cleanup removes. */
async function linkProblem(sys: Sys, scratch: string): Promise<string | null> {
  try {
    await sys.fs.mkdir(path.join(scratch, "folder"));
    await sys.fs.writeFile(path.join(scratch, "file"), "");
    await sys.fs.symlink("file", path.join(scratch, "to-file"), "file");
    await sys.fs.symlink("folder", path.join(scratch, "to-folder"), "dir");
    await sys.fs.symlink("missing", path.join(scratch, "to-nothing"), "file");
    return null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? String(error);
    return `this account can't make symbolic links (${code}): grant it the create-symbolic-links right`;
  }
}

/** Starts a three-level tree, stops it from the top with `taskkill /T`, and
 * waits for every level to go. Anything that survives is left to the run's
 * own cleanup, which stops whatever started after the runner. */
async function treeProblem(sys: Sys): Promise<string | null> {
  const startedAt = sys.now();
  const pids = await sys.startTree(TREE_DEPTH);
  if (pids.length !== TREE_DEPTH) {
    return `a ${String(TREE_DEPTH)}-level process tree would not start (got ${String(pids.length)})`;
  }
  const [root] = pids as [number, ...number[]];
  const code = await sys.stopTree(root);
  if (code === null) {
    // Its pid may already be someone else's, so nothing was stopped.
    return "the tree's top process exited before taskkill could stop it";
  }
  if (code !== 0) {
    return `taskkill /T exited ${String(code)}: this account may need WMI access (Remote Enable on root\\cimv2)`;
  }
  const end = sys.now() + STOP_WAIT_MS;
  let left: ProcInfo[];
  for (;;) {
    // A process under one of the tree's pids that started before the tree is
    // someone else. One that started since counts as a survivor, even if it
    // reused the pid, and so does one whose start can't be read: either way
    // the stop can't be confirmed, so the run is refused rather than passed.
    left = (await sys.listProcesses()).filter(
      (proc) =>
        pids.includes(proc.pid) &&
        (proc.startMs === null || proc.startMs >= startedAt),
    );
    if (left.length === 0 || sys.now() >= end) {
      break;
    }
    await sys.sleep(POLL_MS);
  }
  return left.length === 0
    ? null
    : `taskkill /T left ${String(left.length)} of ${String(TREE_DEPTH)} levels running`;
}

/** Every reason this machine isn't ready, each printable as it stands. Empty
 * when it is ready. */
export async function readinessProblems(
  sys: Sys,
  scratch: string,
): Promise<string[]> {
  const problems = [
    await shProblem(sys),
    await linkProblem(sys, scratch),
    await treeProblem(sys),
  ];
  return problems.filter((problem) => problem !== null);
}
