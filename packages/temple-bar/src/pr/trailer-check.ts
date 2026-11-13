// Whether a pull request's description ends with a trailer block naming
// everyone the branch's commits credit. With setup's squash defaults, a
// merge on GitHub's site makes the description the squash commit's body,
// so a description without them drops them from the default branch; an
// admin merge can't go through `temple-bar merge`, which adds them itself.
// This checks the description only: whoever merges can still edit the
// message, which is why the merge preview stays on the admin checklist.
//
// The branch's commits come from the checked-out history, read with
// merge's own trailer reader over the same range shape merge uses
// (`origin/<base>..<head>`), so the two agree on who is credited and no
// API page limit applies. The checkout must be the pull request's head as
// GitHub has it now, and whole: a shallow one would hide commits.

import type { Context } from "../context.ts";
import {
  creditLines,
  missingTrailers,
  readTrailers,
} from "../merge/message.ts";
import { RERUN_INIT } from "../init/requirements.ts";
import { descriptionTrailers } from "./description-trailers.ts";
import type { LivePullRequest } from "./live-pull-request.ts";

const WHOLE_CHECKOUT =
  "The pull request title workflow checks out the pull request's head " +
  `with its whole history (fetch-depth: 0); run ${RERUN_INIT} to restore ` +
  "it if it has changed.";

async function gitLine(
  ctx: Context,
  args: readonly string[],
): Promise<string | undefined> {
  const result = await ctx.git.run(args, ctx.cwd);
  return result.code === 0 ? result.stdout.trim() : undefined;
}

/** What is wrong, as the whole message to print, or undefined when the
 * description credits everyone. */
export async function checkTrailers(
  ctx: Context,
  number: number,
  live: LivePullRequest,
): Promise<string | undefined> {
  const shallow = await gitLine(ctx, ["rev-parse", "--is-shallow-repository"]);
  if (shallow !== "false") {
    return shallow === "true"
      ? `the checkout is shallow, so the branch's commits can't all be read. ${WHOLE_CHECKOUT}`
      : `could not tell whether the checkout holds the branch's whole history. ${WHOLE_CHECKOUT}`;
  }
  const head = await gitLine(ctx, ["rev-parse", "HEAD"]);
  if (head !== live.headSha) {
    return (
      `pull request #${String(number)}'s head is now ${live.headSha}, but ` +
      `this run checked out ${head ?? "nothing it could read"}, so it is ` +
      "checking an older push. Rerun the check for the newest push."
    );
  }
  let credited;
  try {
    // "origin/" in front keeps a branch name from reading as an option.
    credited = await readTrailers(
      ctx,
      `origin/${live.baseRef}..${live.headSha}`,
      ctx.cwd,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `${reason}. ${WHOLE_CHECKOUT}`;
  }
  const missing = creditLines(
    missingTrailers(credited, descriptionTrailers(live.body)),
  );
  if (missing.length === 0) {
    return undefined;
  }
  return (
    "the pull request description must end with a trailer block naming " +
    "everyone the branch's commits credit, so a squash merge on GitHub " +
    "keeps them. Add these lines at the very end of the description, " +
    "after a blank line, with nothing after them (editing the description " +
    // Unindented: an indented line pasted in would read as the wrapped
    // end of the trailer above it.
    `runs this check again):\n${missing.join("\n")}`
  );
}
