// Writes AGENTS.md and the docs it links to, the judge, gate and title
// workflows, .gitignore, .prettierignore and .gitattributes, and runs every file step of
// setup in order (package.json's step lives in package-json.ts).
// Everything here goes through ctx.fs, which has no delete method: nothing
// is ever removed. Setup rewrites only its own marked block in AGENTS.md
// and authentic earlier generated workflows. All other content
// is preserved, so setup never turns a marker into permission to overwrite.

import type { Context } from "../context.ts";
import { setupWriteTargets, type RefusedTarget } from "./write-target.ts";
import {
  AGENTS_OVERSIZE_FIX,
  describeAgentsOverage,
  measureAgentsFile,
} from "../gate/agents-size.ts";
import {
  freshAgentsMd,
  RESTORE_BLOCK,
  withTempleBarBlock,
} from "./agents-template.ts";
import {
  CLAUDE_MD_PATH,
  COMPANION_FILES,
  fixClaudeMd,
} from "./companion-docs.ts";
import {
  ensurePackageJsonScripts,
  type PackageJsonOutcome,
} from "./package-json.ts";
import { writeWorkflows, type WorkflowOutcome } from "./workflow-update.ts";
import { ensurePrettierIgnore } from "./prettier-ignore.ts";
import {
  ensureGitattributes,
  type GitattributesOutcome,
} from "./gitattributes.ts";

export interface AgentsMdOutcome {
  readonly wrote: boolean;
  /** Set when AGENTS.md's temple-bar block was edited by hand or its
   * markers don't pair up: what is wrong and the fix. Nothing is written
   * in that case. */
  readonly problem?: string;
  /** Set when AGENTS.md, as setup leaves it, is over the size limits the
   * gate checks: by how much, and what to move. A framework's own AGENTS.md
   * plus temple-bar's block can be, and setup is the moment to say so
   * rather than the first gate run. */
  readonly sizeWarning?: string;
}

/** The outcome for AGENTS.md as written (or found up to date), with a
 * size warning when it is over the gate's limits. */
function withSizeCheck(wrote: boolean, content: string): AgentsMdOutcome {
  const overage = describeAgentsOverage(measureAgentsFile(content));
  if (overage.length === 0) {
    return { wrote };
  }
  return {
    wrote,
    sizeWarning:
      `AGENTS.md is over its size limit: ${overage.join(", ")}, and the ` +
      `gate will fail on it. Fix: ${AGENTS_OVERSIZE_FIX}`,
  };
}

/**
 * Writes a new AGENTS.md, or puts temple-bar's rules into an existing one as
 * a marked block: added at the end the first time, and on later runs
 * brought up to date in place when it is a block temple-bar wrote. Nothing
 * outside the block is touched, so a framework's own AGENTS.md, and the
 * project's own rules, stay as they are. A block edited by hand is refused,
 * not overwritten: the edit would be lost.
 */
export async function writeAgentsMd(
  ctx: Context,
  repoRoot: string,
  targets = setupWriteTargets(ctx, repoRoot),
): Promise<AgentsMdOutcome> {
  const existing = await targets.readText("AGENTS.md");
  if (targets.refusals.has("AGENTS.md")) return { wrote: false };
  if (existing === undefined) {
    const content = freshAgentsMd();
    return withSizeCheck(
      await targets.writeText("AGENTS.md", content),
      content,
    );
  }
  const update = withTempleBarBlock(existing);
  if (update.kind === "refused") {
    return {
      wrote: false,
      problem: `${update.detail} It was left alone. Fix: ${RESTORE_BLOCK}.`,
    };
  }
  if (update.kind === "unchanged") {
    return withSizeCheck(false, existing);
  }
  return withSizeCheck(
    await targets.writeText("AGENTS.md", update.content),
    update.content,
  );
}

/** Companion files that are the project's from the start, so a copy that
 * differs from this release's says nothing: CLAUDE.md, which setup adds to
 * itself, and the conventions file, which starts empty to be filled in. */
const PROJECT_OWNED = new Set([CLAUDE_MD_PATH, "docs/conventions.md"]);

/** A guide's text with Windows line endings made plain and without its
 * final newline, the tolerance the block's comparison has: a checkout that
 * turned LF into CRLF is still the same guide. */
function comparableGuide(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
}

export interface CompanionOutcome {
  /** The paths this run wrote, relative to the repo root. */
  readonly written: readonly string[];
  /** Existing guides whose text differs from this release's copy. They
   * are left alone: once written, a guide is the project's to edit. */
  readonly differing: readonly string[];
}

/** Writes each file AGENTS.md links to (and CLAUDE.md) where the project
 * has none, and names each existing guide that differs from this release's
 * copy, never writing it: an upgrade replaces the block but not the guides,
 * so the project is told which it may want to replace. */
