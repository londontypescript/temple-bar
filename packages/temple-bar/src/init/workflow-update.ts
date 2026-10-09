// Setup treats all generated workflows alike: create missing files, replace
// authentic earlier output, and preserve anything it cannot prove it wrote.
// The judge joins setup's ownership checks without adding a new gate check.

import type { Context } from "../context.ts";
import { isEarlierOutput } from "../generated-history.ts";
import {
  compareWorkflow,
  compareWorkflowText,
  type WorkflowState,
} from "../gate/workflow-copies.ts";
import { JUDGE_WORKFLOW_PATH, judgeWorkflow } from "../judge/workflow.ts";
import { setupWriteTargets } from "./write-target.ts";
import { CHECKED_WORKFLOWS, type CheckedWorkflow } from "./workflows.ts";

interface ManagedWorkflow extends CheckedWorkflow {
  readonly checkedByGate: boolean;
}

const WORKFLOWS: readonly ManagedWorkflow[] = [
  {
    path: JUDGE_WORKFLOW_PATH,
    label: "judge workflow",
    content: judgeWorkflow(),
    checkedByGate: false,
  },
  ...CHECKED_WORKFLOWS.map((workflow) => ({
    ...workflow,
    checkedByGate: true,
  })),
];

export interface WorkflowOutcome {
  readonly workflow: ManagedWorkflow;
  readonly wrote: boolean;
  readonly upgraded: boolean;
  /** How the file compares with this version after setup's attempted write. */
  readonly state: WorkflowState;
}

export async function writeWorkflows(
  ctx: Context,
  repoRoot: string,
  targets = setupWriteTargets(ctx, repoRoot),
): Promise<readonly WorkflowOutcome[]> {
  const outcomes: WorkflowOutcome[] = [];
  for (const workflow of WORKFLOWS) {
    const found = await targets.readText(workflow.path);
    const before: WorkflowState = targets.refusals.has(workflow.path)
      ? { kind: "not-a-file" }
      : found === undefined
        ? { kind: "missing" }
        : compareWorkflowText(found, workflow.content);
    const earlier =
      before.kind === "differs" &&
      found !== undefined &&
      isEarlierOutput(workflow.path, found);
    // WriteTargets checks the index and disk again at the write, so an old
    // recognized copy never licenses writing through a newly linked target.
    const wrote =
      (before.kind === "missing" || earlier) &&
      (await targets.writeText(workflow.path, workflow.content));
    const state = wrote
      ? await compareWorkflow(ctx, repoRoot, workflow)
      : before;
    outcomes.push({ workflow, wrote, upgraded: wrote && earlier, state });
  }
  return outcomes;
}
