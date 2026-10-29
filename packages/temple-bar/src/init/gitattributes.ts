// Gives a project LF line endings in every checkout. Git for Windows installs
// with core.autocrlf=true, so without attributes a fresh Windows clone has
// CRLF in every text file, and the gate's format check (Prettier writes LF)
// fails before anyone has changed anything. Setup writes the file only when
// the project has none: appending a line would override the project's own
// rules, since a later line wins. An existing file is left alone, and git
// itself is asked whether it already gives LF, because a later line can undo
// an earlier one and reading the lines can't tell. Only what a clone gets
// counts: the global attributes file is switched off for the question, and
// local rules in .git/info/attributes make the answer unknown.

import path from "node:path";

import type { Context } from "../context.ts";
import { JUDGE_WORKFLOW_PATH } from "../judge/workflow.ts";
import { COMPANION_FILES } from "./companion-docs.ts";
import { PRETTIER_IGNORE_PATH } from "./prettier-ignore.ts";
import { CHECKED_WORKFLOWS } from "./workflows.ts";
import type { WriteTargets } from "./write-target.ts";

export const GITATTRIBUTES_PATH = ".gitattributes";

/** The one line setup writes, and the one it tells a project to add. */
export const LF_LINE = "* text=auto eol=lf";

/** Paths asked about: every text file setup writes, and two standing for a
 * project's sources. They needn't exist: git resolves attributes by name. */
export const PROBE_PATHS: readonly string[] = [
  ...new Set([
    "AGENTS.md",
    ...COMPANION_FILES.map((file) => file.path),
    "package.json",
    "pnpm-lock.yaml",
    ".gitignore",
    PRETTIER_IGNORE_PATH,
    GITATTRIBUTES_PATH,
    JUDGE_WORKFLOW_PATH,
    ...CHECKED_WORKFLOWS.map((file) => file.path),
    "src/index.ts",
    "src/index.js",
  ]),
];

/** How many files stored with CRLF the report names before "and N more". */
const CRLF_SHOWN = 3;

export type GitattributesOutcome = AttributesAnswer & {
  /** Tracked files whose committed content has CRLF line endings (as
   * `git ls-files --eol` reports, `i/crlf` or `i/mixed`): attributes don't
   * convert what is already stored, so these need renormalising whatever
   * the attributes say. */
  readonly committedCrlf: readonly string[];
};

type AttributesAnswer =
  /** No file was there; setup wrote one holding LF_LINE. */
  | { readonly kind: "wrote" }
  /** The project's attributes already give every probed path LF. */
  | { readonly kind: "gives-lf" }
  /** Git says a probed path doesn't get LF. */
  | { readonly kind: "no-lf"; readonly path: string }
  /** Git couldn't say, so the line may be needed. */
  | { readonly kind: "unknown"; readonly detail: string }
  /** Setup refused to write through the path; reported when found. */
  | { readonly kind: "refused" };

/** What git resolved for one path: `text` and `eol`, as check-attr prints
 * them (`set`, `unset`, `unspecified`, or a value). */
type Resolved = Map<string, { text?: string; eol?: string }>;

/** Reads `git check-attr -z` output: path, attribute and value, each ended
 * by NUL. Undefined when it isn't exactly that. */
function parseCheckAttr(stdout: string): Resolved | undefined {
  const fields = stdout.split("\0");
  if (fields.pop() !== "" || fields.length % 3 !== 0) return undefined;
  const resolved: Resolved = new Map();
  for (let i = 0; i < fields.length; i += 3) {
    const [file, attr, value] = fields.slice(i, i + 3);
    if (file === undefined || value === undefined) return undefined;
    const entry = resolved.get(file) ?? {};
    if (attr === "text") entry.text = value;
    else if (attr === "eol") entry.eol = value;
    else return undefined;
    resolved.set(file, entry);
  }
  return resolved;
}

