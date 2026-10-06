// Creates package.json, or adds the scripts temple-bar needs to an existing
// one. Like the rest of setup, it only adds: when the project already has one
// of those scripts with different content, it is reported, never overwritten.

import path from "node:path";

import type { Context } from "../context.ts";
import { RERUN_INIT } from "./requirements.ts";

interface PackageJsonShape {
  name?: unknown;
  private?: unknown;
  scripts?: Record<string, unknown>;
  [key: string]: unknown;
}

export const PREPARE_SCRIPT = "temple-bar hook install";
export const GATE_SCRIPT = "temple-bar gate";

const REQUIRED_SCRIPTS: Readonly<Record<string, string>> = {
  prepare: PREPARE_SCRIPT,
  gate: GATE_SCRIPT,
};

function folderName(repoRoot: string): string {
  return repoRoot.split(/[/\\]/).filter(Boolean).at(-1) ?? "app";
}

function isPackageJsonShape(value: unknown): value is PackageJsonShape {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface PackageJsonOutcome {
  readonly wrote: boolean;
  readonly conflicts: readonly { name: string; expected: string }[];
  /** Set when package.json exists but isn't a JSON object: the exact fix.
   * Nothing is written in that case. */
  readonly invalid?: string;
}

/**
 * Creates a minimal package.json if there isn't one, then adds the
 * `prepare`/`gate` scripts if they're absent. A script that already exists
 * with different content is left untouched; its name and expected line come
 * back in `conflicts` so the caller can report it and end non-zero.
 */
export async function ensurePackageJsonScripts(
  ctx: Context,
  repoRoot: string,
): Promise<PackageJsonOutcome> {
  const filePath = path.join(repoRoot, "package.json");
  const existing = await ctx.fs.readText(filePath);

  let pkg: PackageJsonShape;
  let wrote = false;
  if (existing === undefined) {
    pkg = { name: folderName(repoRoot), private: true };
    wrote = true;
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch {
      parsed = undefined;
    }
    if (!isPackageJsonShape(parsed)) {
      return {
        wrote: false,
        conflicts: [],
        invalid:
          "package.json isn't a valid JSON object, so it was left alone. Fix: " +
          `correct it, then run ${RERUN_INIT} again.`,
      };
    }
    pkg = parsed;
  }

  const scripts: Record<string, unknown> = { ...pkg.scripts };
  const conflicts: { name: string; expected: string }[] = [];
  let scriptsChanged = false;

  for (const [name, expected] of Object.entries(REQUIRED_SCRIPTS)) {
    const current = scripts[name];
    if (current === undefined) {
      scripts[name] = expected;
      scriptsChanged = true;
    } else if (current !== expected) {
      conflicts.push({ name, expected });
    }
  }

  if (wrote || scriptsChanged) {
    pkg.scripts = scripts;
    await ctx.fs.writeText(filePath, formatLike(existing, pkg));
  }

  return { wrote: wrote || scriptsChanged, conflicts };
}

/** Serialises `value` the way `original` was laid out: the same indent (tabs
 * or any number of spaces) and the same final newline, so adding scripts
 * doesn't turn into a whole-file formatting diff. A new file gets two spaces
 * and a final newline. */
function formatLike(original: string | undefined, value: unknown): string {
  const indent = /^([ \t]+)\S/m.exec(original ?? "")?.[1] ?? "  ";
  const finalNewline = original === undefined || original.endsWith("\n");
  return `${JSON.stringify(value, null, indent)}${finalNewline ? "\n" : ""}`;
}
