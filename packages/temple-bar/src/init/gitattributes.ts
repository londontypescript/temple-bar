// Gives a project LF line endings in every checkout. Git for Windows installs
// with core.autocrlf=true, so without attributes a fresh Windows clone has
// CRLF in every text file, and the gate's format check (Prettier writes LF)
// fails before anyone has changed anything. Setup writes the file only when
// the project has none: appending a line would override the project's own
// rules, since a later line wins. An existing file is left alone, and git
// itself is asked whether it already gives LF, because a later line can undo
// an earlier one and reading the lines can't tell.

import type { Context } from "../context.ts";
import type { WriteTargets } from "./write-target.ts";

export const GITATTRIBUTES_PATH = ".gitattributes";

/** The one line setup writes, and the one it tells a project to add. */
export const LF_LINE = "* text=auto eol=lf";

/** Paths asked about, standing for the text files setup writes and a
 * project's sources. They needn't exist: git resolves attributes by name. */
export const PROBE_PATHS: readonly string[] = [
  "AGENTS.md",
  "package.json",
  "pnpm-lock.yaml",
  ".gitignore",
  ".github/workflows/temple-bar-gate.yml",
  "src/index.ts",
  "src/index.js",
];

export type GitattributesOutcome =
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
): Promise<GitattributesOutcome> {
  const result = await ctx.git.run(
    ["check-attr", "-z", "text", "eol", "--", ...PROBE_PATHS],
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

/** Writes .gitattributes when the project has none; otherwise leaves it
 * alone and asks git whether it gives LF. A second run writes nothing. */
export async function ensureGitattributes(
  ctx: Context,
  repoRoot: string,
  targets: WriteTargets,
): Promise<GitattributesOutcome> {
  const existing = await targets.readText(GITATTRIBUTES_PATH);
  if (targets.refusals.has(GITATTRIBUTES_PATH)) return { kind: "refused" };
  if (existing === undefined) {
    return (await targets.writeText(GITATTRIBUTES_PATH, `${LF_LINE}\n`))
      ? { kind: "wrote" }
      : { kind: "refused" };
  }
  return checkLf(ctx, repoRoot);
}

/** What an existing checkout needs once the line is committed: attributes
 * don't rewrite files already checked out, and a file committed with CRLF
 * stays that way until it is stored again. */
const CHECKOUT_STEPS =
  "A new attributes line doesn't change files already checked out. Once it's committed:\n" +
  "  git add --renormalize .  (then commit: stores any file committed with CRLF as LF)\n" +
  "  git rm --cached -r . && git reset --hard  (in each existing Windows clone, after committing its work: checks every file out again; a fresh clone works too)\n";

/** Setup's lines about .gitattributes: what it did, the line to add when
 * one may be needed, and the checkout steps whenever a line is new or may
 * be. Nothing here fails the run: the gate still runs on LF checkouts. */
export function describeGitattributes(outcome: GitattributesOutcome): string {
  switch (outcome.kind) {
    case "refused":
      return "";
    case "gives-lf":
      return `${GITATTRIBUTES_PATH} already gives text files LF line endings; left it alone.\n`;
    case "wrote":
      return (
        `Wrote ${GITATTRIBUTES_PATH} (${LF_LINE}), so every clone, Windows included, checks text files out with LF.\n` +
        CHECKOUT_STEPS
      );
    case "no-lf":
      return (
        `${GITATTRIBUTES_PATH} doesn't give ${outcome.path} LF line endings, so a Windows clone can fail the gate's format check; left it alone. ` +
        `Add this line, after any line that would undo it, and \`git check-attr text eol -- ${outcome.path}\` should then say eol: lf:\n` +
        `  ${LF_LINE}\n` +
        CHECKOUT_STEPS
      );
    case "unknown":
      return (
        `Couldn't ask git whether ${GITATTRIBUTES_PATH} gives text files LF line endings (${outcome.detail}); left it alone. ` +
        "This line may be needed:\n" +
        `  ${LF_LINE}\n` +
        CHECKOUT_STEPS
      );
  }
}
