// Measures how big a pull request is: source lines and test lines changed,
// and files touched, between the merge base of two refs and the head. Reads
// `git diff` only through the git seam.
//
// Test lines are counted apart from source lines because a well-tested
// change is bigger than an untested one, and one limit for both would
// reward leaving the tests out. A file is a test by its name alone (see
// `isTestPath`), so moving code into a folder can't move it out of the
// source count.
//
// What does not count, so the number reflects what a reviewer reads:
//   - lockfiles (the same list the file-length cap skips): a dependency
//     change rewrites them wholesale and nobody reviews them line by line;
//   - generated files, marked the standard way with the `linguist-generated`
//     git attribute (GitHub hides those from the diff view too), so a
//     project opts a file out in .gitattributes, not in a list here;
//   - pure renames: a moved file with no edits changes no content.
// A rename that is also edited counts its edited lines, once, as source or
// test by its new name.

import path from "node:path";
import type { Context } from "../context.ts";
import { LOCKFILE_NAMES } from "../gate/lengths.ts";

export interface DiffSize {
  /** Lines added plus deleted in files that aren't tests. */
  readonly sourceLines: number;
  /** Lines added plus deleted in test files. */
  readonly testLines: number;
  /** Files touched, source and test together. */
  readonly filesTouched: number;
}

/** A test file's name: `*.test.*` or `*.spec.*`. */
const TEST_NAME = /\.(?:test|spec)\.[^/]+$/;

/** True for a test file, judged by its path as git writes it (`/` between
 * folders): a name like `*.test.*` or `*.spec.*`, anything under a
 * `__tests__` folder, or a `.snap` snapshot. Folders such as `fixtures/`,
 * `test/` or `testing/` don't make a file a test: they often hold real code
 * the tests share, and that is reviewed like any other source. */
export function isTestPath(file: string): boolean {
  const basename = path.posix.basename(file);
  return (
    TEST_NAME.test(basename) ||
    path.posix.extname(basename) === ".snap" ||
    path.posix.dirname(file).split("/").includes("__tests__")
  );
}

interface NumstatEntry {
  readonly path: string;
  /** Added plus deleted; 0 for a binary file, which git reports as "-". */
  readonly lines: number;
  readonly renamed: boolean;
}

/** Parses `git diff --numstat -z` output. A plain entry is
 * "added\tdeleted\tpath\0"; a rename is "added\tdeleted\t\0old\0new\0". */
export function parseNumstat(output: string): NumstatEntry[] {
  const fields = output.split("\0");
  const entries: NumstatEntry[] = [];
  let index = 0;
  while (index < fields.length) {
    const head = fields[index++];
    if (head === undefined || head === "") {
      continue;
    }
    const [added = "", deleted = "", inlinePath = ""] = head.split("\t");
    const lines = (Number(added) || 0) + (Number(deleted) || 0);
    if (inlinePath === "") {
      index++; // the old name; only the new one matters
      const renamedTo = fields[index++] ?? "";
      entries.push({ path: renamedTo, lines, renamed: true });
    } else {
      entries.push({ path: inlinePath, lines, renamed: false });
    }
  }
  return entries;
}

async function findGeneratedPaths(
  ctx: Context,
  paths: readonly string[],
): Promise<Set<string>> {
  const generated = new Set<string>();
  if (paths.length === 0) {
    return generated;
  }
  const result = await ctx.git.run(
    ["check-attr", "-z", "linguist-generated", "--", ...paths],
    ctx.cwd,
  );
  if (result.code !== 0) {
    throw new Error(
      `git check-attr failed: ${result.stderr.trim() || "no output"}`,
    );
  }
  // Output is "path\0attribute\0value\0" repeated.
  const fields = result.stdout.split("\0");
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const [file, , value] = [fields[i], fields[i + 1], fields[i + 2]];
    if (file !== undefined && (value === "set" || value === "true")) {
      generated.add(file);
    }
  }
  return generated;
}

/** Sizes the change from the merge base of `base` and `head` to `head`. */
export async function measureDiff(
  ctx: Context,
  base: string,
  head: string,
): Promise<DiffSize> {
  const result = await ctx.git.run(
    ["diff", "--numstat", "-z", "--find-renames", `${base}...${head}`, "--"],
    ctx.cwd,
  );
  if (result.code !== 0) {
    throw new Error(
      `git diff ${base}...${head} failed: ${result.stderr.trim() || "no output"}`,
    );
  }
  const counted = parseNumstat(result.stdout).filter(
    (entry) =>
      !(entry.renamed && entry.lines === 0) &&
      !LOCKFILE_NAMES.has(path.basename(entry.path)),
  );
  const generated = await findGeneratedPaths(
    ctx,
    counted.map((entry) => entry.path),
  );
  const kept = counted.filter((entry) => !generated.has(entry.path));
  let sourceLines = 0;
  let testLines = 0;
  for (const entry of kept) {
    if (isTestPath(entry.path)) {
      testLines += entry.lines;
    } else {
      sourceLines += entry.lines;
    }
  }
  return { sourceLines, testLines, filesTouched: kept.length };
}
