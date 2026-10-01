// The squash commit's message. A squash merge turns the pull request into
// one commit on the default branch, and GitHub's default message pastes in
// every commit on the branch ("wip", "fix typo", ...). The written message
// is instead: the title with the pull request number, one bullet per
// distinct change from the description, and each co-author once at the end.

import type { Context } from "../context.ts";
import { refuse } from "./refusal.ts";

/** HTML comments and fenced code hold template text and examples, never
 * the description's own bullets, so they are stepped over while reading.
 * An unclosed one hides the rest of the text, as it does when GitHub
 * renders it. Scanning by position, rather than deleting matches, means no
 * text is ever rebuilt from leftovers around a removed piece. */
function withoutCommentsAndCode(body: string): string {
  const pairs = [
    ["<!--", "-->"],
    ["```", "```"],
  ] as const;
  let kept = "";
  let from = 0;
  for (;;) {
    let start = -1;
    let close = "";
    let openLength = 0;
    for (const [open, end] of pairs) {
      const at = body.indexOf(open, from);
      if (at !== -1 && (start === -1 || at < start)) {
        start = at;
        close = end;
        openLength = open.length;
      }
    }
    if (start === -1) {
      return kept + body.slice(from);
    }
    kept += body.slice(from, start);
    const end = body.indexOf(close, start + openLength);
    if (end === -1) {
      return kept;
    }
    from = end + close.length;
  }
}

/** The description's top-level "- " bullets, each on one line. A bullet
 * that wraps onto indented lines below it keeps those lines. */
export function topLevelBullets(body: string): string[] {
  const bullets: string[] = [];
  let current: string | undefined;
  for (const line of withoutCommentsAndCode(body).split(/\r?\n/)) {
    if (line.startsWith("- ")) {
      if (current !== undefined) {
        bullets.push(current);
      }
      current = line.slice(2).trim();
    } else if (current !== undefined && /^\s+\S/.test(line)) {
      // An indented line continues the bullet, unless it starts a nested
      // list: the commit message keeps only the top level.
      const trimmed = line.trim();
      if (/^[-*+] |^\d+[.)] /.test(trimmed)) {
        continue;
      }
      current = `${current} ${trimmed}`;
    } else if (current !== undefined) {
      bullets.push(current);
      current = undefined;
    }
  }
  if (current !== undefined) {
    bullets.push(current);
  }
  return bullets.filter((bullet) => bullet !== "");
}

/** Co-authors named in the trailers of the commits in `range`, each once,
 * in the order first seen. Names are compared without case, because the
 * same person is often typed two ways across commits. */
export async function readCoAuthors(
  ctx: Context,
  range: string,
  cwd: string,
): Promise<string[]> {
  const result = await ctx.git.run(
    [
      "log",
      "--reverse",
      "--format=%(trailers:key=Co-authored-by,valueonly)",
      range,
    ],
    cwd,
  );
  if (result.code !== 0) {
    refuse(
      `could not read the branch's commits for co-authors: ${result.stderr.trim()}`,
    );
  }
  const seen = new Map<string, string>();
  for (const line of result.stdout.split("\n")) {
    const author = line.trim().replace(/\s+/g, " ");
    if (author !== "" && !seen.has(author.toLowerCase())) {
      seen.set(author.toLowerCase(), author);
    }
  }
  return [...seen.values()];
}

export interface SquashMessage {
  readonly subject: string;
  readonly body: string;
}

export function buildSquashMessage(
  pullRequest: {
    readonly number: number;
    readonly title: string;
    readonly body: string;
  },
  coAuthors: readonly string[],
): SquashMessage {
  const bullets = topLevelBullets(pullRequest.body);
  if (bullets.length === 0) {
    refuse(
      `pull request #${String(pullRequest.number)}'s description has no top-level "- " bullets: ` +
        "the squash commit's body is one bullet per distinct change, taken from the description. " +
        "Add them (one per change) and run merge again.",
    );
  }
  const lines = bullets.map((bullet) => `- ${bullet}`);
  if (coAuthors.length > 0) {
    lines.push("", ...coAuthors.map((author) => `Co-Authored-By: ${author}`));
  }
  return {
    subject: `${pullRequest.title.trim()} (#${String(pullRequest.number)})`,
    body: lines.join("\n"),
  };
}
