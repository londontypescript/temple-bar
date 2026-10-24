// The coverage check's test listings: which test files a test script's
// commands run.
//
// Vitest lists them itself: `vitest list <the run's own arguments>
// --filesOnly --json` reads the same config, projects and filters the run
// does and prints a JSON array of `{ "file": <absolute path> }`. `--json`
// must come last, or Vitest takes the next word as a file to write to. It
// needs Vitest 2.1 or later, which added `list`; an older one rejects it,
// and that is a failed listing.
//
// Node's test runner has no list mode, so its patterns are expanded the
// way it expands them, from the package's folder, skipping node_modules.
// A pattern the script names that matches nothing is a failed listing:
// Node runs nothing for it and still passes. With no patterns, Node runs
// files with its default test names, which a default that matches nothing
// is not a problem for.

import path from "node:path";

import {
  firstLine,
  type Listing,
  type ListingContext,
} from "./coverage-listing.ts";
import type { TestPart } from "./coverage-scripts.ts";

/** The names Node's test runner runs when given no patterns (probed on
 * Node 24 against a folder holding every kind of name). */
export const NODE_DEFAULT_PATTERNS: readonly string[] = [
  "**/*.test.{cjs,mjs,js,cts,mts,ts}",
  "**/*-test.?(c|m)[jt]s",
  "**/*_test.?(c|m)[jt]s",
  "**/test-*.?(c|m)[jt]s",
  "**/test.?(c|m)[jt]s",
  "**/test/**/*.?(c|m)[jt]s",
];

function isAbsoluteOn(platform: NodeJS.Platform, file: string): boolean {
  return (platform === "win32" ? path.win32 : path.posix).isAbsolute(file);
}

/** The absolute files `vitest list --json` printed, or what is wrong with
 * its output. */
function readVitestList(
  stdout: string,
  platform: NodeJS.Platform,
): string[] | { readonly problem: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { problem: "vitest list printed no JSON" };
  }
  if (!Array.isArray(parsed)) {
    return { problem: "vitest list printed no list" };
  }
  const files: string[] = [];
  for (const entry of parsed as unknown[]) {
    const file: unknown =
      typeof entry === "object" && entry !== null && "file" in entry
        ? entry.file
        : undefined;
    if (typeof file !== "string" || !isAbsoluteOn(platform, file)) {
      return {
        problem: `vitest list printed an entry without an absolute file: ${JSON.stringify(entry)}`,
      };
    }
    files.push(file);
  }
  return files;
}

function listVitest(
  lc: ListingContext,
  part: Extract<TestPart, { tool: "vitest" }>,
): Promise<Listing> {
  const args = ["list", ...part.args, "--filesOnly", "--json"];
  return lc.once(["vitest", ...args], part.text, "runs", async (key) => {
    const output = await lc.run("vitest", args);
    const listing = { key, command: part.text, where: lc.where };
    const read =
      output.code === 0
        ? readVitestList(output.stdout, lc.platform)
        : { problem: `exited with ${String(output.code)}` };
    if ("problem" in read) {
      return { ...listing, failure: firstLine(output.stderr) ?? read.problem };
    }
    const files = new Set<string>();
    for (const file of read) {
      files.add(await lc.real(file));
    }
    return { ...listing, files, note: `${String(files.size)} file(s)` };
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function listNode(
  lc: ListingContext,
  part: Extract<TestPart, { tool: "node" }>,
): Promise<Listing> {
  const given = part.patterns.length > 0;
  const patterns = given ? part.patterns : NODE_DEFAULT_PATTERNS;
  // Node's other options never change which files run, so the patterns
  // alone identify the listing.
  return lc.once(
    ["node", "--test", ...part.patterns],
    part.text,
    "runs",
    async (key) => {
      const listing = { key, command: part.text, where: lc.where };
      const found = new Set<string>();
      for (const pattern of patterns) {
        let matched: string[];
        try {
          matched = await lc.ctx.fs.glob(lc.folder, pattern);
        } catch (error) {
          return {
            ...listing,
            failure: `couldn't expand ${JSON.stringify(pattern)}: ${describe(error)}`,
          };
        }
        if (given && matched.length === 0) {
          return {
            ...listing,
            failure: `it names a pattern that matches no file: ${JSON.stringify(pattern)}`,
          };
        }
        for (const file of matched) {
          found.add(path.join(lc.folder, ...file.split("/")));
        }
      }
      const files = new Set<string>();
      for (const file of found) {
        files.add(await lc.real(file));
      }
      return { ...listing, files, note: `${String(files.size)} file(s)` };
    },
  );
}

/** The listing one command of a test script makes. */
export function listTests(
  lc: ListingContext,
  part: TestPart,
): Promise<Listing> {
  return part.tool === "vitest" ? listVitest(lc, part) : listNode(lc, part);
}
