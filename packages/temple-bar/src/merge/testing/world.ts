// A scripted repository and GitHub for merge's unit tests: one object says
// what git and gh answer, and every call is recorded. Each test changes the
// one thing its refusal is about and leaves the rest on a happy path.

import type { Context } from "../../context.ts";
import type { GhResult } from "../../seams/gh.ts";
import type { GitResult } from "../../seams/git.ts";
import {
  createFakeContext,
  createFakeGh,
  createFakeGit,
  createFakeWriter,
  type FakeGh,
  type FakeGit,
  type FakeWriter,
} from "../../testing/fakes.ts";
import { fakeTreeReads } from "../../testing/git-trees.ts";
import type { MergeDeps } from "../run.ts";

export const HEAD = "a".repeat(40);
export const MERGED_IN = "b".repeat(40);
const BASE = "c".repeat(40);
/** What a push made after GitHub accepted the merge moved origin's branch to. */
export const REMOTE_NEWER = "9".repeat(40);
/** A commit made on the local branch after GitHub accepted the merge. */
export const LOCAL_NEWER = "8".repeat(40);

/** A check run as GitHub's API returns it. `id` and `started_at` tell
 * which of several runs with one name is the newest. */
export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  id?: number;
  started_at?: string | null;
  /** The check suite (one per workflow run) the run belongs to. */
  suite?: number;
}

export interface World {
  pr: {
    number: number;
    title: string;
    body: string;
    state: string;
    isDraft: boolean;
    baseRefName: string;
    headRefName: string;
    isCrossRepository: boolean;
  };
  /** headRefOid on each read of the pull request; the last one repeats. */
  heads: string[];
  /** Local branch tip, or undefined for no local branch. */
  localTip: string | undefined;
  behind: boolean;
  /** Exit code of the gate merge runs after bringing a branch up to date. */
  gateExit: number;
  dirty: boolean;
  /** Extra worktree entries after the primary one, in porcelain form. */
  worktrees: string;
  /** Check runs on each read; the last one repeats. */
  checkRuns: CheckRun[][];
  /** Which workflow each check suite belongs to. */
  workflowRuns: { suite: number; workflow: number }[];
  statuses: { context: string; state: string }[];
  required: string[];
  alertsForPr: { number: number; rule: string; path: string }[] | "not-set-up";
  alertsOnDefault: { number: number; rule: string; path: string }[];
  changedFiles: string[];
  packageBefore: string;
  packageAfter: string;
  /** Other files' contents where the branched-off commit and the head have
   * them; a missing side doesn't exist there. A changed file not named here
   * is on both sides, with different text. */
  otherFiles: Record<string, { before?: string; after?: string }>;
  coAuthors: string;
  /** How many merge requests GitHub refuses before it accepts one. */
  mergeRefusals: number;
  /** origin's branch once GitHub has merged: deleted with the merge, still
   * at the head GitHub accepted, or moved on to REMOTE_NEWER by a push. */
  remoteAfterMerge: "deleted" | "accepted" | "moved";
  /** The local branch gains LOCAL_NEWER once GitHub has merged. */
  localCommitAfterMerge: boolean;
  /** stderr of a deletion push that fails for a reason other than its lease
   * (a rule or a permission, say); undefined when origin applies the lease. */
  deletionError: string | undefined;
  incidents: number;
  /** Bypassed rule suites on the default branch, one JSON object a line, as
   * the listing's --jq prints them. Each one went past the judge. */
  bypasses: string;
}

export function defaultWorld(): World {
  return {
    pr: {
      number: 7,
      title: "feat(x): add x",
      body: "Adds x.\n\n- add the x command\n- document x\n",
      state: "OPEN",
      isDraft: false,
      baseRefName: "main",
      headRefName: "feat/x",
      isCrossRepository: false,
    },
    heads: [HEAD],
    localTip: HEAD,
    behind: false,
    gateExit: 0,
    dirty: false,
    worktrees: `worktree /wt/x\nHEAD ${HEAD}\nbranch refs/heads/feat/x\n`,
    checkRuns: [[{ name: "gate", status: "completed", conclusion: "success" }]],
    workflowRuns: [],
    statuses: [],
    required: [],
    alertsForPr: [],
    alertsOnDefault: [],
    changedFiles: ["src/x.ts"],
    packageBefore:
      '{"devDependencies":{"@londontypescript/temple-bar":"0.0.4"}}',
    packageAfter:
      '{"devDependencies":{"@londontypescript/temple-bar":"0.0.4"}}',
    otherFiles: {},
    coAuthors:
      "Co-authored-by: Ada <ada@example.com>\n\nCo-Authored-By: ada <ADA@example.com>\nCo-authored-by: Bob <bob@example.com>\n",
    mergeRefusals: 0,
    remoteAfterMerge: "deleted",
    localCommitAfterMerge: false,
    deletionError: undefined,
    incidents: 3,
    bypasses: "",
  };
}

