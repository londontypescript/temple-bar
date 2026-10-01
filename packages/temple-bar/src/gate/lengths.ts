// The gate's file-length cap (base check, always runs — AGENTS.md §5,
// P3.1). Ported by hand from this repo's own scripts/lengths.ts rather than
// imported: that script is this repo's own tooling for gating itself before
// a published gate exists, and it is deleted once this module replaces it at
// 1.10 (see AGENTS.md §0). This version reads through Context's existing git
// and fs seams instead of touching node:child_process/node:fs directly, so
// no new seam was needed for it (only `proc`, for running stack scripts).

import path from "node:path";
import type { Context } from "../context.ts";

/**
 * The package's default file-length cap, used when a project has no
 * temple-bar.config.json or no "maxFileLines" key in it. This is the only
 * place in src/ (tests included) that hardcodes a max-file-lines number;
 * tests that need a cap read it from a fixture config or pass their own
 * number to findOverCapFiles directly.
 */
export const DEFAULT_MAX_FILE_LINES = 400;

const CONFIG_FILE_NAME = "temple-bar.config.json";

const LOCKFILE_NAMES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
]);

export interface FileLineCount {
  readonly path: string;
  readonly lines: number;
}

/**
 * Lists every path `git ls-files` would track (tracked plus untracked,
 * unignored), relative to `ctx.cwd`. Shared by the length cap and the
 * stack's "does code exist" check so both see the same file set.
 *
 * P3.7: a nested worktree or nested repo is never recursed into — git lists
 * it as a single directory entry ending in "/" instead — and anything under
 * `.git/` is never listed at all, so both are already excluded here, not
 * specially handled by callers.
 */
export async function listGitPaths(ctx: Context): Promise<string[]> {
  const result = await ctx.git.run(
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    ctx.cwd,
  );
  if (result.code !== 0) {
    // Never read a failed listing as "no files": that would pass the gate
    // without checking anything.
    throw new Error(
      `git ls-files failed in ${ctx.cwd}: ${result.stderr.trim() || "no output"}`,
    );
  }
  return result.stdout.split("\n").filter((line) => line.length > 0);
}

/** True for a directory entry (see listGitPaths) and for known lockfiles,
 * both of which the length cap skips. */
export function isSkippableLengthPath(relativePath: string): boolean {
  if (relativePath.endsWith("/")) {
    return true;
  }
  return LOCKFILE_NAMES.has(path.basename(relativePath));
}

/** A NUL byte only ever appears in binary content; a single 0x00 byte
 * decodes losslessly to U+0000 in UTF-8, so this still works on content
 * read as text. */
export function looksBinary(content: string): boolean {
  return content.includes("\0");
}

/** Counts lines the way a human would: a trailing newline doesn't count as
 * an extra blank line. */
export function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  const normalized = content.endsWith("\n") ? content.slice(0, -1) : content;
  return normalized.split("\n").length;
}

/** Pure: given line counts and a cap, returns the entries over the cap,
 * longest first. */
export function findOverCapFiles(
  entries: readonly FileLineCount[],
  maxLines: number,
): FileLineCount[] {
  return entries
    .filter((entry) => entry.lines > maxLines)
    .sort((a, b) => b.lines - a.lines);
}

export async function collectLineCounts(
  ctx: Context,
): Promise<FileLineCount[]> {
  const results: FileLineCount[] = [];
  for (const relativePath of await listGitPaths(ctx)) {
    if (isSkippableLengthPath(relativePath)) {
      continue;
    }
    const fullPath = path.join(ctx.cwd, relativePath);
    // A symlink isn't a text file of the repo's own: reading it would either
    // fail (a link to a directory) or count some other file's lines twice.
    if (!(await ctx.fs.isRegularFile(fullPath))) {
      continue;
    }
    const content = await ctx.fs.readText(fullPath);
    if (content === undefined) {
      // Listed by git (e.g. a staged rename) but no longer on disk.
      continue;
    }
    if (looksBinary(content)) {
      continue;
    }
    results.push({ path: relativePath, lines: countLines(content) });
  }
  return results;
}

function readConfigCap(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${CONFIG_FILE_NAME} must contain a JSON object`);
  }
  if (!("maxFileLines" in value)) {
    return undefined;
  }
  const cap = value.maxFileLines;
  if (typeof cap !== "number" || !Number.isInteger(cap) || cap < 1) {
    throw new Error(
      `${CONFIG_FILE_NAME}: "maxFileLines" must be a positive whole number`,
    );
  }
  return cap;
}

export async function readMaxFileLines(ctx: Context): Promise<number> {
  const raw = await ctx.fs.readText(path.join(ctx.cwd, CONFIG_FILE_NAME));
  if (raw === undefined) {
    return DEFAULT_MAX_FILE_LINES;
  }
  // A config that can't be read is an error, never a silent fallback: falling
  // back could quietly loosen the cap the project set.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${CONFIG_FILE_NAME} is not valid JSON`);
  }
  return readConfigCap(parsed) ?? DEFAULT_MAX_FILE_LINES;
}

export interface LengthCheckResult {
  readonly offenders: readonly FileLineCount[];
  readonly totalChecked: number;
  readonly maxLines: number;
}

export async function checkFileLengths(
  ctx: Context,
): Promise<LengthCheckResult> {
  const maxLines = await readMaxFileLines(ctx);
  const entries = await collectLineCounts(ctx);
  const offenders = findOverCapFiles(entries, maxLines);
  return { offenders, totalChecked: entries.length, maxLines };
}

export function formatLengthFailure(result: LengthCheckResult): string {
  const lines = [
    `gate: ${String(result.offenders.length)} file(s) exceed the ${String(result.maxLines)}-line cap:`,
  ];
  for (const offender of result.offenders) {
    lines.push(`  ${offender.path}: ${String(offender.lines)} lines`);
  }
  return `${lines.join("\n")}\n`;
}
