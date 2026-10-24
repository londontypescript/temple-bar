// Which of the check runs on a commit count. GitHub lists every run of
// every check, including runs that later runs replaced, so merge narrows
// them to the ones GitHub's required checks would look at.
//
// How GitHub records several runs on one commit (a cancelled run, its
// replacement, a re-run) was measured on real GitHub; the tables are on
// londontypescript/temple-bar#303.

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** One GitHub Actions workflow run on the commit, as GitHub's list of
 * workflow runs gives it. Each workflow run has its own check suite, which
 * is how a check run is traced back to the workflow run that made it. */
export interface WorkflowRun {
  /** The check suite holding this workflow run's check runs. */
  readonly suite: number;
  /** The workflow (one YAML file) this is a run of. */
  readonly workflow: number;
  /** The workflow run's own id. GitHub numbers workflow runs in the order
   * it creates them, and a re-run keeps the id. */
  readonly run?: number | undefined;
  /** GitHub's word for where the run is: "pending", "queued",
   * "in_progress", "completed" and so on. */
  readonly status?: string | undefined;
}

/** A check run with the workflow run it belongs to, when merge knows it. */
interface Placed {
  readonly run: Record<string, unknown>;
  readonly workflowRun: WorkflowRun | undefined;
}

/** Whether run `a` is newer than run `b` of the same check. The run in the
 * later workflow run is newer. Within one workflow run, which is how a
 * re-run's attempts are recorded, the higher check run id is: GitHub gives
 * each new check run a higher id. Start time is no use here: while a run is
 * queued, GitHub reports its creation time as its start, so a run cancelled
 * before it started can look newer than the run that replaced it. */
function isNewer(a: Placed, b: Placed): boolean {
  const aWorkflowRun = a.workflowRun?.run;
  const bWorkflowRun = b.workflowRun?.run;
  if (
    aWorkflowRun !== undefined &&
    bWorkflowRun !== undefined &&
    aWorkflowRun !== bWorkflowRun
  ) {
    return aWorkflowRun > bWorkflowRun;
  }
  return (
    (numberOrUndefined(a.run.id) ?? 0) > (numberOrUndefined(b.run.id) ?? 0)
  );
}

/** A later workflow run of the same workflow that hasn't finished, if there
 * is one. While a newer workflow run waits for the old one to be cancelled,
 * GitHub lists it but hasn't made its check runs yet: they appear only once
 * the old run is cancelled. A read in that gap sees only the cancelled run,
 * so the check is still to be decided, not failed. The newer workflow run
 * can't hold a run of this check already: that run would be the newest.
 * A newer workflow run that finished without this check (it failed to
 * start, or left the job out) doesn't count. */
function laterWorkflowRunStillGoing(
  placed: Placed,
  workflowRuns: readonly WorkflowRun[],
): WorkflowRun | undefined {
  const current = placed.workflowRun;
  if (current?.run === undefined) {
    return undefined;
  }
  let latest: WorkflowRun | undefined;
  for (const other of workflowRuns) {
    if (
      other.workflow === current.workflow &&
      other.run !== undefined &&
      other.run > current.run &&
      other.status !== undefined &&
      other.status !== "completed" &&
      (latest?.run === undefined || other.run > latest.run)
    ) {
      latest = other;
    }
  }
  return latest;
}

/** A later GitHub Actions run with this check's name whose workflow run
 * isn't listed yet, if there is one. GitHub can list a new check run a
 * moment before the workflow run that made it, so merge can't yet tell
 * which workflow it belongs to. It might be this check's replacement, so
 * the check waits until the two lists agree. That only ever delays: the
 * run never makes this check pass, and never joins it to another workflow's
 * runs. `actionsApps` holds the apps of the runs that are placed in a
 * workflow, which is how a run is known to come from GitHub Actions. */
function unlistedLaterRun(
  placed: Placed,
  unplaced: readonly Record<string, unknown>[],
  actionsApps: ReadonlySet<number>,
): Record<string, unknown> | undefined {
  const newestId = numberOrUndefined(placed.run.id);
  if (placed.workflowRun === undefined || newestId === undefined) {
    return undefined;
  }
  let latest: Record<string, unknown> | undefined;
  let latestId = newestId;
  for (const run of unplaced) {
    const app = numberOrUndefined(run.app);
    const id = numberOrUndefined(run.id);
    if (
      app !== undefined &&
      actionsApps.has(app) &&
      text(run.name) === text(placed.run.name) &&
      id !== undefined &&
      id > latestId
    ) {
      latest = run;
      latestId = id;
    }
  }
  return latest;
}

/** The run that decides a check: its newest run, unless a later run of it
 * is still on its way. Then it's a run still to finish, with no outcome,
 * so the check reads as pending. */
function deciding(
  placed: Placed,
  workflowRuns: readonly WorkflowRun[],
  unplaced: readonly Record<string, unknown>[],
  actionsApps: ReadonlySet<number>,
): Record<string, unknown> {
  const going = laterWorkflowRunStillGoing(placed, workflowRuns);
  if (going?.status !== undefined) {
    return { name: placed.run.name, status: going.status, conclusion: null };
  }
  const unlisted = unlistedLaterRun(placed, unplaced, actionsApps);
  if (unlisted !== undefined) {
    // The unlisted run may already have finished, but which check it
    // finished for isn't known yet, so it still counts as pending.
    const status = text(unlisted.status);
    return {
      name: placed.run.name,
      status: status === "" || status === "completed" ? "pending" : status,
      conclusion: null,
    };
  }
  return placed.run;
}

/** The run that decides each check, where a check is a name within one
 * workflow. One commit can carry several runs of the same check: a
 * description edit or a re-run starts a new run, which often cancels the
 * old one, and GitHub lists both. Only the newest of those counts, so an
 * old cancelled or failed run that a later one replaced doesn't, and a
 * check whose newer run hasn't appeared yet is pending. Runs from different
 * workflows never replace each other, even with the same name: a pull
 * request can add a workflow whose job copies a required check's name, and
 * GitHub still holds the real check's failure against it. `workflowRuns`
 * lists the commit's workflow runs; a run whose check suite isn't among
 * them (any run outside GitHub Actions) is grouped by its app and ordered
 * by check run id. */
export function newestRunPerCheck(
  runs: readonly Record<string, unknown>[],
  workflowRuns: readonly WorkflowRun[] = [],
): Record<string, unknown>[] {
  const bySuite = new Map(workflowRuns.map((w) => [w.suite, w]));
  const newest = new Map<string, Placed>();
  const unplaced: Record<string, unknown>[] = [];
  const actionsApps = new Set<number>();
  for (const run of runs) {
    const suite = numberOrUndefined(run.suite);
    const workflowRun = suite === undefined ? undefined : bySuite.get(suite);
    const app = numberOrUndefined(run.app);
    if (workflowRun === undefined) {
      unplaced.push(run);
    } else if (app !== undefined) {
      actionsApps.add(app);
    }
    const source =
      workflowRun === undefined
        ? `app ${app === undefined ? "" : String(app)}`
        : `workflow ${String(workflowRun.workflow)}`;
    const key = `${source}\n${text(run.name)}`;
    const candidate = { run, workflowRun };
    const seen = newest.get(key);
    if (seen === undefined || isNewer(candidate, seen)) {
      newest.set(key, candidate);
    }
  }
  return [...newest.values()].map((placed) =>
    deciding(placed, workflowRuns, unplaced, actionsApps),
  );
}
