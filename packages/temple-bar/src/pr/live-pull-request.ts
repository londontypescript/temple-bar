// Reads a pull request as it is now, from GitHub's API: its title,
// description, head commit and base branch. The title check reads these
// live rather than from the event GitHub saved when the run started, so a
// rerun can't pass a title or description that has since changed.
//
// Every failure comes back as a reason, never a guess: an answer that isn't
// the shape GitHub documents is a failure too, so the check fails rather
// than pass what it hasn't read.

import type { Context } from "../context.ts";

export interface PullRequestAddress {
  /** GitHub's API root, `https://api.github.com` unless Enterprise Server
   * names its own. */
  readonly api: string;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly token: string | undefined;
}

export interface LivePullRequest {
  readonly title: string;
  /** Empty when the pull request has no description (GitHub sends null). */
  readonly body: string;
  readonly headSha: string;
  readonly baseRef: string;
}

export type LiveRead =
  | { readonly ok: true; readonly value: LivePullRequest }
  | { readonly ok: false; readonly reason: string };

const COMMIT_ID = /^[0-9a-f]{40}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function answered(status: number): string {
  return status === 403 || status === 429
    ? `GitHub answered ${String(status)} (denied, or the rate limit)`
    : `GitHub answered ${String(status)}`;
}

export async function readLivePullRequest(
  ctx: Context,
  pr: PullRequestAddress,
): Promise<LiveRead> {
  const url =
    `${pr.api}/repos/${encodeURIComponent(pr.owner)}/` +
    `${encodeURIComponent(pr.repo)}/pulls/${String(pr.number)}`;
  const reply = await ctx.http.get(url, pr.token);
  if (reply.kind === "network-error") {
    return { ok: false, reason: reply.message };
  }
  if (reply.status !== 200) {
    return { ok: false, reason: answered(reply.status) };
  }
  let value: unknown;
  try {
    value = JSON.parse(reply.body);
  } catch {
    return { ok: false, reason: "an answer that isn't JSON" };
  }
  if (!isRecord(value)) {
    return { ok: false, reason: "an answer that isn't a JSON object" };
  }
  const { title, body, head, base } = value;
  const headSha = isRecord(head) ? head.sha : undefined;
  const baseRef = isRecord(base) ? base.ref : undefined;
  if (
    typeof title !== "string" ||
    (typeof body !== "string" && body !== null) ||
    typeof headSha !== "string" ||
    !COMMIT_ID.test(headSha) ||
    typeof baseRef !== "string" ||
    baseRef === ""
  ) {
    return {
      ok: false,
      reason: "an unexpected description of the pull request",
    };
  }
  return {
    ok: true,
    value: { title, body: body ?? "", headSha, baseRef },
  };
}
