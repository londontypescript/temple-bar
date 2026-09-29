// Writes AGENTS.md and package.json (or updates package.json's scripts).
// Everything here goes through ctx.fs, which has no delete method (N6/N9):
// nothing is ever overwritten or removed, only created or added to.

import path from "node:path";

import type { Context } from "../context.ts";
import { RERUN_INIT } from "./requirements.ts";

const MINIMAL_AGENTS_MD = `# Agent directives

Pre-release: these rules are still being built out. Nothing here is enforced
by a mechanism yet unless this file says so.

## Before code

For a new project: ask the user what they want to build, then write a plan
and get their approval before writing any code.

## Branching

\`main\` changes only through pull requests the user merges. Agents push
branches and open pull requests, never \`main\`.

## Staying inside the rules

Agents never install global tools on the user's behalf, and never route
around a refusal (a failed check, a declined prompt, a blocked command) by
working around it. Stop and report instead.
`;

/** Writes AGENTS.md only if none exists yet; returns whether it wrote. */
export async function writeAgentsMdIfMissing(
  ctx: Context,
  repoRoot: string,
): Promise<boolean> {
  const filePath = path.join(repoRoot, "AGENTS.md");
  const existing = await ctx.fs.readText(filePath);
  if (existing !== undefined) {
    return false;
  }
  await ctx.fs.writeText(filePath, MINIMAL_AGENTS_MD);
  return true;
}

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
    await ctx.fs.writeText(filePath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  return { wrote: wrote || scriptsChanged, conflicts };
}
