// The one place that reads a project's temple-bar.config.json. Every check
// that has a limit (the file-length cap, the pull request size warning) gets
// it from here, so a key's name, its default and its validation live in one
// spot and a broken file is reported the same way everywhere.

import path from "node:path";
import type { Context } from "../context.ts";

export const CONFIG_FILE_NAME = "temple-bar.config.json";

export interface ProjectConfig {
  /** Longest a tracked text file may be, in lines. */
  readonly maxFileLines: number;
  /** Most lines (added plus deleted) one pull request should change. */
  readonly maxPullRequestLines: number;
  /** Most files one pull request should touch. */
  readonly maxPullRequestFiles: number;
}

/**
 * Defaults, used for any key a project's config leaves out. They are the
 * only place in src/ (tests included) that hardcodes these numbers; tests
 * read a fixture config or pass their own number.
 *
 * The pull request limits follow common review guidance (past a few hundred
 * lines, reviewers start to miss things) and fit this repo's own history: a
 * typical pull request changed about 140 lines across 4 files, and these
 * limits flagged only the few that really were too big.
 */
export const DEFAULT_CONFIG: ProjectConfig = {
  maxFileLines: 400,
  maxPullRequestLines: 500,
  maxPullRequestFiles: 15,
};

export const DEFAULT_MAX_FILE_LINES = DEFAULT_CONFIG.maxFileLines;

function readLimit(
  object: object,
  key: keyof ProjectConfig,
): number | undefined {
  if (!(key in object)) {
    return undefined;
  }
  const value: unknown = (object as Record<string, unknown>)[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(
      `${CONFIG_FILE_NAME}: "${key}" must be a positive whole number`,
    );
  }
  return value;
}

function parseProjectConfig(value: unknown): ProjectConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${CONFIG_FILE_NAME} must contain a JSON object`);
  }
  return {
    maxFileLines:
      readLimit(value, "maxFileLines") ?? DEFAULT_CONFIG.maxFileLines,
    maxPullRequestLines:
      readLimit(value, "maxPullRequestLines") ??
      DEFAULT_CONFIG.maxPullRequestLines,
    maxPullRequestFiles:
      readLimit(value, "maxPullRequestFiles") ??
      DEFAULT_CONFIG.maxPullRequestFiles,
  };
}

/** Reads the project's config; a missing file means all defaults. A file that
 * can't be read is an error, never a silent fallback: falling back could
 * quietly loosen a limit the project set. */
export async function readProjectConfig(ctx: Context): Promise<ProjectConfig> {
  const raw = await ctx.fs.readText(path.join(ctx.cwd, CONFIG_FILE_NAME));
  if (raw === undefined) {
    return DEFAULT_CONFIG;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${CONFIG_FILE_NAME} is not valid JSON`);
  }
  return parseProjectConfig(parsed);
}