/**
 * Whether git checks each probed path out with LF. A path gets LF when its
 * `eol` is `lf` and its `text` isn't unset: git ignores `eol` on a path
 * marked `-text`, and without `eol=lf` core.autocrlf decides. Asks git, so
 * every source of attributes counts (nested files, .git/info/attributes,
 * core.attributesFile) and a later line undoing an earlier one is seen.
 */
async function checkLf(
  ctx: Context,
  repoRoot: string,
): Promise<AttributesAnswer> {
  const local = await localRules(ctx, repoRoot);
  if (local !== undefined) return { kind: "unknown", detail: local };
  // An empty core.attributesFile switches the global file off; system
  // attributes can only be switched off by an environment variable, which
  // the git seam doesn't pass.
  const result = await ctx.git.run(
    [
      "-c",
      "core.attributesFile=",
      "check-attr",
      "-z",
      "text",
      "eol",
      "--",
      ...PROBE_PATHS,
    ],
    repoRoot,
  );
  if (result.code !== 0) {
    const stderr = result.stderr.trim();
    return {
      kind: "unknown",
      detail: stderr === "" ? `git exited ${String(result.code)}` : stderr,
    };
  }
  const resolved = parseCheckAttr(result.stdout);
  for (const probe of PROBE_PATHS) {
    const entry = resolved?.get(probe);
    if (entry?.text === undefined || entry.eol === undefined) {
      return { kind: "unknown", detail: "git's answer couldn't be read" };
    }
    if (entry.eol !== "lf" || entry.text === "unset") {
      return { kind: "no-lf", path: probe };
    }
  }
  return { kind: "gives-lf" };
}

/** Why rules in .git/info/attributes, which a clone doesn't get, make
 * git's answer untrustworthy, or undefined when there are none. git can't
 * be told to skip that file, so any line that isn't blank or a comment
 * counts. Not finding the file's path is unknown too. */