function ok(stdout = ""): GitResult & GhResult {
  return { code: 0, stdout, stderr: "", notFound: false };
}

function fail(stderr: string): GitResult & GhResult {
  return { code: 1, stdout: "", stderr, notFound: false };
}

function lines(items: readonly object[]): string {
  return items.map((item) => JSON.stringify(item)).join("\n");
}

export interface Harness {
  readonly ctx: Context;
  readonly git: FakeGit;
  readonly gh: FakeGh;
  readonly stdout: FakeWriter;
  readonly stderr: FakeWriter;
  readonly deps: MergeDeps;
  readonly sleeps: number[];
  /** The directory of each gate run. */
  readonly gateRuns: string[];
  out(): string;
  err(): string;
  /** Whether a git or gh call whose args start with `prefix` was made. */
  ran(tool: "git" | "gh", ...prefix: string[]): boolean;
}

export function harness(world: World): Harness {
  let merged = false;
  let prReads = 0;
  let checkReads = 0;
  let mergeRequests = 0;
  let tip = world.localTip;
  // origin's tip of the branch, and the head GitHub accepted when it merged.
  let remoteTip = world.heads[0];
  let accepted: string | undefined;
  const branch = world.pr.headRefName;

  // Each side's files: every changed file, with text that differs, then
  // package.json and the other files as the world gives them.
  const side = (atBase: boolean): Record<string, string> => {
    const files = new Map(
      world.changedFiles.map((file) => [file, atBase ? "before" : "after"]),
    );
    files.set(
      "package.json",
      atBase ? world.packageBefore : world.packageAfter,
    );
    for (const [file, sides] of Object.entries(world.otherFiles)) {
      const text = atBase ? sides.before : sides.after;
      if (text === undefined) {
        files.delete(file);
      } else {
        files.set(file, text);
      }
    }
    return Object.fromEntries(files);
  };
  const treeReads = fakeTreeReads((commit) =>
    commit === BASE ? side(true) : side(false),
  );

  const git = createFakeGit((args) => {
    const read = treeReads(args);
    if (read !== undefined) {
      return read;
    }
    const [command, ...rest] = args;
    const joined = args.join(" ");
    switch (command) {
      case "worktree":
        return rest[0] === "list"
          ? ok(
              `worktree /repo\nHEAD ${BASE}\nbranch refs/heads/main\n\n${world.worktrees}`,
            )
          : ok();
      case "for-each-ref":
        return ok(
          `main ${BASE}\n${tip === undefined ? "" : `${branch} ${tip}\n`}`,
        );
      case "rev-parse":
        if (rest[0] === "--git-path") {
          return ok(`.git/${rest[1] ?? ""}\n`);
        }
        return tip === undefined ? fail("") : ok(`${tip}\n`);
      case "merge-base":
        if (rest[0] === "--is-ancestor") {
          // Merge asks if the branch has origin/main in it; leftovers asks if
          // a tip is inside the merged head, which a later commit never is.
          const [, ancestor = "", descendant] = rest;
          const inside = ancestor.startsWith("origin/")
            ? !world.behind
            : ancestor === descendant || ancestor === HEAD;
          return inside ? ok() : fail("");
        }
        return ok(`${BASE}\n`);
      case "status":
        return ok(world.dirty ? " M file.ts\n" : "");
      case "merge":
        if (rest.includes("--no-ff")) {
          tip = MERGED_IN;
        }
        return ok();
      case "diff":
        if (joined.includes("--numstat")) {
          return ok("1\t1\tsrc/x.ts\0");
        }
        return ok(world.changedFiles.map((file) => `${file}\0`).join(""));
      case "log":
        return ok(world.coAuthors);
      case "ls-remote":
        return ok(
          remoteTip === undefined ? "" : `${remoteTip}\trefs/heads/${branch}\n`,
        );
      case "push": {
        const lease = rest.find((arg) => arg.startsWith("--force-with-lease="));
        if (lease === undefined) {
          remoteTip = tip;
          return ok();
        }
        // As in git, origin deletes the branch only while it is at the
        // commit the lease names.
        const at = `--force-with-lease=refs/heads/${branch}:${remoteTip ?? ""}`;
        if (world.deletionError !== undefined || lease !== at) {
          const stale = ` ! [rejected] (delete) -> ${branch} (stale info)`;
          return fail(world.deletionError ?? stale);
        }
        remoteTip = undefined;
        return ok();
      }
      default:
        return ok();
    }
  });

  const gh = createFakeGh((args) => {
    const joined = args.join(" ");
    if (joined.startsWith("repo view")) {
      return ok(
        JSON.stringify({
          nameWithOwner: "o/r",
          defaultBranchRef: { name: "main" },
        }),
      );
    }
    if (joined.startsWith("pr view")) {
      const head = world.heads[Math.min(prReads, world.heads.length - 1)];
      prReads++;
      return ok(
        JSON.stringify({
          ...world.pr,
          state: merged ? "MERGED" : world.pr.state,
          headRefOid: head,
        }),
      );
    }
    if (joined.includes("/check-runs")) {
      const runs =
        world.checkRuns[Math.min(checkReads, world.checkRuns.length - 1)] ?? [];
      checkReads++;
      return ok(lines(runs));
    }
    if (joined.includes("/actions/runs?head_sha=")) {
      return ok(lines(world.workflowRuns));
    }
    if (joined.includes("/status?")) {
      return ok(lines(world.statuses));
    }
    if (joined.includes("/rules/branches/")) {
      return ok(world.required.join("\n"));
    }
    if (joined.includes("code-scanning/alerts?pr=")) {
      return world.alertsForPr === "not-set-up"
        ? fail("HTTP 404: no analysis found")
        : ok(lines(world.alertsForPr));
    }
    if (joined.includes("code-scanning/alerts?ref=")) {
      return ok(lines(world.alertsOnDefault));
    }
    if (joined.startsWith("pr merge")) {
      if (mergeRequests++ < world.mergeRefusals) {
        return fail("Repository rule violations found");
      }
      merged = true;
      accepted = args[args.indexOf("--match-head-commit") + 1];
      const after = { deleted: undefined, accepted, moved: REMOTE_NEWER };
      remoteTip = after[world.remoteAfterMerge];
      if (world.localCommitAfterMerge) {
        tip = LOCAL_NEWER;
      }
      return ok();
    }
    if (joined.startsWith("pr list")) {
      const pr = { ...world.pr, headRefOid: accepted, state: "MERGED" };
      return ok(JSON.stringify(merged ? [pr] : []));
    }
    if (joined.includes("rulesets/rule-suites?")) {
      return ok(world.bypasses);
    }
    if (joined.includes("rulesets/rule-suites/")) {
      return ok(
        JSON.stringify({
          rule_evaluations: [
            {
              rule_source: { name: "main: the judge" },
              result: "fail",
              rule_type: "required_status_checks",
            },
          ],
        }),
      );
    }
    if (joined.startsWith("issue list")) {
      return ok(String(world.incidents));
    }
    return fail(`unscripted gh call: ${joined}`);
  });

  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const ctx = createFakeContext({ git, gh, stdout, stderr, cwd: "/wt/x" });
  // The clock moves only when merge sleeps, so a timeout is reached in a
  // few fake polls instead of real minutes.
  let now = ctx.clock.now().getTime();
  const sleeps: number[] = [];
  const gateRuns: string[] = [];
  const timedCtx: Context = { ...ctx, clock: { now: () => new Date(now) } };
  const deps: MergeDeps = {
    runGate: (gateCtx) => {
      gateRuns.push(gateCtx.cwd);
      return Promise.resolve(world.gateExit);
    },
    sleep: (ms) => {
      sleeps.push(ms);
      now += ms;
      return Promise.resolve();
    },
    timing: {
      pollMs: 1_000,
      headAttempts: 3,
      checksTimeoutMs: 5_000,
      noChecksMs: 2_000,
    },
  };
  const startsWith = (
    args: readonly string[],
    prefix: readonly string[],
  ): boolean => prefix.every((part, i) => args[i] === part);
  return {
    ctx: timedCtx,
    git,
    gh,
    stdout,
    stderr,
    deps,
    sleeps,
    gateRuns,
    out: () => stdout.lines.join(""),
    err: () => stderr.lines.join(""),
    ran: (tool, ...prefix) =>
      (tool === "git" ? git.calls : gh.calls).some((call) =>
        startsWith(call.args, prefix),
      ),
  };
}
