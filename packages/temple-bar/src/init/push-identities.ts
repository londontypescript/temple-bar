// The commit identities a new repository's first push would make public,
// and a short code for them. GitHub shows every commit's author and
// committer name and email, and links each `Co-authored-by` line, so the
// user sees all of them before agreeing to the push. The code lets a rerun
// with `--create-repo` show the identities haven't changed since: a commit
// by someone new, or a changed environment override, gives another code. It
// is a receipt an honest agent passes back, not a proof of anything.

import { createHash } from "node:crypto";

import type { Context } from "../context.ts";
import type { RequirementResult } from "./requirements.ts";

export interface PushIdentities {
  /** What the user is shown: one line per distinct identity, then the
   * environment overrides. */
  readonly lines: readonly string[];
  /** Covers the identities and the overrides, not where each identity was
   * seen: setup's own first commit moves "your git identity" into the
   * history without changing who is published. */
  readonly code: string;
}

type Source =
  | "author"
  | "committer"
  | "co-author"
  | "your git author identity"
  | "your git committer identity";

const SOURCE_ORDER: readonly Source[] = [
  "author",
  "committer",
  "co-author",
  "your git author identity",
  "your git committer identity",
];

/** Variables that change the identity git commits with, sorted. */
const OVERRIDES = [
  "EMAIL",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_NAME",
] as const;

/** Five NUL-separated fields per commit, and `-z` ends each commit with a
 * NUL too. No field can hold a NUL: git refuses one in a name or a
 * message. Raw fields (`%an`, never the mailmap's `%aN`): GitHub shows
 * what the commit holds. */
const LOG_FORMAT = "--format=%an%x00%ae%x00%cn%x00%ce%x00%B";
const FIELDS = 5;

/** Read from the message by setup, not by git's trailer parser, which
 * `trailer.separators` can change. Any line counts, inside the trailer
 * block or not: showing one too many is the safe side. */
const CO_AUTHOR_LINE = /^[ \t]*co-authored-by[ \t]*:[ \t]*(.*?)[ \t]*$/gim;

/** Where HEAD stands: setup's first commit is only for an unborn branch,
 * and a detached HEAD has no branch to publish. A branch with commits
 * keeps the commit read, so the push sends exactly what was disclosed. */
export type HeadState =
  | {
      readonly kind: "commits";
      readonly commit: string;
      readonly branch: string;
    }
  | { readonly kind: "unborn"; readonly branch: string }
  | { readonly kind: "detached" }
  | { readonly kind: "unreadable"; readonly reason: string };

const BRANCH_PREFIX = "refs/heads/";

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

/** Reads HEAD, establishing "unborn" positively: HEAD names a branch, and
 * listing refs for it succeeds, says nothing on stderr (git skips a broken
 * ref with only a warning there) and lists no ref by exactly that name.
 * Anything git can't answer is unreadable, never taken as unborn. */
export async function readHeadState(
  ctx: Context,
  repoRoot: string,
): Promise<HeadState> {
  const symbolic = await ctx.git.run(
    ["symbolic-ref", "--quiet", "HEAD"],
    repoRoot,
  );
  // Only git's line ending is removed: a branch name may end in other
  // whitespace, such as a non-breaking space.
  const ref = symbolic.stdout.replace(/\r?\n$/, "");
  if (symbolic.code !== 0 || !ref.startsWith(BRANCH_PREFIX)) {
    // `--quiet` exits 1, silently, only when HEAD isn't a symbolic ref.
    const notSymbolic = symbolic.code === 1 || symbolic.code === 0;
    const commit = await ctx.git.run(
      ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
      repoRoot,
    );
    return notSymbolic && commit.code === 0
      ? { kind: "detached" }
      : {
          kind: "unreadable",
          reason:
            firstLine(symbolic.stderr || commit.stderr) ||
            "HEAD names no branch",
        };
  }
  const branch = ref.slice(BRANCH_PREFIX.length);
  const listed = await ctx.git.run(
    ["for-each-ref", "--format=%(objectname) %(refname)", ref],
    repoRoot,
  );
  if (listed.code !== 0 || listed.stderr.trim() !== "") {
    return {
      kind: "unreadable",
      reason: firstLine(listed.stderr) || `couldn't list ${ref}`,
    };
  }
  // The pattern also lists refs below it (`refs/heads/main/x`), so only an
  // exact name counts. An object name has no space; a ref name has none.
  for (const line of listed.stdout.split("\n")) {
    const space = line.indexOf(" ");
    if (space > 0 && line.slice(space + 1) === ref) {
      return { kind: "commits", commit: line.slice(0, space), branch };
    }
  }
  return { kind: "unborn", branch };
}

/** Control characters, bidirectional overrides and backslashes shown as
 * escapes, for display only, so a name can't hide the lines after it or
 * pass for another. */
function visible(text: string): string {
  let shown = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const hidden =
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069);
    shown +=
      char === "\\"
        ? "\\\\"
        : hidden
          ? `\\u${code.toString(16).padStart(4, "0")}`
          : char;
  }
  return shown;
}

