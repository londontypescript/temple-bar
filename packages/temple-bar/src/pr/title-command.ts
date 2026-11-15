// `temple-bar pr-title [title]`: checks a pull request title against the same
// conventional-prefix rule as the `commit-msg` hook. A squash merge makes the
// title the commit on `main`, so a bad title is a bad commit.
//
// With no argument it is the required check on a pull request, and it also
// checks that the description ends with a trailer block naming everyone the
// branch's commits credit (trailer-check.ts). It takes only the pull
// request's number from the GitHub event (the file named by
// GITHUB_EVENT_PATH) and reads the title, description and head from GitHub
// as they are now, so a rerun can't pass text that has since changed. Text
// from a pull request never reaches a command line, where it could run code.
// An explicit argument is for trying a title locally, and checks only that.
//
//   0  everything checked is fine
//   1  the title lacks a conventional prefix, the description lacks a
//      trailer, or the pull request or the branch's commits couldn't be read
//   2  there is nothing to check (no argument, no readable pull request event)

import {
  describeRefusal,
  isConventionalSubject,
} from "../conventional/subject.ts";
import type { Context } from "../context.ts";
import { RERUN_INIT } from "../init/requirements.ts";
import { formatUsageLine, type CommandEntry } from "../registry.ts";
import {
  readLivePullRequest,
  type PullRequestAddress,
} from "./live-pull-request.ts";
import { checkTrailers } from "./trailer-check.ts";

const ARGS = "[title]";

const DEFAULT_API = "https://api.github.com";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/** Which pull request the event is about: its number, and the repository
 * from GITHUB_REPOSITORY, else the event's own. Nothing else is taken from
 * the event. */
async function addressFromEvent(
  ctx: Context,
): Promise<Omit<PullRequestAddress, "api" | "token"> | undefined> {
  const eventPath = nonEmpty(ctx.env.GITHUB_EVENT_PATH);
  const text =
    eventPath === undefined ? undefined : await ctx.fs.readText(eventPath);
  if (text === undefined) {
    return undefined;
  }
  let event: unknown;
  try {
    event = JSON.parse(text);
  } catch {
    return undefined;
  }
  const pullRequest = isRecord(event) ? event.pull_request : undefined;
  const number = isRecord(pullRequest) ? pullRequest.number : undefined;
  const repository = isRecord(event) ? event.repository : undefined;
  const fullName = isRecord(repository) ? repository.full_name : undefined;
  const [owner, repo, ...rest] = (
    nonEmpty(ctx.env.GITHUB_REPOSITORY) ??
    (typeof fullName === "string" ? fullName : "")
  ).split("/");
  if (
    typeof number !== "number" ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    owner === undefined ||
    owner === "" ||
    repo === undefined ||
    repo === "" ||
    rest.length > 0
  ) {
    return undefined;
  }
  return { owner, repo, number };
}

function titleProblem(title: string): string | undefined {
  return isConventionalSubject(title)
    ? undefined
    : describeRefusal(title, "the pull request title");
}

async function checkPullRequest(ctx: Context): Promise<number> {
  const address = await addressFromEvent(ctx);
  if (address === undefined) {
    ctx.stderr.write(
      `temple-bar: no pull request title to check. Pass one, or run on a pull_request event.\n${formatUsageLine("pr-title", ARGS)}\n`,
    );
    return 2;
  }
  const token =
    nonEmpty(ctx.env.GH_TOKEN) ?? nonEmpty(ctx.env.GITHUB_TOKEN) ?? undefined;
  if (token === undefined && ctx.env.GITHUB_ACTIONS === "true") {
    ctx.stderr.write(
      "temple-bar: GitHub Actions gave the title check no token to read the " +
        "pull request with, so this pull request title workflow is older " +
        `than this temple-bar. Run ${RERUN_INIT} to update it.\n`,
    );
    return 1;
  }
  const read = await readLivePullRequest(ctx, {
    // GitHub Enterprise Server sets its own API address.
    api: nonEmpty(ctx.env.GITHUB_API_URL) ?? DEFAULT_API,
    ...address,
    token,
  });
  if (!read.ok) {
    ctx.stderr.write(
      `temple-bar: could not read pull request #${String(address.number)} ` +
        `from GitHub: ${read.reason}. The check doesn't pass what it hasn't ` +
        "read: run it again once GitHub answers.\n",
    );
    return 1;
  }
  const problems = [
    titleProblem(read.value.title),
    await checkTrailers(ctx, address.number, read.value).then((problem) =>
      problem === undefined ? undefined : `temple-bar: ${problem}\n`,
    ),
  ].filter((problem) => problem !== undefined);
  for (const problem of problems) {
    ctx.stderr.write(problem);
  }
  return problems.length === 0 ? 0 : 1;
}

export const prTitleCommand: CommandEntry = {
  name: "pr-title",
  summary:
    "Check a pull request title for a conventional prefix, and its description for the branch's trailers.",
  args: ARGS,
  details: [
    "With a title, checks only that title. Without one, takes the pull",
    "request's number from the GitHub event payload (GITHUB_EVENT_PATH),",
    "reads its title, description and head from GitHub as they are now",
    "(GH_TOKEN), and also checks that the description ends with a trailer",
    "block holding every Co-Authored-By and Reviewed-by line on the",
    "branch's commits, read from a checkout of the head with its whole",
    "history (fetch-depth: 0).",
  ].join("\n"),
  async run(args, ctx) {
    const title = args[0];
    if (title === undefined) {
      return checkPullRequest(ctx);
    }
    const problem = titleProblem(title);
    if (problem === undefined) {
      return 0;
    }
    ctx.stderr.write(problem);
    return 1;
  },
};
