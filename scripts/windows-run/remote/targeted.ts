// A targeted run (`pnpm windows-run --only <file>`): one test file, run the
// way `pnpm test` would run it, in a worktree kept between targeted runs so
// its node_modules survives and the install is skipped when nothing it
// depends on has changed. A full run's worktree is fresh and deleted at the
// end, so a full run always installs; it neither uses nor clears anything
// here.

import path from "node:path";

import { addWorktree, Failure, gitNoHooks, verifyHead } from "./checkout.ts";
import { pathExists, removeWithRetry } from "./fsx.ts";
import type { RunLog } from "./log.ts";
import type { CheckScanner } from "./scan.ts";
import {
  installPlan,
  MINUTE,
  runSteps,
  type StepPlan,
  type StepsResult,
} from "./steps.ts";
import type { Layout } from "./sweep.ts";
import type { Sys } from "./sys.ts";
import { testCommand, testTarget } from "./only-target.ts";

const BLOB_ID = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
const VERSION = /\d+\.\d+\.\d+/;

/** What the terminal says when the install is skipped. */
const UNCHANGED = "unchanged since the last install";

/**
 * What a frozen install depends on that can change between runs, and so
 * decides whether the last one still stands:
 * - the lockfile's blob: the install puts in exactly what it lists;
 * - pnpm-workspace.yaml's blob: it says which folders are workspace packages
 *   and holds pnpm's settings, so it decides what is linked where;
 * - Node's version: what an install built or chose under one Node may not
 *   work under another;
 * - pnpm's version: another pnpm may lay node_modules out differently, or
 *   refuse one an earlier pnpm wrote. It is asked from inside the kept
 *   worktree, because pnpm run there switches to the version the project's
 *   `packageManager` names, which is the one the install uses.
 * Null when any of them can't be read: then the install always runs, and no
 * record is written.
 */
async function installKey(
  sys: Sys,
  layout: Layout,
  sha: string,
): Promise<string | null> {
  const blob = async (file: string): Promise<string | null> => {
    const result = await sys.git(
      ["rev-parse", "--verify", "--quiet", `${sha}:${file}`],
      layout.clone,
    );
    const id = result.stdout.trim();
    return result.code === 0 && BLOB_ID.test(id) ? id : null;
  };
  const version = async (tool: string): Promise<string | null> =>
    VERSION.exec(
      (await sys.probe(tool, ["--version"], layout.only)) ?? "",
    )?.[0] ?? null;
  const key = {
    lockfile: await blob("pnpm-lock.yaml"),
    workspace: await blob("pnpm-workspace.yaml"),
    node: await version("node"),
    pnpm: await version("pnpm"),
  };
  return Object.values(key).includes(null) ? null : `${JSON.stringify(key)}\n`;
}

async function recordedKey(sys: Sys, layout: Layout): Promise<string | null> {
  try {
    return await sys.fs.readFile(layout.onlyInstall);
  } catch {
    return null;
  }
}

function forgetInstall(sys: Sys, layout: Layout): Promise<void> {
  return removeWithRetry(sys.fs, (ms) => sys.sleep(ms), layout.onlyInstall);
}

/** Whether git, run in `worktree`, works on that folder and nothing else.
 * The checkout and clean that follow throw away changes, so anything less
 * would let them change some other checkout. */
