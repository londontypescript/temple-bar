// Clearing out what a killed run left in the runner's folder: its worktree,
// its staging folder, stale lock folders and its git refs. Safe because runs
// are serialised and the account is dedicated to them. Links are removed as
// links, never followed (removeWithRetry does that), so a junction a test
// made can't send the sweep into some other folder.

import path from "node:path";

import { pathExists, removeWithRetry } from "./fsx.ts";
import type { Sys } from "./sys.ts";

export interface Layout {
  readonly root: string;
  readonly clone: string;
  readonly runs: string;
  readonly logs: string;
  readonly lock: string;
  readonly incoming: string;
}

export function layoutFor(home: string): Layout {
  const root = path.join(home, "temple-bar-windows-run");
  return {
    root,
    clone: path.join(root, "clone"),
    runs: path.join(root, "runs"),
    logs: path.join(root, "logs"),
    lock: path.join(root, "lock"),
    incoming: path.join(root, "incoming"),
  };
}

export const REF_PREFIX = "refs/windows-run/";

async function listOrEmpty(sys: Sys, dir: string): Promise<string[]> {
  try {
    return await sys.fs.readdir(dir);
  } catch {
    return [];
  }
}

/**
 * Removes every leftover except this run's own, saying what it found.
 * Returns the problems (things that could not be removed); a failure here is
 * reported but does not stop the run, since another run's folder can't hurt
 * this one.
 */
export async function sweepFiles(
  sys: Sys,
  layout: Layout,
  runId: string,
  say: (line: string) => void,
): Promise<string[]> {
  const problems: string[] = [];
  const remove = async (target: string, what: string): Promise<void> => {
    say(`windows-run: sweep: removing ${what}`);
    try {
      await removeWithRetry(sys.fs, (ms) => sys.sleep(ms), target);
    } catch {
      problems.push(`could not remove ${what}`);
    }
  };

  for (const name of await listOrEmpty(sys, layout.runs)) {
    await remove(path.join(layout.runs, name), `leftover run folder ${name}`);
  }
  if (await pathExists(sys.fs, path.join(layout.clone, ".git"))) {
    await sys.git(["worktree", "prune"], layout.clone);
  }
  for (const name of await listOrEmpty(sys, layout.incoming)) {
    if (name !== runId) {
      await remove(
        path.join(layout.incoming, name),
        `leftover staging folder ${name}`,
      );
    }
  }
  for (const name of await listOrEmpty(sys, layout.root)) {
    // lock.<run id> is a lock that was being made; lock.stale.<run id> is
    // one that was being replaced. This run's own lock folder is made later.
    if (name.startsWith("lock.") && name !== `lock.${runId}`) {
      await remove(path.join(layout.root, name), `stale lock folder ${name}`);
    }
  }
  if (await pathExists(sys.fs, path.join(layout.clone, ".git"))) {
    const refs = await sys.git(
      ["for-each-ref", "--format=%(refname)", REF_PREFIX],
      layout.clone,
    );
    for (const ref of refs.stdout.split(/\r?\n/)) {
      if (ref.startsWith(REF_PREFIX) && ref !== `${REF_PREFIX}${runId}`) {
        say(`windows-run: sweep: removing leftover ref ${ref}`);
        const result = await sys.git(["update-ref", "-d", ref], layout.clone);
        if (result.code !== 0) {
          problems.push(`could not remove ref ${ref}`);
        }
      }
    }
  }
  return problems;
}
