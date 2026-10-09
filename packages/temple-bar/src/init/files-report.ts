// What setup says about the files it writes: each one written, or found and
// left alone, and every problem with the fix. Progress goes to stdout and
// problems to stderr. Kept apart from the command so the command reads as
// the order of setup's steps.

import type { Context } from "../context.ts";
import type { WriteTarget } from "./write-target.ts";
import type { SetupFilesOutcome } from "./files.ts";
import type { WorkflowOutcome } from "./workflow-update.ts";
import { RESTORE_WORKFLOW } from "./workflows.ts";

/** Why a package.json script was left alone, and what to do about it. A
 * `prepare` script is the project's own command, so replacing it would throw
 * that away: it has to be changed so temple-bar's command can follow it. */
function conflictMessage(name: string, expected: string): string {
  const head = `package.json already has a "${name}" script that isn't temple-bar's.`;
  if (name === "prepare") {
    return (
      `${head} It can't safely have temple-bar's command chained after it, ` +
      `so change it to end with " && ${expected}" (or set it to ` +
      `"${expected}" if the project doesn't need its own).\n`
    );
  }
  return `${head} Add this yourself: "${name}": "${expected}"\n`;
}

/** Reports AGENTS.md and the files beside it; returns true when AGENTS.md
 * was refused, which ends the run non-zero: the rules agents read aren't
 * temple-bar's until the block is put right. A size warning doesn't: the
 * file is written, and the gate names the overage again until it's fixed. */
function reportAgentsFiles(ctx: Context, files: SetupFilesOutcome): boolean {
  const refused = files.refusedPaths.has("AGENTS.md");
  if (files.agentsProblem !== undefined) {
    ctx.stderr.write(`${files.agentsProblem}\n`);
  } else if (!refused) {
    ctx.stdout.write(
      files.wroteAgents
        ? "Wrote temple-bar's rules into AGENTS.md.\n"
        : "AGENTS.md already has temple-bar's rules; left it alone.\n",
    );
  }
  if (files.agentsSizeWarning !== undefined) {
    ctx.stdout.write(`Warning: ${files.agentsSizeWarning}\n`);
  }
  if (files.wroteCompanions.length > 0) {
    ctx.stdout.write(
      `Wrote the files AGENTS.md links to, where missing: ${files.wroteCompanions.join(", ")}.\n`,
    );
  }
  if (files.claudeMdAdded.length > 0) {
    ctx.stdout.write(
      `Added to CLAUDE.md: ${files.claudeMdAdded.join(" and ")}.\n`,
    );
  }
  return refused || files.agentsProblem !== undefined;
}

/** Reports every generated workflow, including a preserved judge conflict.
 * Setup only reports success alongside an exact current copy. */
function reportWorkflow(ctx: Context, outcome: WorkflowOutcome): boolean {
  const { workflow, state } = outcome;
  if (outcome.wrote && state.kind === "exact") {
    const action = outcome.upgraded ? "Updated" : "Wrote";
    const why = outcome.upgraded
      ? " (recognized an earlier temple-bar release)"
      : "";
    ctx.stdout.write(
      `${action} the ${workflow.label}, ${workflow.path}${why}.\n`,
    );
    return false;
  }
  if (state.kind === "differs" || state.kind === "not-a-file") {
    const how =
      state.kind === "differs"
        ? `differs from the copy this temple-bar writes, from line ${String(state.line)}`
        : "is a symlink or folder, not an ordinary file";
    ctx.stderr.write(
      `${workflow.path} ${how}, so it was left alone` +
        (workflow.checkedByGate
          ? ", and the gate fails until it matches"
          : "; setup cannot complete until it matches") +
        `. Fix: ${RESTORE_WORKFLOW}.\n`,
    );
    return true;
  }
  ctx.stdout.write(`${workflow.path} already exists; left it alone.\n`);
  return false;
}

/** Reports all three workflows; every preserved differing copy is a conflict. */
function reportWorkflows(ctx: Context, files: SetupFilesOutcome): boolean {
  let differs = false;
  for (const outcome of files.workflows) {
    if (
      files.refusedPaths.has(outcome.workflow.path) ||
      reportWorkflow(ctx, outcome)
    )
      differs = true;
  }
  return differs;
}

/** Reports package.json; returns true when something in it has to be put
 * right by hand, which ends the run non-zero. */
function reportPackageJson(ctx: Context, files: SetupFilesOutcome): boolean {
  if (files.refusedPaths.has("package.json")) return true;
  const outcome = files.packageOutcome;
  if (outcome.invalid !== undefined) {
    ctx.stderr.write(`${outcome.invalid}\n`);
    return true;
  }
  for (const conflict of outcome.conflicts) {
    ctx.stderr.write(conflictMessage(conflict.name, conflict.expected));
  }
  if (outcome.pnpmProblem !== undefined) {
    ctx.stderr.write(`${outcome.pnpmProblem}\n`);
  }
  ctx.stdout.write(
    outcome.wrote
      ? "Updated package.json.\n"
      : "package.json already has the required scripts; left it alone.\n",
  );
  if (outcome.addedPnpm !== undefined) {
    ctx.stdout.write(
      `Set "packageManager" in package.json to "pnpm@${outcome.addedPnpm}", ` +
        "the pnpm running setup: the workflows install the version it names.\n",
    );
  }
  return outcome.conflicts.length > 0 || outcome.pnpmProblem !== undefined;
}

/** Reports every file setup wrote or left alone; returns true when one has
 * a problem that ends the run non-zero. .gitignore is reported by the
 * command, which may have written it earlier in the run. */
export function reportSetupFiles(
  ctx: Context,
  files: SetupFilesOutcome,
): boolean {
  const agentsFailed = reportAgentsFiles(ctx, files);
  const workflowsFailed = reportWorkflows(ctx, files);
  const packageFailed = reportPackageJson(ctx, files);
  return (
    agentsFailed ||
    workflowsFailed ||
    packageFailed ||
    files.refusedPaths.size > 0
  );
}

/** Whether this run wrote any of setup's files, which leaves something to
 * commit. .gitignore and the hooks are the command's to add. */
export function wroteSetupFiles(files: SetupFilesOutcome): boolean {
  return (
    files.wroteGitignore ||
    files.wroteAgents ||
    files.wroteCompanions.length > 0 ||
    files.claudeMdAdded.length > 0 ||
    files.workflows.some((outcome) => outcome.wrote) ||
    files.packageOutcome.wrote
  );
}

/** Called on discovery, including before setup stops at a GitHub question. */
export function reportWriteTarget(
  ctx: Context,
  relative: string,
  state: WriteTarget,
): void {
  if (state.kind === "refused") {
    ctx.stderr.write(
      `${relative} ${state.reason}; left it alone. Fix: ${state.fix}.\n`,
    );
  } else if (state.kind === "claude-link") {
    ctx.stdout.write("CLAUDE.md links to AGENTS.md and was left alone.\n");
  }
}