async function localRules(
  ctx: Context,
  repoRoot: string,
): Promise<string | undefined> {
  const where = await ctx.git.run(
    ["rev-parse", "--git-path", "info/attributes"],
    repoRoot,
  );
  const relative = where.stdout.replace(/\r?\n$/, "");
  if (where.code !== 0 || relative === "") {
    return "couldn't find .git/info/attributes";
  }
  // Relative to repoRoot in the main worktree, absolute in a linked one.
  // Joined, not resolved: path.resolve would put the current drive in front
  // of the path on Windows.
  const file = path.isAbsolute(relative)
    ? relative
    : path.join(repoRoot, relative);
  // An optional check: a file that can't be read (a folder, no permission)
  // makes the answer unknown, never stops setup.
  let content: string | undefined;
  try {
    content = await ctx.fs.readText(file);
  } catch {
    return "couldn't read .git/info/attributes";
  }
  const rules = (content ?? "")
    .split(/\r?\n/)
    .some((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
  return rules
    ? ".git/info/attributes has rules of its own, which a clone doesn't get"
    : undefined;
}

/** Tracked files stored with CRLF, from `git ls-files --eol -z`: each
 * record is `i/<eol> w/<eol> attr/<attrs>`, a tab, then the path. A file
 * whose attributes say `-text` (marked so on purpose, or `binary`) is
 * skipped: renormalising leaves it as it is, so naming it would be advice
 * that can't be followed. Attributes are read as a clone gets them, without
 * the global file. An answer git can't give, or that can't be read, names
 * none: this is advice beside the attributes report, never a reason to
 * fail. */
async function committedCrlf(
  ctx: Context,
  repoRoot: string,
): Promise<readonly string[]> {
  const result = await ctx.git.run(
    ["-c", "core.attributesFile=", "ls-files", "--eol", "-z"],
    repoRoot,
  );
  if (result.code !== 0) return [];
  return result.stdout.split("\0").flatMap((record) => {
    const match = /^i\/(\S*)\s+w\/\S*\s+attr\/([^\t]*)\t([\s\S]+)$/.exec(
      record,
    );
    const [, stored, attrs, file] = match ?? [];
    const renormalisable = !(attrs ?? "").split(/\s+/).includes("-text");
    return file !== undefined &&
      (stored === "crlf" || stored === "mixed") &&
      renormalisable
      ? [file]
      : [];
  });
}

/** Writes .gitattributes when the project has none; otherwise leaves it
 * alone and asks git whether it gives LF. Either way, names files already
 * committed with CRLF. A second run writes nothing. */
export async function ensureGitattributes(
  ctx: Context,
  repoRoot: string,
  targets: WriteTargets,
): Promise<GitattributesOutcome> {
  const existing = await targets.readText(GITATTRIBUTES_PATH);
  if (targets.refusals.has(GITATTRIBUTES_PATH)) {
    return { kind: "refused", committedCrlf: [] };
  }
  const answer: AttributesAnswer =
    existing !== undefined
      ? await checkLf(ctx, repoRoot)
      : (await targets.writeText(GITATTRIBUTES_PATH, `${LF_LINE}\n`))
        ? { kind: "wrote" }
        : { kind: "refused" };
  if (answer.kind === "refused") return { ...answer, committedCrlf: [] };
  return { ...answer, committedCrlf: await committedCrlf(ctx, repoRoot) };
}

/** What an existing checkout needs once the line is committed: attributes
 * don't rewrite files already checked out, and a file committed with CRLF
 * stays that way until it is stored again. */
const CHECKOUT_STEPS =
  "A new attributes line doesn't change files already checked out. Once it's committed:\n" +
  "  git add --renormalize .  (then commit: stores any file committed with CRLF as LF)\n" +
  "  git rm --cached -r . && git reset --hard  (in each existing Windows clone, after committing its work: checks every file out again; a fresh clone works too)\n";

const RENORMALIZE = "  git add --renormalize .\n";

/** The files committed with CRLF, a few by name. */
function describeCommittedCrlf(paths: readonly string[]): string {
  if (paths.length === 0) return "";
  const shown = paths.slice(0, CRLF_SHOWN).join(", ");
  const more =
    paths.length > CRLF_SHOWN
      ? ` and ${String(paths.length - CRLF_SHOWN)} more`
      : "";
  return (
    `${String(paths.length)} tracked file(s) are stored with CRLF line endings (${shown}${more}), ` +
    "and attributes don't convert what's already committed. Store them with LF, then commit:\n"
  );
}

/** Setup's lines about .gitattributes: what it did, the line to add when
 * one may be needed, the checkout steps whenever a line is new or may be,
 * and the files already stored with CRLF. Nothing here fails the run: the
 * gate still runs on LF checkouts. */
export function describeGitattributes(outcome: GitattributesOutcome): string {
  const crlf = describeCommittedCrlf(outcome.committedCrlf);
  switch (outcome.kind) {
    case "refused":
      return "";
    case "gives-lf":
      return (
        `${GITATTRIBUTES_PATH} gives the files setup writes LF line endings; left it alone.\n` +
        (crlf === "" ? "" : crlf + RENORMALIZE)
      );
    case "wrote":
      return (
        `Wrote ${GITATTRIBUTES_PATH} (${LF_LINE}), so every clone, Windows included, checks text files out with LF.\n` +
        crlf +
        CHECKOUT_STEPS
      );
    case "no-lf":
      return (
        `${GITATTRIBUTES_PATH} doesn't give ${outcome.path} LF line endings, so a Windows clone can fail the gate's format check; left it alone. ` +
        `Add this line, after any line that would undo it, and \`git check-attr text eol -- ${outcome.path}\` should then say eol: lf:\n` +
        `  ${LF_LINE}\n` +
        crlf +
        CHECKOUT_STEPS
      );
    case "unknown":
      return (
        `Couldn't tell whether ${GITATTRIBUTES_PATH} gives text files LF line endings (${outcome.detail}); left it alone. ` +
        "This line may be needed:\n" +
        `  ${LF_LINE}\n` +
        crlf +
        CHECKOUT_STEPS
      );
  }
}
