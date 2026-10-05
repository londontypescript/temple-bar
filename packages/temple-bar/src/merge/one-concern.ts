// A pull request that closes several issues has to say, in its description,
// why they are one change and not several. Merge only checks that the line
// is there; whether the reason holds is for review.

import { findClosingIssues } from "../pr/closing-issues.ts";
import { proseLines } from "../pr/prose.ts";
import { refuse } from "./refusal.ts";
import type { PullRequest } from "./github.ts";

/** `One concern:` at the start of a line, optionally quoted (`> `), as a
 * `- ` bullet (the form merge's squash message keeps in `git log`), or in
 * bold (`**One concern:**` or `**One concern**:`). What follows is the
 * reason. */
const ONE_CONCERN =
  /^[ \t]*(?:>[ \t]*)*(?:-[ \t]+)?(?:\*\*)?One concern(?::\*\*|\*\*:|:)(.*)$/i;

/** True when `body` has a `One concern:` line that gives a reason. The line
 * is looked for in the same prose the closed issues are counted in, so a
 * line inside a comment or code doesn't count, and neither does a template
 * placeholder such as `One concern: <!-- say why -->`, which is empty once
 * the comment is gone. Leftover bold markers aren't a reason either. */
export function hasOneConcernLine(body: string): boolean {
  return proseLines(body).some((line) => {
    const reason = ONE_CONCERN.exec(line)?.[1];
    return reason !== undefined && reason.replace(/[\s*]/g, "") !== "";
  });
}

/** Stops the merge when the pull request closes two or more issues and its
 * description has no `One concern:` line. `repository` ("owner/name") is
 * the pull request's own, so an issue there written in full counts once. */
export function checkOneConcern(
  pullRequest: PullRequest,
  repository: string,
): void {
  const closed = findClosingIssues(
    [pullRequest.title, pullRequest.body],
    repository,
  );
  if (closed.length < 2 || hasOneConcernLine(pullRequest.body)) {
    return;
  }
  refuse(
    `pull request #${String(pullRequest.number)} closes ${String(closed.length)} issues (${closed.join(", ")}) ` +
      "but its description has no `One concern:` line. Add one saying why they are a single change " +
      "(see AGENTS.md section 2 for the reasons that count), or split the pull request.",
  );
}
