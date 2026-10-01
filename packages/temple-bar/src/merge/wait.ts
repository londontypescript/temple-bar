// The two waits in a merge, both bounded so merge always ends: for GitHub
// to show the pushed commit as the pull request's head, then for every
// check on that exact commit to finish. Time comes from the clock seam and
// pauses from the injected sleep, so tests run them instantly.

import type { Context } from "../context.ts";
import {
  readChecks,
  readPullRequest,
  type Check,
  type PullRequest,
  type Repository,
} from "./github.ts";
import { refuse } from "./refusal.ts";

export interface Timing {
  /** Pause between two reads of the pull request or its checks. */
  readonly pollMs: number;
  /** How many times to read the pull request's head before giving up. */
  readonly headAttempts: number;
  /** How long to wait for the checks before giving up. */
  readonly checksTimeoutMs: number;
}

export const DEFAULT_TIMING: Timing = {
  pollMs: 15_000,
  headAttempts: 8,
  checksTimeoutMs: 45 * 60_000,
};

export type Sleep = (ms: number) => Promise<void>;

/** GitHub has been seen to keep a pull request's head on an older commit
 * after a push, and the old commit's green checks then look like the new
 * one's. So the head must equal the local tip before any check is trusted. */
export async function waitForHead(
  ctx: Context,
  sleep: Sleep,
  timing: Timing,
  expected: {
    readonly prNumber: number;
    readonly sha: string;
    readonly branch: string;
  },
  cwd: string,
): Promise<PullRequest> {
  let seen = "";
  for (let attempt = 1; attempt <= timing.headAttempts; attempt++) {
    const pullRequest = await readPullRequest(ctx, expected.prNumber, cwd);
    if (pullRequest.headRefOid === expected.sha) {
      return pullRequest;
    }
    seen = pullRequest.headRefOid;
    if (attempt < timing.headAttempts) {
      await sleep(timing.pollMs);
    }
  }
  return refuse(
    `pull request #${String(expected.prNumber)}'s head on GitHub is ${seen}, ` +
      `but the local branch ${expected.branch} is at ${expected.sha}. ` +
      "Push the branch if you haven't. If you have, GitHub hasn't synced the " +
      "pull request: close and reopen it, then run merge again.",
  );
}

function names(checks: readonly Check[]): string {
  return checks.map((check) => `${check.name} (${check.detail})`).join(", ");
}

/** Waits until every check on `sha` has finished and each required check
 * has appeared. Refuses at the first failure, naming the failed checks. */
export async function waitForChecks(
  ctx: Context,
  sleep: Sleep,
  timing: Timing,
  target: {
    readonly repository: Repository;
    readonly sha: string;
    readonly required: readonly string[];
  },
  cwd: string,
): Promise<Check[]> {
  const deadline = ctx.clock.now().getTime() + timing.checksTimeoutMs;
  let lastProgress = "";
  for (;;) {
    const checks = await readChecks(ctx, target.repository, target.sha, cwd);
    const failed = checks.filter((check) => check.state === "failed");
    if (failed.length > 0) {
      refuse(`checks failed on ${target.sha}: ${names(failed)}`);
    }
    const pending = checks.filter((check) => check.state === "pending");
    const present = new Set(checks.map((check) => check.name));
    const missing = target.required.filter((name) => !present.has(name));
    if (checks.length > 0 && pending.length === 0 && missing.length === 0) {
      return checks;
    }

    const waitingOn = [
      ...pending.map((check) => check.name),
      ...missing.map((name) => `${name} (not started)`),
    ];
    if (ctx.clock.now().getTime() >= deadline) {
      const minutes = Math.round(timing.checksTimeoutMs / 60_000);
      refuse(
        waitingOn.length === 0
          ? `no checks started on ${target.sha} within ${String(minutes)} minutes. Check the workflows ran, then run merge again.`
          : `timed out after ${String(minutes)} minutes waiting for checks on ${target.sha}: ${waitingOn.join(", ")}. Run merge again once they finish.`,
      );
    }
    const progress =
      waitingOn.length === 0
        ? "merge: waiting for checks to start\n"
        : `merge: waiting for ${waitingOn.join(", ")}\n`;
    if (progress !== lastProgress) {
      ctx.stdout.write(progress);
      lastProgress = progress;
    }
    await sleep(timing.pollMs);
  }
}
