// The gate's check that the gate and title workflows are exact copies of the
// ones this temple-bar writes. A pull request runs its own copy of a
// workflow, so an edited one could stop running the gate, or run it with a
// step that hides its failures, and still pass. Holding each file to the
// exact text means any edit fails, whatever it does.
//
// The only difference allowed is line endings: a Windows checkout may turn
// LF into CRLF, so CRLF in the file read counts as LF. Nothing else is
// normalised, not even trailing whitespace or a final newline. It reads
// files only: no git and no network, so it gives the same answer anywhere.

import path from "node:path";

import type { Context } from "../context.ts";
import { classifyDiskTarget } from "../init/write-target.ts";
import {
  CHECKED_WORKFLOWS,
  RESTORE_WORKFLOW,
  type CheckedWorkflow,
} from "../init/workflows.ts";
import { RERUN_INIT } from "../init/requirements.ts";
import type { CheckOutcome } from "./report.ts";

const WORKFLOWS_CHECK = "gate and title workflows";

/** Lines with their endings kept, so a missing or extra final newline
 * changes the last line. */
function linesOf(text: string): string[] {
  return text.split(/(?<=\n)/);
}

/** The first line, from 1, where `found` differs from `expected` once CRLF
 * in `found` is read as LF, or undefined when they match. When one text is
 * longer, the first line the other lacks is the one that differs. */
function firstDifferingLine(
  found: string,
  expected: string,
): number | undefined {
  const actual = linesOf(found.replaceAll("\r\n", "\n"));
  const wanted = linesOf(expected);
  const longest = Math.max(actual.length, wanted.length);
  for (let index = 0; index < longest; index++) {
    if (actual[index] !== wanted[index]) {
      return index + 1;
    }
  }
  return undefined;
}

/** How a workflow in the repo compares with the copy this temple-bar
 * writes: missing, not an ordinary file, an exact copy, or different from
 * `line` on. */
export type WorkflowState =
  | { readonly kind: "missing" }
  | { readonly kind: "not-a-file" }
  | { readonly kind: "exact" }
  | { readonly kind: "differs"; readonly line: number };

/** Reads `workflow` under `repoRoot` and compares it with its copy. A
 * symlink is never a copy, even of the right text: git stores only the path
 * it points to, and GitHub doesn't run a symlinked workflow. */
export async function compareWorkflow(
  ctx: Context,
  repoRoot: string,
  workflow: CheckedWorkflow,
): Promise<WorkflowState> {
  const file = path.join(repoRoot, ...workflow.path.split("/"));
  const target = await classifyDiskTarget(ctx, repoRoot, workflow.path);
  if (target.kind === "missing") return { kind: "missing" };
  if (target.kind !== "file") return { kind: "not-a-file" };
  const found = await ctx.fs.readText(file);
  if (found === undefined) {
    return { kind: "missing" };
  }
  const line = firstDifferingLine(found, workflow.content);
  return line === undefined ? { kind: "exact" } : { kind: "differs", line };
}

/** Every workflow that isn't an exact copy, each named, with its fix. Both
 * are always checked, so two wrong files are both reported. */
export async function runWorkflowCopiesCheck(
  ctx: Context,
): Promise<CheckOutcome> {
  const problems: { summary: string; message: string }[] = [];
  for (const workflow of CHECKED_WORKFLOWS) {
    const state = await compareWorkflow(ctx, ctx.cwd, workflow);
    if (state.kind === "missing") {
      problems.push({
        summary: `${workflow.path} missing`,
        message:
          `gate: ${workflow.path} is missing.\n` +
          `  fix: run ${RERUN_INIT} again: setup writes it.\n`,
      });
    } else if (state.kind === "not-a-file") {
      problems.push({
        summary: `${workflow.path} not an ordinary file`,
        message:
          `gate: ${workflow.path} is a symlink or folder, not an ordinary ` +
          "file, so GitHub doesn't run it as a workflow.\n" +
          `  fix: ${RESTORE_WORKFLOW}.\n`,
      });
    } else if (state.kind === "differs") {
      problems.push({
        summary: `${workflow.path} differs at line ${String(state.line)}`,
        message:
          `gate: ${workflow.path} differs from the copy this temple-bar ` +
          `writes, from line ${String(state.line)}.\n` +
          `  fix: ${RESTORE_WORKFLOW}.\n`,
      });
    }
  }
  if (problems.length > 0) {
    ctx.stderr.write(problems.map((problem) => problem.message).join(""));
    return {
      name: WORKFLOWS_CHECK,
      status: "failed",
      detail: problems.map((problem) => problem.summary).join(", "),
    };
  }
  return {
    name: WORKFLOWS_CHECK,
    status: "passed",
    detail: `${String(CHECKED_WORKFLOWS.length)} exact copies`,
  };
}
