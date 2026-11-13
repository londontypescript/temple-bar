// The trailer block a pull request's description ends with. With setup's
// squash defaults, a merge on GitHub's site makes the description the
// squash commit's body, and git reads a commit's trailers from its last
// paragraph only. So the co-authors and reviewers the branch's commits
// credit survive such a merge only when the description's last paragraph
// is wholly trailer lines naming them.
//
// The text is read raw, as GitHub copies it into the commit: an HTML
// comment or a code fence in that paragraph is a line git doesn't read as
// a trailer, so it isn't one here either.

import { collectTrailers, type CommitTrailers } from "../merge/message.ts";

/** A trailer line: a key of letters, digits and dashes, then a colon, as
 * git recognises one with no trailer configuration of its own (which is
 * how GitHub's runners and a fresh clone read it). */
const TRAILER_LINE = /^[A-Za-z0-9][A-Za-z0-9-]*[ \t]*:/;

/** A line that continues the trailer above it: git joins a value wrapped
 * onto an indented line. */
const CONTINUATION = /^[ \t]/;

/** The description's last paragraph as one "Key: value" line per trailer,
 * wrapped values joined, or undefined when that paragraph isn't wholly
 * trailers (or there is no text at all). Blank lines are lines of only
 * spaces and tabs, as git counts them. */
export function finalTrailerBlock(description: string): string | undefined {
  const lines = description.split(/\r?\n/);
  const isBlank = (line: string) => line.trim() === "";
  let end = lines.length;
  while (end > 0 && isBlank(lines[end - 1] ?? "")) {
    end -= 1;
  }
  let start = end;
  while (start > 0 && !isBlank(lines[start - 1] ?? "")) {
    start -= 1;
  }
  const trailers: string[] = [];
  for (const line of lines.slice(start, end)) {
    const last = trailers.length - 1;
    if (CONTINUATION.test(line) && last >= 0) {
      trailers[last] = `${trailers[last] ?? ""} ${line.trim()}`;
    } else if (TRAILER_LINE.test(line)) {
      trailers.push(line);
    } else {
      return undefined;
    }
  }
  return trailers.length === 0 ? undefined : trailers.join("\n");
}

/** The co-authors and reviewers the description's final trailer block
 * names, matched as merge matches the branch's own; none when it has no
 * such block. */
export function descriptionTrailers(description: string): CommitTrailers {
  return collectTrailers(finalTrailerBlock(description) ?? "");
}
