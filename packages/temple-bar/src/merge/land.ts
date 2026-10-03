// The last step before anything changes on GitHub: wait for the checks,
// refuse on open code-scanning alerts, then ask GitHub for the squash. When
// GitHub refuses because it started new check runs after merge read them,
// wait for those and ask again.

import type { Context } from "../context.ts";
import { warnAboutPullRequestSize } from "../pr/size.ts";
import {
  describeAlerts,
  describeGhFailure,
  readChecks,
  readOpenAlerts,
  readRequiredChecks,
  squashMerge,
  type Check,
  type Repository,
} from "./github.ts";
import type { SquashMessage } from "./message.ts";
import { refuse } from "./refusal.ts";
import {
  DEFAULT_TIMING,
  waitForChecks,
  type Sleep,
  type Timing,
} from "./wait.ts";

/** A title or description edit reruns CI on the same commit, and GitHub
 * takes a few seconds to create the new runs. A merge started in those
 * seconds sees only the old, finished runs, all green, while the ruleset
 * already waits on the new ones and refuses. Each such refusal is followed
 * by another wait, so a few tries are plenty; more would mean something
 * keeps restarting CI, which a person should look at. */
const MERGE_ATTEMPTS = 3;

async function refuseOnOpenAlerts(
  ctx: Context,
  repository: Repository,
  prNumber: number,
  cwd: string,
): Promise<void> {
  const forPullRequest = await readOpenAlerts(
    ctx,
    repository,
    { pr: prNumber },
    cwd,
  );
  const onDefault = await readOpenAlerts(
    ctx,
    repository,
    { branch: repository.defaultBranch },
    cwd,
  );
  if (forPullRequest === "not-set-up" || onDefault === "not-set-up") {
    ctx.stdout.write(
      "merge: code scanning isn't set up here, so there are no alerts to check\n",
    );
  }
  if (forPullRequest !== "not-set-up" && forPullRequest.length > 0) {
    refuse(
      `pull request #${String(prNumber)} has open code-scanning alerts: ${describeAlerts(forPullRequest)}. Fix them, push, and run merge again.`,
    );
  }
  if (onDefault !== "not-set-up" && onDefault.length > 0) {
    refuse(
      `${repository.defaultBranch} has open code-scanning alerts: ${describeAlerts(onDefault)}. Fix or dismiss them before merging more.`,
    );
  }
}

/** Checks that haven't finished, or that the ruleset requires and that
 * haven't started, each with GitHub's word for where it is. */
function stillRunning(
  checks: readonly Check[],
  required: readonly string[],
): string[] {
  const present = new Set(checks.map((check) => check.name));
  return [
    ...checks
      .filter((check) => check.state === "pending")
      .map((check) => `${check.name} (${check.detail})`),
    ...required
      .filter((name) => !present.has(name))
      .map((name) => `${name} (not started)`),
  ];
}

export interface Landing {
  readonly repository: Repository;
  readonly prNumber: number;
  readonly sha: string;
  /** The default branch on origin, which the size warning measures from. */
  readonly upstream: string;
  readonly message: SquashMessage;
}

/** Waits for the checks on `landing.sha`, then squash-merges it. Returns
 * once GitHub has accepted the merge; refuses otherwise. */
export async function checkAndMerge(
  ctx: Context,
  deps: { readonly sleep: Sleep; readonly timing?: Timing },
  landing: Landing,
  root: string,
): Promise<void> {
  const { repository, prNumber, sha } = landing;
  const timing = deps.timing ?? DEFAULT_TIMING;
  const required = await readRequiredChecks(ctx, repository, root);
  for (let attempt = 1; ; attempt++) {
    const checks = await waitForChecks(
      ctx,
      deps.sleep,
      timing,
      { repository, sha, required },
      root,
    );
    ctx.stdout.write(
      `merge: all ${String(checks.length)} checks passed on ${sha}\n`,
    );
    await refuseOnOpenAlerts(ctx, repository, prNumber, root);

    if (attempt === 1) {
      // Advice only: a failure to measure must not stop the merge.
      await warnAboutPullRequestSize(
        { ...ctx, cwd: root },
        { base: landing.upstream, head: sha, prNumber: String(prNumber) },
      ).catch((error: unknown) => {
        ctx.stdout.write(
          `merge: could not measure the pull request's size: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      });
    }

    const merged = await squashMerge(
      ctx,
      {
        prNumber,
        sha,
        subject: landing.message.subject,
        body: landing.message.body,
      },
      root,
    );
    if (merged.code === 0) {
      return;
    }

    const refusal = `GitHub refused the merge: ${describeGhFailure(merged)}`;
    const running = stillRunning(
      await readChecks(ctx, repository, sha, root),
      required,
    ).join(", ");
    if (running === "") {
      refuse(refusal);
    }
    if (attempt >= MERGE_ATTEMPTS) {
      refuse(
        `${refusal}. GitHub is still running checks it started after merge read them: ${running}. Run merge again once they finish.`,
      );
    }
    ctx.stdout.write(
      `merge: GitHub refused the merge while checks it started after merge read them were running: ${running}. Waiting for them, then trying again\n`,
    );
  }
}
