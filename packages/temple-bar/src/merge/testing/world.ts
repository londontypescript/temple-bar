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
import type { MergeDeps } from "../run.ts";

export const HEAD = "a".repeat(40);
export const MERGED_IN = "b".repeat(40);
export const BASE = "c".repeat(40);

/** A check run as GitHub's API returns it. `id` and `started_at` tell
 * which of several runs with one name is the newest. */
export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  id?: number;
  started_at?: string | null;
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
  dirty: boolean;
  /** Extra worktree entries after the primary one, in porcelain form. */
  worktrees: string;
  /** Check runs on each read; the last one repeats. */
  checkRuns: CheckRun[][];
  statuses: { context: string; state: string }[];
  required: string[];
  alertsForPr: { number: number; rule: string; path: string }[] | "not-set-up";
  alertsOnDefault: { number: number; rule: string; path: string }[];
  changedFiles: string[];
  packageBefore: string;
  packageAfter: string;
  /** Other files' contents where the branched-off commit and the head have
   * them; a missing side doesn't exist there. */
  otherFiles: Record<string, { before?: string; after?: string }>;
  coAuthors: string;
  /** How many merge requests GitHub refuses before it accepts one. */
  mergeRefusals: number;
  remoteBranchAfterMerge: boolean;
  incidents: number;
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
    dirty: false,
    worktrees: `worktree /wt/x\nHEAD ${HEAD}\nbranch refs/heads/feat/x\n`,
    checkRuns: [[{ name: "gate", status: "completed", conclusion: "success" }]],
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
      "Ada <ada@example.com>\n\nada <ADA@example.com>\nBob <bob@example.com>\n",
    mergeRefusals: 0,
    remoteBranchAfterMerge: false,
    incidents: 3,
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
  let remoteDeleted = false;
  let worktreeRemoved = false;
  let branchDeleted = false;

  const git = createFakeGit((args) => {
    const [command, ...rest] = args;
    const joined = args.join(" ");
    switch (command) {
      case "worktree":
        if (rest[0] === "list") {
          return ok(
            `worktree /repo\nHEAD ${BASE}\nbranch refs/heads/main\n\n${worktreeRemoved ? "" : world.worktrees}`,
          );
        }
        worktreeRemoved = rest[0] === "remove";
        return ok();
      case "branch":
        branchDeleted = rest[0] === "-D";
        return ok();
      case "for-each-ref":
        return ok(branchDeleted ? "main\n" : `main\n${world.pr.headRefName}\n`);
      case "rev-parse":
        return tip === undefined ? fail("") : ok(`${tip}\n`);
      case "merge-base":
        if (rest[0] === "--is-ancestor") {
          return world.behind ? fail("") : ok();
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
        return ok(world.changedFiles.join("\n"));
      case "show": {
        const spec = rest[0] ?? "";
        const file = spec.slice(spec.indexOf(":") + 1);
        const atBase = spec.startsWith(BASE);
        if (file === "package.json") {
          return ok(atBase ? world.packageBefore : world.packageAfter);
        }
        const text = atBase
          ? world.otherFiles[file]?.before
          : world.otherFiles[file]?.after;
        return text === undefined
          ? fail(`fatal: path '${file}' does not exist`)
          : ok(text);
      }
      case "log":
        return ok(world.coAuthors);
      case "ls-remote":
        return ok(
          world.remoteBranchAfterMerge && !remoteDeleted
            ? `${HEAD}\trefs/heads/${world.pr.headRefName}\n`
            : "",
        );
      case "push":
        if (rest.includes("--delete")) {
          remoteDeleted = true;
        }
        return ok();
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
      return ok();
    }
    if (joined.startsWith("pr list")) {
      return ok("[]");
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
  const timedCtx: Context = { ...ctx, clock: { now: () => new Date(now) } };
  const deps: MergeDeps = {
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
    out: () => stdout.lines.join(""),
    err: () => stderr.lines.join(""),
    ran: (tool, ...prefix) =>
      (tool === "git" ? git.calls : gh.calls).some((call) =>
        startsWith(call.args, prefix),
      ),
  };
}
