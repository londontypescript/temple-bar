// `temple-bar pr-title [title]`: checks a pull request title against the same
// conventional-prefix rule as the `commit-msg` hook. A squash merge makes the
// title the commit on `main`, so a bad title is a bad commit.
//
// With no argument it reads the title from the GitHub event payload (the file
// named by GITHUB_EVENT_PATH). That is the safe way to feed it from CI: a
// title interpolated into a shell command line can run code, a title read
// from a file cannot. An explicit argument is for trying a title locally.
//
//   0  the title is fine
//   1  the title lacks a conventional prefix
//   2  there is no title to check (no argument, no readable pull request event)

import {
  describeRefusal,
  isConventionalSubject,
} from "../conventional/subject.ts";
import type { Context } from "../context.ts";
import { formatUsageLine, type CommandEntry } from "../registry.ts";

const ARGS = "[title]";

async function titleFromEvent(ctx: Context): Promise<string | undefined> {
  const eventPath = ctx.env.GITHUB_EVENT_PATH;
  if (eventPath === undefined || eventPath === "") {
    return undefined;
  }
  const text = await ctx.fs.readText(eventPath);
  if (text === undefined) {
    return undefined;
  }
  try {
    const event: unknown = JSON.parse(text);
    const title = (event as { pull_request?: { title?: unknown } }).pull_request
      ?.title;
    return typeof title === "string" ? title : undefined;
  } catch {
    return undefined;
  }
}

export const prTitleCommand: CommandEntry = {
  name: "pr-title",
  summary: "Check a pull request title for a conventional prefix.",
  args: ARGS,
  details:
    "Without a title, reads the pull request title from the GitHub event payload (GITHUB_EVENT_PATH).",
  async run(args, ctx) {
    const title = args[0] ?? (await titleFromEvent(ctx));
    if (title === undefined) {
      ctx.stderr.write(
        `temple-bar: no pull request title to check. Pass one, or run on a pull_request event.\n${formatUsageLine("pr-title", ARGS)}\n`,
      );
      return 2;
    }
    if (isConventionalSubject(title)) {
      return 0;
    }
    ctx.stderr.write(describeRefusal(title, "the pull request title"));
    return 1;
  },
};
