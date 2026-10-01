// Finds the issues a pull request will close. A squash merge turns the pull
// request into one commit, so the title and body are what GitHub reads for
// closing keywords ("Closes #12", "fixes owner/repo#12").

import type { Context } from "../context.ts";

const CLOSING_KEYWORD =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?[ \t]+((?:[\w.-]+\/[\w.-]+)?#\d+)/gi;

/** HTML comments and fenced code are not read by GitHub as closing
 * references, and a pull request template often carries an example there. */
function stripNonProse(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "").replace(/```[\s\S]*?```/g, "");
}

/** The distinct issues named after a closing keyword in `texts`, in the
 * order first seen, as written ("#12" or "owner/repo#12"). */
export function findClosingIssues(texts: readonly string[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of stripNonProse(text).matchAll(CLOSING_KEYWORD)) {
      const reference = match[1];
      if (reference !== undefined) {
        found.add(reference.toLowerCase());
      }
    }
  }
  return [...found];
}

export interface PullRequestText {
  readonly title: string;
  readonly body: string;
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
  const { title, body } = pullRequest as Record<string, unknown>;
  return {
    title: typeof title === "string" ? title : "",
    body: typeof body === "string" ? body : "",
  };
}

async function readViaGh(
  ctx: Context,
  prNumber: string | undefined,
): Promise<PullRequestText | undefined> {
  const args = ["pr", "view", "--json", "title,body"];
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