export async function writeCompanionFiles(
  ctx: Context,
  repoRoot: string,
  targets = setupWriteTargets(ctx, repoRoot),
): Promise<CompanionOutcome> {
  const written: string[] = [];
  const differing: string[] = [];
  for (const file of COMPANION_FILES) {
    const existing = await targets.readText(file.path);
    if (targets.refusals.has(file.path)) continue;
    if (existing === undefined) {
      if (await targets.writeText(file.path, file.content)) {
        written.push(file.path);
      }
    } else if (
      !PROJECT_OWNED.has(file.path) &&
      comparableGuide(existing) !== comparableGuide(file.content)
    ) {
      differing.push(file.path);
    }
  }
  return { written, differing };
}

/** Adds what an existing CLAUDE.md lacks (a heading, the AGENTS.md
 * import), never removing anything; returns what it added, in words, or
 * nothing when the file was already right or isn't there. */
export async function updateClaudeMd(
  ctx: Context,
  repoRoot: string,
  targets = setupWriteTargets(ctx, repoRoot),
): Promise<readonly string[]> {
  const existing = await targets.readText(CLAUDE_MD_PATH);
  const fix = existing === undefined ? undefined : fixClaudeMd(existing);
  if (fix === undefined) {
    return [];
  }
  return (await targets.writeText(CLAUDE_MD_PATH, fix.content))
    ? fix.added
    : [];
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
  targets = setupWriteTargets(ctx, repoRoot),
): Promise<boolean> {
  const existing = await targets.readText(".gitignore");
  if (targets.refusals.has(".gitignore")) return false;
  const present = new Set((existing ?? "").split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE_LINES.filter((line) => !present.has(line));
  if (missing.length === 0) {
    return false;
  }
  if (existing === undefined || existing.trim() === "") {
    return targets.writeText(".gitignore", freshGitignore());
  }
  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  return targets.writeText(
    ".gitignore",
    `${existing}${separator}# Added by temple-bar\n${missing.join("\n")}\n`,
  );
}

export interface SetupFilesOutcome {
  /** Every path setup refused to write through, with why and its fix. */
  readonly refusedPaths: ReadonlyMap<string, RefusedTarget>;
  readonly wroteGitignore: boolean;
  /** Whether this run created .prettierignore or added the lockfile to it. */
  readonly wrotePrettierIgnore: boolean;
  readonly gitattributes: GitattributesOutcome;
  readonly wroteAgents: boolean;
  /** Set when setup left AGENTS.md alone; see AgentsMdOutcome. */
  readonly agentsProblem?: string;
  /** Set when AGENTS.md is over its size limits; see AgentsMdOutcome. */
  readonly agentsSizeWarning?: string;
  /** The docs AGENTS.md links to, and CLAUDE.md, that this run wrote. */
  readonly wroteCompanions: readonly string[];
  /** Existing guides that differ from this release's copy; reported only. */
  readonly differingCompanions: readonly string[];
  /** What this run added to an existing CLAUDE.md, in words ("a heading",
   * "the AGENTS.md import"); empty when it needed nothing. */
  readonly claudeMdAdded: readonly string[];
  /** The judge, gate and title workflows, in setup order. */
  readonly workflows: readonly WorkflowOutcome[];
  readonly packageOutcome: PackageJsonOutcome;
}

/** Writes every file setup owns. .gitignore goes first so that anything
 * committed afterwards already leaves node_modules/ out. */
export async function writeSetupFiles(
  ctx: Context,
  repoRoot: string,
  targets = setupWriteTargets(ctx, repoRoot),
): Promise<SetupFilesOutcome> {
  const wroteGitignore = await ensureGitignore(ctx, repoRoot, targets);
  const wrotePrettierIgnore = await ensurePrettierIgnore(targets);
  const gitattributes = await ensureGitattributes(ctx, repoRoot, targets);
  const agents = await writeAgentsMd(ctx, repoRoot, targets);
  const companions = await writeCompanionFiles(ctx, repoRoot, targets);
  const claudeMdAdded = await updateClaudeMd(ctx, repoRoot, targets);
  const workflows = await writeWorkflows(ctx, repoRoot, targets);
  const packageOutcome = await ensurePackageJsonScripts(ctx, repoRoot, targets);
  return {
    refusedPaths: targets.refusals,
    wroteGitignore,
    wrotePrettierIgnore,
    gitattributes,
    wroteAgents: agents.wrote,
    ...(agents.problem === undefined ? {} : { agentsProblem: agents.problem }),
    ...(agents.sizeWarning === undefined
      ? {}
      : { agentsSizeWarning: agents.sizeWarning }),
    wroteCompanions: companions.written,
    differingCompanions: companions.differing,
    claudeMdAdded,
    workflows,
    packageOutcome,
  };
}
