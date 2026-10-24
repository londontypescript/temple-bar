// A pull request that closes several issues, or is over the size limits,
// has to say in its description why it is one change and not several.
// Merge only checks that the line is there; whether the reason holds is for
// review.

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

/** Whether a pull request needs a `One concern:` line, and has one. It
 * needs one when it closes two or more issues or is over a size limit
 * (`overages`, empty when it isn't): either way it may hold more than one
 * change, and the line is where its author says why it doesn't. The size
 * report and merge's refusal both decide here, so they can't disagree. */
export function oneConcernVerdict(
  body: string,
  closed: readonly string[],
  overages: readonly string[],
): "not needed" | "given" | "missing" {
  if (closed.length < 2 && overages.length === 0) {
    return "not needed";
  }
  return hasOneConcernLine(body) ? "given" : "missing";
}

/** Stops the merge when the pull request needs a `One concern:` line and its
 * description has none. `repository` ("owner/name") is the pull request's
 * own, so an issue there written in full counts once. `overages` are the
 * size limits it is over, as the size report words them; the early call,
 * made before anything is measured, passes none. */
export function checkOneConcern(
  pullRequest: PullRequest,
  repository: string,
  overages: readonly string[] = [],
): void {
  const closed = findClosingIssues(
    [pullRequest.title, pullRequest.body],
    repository,
  );
  if (oneConcernVerdict(pullRequest.body, closed, overages) !== "missing") {
    return;
  }
  const several = closed.length >= 2;
  const reasons = [
    ...(overages.length > 0
      ? [`is over the size limits (${overages.join("; ")})`]
      : []),
    ...(several
      ? [`closes ${String(closed.length)} issues (${closed.join(", ")})`]
      : []),
  ];
  const what =
    several && overages.length === 0
      ? "they are a single change"
      : "it is a single change";
  refuse(
    `pull request #${String(pullRequest.number)} ${reasons.join(" and ")} ` +
      "but its description has no `One concern:` line. " +
      `Add a line to the description starting \`One concern:\` that says why ${what} ` +
      "(see AGENTS.md section 2 for the reasons that count), or split the pull request.",
  );
}
