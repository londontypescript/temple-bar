// Reads a pull request description the way GitHub renders it, keeping only
// the prose. HTML comments, code blocks and code spans are where templates
// put placeholders and where people paste examples, so text inside them
// neither closes an issue nor counts as a written reason. Every check that
// reads the description goes through this one scan, so they can't disagree
// about which text is real.

/** Stands in for a code span. It is not whitespace, so a line whose only
 * content is code still has content; and it is not a word character or
 * `#`, so it can never become part of a closing keyword or an issue
 * reference. */
export const CODE_SPAN = "\uE000";

/** A fence opens on a line of three or more backticks or tildes, indented
 * by at most three spaces. A backtick fence's info string can't hold a
 * backtick, or the line is inline code instead. */
const FENCE_OPEN = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
const INDENTED_CODE = /^(?: {4}|\t| {1,3}\t)/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

interface Fence {
  readonly marker: string;
  readonly length: number;
}

function closesFence(line: string, fence: Fence): boolean {
  const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
  const run = match?.[1];
  return run?.startsWith(fence.marker) === true && run.length >= fence.length;
}

interface Inline {
  readonly text: string;
  /** True when an HTML comment opened on this line and didn't close. */
  readonly openComment: boolean;
}

/** Blanks the comments and code spans within one line, left to right, so
 * that `<!--` inside a code span stays code and a backtick inside a
 * comment stays hidden. A comment becomes a space rather than nothing, so
 * the words either side of it are never joined into a new one. */
function inline(line: string): Inline {
  let text = "";
  let at = 0;
  while (at < line.length) {
    if (line.startsWith("<!--", at)) {
      const end = line.indexOf("-->", at + 4);
      if (end === -1) {
        return { text, openComment: true };
      }
      text += " ";
      at = end + 3;
      continue;
    }
    if (line[at] === "`") {
      let run = 1;
      while (line[at + run] === "`") {
        run += 1;
      }
      const close = closingRun(line, at + run, run);
      if (close === -1) {
        // No matching run: the backticks are literal text.
        text += line.slice(at, at + run);
      } else {
        text += CODE_SPAN;
        run = close + run - at;
      }
      at += run;
      continue;
    }
    text += line.charAt(at);
    at += 1;
  }
  return { text, openComment: false };
}

/** Where a backtick run of exactly `length` starts at or after `from`, or
 * -1. A longer or shorter run doesn't close a code span. */
function closingRun(line: string, from: number, length: number): number {
  let at = line.indexOf("`", from);
  while (at !== -1) {
    let run = 1;
    while (line[at + run] === "`") {
      run += 1;
    }
    if (run === length) {
      return at;
    }
    at = line.indexOf("`", at + run);
  }
  return -1;
}

/**
 * The description's lines with everything GitHub doesn't render as prose
 * replaced: lines inside a comment, a ``` or ~~~ fence, or an indented code
 * block become empty, and comments and code spans within a line are
 * blanked. Line numbers are kept, one output line per input line.
 *
 * An unclosed comment or fence hides the rest of the text, as it does when
 * GitHub renders it. Indented lines are code only where they could start
 * a code block: after a blank line, and outside a list, whose indented
 * lines continue its items.
 */
export function proseLines(text: string): string[] {
  const out: string[] = [];
  let fence: Fence | undefined;
  let inComment = false;
  let inIndentedCode = false;
  let inList = false;
  let previousBlank = true;

  for (const line of text.split(/\r?\n/)) {
    const blank = line.trim() === "";
    let rest = line;

    if (fence !== undefined) {
      if (closesFence(line, fence)) {
        fence = undefined;
      }
      out.push("");
      continue;
    }

    if (inComment) {
      const end = line.indexOf("-->");
      if (end === -1) {
        out.push("");
        continue;
      }
      // The comment ends here; the rest of the line is read as prose, and
      // `inComment` is set again from it below.
      rest = ` ${line.slice(end + 3)}`;
    } else {
      if (inIndentedCode && !blank && !INDENTED_CODE.test(line)) {
        inIndentedCode = false;
      }
      if (
        !inIndentedCode &&
        previousBlank &&
        !inList &&
        INDENTED_CODE.test(line) &&
        !blank
      ) {
        inIndentedCode = true;
      }
      if (inIndentedCode) {
        out.push("");
        previousBlank = blank;
        continue;
      }

      const open = FENCE_OPEN.exec(line)?.[1];
      if (open !== undefined) {
        fence = { marker: open[0] ?? "`", length: open.length };
        out.push("");
        continue;
      }

      if (LIST_ITEM.test(line)) {
        inList = true;
      } else if (previousBlank && !blank && !/^[ \t]/.test(line)) {
        // A paragraph that starts at the margin after a blank line ends
        // any list above it.
        inList = false;
      }
    }

    const result = inline(rest);
    inComment = result.openComment;
    out.push(result.text);
    previousBlank = blank;
  }
  return out;
}
