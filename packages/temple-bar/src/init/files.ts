// Writes AGENTS.md and the docs it links to, the judge, gate and title
// workflows and .gitignore, and runs every file step of setup in order
// (package.json's step lives in package-json.ts).
// Everything here goes through ctx.fs, which has no delete method: nothing
// is ever removed. The one thing setup rewrites is its own marked block in
// AGENTS.md; everything else is only created or added to.

import type { Context } from "../context.ts";
import { setupWriteTargets, type RefusedTarget } from "./write-target.ts";
import {
  AGENTS_OVERSIZE_FIX,
  describeAgentsOverage,
  measureAgentsFile,
} from "../gate/agents-size.ts";
import {
  compareWorkflow,
  type WorkflowState,
} from "../gate/workflow-copies.ts";
import { JUDGE_WORKFLOW_PATH, judgeWorkflow } from "../judge/workflow.ts";
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
import { CHECKED_WORKFLOWS, type CheckedWorkflow } from "./workflows.ts";

/** Writes `content` at `relativePath` only if nothing is there yet;
 * returns whether it wrote. A copy that differs is left alone: once written,
 * the file is the project's to edit. */
async function writeIfMissing(
  ctx: Context,
  repoRoot: string,
  relativePath: string,
  content: string,
  targets = setupWriteTargets(ctx, repoRoot),
): Promise<boolean> {
  if ((await targets.readText(relativePath)) !== undefined) {
    return false;
  }
  return targets.writeText(relativePath, content);
}

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

/** Writes each file AGENTS.md links to (and CLAUDE.md) where the project
 * has none; returns the paths it wrote, relative to the repo root. */
export async function writeCompanionFiles(
  ctx: Context,
  repoRoot: string,
  targets = setupWriteTargets(ctx, repoRoot),
): Promise<readonly string[]> {
  const written: string[] = [];
  for (const file of COMPANION_FILES) {
    if (await writeIfMissing(ctx, repoRoot, file.path, file.content, targets)) {
      written.push(file.path);
    }
  }
  return written;
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

/** Writes the judge workflow only if none exists yet; returns whether it
 * wrote. A copy that differs is left alone, like AGENTS.md: it may be the
 * maintainer's own reviewed change. */
export async function writeJudgeWorkflowIfMissing(
  ctx: Context,
  repoRoot: string,
  targets = setupWriteTargets(ctx, repoRoot),
): Promise<boolean> {
  return writeIfMissing(
    ctx,
    repoRoot,
    JUDGE_WORKFLOW_PATH,
    judgeWorkflow(),
    targets,
  );
}

/** What setup did with one of the workflows the gate holds to an exact
 * copy: wrote it, or found it there, as an exact copy or not. */
export interface CheckedWorkflowOutcome {
  readonly workflow: CheckedWorkflow;
  readonly wrote: boolean;
  /** How the file compares with its copy after this run. */
  readonly state: WorkflowState;
}

/** Writes the gate and title workflows where they're missing. One that
 * differs is left alone, like the judge's, but reported: the gate fails
 * until it is an exact copy again. */
async function writeCheckedWorkflows(
  ctx: Context,
  repoRoot: string,
  targets = setupWriteTargets(ctx, repoRoot),
): Promise<readonly CheckedWorkflowOutcome[]> {
  const outcomes: CheckedWorkflowOutcome[] = [];
  for (const workflow of CHECKED_WORKFLOWS) {
    // Compared first, so a symlink or folder at the path is reported, never
    // read through or written over.
    const target = await targets.inspect(workflow.path);
    const before: WorkflowState =
      target.kind === "refused"
        ? { kind: "not-a-file" }
        : await compareWorkflow(ctx, repoRoot, workflow);
    const wrote =
      before.kind === "missing" &&
      (await writeIfMissing(
        ctx,
        repoRoot,
        workflow.path,
        workflow.content,
        targets,
      ));
    const state = wrote
      ? await compareWorkflow(ctx, repoRoot, workflow)
      : before;
    outcomes.push({ workflow, wrote, state });
  }
  return outcomes;
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
  readonly refusedPaths?: ReadonlyMap<string, RefusedTarget>;
  readonly wroteGitignore: boolean;
  readonly wroteAgents: boolean;
  /** Set when setup left AGENTS.md alone; see AgentsMdOutcome. */
  readonly agentsProblem?: string;
  /** Set when AGENTS.md is over its size limits; see AgentsMdOutcome. */
  readonly agentsSizeWarning?: string;
  /** The docs AGENTS.md links to, and CLAUDE.md, that this run wrote. */
  readonly wroteCompanions: readonly string[];
  /** What this run added to an existing CLAUDE.md, in words ("a heading",
   * "the AGENTS.md import"); empty when it needed nothing. */
  readonly claudeMdAdded: readonly string[];
  readonly wroteJudge: boolean;
  /** The gate and title workflows, in the order they were written. */
  readonly checkedWorkflows: readonly CheckedWorkflowOutcome[];
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
  const agents = await writeAgentsMd(ctx, repoRoot, targets);
  const wroteCompanions = await writeCompanionFiles(ctx, repoRoot, targets);
  const claudeMdAdded = await updateClaudeMd(ctx, repoRoot, targets);
  const wroteJudge = await writeJudgeWorkflowIfMissing(ctx, repoRoot, targets);
  const checkedWorkflows = await writeCheckedWorkflows(ctx, repoRoot, targets);
  const packageOutcome = await ensurePackageJsonScripts(ctx, repoRoot, targets);
  return {
    refusedPaths: targets.refusals,
    wroteGitignore,
    wroteAgents: agents.wrote,
    ...(agents.problem === undefined ? {} : { agentsProblem: agents.problem }),
    ...(agents.sizeWarning === undefined
      ? {}
      : { agentsSizeWarning: agents.sizeWarning }),
    wroteCompanions,
    claudeMdAdded,
    wroteJudge,
    checkedWorkflows,
    packageOutcome,
  };
}
