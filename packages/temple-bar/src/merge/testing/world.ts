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
import {
  BASE,
  GATE_COMMIT,
  HEAD,
  LOCAL_NEWER,
  MERGED_IN,
  REMOTE_NEWER,
  type World,
} from "./default-world.ts";

// The tests import the world's data from here too, alongside the harness.
export {
  defaultWorld,
  HEAD,
  LOCAL_NEWER,
  MERGED_IN,
  REMOTE_NEWER,
  type CheckRun,
  type World,
} from "./default-world.ts";

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
  /** The ready mark's text in the gate's worktree as each gate run starts. */
  readonly marksAtGate: (string | undefined)[];
  /** Whether the pull request's branch was pushed to origin (not deleted). */
  pushedBranch(): boolean;
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
  let gated = false;
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
        return ok(
          world.dirty || (gated && world.gateEffect === "dirties")
            ? " M file.ts\n"
            : "",
        );
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
  const marksAtGate: (string | undefined)[] = [];
  const timedCtx: Context = { ...ctx, clock: { now: () => new Date(now) } };
  const deps: MergeDeps = {
    runGate: async (gateCtx) => {
      gateRuns.push(gateCtx.cwd);
      marksAtGate.push(
        await ctx.fs.readText(`${gateCtx.cwd}/.git/temple-bar-ready`),
      );
      gated = true;
      if (world.gateEffect === "commits") {
        tip = GATE_COMMIT;
      }
      return world.gateExit;
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
    marksAtGate,
    pushedBranch: () =>
      git.calls.some((call) =>
        startsWith(call.args, [
          "push",
          "origin",
          `refs/heads/${branch}:refs/heads/${branch}`,
        ]),
      ),
    out: () => stdout.lines.join(""),
    err: () => stderr.lines.join(""),
    ran: (tool, ...prefix) =>
      (tool === "git" ? git.calls : gh.calls).some((call) =>
        startsWith(call.args, prefix),
      ),
  };
}
