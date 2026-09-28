// File-length rule for this repo (AGENTS.md §5): the cap lives only in
// temple-bar.config.json. Checks every text file git tracks or would track,
// using only Node built-ins. The command is scripts/check-lengths.ts.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export interface FileLineCount {
  path: string;
  lines: number;
}

const LOCKFILE_NAMES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
]);

const BINARY_SNIFF_BYTES = 8000;

/** True for lockfiles and files that look binary (a NUL byte in the first
 * BINARY_SNIFF_BYTES bytes), both of which are skipped by the checker. */
export function isSkippable(filePath: string, content: Buffer): boolean {
  if (LOCKFILE_NAMES.has(path.basename(filePath))) {
    return true;
  }
  const sample = content.subarray(0, BINARY_SNIFF_BYTES);
  return sample.includes(0);
}

/** Counts lines the way a human would: a trailing newline doesn't count
 * as an extra blank line. */
export function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  const normalized = content.endsWith("\n") ? content.slice(0, -1) : content;
  return normalized.split("\n").length;
}

/** Pure: given line counts and a cap, returns the entries over the cap,
 * longest first. Covered directly by lengths.test.ts so the rule
 * itself is tested without touching the filesystem or git. */
export function findOverCapFiles(
  entries: readonly FileLineCount[],
  maxLines: number,
): FileLineCount[] {
  return entries
    .filter((entry) => entry.lines > maxLines)
    .sort((a, b) => b.lines - a.lines);
}

function listCandidateFiles(cwd: string): string[] {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd, encoding: "utf8" },
  );
  return output.split("\n").filter((line) => line.length > 0);
}

export function collectLineCounts(cwd: string): FileLineCount[] {
  const results: FileLineCount[] = [];
  for (const relativePath of listCandidateFiles(cwd)) {
    let buffer: Buffer;
    try {
      buffer = readFileSync(path.join(cwd, relativePath));
    } catch {
      // Listed by git (e.g. a staged rename) but no longer on disk.
      continue;
    }
    if (isSkippable(relativePath, buffer)) {
      continue;
    }
    results.push({
      path: relativePath,
      lines: countLines(buffer.toString("utf8")),
    });
  }
  return results;
}

function isConfigWithMaxFileLines(
  value: unknown,
): value is { maxFileLines: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "maxFileLines" in value &&
    typeof value.maxFileLines === "number"
  );
}

export function readMaxFileLines(cwd: string): number {
  const configPath = path.join(cwd, "temple-bar.config.json");
  const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  if (!isConfigWithMaxFileLines(parsed)) {
    throw new Error(`${configPath} must contain a numeric "maxFileLines"`);
  }
  return parsed.maxFileLines;
}
