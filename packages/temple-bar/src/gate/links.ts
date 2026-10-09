// The gate's local link check: every link in the repo's markdown that points
// inside the repo, and every path a document cites in `code`, must name
// something that exists. A README that points at a moved or deleted file is
// wrong for every reader, and nothing else notices.
//
// Only local targets are checked, never web links, so the gate never
// depends on the network (or on someone else's site being up) to pass.
//
// "Exists" means git lists it (tracked, or new and not ignored), the same
// file set every other check reads. Built output and other ignored files
// count as missing: they aren't there for someone reading the repo on
// GitHub or in a fresh clone, and they come and go between a laptop and CI.
//
// A cited path is a code span that looks like a path with a folder in it
// (`docs/adr/0007-what-the-gate-checks.md`), whose first folder exists. That
// keeps out things that only look like paths: a package name
// (`@scope/name`), an `owner/repo`, a git ref, or a path with a placeholder.
// A cited path that git ignores (`node_modules/...`, a local drafts folder)
// names local state, not the repo's content, so it isn't checked either.

import path from "node:path";

import type { Context } from "../context.ts";
import { extractLocalTargets } from "./links-parse.ts";

export { extractLocalTargets } from "./links-parse.ts";

export const LINKS_CHECK = "local links";

type TargetKind = "link" | "cited path";

export interface LocalTarget {
  readonly line: number;
  readonly target: string;
  readonly kind: TargetKind;
}

export interface BrokenTarget extends LocalTarget {
  /** The markdown file it appears in, relative to the repo root. */
  readonly file: string;
}

const MARKDOWN = /\.(?:md|markdown)$/i;

export function isMarkdownPath(relativePath: string): boolean {
  return MARKDOWN.test(relativePath);
}

/** Every path git lists, plus every folder above one, so a link to a folder
 * counts as existing. Folders end in "/". */
function existingPaths(listed: readonly string[]): Set<string> {
  const existing = new Set<string>();
  for (const listedPath of listed) {
    const parts = listedPath.replace(/\/$/, "").split("/");
    existing.add(parts.join("/"));
    for (let depth = 1; depth < parts.length; depth++) {
      existing.add(`${parts.slice(0, depth).join("/")}/`);
    }
  }
  return existing;
}

function pathExists(existing: ReadonlySet<string>, candidate: string): boolean {
  const bare = candidate.replace(/\/$/, "");
  return existing.has(bare) || existing.has(`${bare}/`);
}

/** Where a link points, relative to the repo root, or undefined when it
 * names no file (a bare #fragment). A leading "/" means the repo root, as
 * GitHub reads it. Goes above the root as "../...", which never exists. */
function resolveLink(file: string, target: string): string | undefined {
  let bare = target.replace(/[?#].*$/, "");
  try {
    bare = decodeURI(bare);
  } catch {
    // Not valid percent-encoding: check it as written.
  }
  if (bare === "") {
    return undefined;
  }
  const from = bare.startsWith("/") ? "" : path.posix.dirname(file);
  return path.posix.normalize(path.posix.join(from, bare.replace(/^\/+/, "")));
}

/** True when the target names something that exists. A cited path whose
 * first folder doesn't exist isn't treated as a path at all (it is an
 * `owner/repo`, a package or a ref), so it counts as fine. */
function isFine(
  existing: ReadonlySet<string>,
  file: string,
  target: LocalTarget,
): boolean {
  const resolved = resolveLink(file, target.target);
  if (resolved === undefined) {
    return true;
  }
  if (target.kind === "link") {
    return pathExists(existing, resolved);
  }
  // A document may cite a path from its own folder or from the repo root.
  // It is only treated as a path when its first folder exists in one of
  // them: `owner/repo` cited from docs/ must not count just because docs/
  // exists.
  const bases = [path.posix.dirname(file), ""];
  const cited = path.posix.normalize(target.target);
  if (
    bases.some((base) => pathExists(existing, path.posix.join(base, cited)))
  ) {
    return true;
  }
  const first = cited.split("/")[0] ?? "";
  return !bases.some((base) =>
    existing.has(`${path.posix.join(base, first)}/`),
  );
}

/** Pure: the targets in `documents` that name nothing in `listed`. */
export function findBrokenTargets(
  documents: readonly { file: string; content: string }[],
  listed: readonly string[],
): BrokenTarget[] {
  const existing = existingPaths(listed);
  return documents.flatMap(({ file, content }) =>
    extractLocalTargets(content)
      .filter((target) => !isFine(existing, file, target))
      .map((target) => ({ ...target, file })),
  );
}

/** The cited paths among `broken` that git ignores: those name local state
 * (a build folder, a drafts folder), not the repo's content. */
async function ignoredByGit(
  ctx: Context,
  broken: readonly BrokenTarget[],
): Promise<Set<string>> {
  const cited = [
    ...new Set(
      broken
        .filter((target) => target.kind === "cited path")
        .map((target) => target.target),
    ),
  ];
  if (cited.length === 0) {
    return new Set();
  }
  // Exit 1 means none is ignored; anything else listed on stdout is.
  const result = await ctx.git.run(
    ["check-ignore", "--no-index", "--", ...cited],
    ctx.cwd,
  );
  return new Set(
    result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
}

export interface LinkCheckResult {
  readonly broken: readonly BrokenTarget[];
  readonly documents: number;
}

export async function checkLocalLinks(
  ctx: Context,
  listed: readonly string[],
): Promise<LinkCheckResult> {
  const documents: { file: string; content: string }[] = [];
  for (const file of listed.filter(isMarkdownPath)) {
    const fullPath = path.join(ctx.cwd, file);
    if (!(await ctx.fs.isRegularFile(fullPath))) {
      continue;
    }
    const content = await ctx.fs.readText(fullPath);
    if (content !== undefined) {
      documents.push({ file, content });
    }
  }
  const candidates = findBrokenTargets(documents, listed);
  const ignored = await ignoredByGit(ctx, candidates);
  const broken = candidates.filter(
    (target) => target.kind === "link" || !ignored.has(target.target),
  );
  return { broken, documents: documents.length };
}

export function formatBrokenLinks(broken: readonly BrokenTarget[]): string {
  const lines = [
    `gate: ${String(broken.length)} local link(s) or cited path(s) name nothing in the repo:`,
  ];
  for (const { file, line, kind, target } of broken) {
    lines.push(`  ${file}:${String(line)}: ${kind} ${target}`);
  }
  lines.push(
    "  point each one at the file's current path, or remove it if the file is gone",
  );
  return `${lines.join("\n")}\n`;
}