async function isOwnWorktree(sys: Sys, worktree: string): Promise<boolean> {
  // A link (or, on Windows, a junction, which Node reports as one) would
  // send them into the folder it points at. One that has gone since it was
  // seen is made again too.
  try {
    const own = await sys.fs.lstat(worktree);
    if (own.isSymbolicLink() || !own.isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }
  // A worktree's .git is a file. Without one, git would look further up
  // for a repository.
  try {
    if ((await sys.fs.lstat(path.join(worktree, ".git"))).isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }
  // And git must agree that this folder is the top of the checkout. Both
  // sides are compared as canonical paths: git prints forward slashes, and
  // Windows can spell one folder with short names or another case.
  const top = await sys.git(["rev-parse", "--show-toplevel"], worktree);
  const [gitSays, expected] = await Promise.all([
    sys.realpath(top.stdout.trim()),
    sys.realpath(worktree),
  ]);
  return top.code === 0 && gitSays !== null && gitSays === expected;
}

/** Brings the kept worktree to `sha`, leaving only node_modules from what
 * an earlier file left. False when it isn't its own worktree or git failed:
 * then it is made again. */
async function refresh(
  sys: Sys,
  worktree: string,
  sha: string,
): Promise<boolean> {
  if (!(await isOwnWorktree(sys, worktree))) {
    return false;
  }
  const checkedOut = await gitNoHooks(
    sys,
    ["checkout", "--quiet", "--detach", "--force", sha],
    worktree,
  );
  if (checkedOut.code !== 0) {
    return false;
  }
  const cleaned = await gitNoHooks(
    sys,
    ["clean", "-ffdx", "--quiet", "-e", "node_modules"],
    worktree,
  );
  return cleaned.code === 0;
}

/** The kept worktree at `sha`: updated in place, or made afresh (once) when
 * it is missing or can't be updated. A new one has no node_modules, so the
 * install record is forgotten whenever one is made. */
async function prepareWorktree(
  sys: Sys,
  layout: Layout,
  sha: string,
  say: (line: string) => void,
): Promise<void> {
  if (await pathExists(sys.fs, layout.only)) {
    if (await refresh(sys, layout.only, sha)) {
      await verifyHead(sys, layout.only, sha);
      return;
    }
    say("windows-run: the kept worktree could not be updated: making it again");
    try {
      await removeWithRetry(sys.fs, (ms) => sys.sleep(ms), layout.only);
    } catch {
      throw new Failure(
        "checkout-failed",
        "could not remove the kept worktree",
      );
    }
    await sys.git(["worktree", "prune"], layout.clone);
  }
  await forgetInstall(sys, layout);
  await addWorktree(sys, layout, layout.only, sha);
  await verifyHead(sys, layout.only, sha);
}

/** Runs `file` (repo-relative, already checked by the entry point) at
 * `sha`, after the install if one is needed. */
export async function runTargeted(
  sys: Sys,
  layout: Layout,
  sha: string,
  file: string,
  log: RunLog,
  scanner: CheckScanner,
  say: (line: string) => void,
): Promise<StepsResult> {
  const target = testTarget(file);
  if (target === undefined) {
    throw new Error("the test file is not one the suite runs");
  }
  await prepareWorktree(sys, layout, sha, say);
  const key = await installKey(sys, layout, sha);
  // pnpm writes node_modules/.modules.yaml at the end of an install, so a
  // node_modules deleted or half-written since the record was made installs
  // again whatever the record says.
  const installed =
    key !== null &&
    (await recordedKey(sys, layout)) === key &&
    (await pathExists(
      sys.fs,
      path.join(layout.only, "node_modules", ".modules.yaml"),
    ));
  const problems: string[] = [];
  if (!installed) {
    // Deleted before the install starts and written only once it passes, so
    // an interrupted or failed install always installs again next time.
    await forgetInstall(sys, layout);
  }
  const install: StepPlan = installed
    ? { ...installPlan(layout.only), skipped: UNCHANGED }
    : {
        ...installPlan(layout.only),
        async afterPass() {
          if (key === null) {
            return;
          }
          try {
            await sys.fs.writeFile(layout.onlyInstall, key);
          } catch {
            problems.push("could not write the install record");
          }
        },
      };
  const { command, args } = testCommand(target);
  const test: StepPlan = {
    name: "test",
    command,
    args,
    cwd: path.join(layout.only, ...target.workspace.split("/")),
    // An e2e file can be slow on a machine a tenth of the Mac's speed.
    timeoutMs: 30 * MINUTE,
    scan: true,
  };
  const result = await runSteps(sys, [install, test], log, scanner, say);
  return {
    steps: result.steps,
    problems: [...result.problems, ...problems],
  };
}
