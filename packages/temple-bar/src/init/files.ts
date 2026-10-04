// Writes AGENTS.md, the judge workflow and package.json (or updates
// package.json's scripts).
// Everything here goes through ctx.fs, which has no delete method (N6/N9):
// nothing is ever overwritten or removed, only created or added to.

import path from "node:path";

import type { Context } from "../context.ts";
import { JUDGE_WORKFLOW_PATH, judgeWorkflow } from "../judge/workflow.ts";
import { RERUN_INIT } from "./requirements.ts";

const MINIMAL_AGENTS_MD = `# Agent directives

Pre-release: these rules are still being built out. Nothing here is enforced
by a mechanism yet unless this file says so.

## Before code

For a new project: ask the user what they want to build, then write a plan
and get their approval before writing any code.

## Branching

The default branch (usually \`main\`) changes only through
pull requests the user merges, each squashed into one commit. Agents push
branches and open pull requests, never the default branch.

## Drafts

Plans, drafts and anything else that's local to this checkout go in
\`.temple-bar/\`, which is never committed. Draft there, agree it with the
user, then push it once.

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

/** Writes the judge workflow only if none exists yet; returns whether it
 * wrote. A copy that differs is left alone, like AGENTS.md: it may be the
 * maintainer's own reviewed change. */
export async function writeJudgeWorkflowIfMissing(
  ctx: Context,
  repoRoot: string,
): Promise<boolean> {
  const filePath = path.join(repoRoot, ...JUDGE_WORKFLOW_PATH.split("/"));
  if ((await ctx.fs.readText(filePath)) !== undefined) {
    return false;
  }
  await ctx.fs.mkdirp(path.dirname(filePath));
  await ctx.fs.writeText(filePath, judgeWorkflow());
  return true;
}

/** What setup keeps in .gitignore, in commented groups: a sensible default
 * for a TypeScript project on Node. Without it, the first `git add -A`
 * commits node_modules/. Deliberately left out: `build/` (some projects keep
 * source there), framework folders such as `.next/` (they belong to the
 * stack), and editor folders such as `.vscode/` (teams often share them). */
const GITIGNORE_SECTIONS: readonly {
  readonly comment: string;
  readonly lines: readonly string[];
}[] = [
  {
    comment: "Dependencies and build output",
    lines: ["node_modules/", "dist/", "coverage/", "*.tsbuildinfo", "*.tgz"],
  },
  { comment: "Logs", lines: ["*.log"] },
  {
    comment: "Env files hold secrets; their .example templates are committed",
    lines: [".env", ".env.*", "!*.example"],
  },
  { comment: "OS files", lines: [".DS_Store", "Thumbs.db"] },
  {
    comment: "Personal harness settings, never shared",
    lines: [".claude/settings.local.json", "CLAUDE.local.md"],
  },
  {
    comment:
      "Worktrees Claude Code creates inside the repo: each is a whole checkout\n" +
      "# of another branch, so git and every check skip it",
    lines: [".claude/worktrees/"],
  },
  {
    comment:
      "This checkout's local working folder: drafts, and anything temple-bar\n" +
      "# or its agents keep for this checkout only",
    lines: [".temple-bar/"],
  },
];

/** Every line setup keeps in .gitignore, without the comments. */
export const GITIGNORE_LINES: readonly string[] = GITIGNORE_SECTIONS.flatMap(
  (section) => section.lines,
);

/** A new .gitignore: every group with its comment. */
function freshGitignore(): string {
  return `${GITIGNORE_SECTIONS.map(
    (section) => `# ${section.comment}\n${section.lines.join("\n")}`,
  ).join("\n\n")}\n`;
}

/**
 * Creates .gitignore, or appends only the lines it lacks. Existing lines are
 * never removed or reordered, so a second run writes nothing. Returns
 * whether it wrote.
 */
export async function ensureGitignore(
  ctx: Context,
  repoRoot: string,
): Promise<boolean> {
  const filePath = path.join(repoRoot, ".gitignore");
  const existing = await ctx.fs.readText(filePath);
  const present = new Set((existing ?? "").split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE_LINES.filter((line) => !present.has(line));
  if (missing.length === 0) {
    return false;
  }
  if (existing === undefined || existing.trim() === "") {
    await ctx.fs.writeText(filePath, freshGitignore());
    return true;
  }
  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  await ctx.fs.writeText(
    filePath,
    `${existing}${separator}# Added by temple-bar\n${missing.join("\n")}\n`,
  );
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

export interface SetupFilesOutcome {
  readonly wroteGitignore: boolean;
  readonly wroteAgents: boolean;
  readonly wroteJudge: boolean;
  readonly packageOutcome: PackageJsonOutcome;
}

/** Writes every file setup owns. .gitignore goes first so that anything
 * committed afterwards already leaves node_modules/ out. */
export async function writeSetupFiles(
  ctx: Context,
  repoRoot: string,
): Promise<SetupFilesOutcome> {
  const wroteGitignore = await ensureGitignore(ctx, repoRoot);
  const wroteAgents = await writeAgentsMdIfMissing(ctx, repoRoot);
  const wroteJudge = await writeJudgeWorkflowIfMissing(ctx, repoRoot);
  const packageOutcome = await ensurePackageJsonScripts(ctx, repoRoot);
  return { wroteGitignore, wroteAgents, wroteJudge, packageOutcome };
}
