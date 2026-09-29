// The gate's stack checks: detecting the package manager and the project's
// typecheck/lint/format:check/test scripts, and running them (D2, P3.1,
// P3.3, decision 23).

import path from "node:path";
import type { Context } from "../context.ts";
import { listGitPaths } from "./lengths.ts";

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

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

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

/** "Code exists" (D2): any git-tracked-or-trackable file with a code
 * extension. Reuses listGitPaths from lengths.ts so both checks see the
 * same file set and nested worktrees are skipped the same way (P3.7). */
export async function codeExists(ctx: Context): Promise<boolean> {
  const paths = await listGitPaths(ctx);
  return paths.some(
    (relativePath) =>
      !relativePath.endsWith("/") &&
      CODE_EXTENSIONS.has(path.extname(relativePath)),
  );
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
 * in its environment (P3.3), added on top of ctx.env rather than replacing
 * it.
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
