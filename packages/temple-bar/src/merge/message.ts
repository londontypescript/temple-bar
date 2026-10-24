// The squash commit's message. A squash merge turns the pull request into
// one commit on the default branch, and GitHub's default message pastes in
// every commit on the branch ("wip", "fix typo", ...). The written message
// is instead: the title with the pull request number, one bullet per
// distinct change when the description lists them, then trailers: whether
// the maintainer approved a change that needs them, each co-author once, and
// each reviewer once.

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

/** The people the branch's commits credit in their trailers: who wrote
 * the change with the author, and who reviewed it. */
export interface CommitTrailers {
  readonly coAuthors: readonly string[];
  readonly reviewers: readonly string[];
}

const CO_AUTHOR_KEY = "Co-authored-by";
const REVIEWER_KEY = "Reviewed-by";

/** Co-authors and reviewers named in the trailers of the commits in `range`,
 * each once, in the order first seen, oldest commit first. Names are
 * compared without case, because the same person is often typed two ways
 * across commits. */
export async function readTrailers(
  ctx: Context,
  range: string,
  cwd: string,
): Promise<CommitTrailers> {
  // `unfold` joins a value wrapped onto a second line, which would otherwise
  // be cut at the wrap.
  const result = await ctx.git.run(
    [
      "log",
      "--reverse",
      `--format=%(trailers:key=${CO_AUTHOR_KEY},key=${REVIEWER_KEY},unfold)`,
      range,
    ],
    cwd,
  );
  if (result.code !== 0) {
    refuse(
      `could not read the branch's commits for co-authors and reviewers: ${result.stderr.trim()}`,
    );
  }
  const coAuthors = new Map<string, string>();
  const reviewers = new Map<string, string>();
  // Git matches the keys without case and prints each as the commit spells
  // it ("Co-Authored-By" and "Co-authored-by" both occur), so lines are
  // sorted by their key compared the same way.
  const lists = new Map([
    [CO_AUTHOR_KEY.toLowerCase(), coAuthors],
    [REVIEWER_KEY.toLowerCase(), reviewers],
  ]);
  for (const line of result.stdout.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const list = lists.get(line.slice(0, colon).trim().toLowerCase());
    const name = line
      .slice(colon + 1)
      .trim()
      .replace(/\s+/g, " ");
    if (list !== undefined && name !== "" && !list.has(name.toLowerCase())) {
      list.set(name.toLowerCase(), name);
    }
  }
  return {
    coAuthors: [...coAuthors.values()],
    reviewers: [...reviewers.values()],
  };
}

export interface SquashMessage {
  readonly subject: string;
  readonly body: string;
}

/** The trailer that records, on the default branch, that the merging agent
 * said the maintainer approved a change that needs their yes. */
const MAINTAINER_APPROVED_TRAILER = "Maintainer-Approved";

/** `maintainerApproved` lists the changes the maintainer said yes to (as
 * merge words them); empty when the pull request needed no such yes. */
export function buildSquashMessage(
  pullRequest: {
    readonly number: number;
    readonly title: string;
    readonly body: string;
  },
  credited: CommitTrailers,
  maintainerApproved: readonly string[] = [],
): SquashMessage {
  // Bullets are optional: a pull request is one concern, so its title can
  // say everything, and a bullet repeating it adds nothing. The message is
  // never built from the branch's commits either way.
  const bullets = topLevelBullets(pullRequest.body).map(
    (bullet) => `- ${bullet}`,
  );
  // Nothing can prove the maintainer said yes, so the claim is written
  // where everyone reads it: `git log` on the default branch. A commit
  // there that changes AGENTS.md without this line was merged some other
  // way, and so skipped the request for the yes.
  const trailers = [
    ...(maintainerApproved.length > 0
      ? [`${MAINTAINER_APPROVED_TRAILER}: ${maintainerApproved.join("; ")}`]
      : []),
    ...credited.coAuthors.map((author) => `Co-Authored-By: ${author}`),
    ...credited.reviewers.map((reviewer) => `${REVIEWER_KEY}: ${reviewer}`),
  ];
  const lines =
    bullets.length > 0 && trailers.length > 0
      ? [...bullets, "", ...trailers]
      : [...bullets, ...trailers];
  return {
    subject: `${pullRequest.title.trim()} (#${String(pullRequest.number)})`,
    body: lines.join("\n"),
  };
}
