// The gate's stack checks: detecting the package manager and the project's
// typecheck/lint/format:check/test scripts, and running them. See
// docs/adr/0007-what-the-gate-checks.md for why the gate owns these checks.

import path from "node:path";
import { CONFIG_FILE_NAME } from "../config/project-config.ts";
import type { Context } from "../context.ts";
import { COMPANION_FILES } from "../init/companion-docs.ts";
import { JUDGE_WORKFLOW_PATH } from "../judge/workflow.ts";
import { LOCKFILE_NAMES, listGitPaths } from "./lengths.ts";

/** In the order the gate runs them. Every script runs whatever the others
 * return, so the order only decides how soon each result appears: the fast
 * static checks first, the usually slowest (test) last. */
export const REQUIRED_SCRIPTS = [
  "typecheck",
  "lint",
  "format:check",
  "test",
] as const;
export type RequiredScript = (typeof REQUIRED_SCRIPTS)[number];

/** What each required script is for: the gate says this when one is
 * missing or does nothing, so the user knows what to put there. */
export const SCRIPT_PURPOSE: Readonly<Record<RequiredScript, string>> = {
  typecheck: "a command that type-checks the project",
  lint: "a command that runs the project's linter",
  "format:check":
    "a command that checks the project's formatting without changing files",
  test: "a command that runs the project's tests",
};

export interface PackageManifest {
  readonly scripts?: Readonly<Record<string, string>>;
  readonly packageManager?: string;
}

function isPackageManifest(value: unknown): value is PackageManifest {
  return typeof value === "object" && value !== null;
}

/** Reads and parses package.json at ctx.cwd, or undefined if there is none
 * (or it isn't valid JSON — treated the same as absent, since either way
 * there is nowhere to read scripts from). */
export async function readPackageManifest(
  ctx: Context,
): Promise<PackageManifest | undefined> {
  const raw = await ctx.fs.readText(path.join(ctx.cwd, "package.json"));
  if (raw === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return isPackageManifest(parsed) ? parsed : undefined;
}

/** Which of the required scripts are missing from `manifest`. A missing
 * manifest (no package.json at all) counts as every one missing:
 * there is nowhere for them to be defined. */
export function missingRequiredScripts(
  manifest: PackageManifest | undefined,
): RequiredScript[] {
  const scripts = manifest?.scripts ?? {};
  return REQUIRED_SCRIPTS.filter((name) => !(name in scripts));
}

/** Commands that always succeed without checking anything, compared after
 * trimming and collapsing runs of spaces. Kept short and exact on purpose:
 * this catches a placeholder, not every way to write a weak check. */
const NO_OP_COMMANDS = new Set(["", "true", ":", "exit", "exit 0"]);

function isNoOpPart(part: string): boolean {
  const command = part.trim().replace(/\s+/g, " ");
  if (NO_OP_COMMANDS.has(command)) {
    return true;
  }
  // A bare `echo` only prints, and always succeeds. One that pipes into
  // something or runs a command inside it (backticks, $(...)) might check
  // something, so it is left alone.
  return (
    /^echo( |$)/.test(command) &&
    !command.includes("|") &&
    !command.includes("`") &&
    !command.includes("$(")
  );
}

/**
 * True when a script's command obviously does nothing: an empty string,
 * `true`, `:`, `exit 0`, a bare `echo ...`, or a chain made only of these
 * (`echo ok && exit 0`). Such a script would pass the gate while checking
 * nothing, so the gate fails it instead of running it.
 */
export function isNoOpScript(command: string): boolean {
  return command.split(/&&|\|\||;|\n/).every(isNoOpPart);
}

/** Folders holding other people's code or generated output. Anything
 * under one of these, at any depth, is not the project's own content, even
 * when it was committed by mistake. */
const NOT_OWN_CONTENT_FOLDERS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
]);

/** Files a project starts with before it has anything of its own: the ones
 * setup writes (AGENTS.md and the docs it links to, CLAUDE.md, package.json,
 * .gitignore and the judge workflow), the lockfile its install writes, temple-bar's own config, and
 * the ones GitHub offers to create with a new repository (README.md,
 * LICENSE and .gitignore). A repo holding only these has nothing for the
 * four scripts to check yet. */
const STARTING_FILES = new Set([
  "AGENTS.md",
  "package.json",
  ".gitignore",
  ...COMPANION_FILES.map((file) => file.path),
  JUDGE_WORKFLOW_PATH,
  CONFIG_FILE_NAME,
  "README.md",
  "LICENSE",
  ...LOCKFILE_NAMES,
]);

function isOwnContent(relativePath: string): boolean {
  // A path ending in "/" is a nested worktree or repo: another checkout,
  // not this project's content.
  if (relativePath.endsWith("/") || STARTING_FILES.has(relativePath)) {
    return false;
  }
  const folders = relativePath.split("/").slice(0, -1);
  return !folders.some((folder) => NOT_OWN_CONTENT_FOLDERS.has(folder));
}

/**
 * Whether the repo has content of its own, which is when the four scripts
 * become required. This looks at which files exist, never at their
 * extensions: a list of "code" extensions let every project written in
 * anything else (Rust, Svelte, Vue...) pass the gate with none of its checks
 * run. Any file beyond the starting set (see STARTING_FILES) counts,
 * whatever its type, apart from vendored or built output (see
 * NOT_OWN_CONTENT_FOLDERS).
 *
 * Reads the same file list as the length cap (listGitPaths), so both checks
 * see the same files and skip nested worktrees the same way.
 */
export async function ownContentExists(ctx: Context): Promise<boolean> {
  return (await listGitPaths(ctx)).some(isOwnContent);
}

/** pnpm if `packageManager` in package.json pins a pnpm version, or a
 * pnpm-lock.yaml is present; npm otherwise. Pure detection: never runs
 * anything, so a test can assert it picks pnpm without pnpm on PATH. */
export async function detectPackageManager(
  ctx: Context,
  manifest: PackageManifest | undefined,
): Promise<"npm" | "pnpm"> {
  if (manifest?.packageManager?.startsWith("pnpm@") === true) {
    return "pnpm";
  }
  if (await ctx.fs.exists(path.join(ctx.cwd, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  return "npm";
}

export interface ScriptRunResult {
  readonly script: RequiredScript;
  readonly exitCode: number;
}

/**
 * Runs each of `scripts` in order via `<manager> run <script>`, always
 * running all of them even if an earlier one fails (the gate summarises
 * every failure, it doesn't stop at the first). Every script gets CI=true
 * in its environment, so tools that act differently in CI (watch modes,
 * prompts) act the same way locally. It is added on top of ctx.env rather
 * than replacing it.
 */
export async function runRequiredScripts(
  ctx: Context,
  manager: "npm" | "pnpm",
  scripts: readonly RequiredScript[],
): Promise<ScriptRunResult[]> {
  const results: ScriptRunResult[] = [];
  for (const script of scripts) {
    const exitCode = await ctx.proc.run(manager, ["run", script], {
      cwd: ctx.cwd,
      env: { ...ctx.env, CI: "true" },
      stdout: ctx.stdout,
      stderr: ctx.stderr,
    });
    results.push({ script, exitCode });
  }
  return results;
}
