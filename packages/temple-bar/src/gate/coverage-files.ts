// Which files the coverage check (coverage.ts) requires: every tracked file
// an outcome asks for that is the project's own content (see isOwnContent:
// not vendored or built output), is on disk, and isn't excluded.
//
// An exclusion is an exact path, or a folder ending in "/" that matches a
// path's leading folders whole (`src/foo/` takes `src/foo/a.ts`, never
// `src/foo-bar/a.ts`), both "/"-separated from the root. No globs: a glob
// could quietly take more than meant. An exclusion that matches nothing is
// counted, never a failure: deleting a file mustn't force an edit to a
// file only the maintainer may merge.

import path from "node:path";

import type { Context } from "../context.ts";
import { isOwnContent } from "./stack.ts";

/** A file the check requires: its git path, for messages and for saying
 * whose it is, and its real path, which listings are compared on. Real
 * paths settle a tracked link and a name git spells in another letter case
 * than the disk; they are never lower-cased, since a case-sensitive disk
 * can hold both spellings. */
export interface Obligation {
  readonly path: string;
  readonly real: string;
}

function excludes(exclusion: string, file: string): boolean {
  return exclusion.endsWith("/")
    ? file.startsWith(exclusion)
    : file === exclusion;
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** The files `requires` takes from `listed` (git's paths), in byte order,
 * and how many the exclusions took out. */
export async function requiredFiles(
  ctx: Context,
  listed: readonly string[],
  requires: (file: string) => boolean,
  exclusions: readonly string[],
): Promise<{ readonly required: Obligation[]; readonly excluded: number }> {
  const candidates = listed.filter(
    (file) => isOwnContent(file) && requires(file),
  );
  const kept = candidates.filter(
    (file) => !exclusions.some((exclusion) => excludes(exclusion, file)),
  );
  const required: Obligation[] = [];
  for (const file of kept) {
    try {
      required.push({
        path: file,
        real: await ctx.fs.realpath(path.join(ctx.cwd, ...file.split("/"))),
      });
    } catch (error) {
      // Git also lists a file a staged rename has moved away.
      const code =
        error instanceof Error && "code" in error ? error.code : undefined;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw error;
      }
    }
  }
  return {
    required: required.sort((a, b) => byteOrder(a.path, b.path)),
    excluded: candidates.length - kept.length,
  };
}

/** Said after an outcome's detail when there are exclusions: how many,
 * and how many match no path git lists. */
export function exclusionSummary(
  listed: readonly string[],
  exclusions: readonly string[],
): string {
  if (exclusions.length === 0) {
    return "";
  }
  const unmatched = exclusions.filter(
    (exclusion) => !listed.some((file) => excludes(exclusion, file)),
  ).length;
  return `; ${String(exclusions.length)} exclusion(s)${
    unmatched === 0 ? "" : `, ${String(unmatched)} matching nothing`
  }`;
}