function fail(message: string): {
  readonly ok: false;
  readonly message: string;
} {
  return { ok: false, message };
}

/** Only what went wrong: the reader runs before and after the repository
 * is created, so each caller says what did and didn't happen. */
const UNREADABLE = "Couldn't read the commits a first push would publish";

/** Every commit reachable from `commit`, which is what pushing it sends, as
 * author, committer and co-author identities; a problem when the history
 * can't be read exactly. */
async function readHistory(
  ctx: Context,
  repoRoot: string,
  commit: string,
  add: (identity: string, source: Source) => void,
): Promise<string | undefined> {
  const log = await ctx.git.run(
    [
      // A push sends the commits themselves, never their replacements.
      "--no-replace-objects",
      "log",
      // Signature checks would print into the same output.
      "--no-show-signature",
      // Whatever i18n.logOutputEncoding says.
      "--encoding=UTF-8",
      "-z",
      LOG_FORMAT,
      commit,
      "--",
    ],
    repoRoot,
  );
  if (log.code !== 0) {
    return `${UNREADABLE} (git: ${firstLine(log.stderr) || "no answer"}).`;
  }
  const fields = log.stdout.split("\0");
  // git ends the last commit with a NUL too, leaving one empty part.
  if (
    fields.pop() !== "" ||
    fields.length === 0 ||
    fields.length % FIELDS !== 0
  ) {
    return `${UNREADABLE}: git's answer wasn't one record per commit.`;
  }
  for (let index = 0; index < fields.length; index += FIELDS) {
    const [authorName, authorEmail, committerName, committerEmail, message] =
      fields.slice(index, index + FIELDS);
    add(`${authorName ?? ""} <${authorEmail ?? ""}>`, "author");
    add(`${committerName ?? ""} <${committerEmail ?? ""}>`, "committer");
    for (const match of (message ?? "").matchAll(CO_AUTHOR_LINE)) {
      const coAuthor = match[1] ?? "";
      if (coAuthor !== "") {
        add(coAuthor, "co-author");
      }
    }
  }
  return undefined;
}

/** Reads the identities the push would publish: the history when HEAD has
 * commits, and the identity git commits with now, which setup's own first
 * commit uses on an unborn branch. A history that can't be read stops
 * setup, never reads as "nobody". */
export async function readPushIdentities(
  ctx: Context,
  repoRoot: string,
  head: HeadState,
): Promise<RequirementResult<PushIdentities>> {
  const sources = new Map<string, Set<Source>>();
  const add = (identity: string, source: Source): void => {
    const known = sources.get(identity) ?? new Set<Source>();
    known.add(source);
    sources.set(identity, known);
  };

  if (head.kind === "commits") {
    const problem = await readHistory(ctx, repoRoot, head.commit, add);
    if (problem !== undefined) {
      return fail(problem);
    }
  } else if (head.kind !== "unborn") {
    return fail(
      `${UNREADABLE}: HEAD is ${head.kind === "detached" ? "detached" : `unreadable (${head.reason})`}.`,
    );
  }

  // Shown, never coded: a commit can't use an identity git can't name, and
  // one named later is a new identity, which changes the code anyway.
  const unnamed: string[] = [];
  for (const [variable, source] of [
    ["GIT_AUTHOR_IDENT", "your git author identity"],
    ["GIT_COMMITTER_IDENT", "your git committer identity"],
  ] as const) {
    // `git var` applies config, `GIT_CONFIG_*` and the environment, as a
    // commit would. Its answer ends with a timestamp and offset.
    const result = await ctx.git.run(["var", variable], repoRoot);
    const ident = result.stdout
      .replace(/\r?\n$/, "")
      .replace(/ \d+ [+-]\d{4}$/, "");
    if (result.code === 0 && ident !== "") {
      add(ident, source);
    } else {
      unnamed.push(
        `${source}: git couldn't say (${firstLine(result.stderr) || "no answer"})`,
      );
    }
  }

  const overrides = OVERRIDES.flatMap((name) => {
    const value = ctx.env[name];
    return value === undefined ? [] : [[name, value] as const];
  });
  const identities = [...sources.keys()].sort();
  const lines = [
    ...identities.map((identity) => {
      const from = sources.get(identity) ?? new Set<Source>();
      const named = SOURCE_ORDER.filter((source) => from.has(source));
      return `${visible(identity)}: ${named.join(", ")}`;
    }),
    ...unnamed.map(visible),
    overrides.length === 0
      ? "No environment variable overrides the git identity."
      : `Set in the environment: ${overrides.map(([name, value]) => `${name}=${visible(value)}`).join(", ")}`,
  ];
  const code = createHash("sha256")
    .update(JSON.stringify({ identities, overrides }))
    .digest("hex")
    .slice(0, 12);
  return { ok: true, value: { lines, code } };
}

/** The disclosure, for a question or a stop. */
export function identitiesText(identities: PushIdentities): string {
  return (
    "Pushing publishes every commit's author and committer name and email, " +
    `and its co-authors. These would become public (code ${identities.code}):\n` +
    identities.lines.map((line) => `  ${line}\n`).join("")
  );
}
