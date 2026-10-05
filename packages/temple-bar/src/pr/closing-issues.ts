// Finds the issues a pull request will close. A squash merge turns the pull
// request into one commit, so the title and body are what GitHub reads for
// closing keywords ("Closes #12", "fixes owner/repo#12").

import type { Context } from "../context.ts";
import { proseLines } from "./prose.ts";

/** A closing keyword, then the issue: `#12`, `owner/repo#12`, or the
 * issue's full URL on GitHub. Text in comments and code never reaches this
 * pattern: `proseLines` has blanked it first, because GitHub doesn't read
 * closing references there and a template often carries an example. */
const CLOSING_REFERENCE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?[ \t]+(?:([\w.-]+\/[\w.-]+)?#(\d+)|https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\b)/gi;

/** The distinct issues named after a closing keyword in `texts`, in the
 * order first seen, lower-cased. An issue in `repository` ("owner/name")
 * is written `#12` however it was referenced, so the same issue written
 * two ways counts once; one in another repository keeps its
 * `owner/repo#12` form. */
export function findClosingIssues(
  texts: readonly string[],
  repository?: string,
): string[] {
  const here = repository?.toLowerCase();
  const found = new Set<string>();
  for (const text of texts) {
    for (const line of proseLines(text)) {
      for (const match of line.matchAll(CLOSING_REFERENCE)) {
        const owner = (match[1] ?? match[3])?.toLowerCase();
        const number = match[2] ?? match[4] ?? "";
        found.add(
          owner === undefined || owner === here
            ? `#${number}`
            : `${owner}#${number}`,
        );
      }
    }
  }
  return [...found];
}

export interface PullRequestText {
  readonly title: string;
  readonly body: string;
  /** "owner/name" of the repository the pull request is in, read from its
   * URL, so a reference to an issue there by its full name counts as the
   * same issue as `#N`. Undefined when the URL wasn't available. */
  readonly repository?: string;
}

function repositoryOf(url: unknown): string | undefined {
  if (typeof url !== "string") {
    return undefined;
  }
  return /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/\d+/.exec(url)?.[1];
}

function readPayloadText(raw: string): PullRequestText | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const pullRequest: unknown = (payload as Record<string, unknown>)
    .pull_request;
  if (typeof pullRequest !== "object" || pullRequest === null) {
    return undefined;
  }
  // The event payload calls the URL `html_url`; `gh pr view` calls it `url`.
  const { title, body, url, html_url } = pullRequest as Record<string, unknown>;
  const repository = repositoryOf(html_url ?? url);
  return {
    title: typeof title === "string" ? title : "",
    body: typeof body === "string" ? body : "",
    ...(repository === undefined ? {} : { repository }),
  };
}

async function readViaGh(
  ctx: Context,
  prNumber: string | undefined,
): Promise<PullRequestText | undefined> {
  const args = ["pr", "view", "--json", "title,body,url"];
  if (prNumber !== undefined) {
    args.splice(2, 0, prNumber);
  }
  const result = await ctx.gh.run(args, ctx.cwd);
  if (result.code !== 0) {
    return undefined;
  }
  return readPayloadText(`{"pull_request":${result.stdout}}`);
}

/**
 * Where the pull request's title and body come from, in order:
 *   1. the pull_request event payload GitHub Actions writes to
 *      GITHUB_EVENT_PATH: no network, no token, and it is the same data the
 *      check runs on, so CI needs nothing extra;
 *   2. `gh pr view` (for `prNumber` when given, else the current branch's
 *      pull request), which is how `temple-bar merge` and a local run read it.
 * Undefined when neither is available (no event, no gh, no pull request
 * yet): the caller then says issues could not be checked.
 */
export async function readPullRequestText(
  ctx: Context,
  prNumber?: string,
): Promise<PullRequestText | undefined> {
  const eventPath = ctx.env.GITHUB_EVENT_PATH;
  if (eventPath !== undefined && eventPath !== "" && prNumber === undefined) {
    const raw = await ctx.fs.readText(eventPath);
    const fromEvent = raw === undefined ? undefined : readPayloadText(raw);
    if (fromEvent !== undefined) {
      return fromEvent;
    }
  }
  return readViaGh(ctx, prNumber);
}
