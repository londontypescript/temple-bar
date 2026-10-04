// A pull request that closes several issues has to say, in its description,
// why they are one change and not several. Merge only checks that the line
// is there; whether the reason holds is for review.

import { findClosingIssues } from "../pr/closing-issues.ts";
import { refuse } from "./refusal.ts";
import type { PullRequest } from "./github.ts";

const ONE_CONCERN_LINE = /^[ \t]*One concern:[ \t]*\S/im;

/** Stops the merge when the pull request closes two or more issues and its
 * description has no `One concern:` line. */
export function checkOneConcern(pullRequest: PullRequest): void {
  const closed = findClosingIssues([pullRequest.title, pullRequest.body]);
  if (closed.length < 2 || ONE_CONCERN_LINE.test(pullRequest.body)) {
    return;
  }
  refuse(
    `pull request #${String(pullRequest.number)} closes ${String(closed.length)} issues (${closed.join(", ")}) ` +
      "but its description has no `One concern:` line. Add one saying why they are a single change " +
      "(see AGENTS.md section 2 for the reasons that count), or split the pull request.",
  );
}
