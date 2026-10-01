// Env files for a new worktree. They hold secrets, so git ignores them and
// `git worktree add` leaves them behind; this copies them in from the
// primary checkout, then checks each against its committed `.example`
// template.
//
// Values are never printed or kept: what is reported is file names, and key
// names taken from the committed template, never anything read out of an
// env file except which keys it sets.
//
// Which files: every git-ignored file whose name starts with `.env` and
// doesn't end in `.example`, at the root or in any folder git doesn't ignore
// (so a monorepo package's own `.env` comes too, while anything under
// node_modules/ or dist/ doesn't). A file goes to the same path in the new
// worktree only when its folder exists on the new branch, and never over a
// file already there.

import path from "node:path";

import type { Context } from "../context.ts";

const EXAMPLE_SUFFIX = ".example";

export type EnvCopyOutcome =
  "copied" | "already-there" | "no-folder" | "not-a-file";

export interface EnvCopy {
  /** Relative to the repo root, with forward slashes. */
  readonly file: string;
  readonly outcome: EnvCopyOutcome;
}

export interface EnvKeyCheck {
  /** The env file, relative to the repo root. */
  readonly file: string;
  /** The committed template it was checked against. */
  readonly template: string;
  /** Keys the template lists that the env file doesn't set; empty when
   * none are missing. Undefined when the env file doesn't exist. */
  readonly missingKeys: readonly string[] | undefined;
}

function isEnvFileName(file: string): boolean {
  const name = path.posix.basename(file);
  return name.startsWith(".env") && !name.endsWith(EXAMPLE_SUFFIX);
}

function isEnvTemplateName(file: string): boolean {
  const name = path.posix.basename(file);
  return name.startsWith(".env") && name.endsWith(EXAMPLE_SUFFIX);
}

function splitNul(text: string): string[] {
  return text.split("\0").filter((entry) => entry !== "");
}

/** The env files git ignores in `checkout`, relative to its root. Ignored
 * folders are listed as one entry ending in "/" (`--directory`), so git
 * never walks node_modules/ to answer. */
async function ignoredEnvFiles(
  ctx: Context,
  checkout: string,
): Promise<string[]> {
  const result = await ctx.git.run(
    [
      "ls-files",
      "-z",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
    ],
    checkout,
  );
  if (result.code !== 0) {
    return [];
  }
  return splitNul(result.stdout)
    .filter((file) => !file.endsWith("/"))
    .filter(isEnvFileName)
    .sort();
}

/**
 * Copies each env file from `primary` into `worktree` (both checkout roots).
 * A failure to copy one file is thrown, not hidden: the caller reports it.
 */
export async function copyEnvFiles(
  ctx: Context,
  primary: string,
  worktree: string,
): Promise<EnvCopy[]> {
  const copies: EnvCopy[] = [];
  for (const file of await ignoredEnvFiles(ctx, primary)) {
    const from = path.join(primary, file);
    const to = path.join(worktree, file);
    if (!(await ctx.fs.isRegularFile(from))) {
      copies.push({ file, outcome: "not-a-file" });
    } else if (!(await ctx.fs.exists(path.dirname(to)))) {
      copies.push({ file, outcome: "no-folder" });
    } else if (await ctx.fs.copyNew(from, to)) {
      copies.push({ file, outcome: "copied" });
    } else {
      copies.push({ file, outcome: "already-there" });
    }
  }
  return copies;
}

/** The key names an env file sets: `KEY=...` or `export KEY=...` lines.
 * Only names leave this function, never values. */
export function envKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=/.exec(line);
    if (match?.[1] !== undefined) {
      keys.add(match[1]);
    }
  }
  return keys;
}

/**
 * For every committed `<name>.example` env template in `worktree`, the keys
 * it lists that `<name>` lacks.
 */
export async function checkEnvKeys(
  ctx: Context,
  worktree: string,
): Promise<EnvKeyCheck[]> {
  const result = await ctx.git.run(["ls-files", "-z"], worktree);
  if (result.code !== 0) {
    return [];
  }
  const checks: EnvKeyCheck[] = [];
  for (const template of splitNul(result.stdout)
    .filter(isEnvTemplateName)
    .sort()) {
    const file = template.slice(0, -EXAMPLE_SUFFIX.length);
    const templateText = await ctx.fs.readText(path.join(worktree, template));
    const envText = await ctx.fs.readText(path.join(worktree, file));
    if (templateText === undefined) {
      continue;
    }
    if (envText === undefined) {
      checks.push({ file, template, missingKeys: undefined });
      continue;
    }
    const present = envKeys(envText);
    const missingKeys = [...envKeys(templateText)].filter(
      (key) => !present.has(key),
    );
    checks.push({ file, template, missingKeys });
  }
  return checks;
}

const COPY_LINES: Record<EnvCopyOutcome, (file: string) => string> = {
  copied: (file) => `copied ${file} from the primary checkout`,
  "already-there": (file) => `kept ${file}: this worktree already has one`,
  "no-folder": (file) =>
    `skipped ${file}: its folder isn't on this worktree's branch`,
  "not-a-file": (file) =>
    `skipped ${file}: it isn't an ordinary file (a link or a folder)`,
};

/** The report lines for both steps, without values. */
export function describeEnv(
  copies: readonly EnvCopy[],
  checks: readonly EnvKeyCheck[],
): string[] {
  const lines = copies.map((copy) => COPY_LINES[copy.outcome](copy.file));
  for (const check of checks) {
    if (check.missingKeys === undefined) {
      lines.push(`no ${check.file} here, though ${check.template} exists`);
    } else if (check.missingKeys.length > 0) {
      lines.push(
        `${check.file} lacks keys that ${check.template} lists: ${check.missingKeys.join(", ")}`,
      );
    }
  }
  return lines;
}
