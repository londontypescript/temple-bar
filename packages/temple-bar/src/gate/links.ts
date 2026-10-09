// Local navigable links must point to Git-listed repository content.
// Inline code mentions examples and optional paths without asserting that
// those files exist. Web links never depend on a network request here.

import path from "node:path";

import type { Context } from "../context.ts";
import { extractLocalTargets } from "./links-parse.ts";

export { extractLocalTargets } from "./links-parse.ts";

export const LINKS_CHECK = "local links";

export interface LocalTarget {
  readonly line: number;
  readonly target: string;
  readonly kind: "link";
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

/** A bare fragment names no file; every other local target must exist. */
function isFine(
  existing: ReadonlySet<string>,
  file: string,
  target: LocalTarget,
): boolean {
  const resolved = resolveLink(file, target.target);
  return resolved === undefined || pathExists(existing, resolved);
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
  return {
    broken: findBrokenTargets(documents, listed),
    documents: documents.length,
  };
}

export function formatBrokenLinks(broken: readonly BrokenTarget[]): string {
  const lines = [
    `gate: ${String(broken.length)} local link(s) name nothing in the repo:`,
  ];
  for (const { file, line, kind, target } of broken) {
    lines.push(`  ${file}:${String(line)}: ${kind} ${target}`);
  }
  lines.push(
    "  point each one at the file's current path, or remove it if the file is gone",
  );
  return `${lines.join("\n")}\n`;
}
