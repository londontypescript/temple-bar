// Which of the check runs on a commit count. GitHub lists every run of
// every check, including runs that later runs replaced, so merge narrows
// them to the ones GitHub's required checks would look at.

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Whether run `a` started after run `b`. Start times are ISO strings, so
 * they compare as text; check run ids grow with each new run, so they
 * settle a tie or a run that hasn't started yet. */
function isNewer(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const aStarted = text(a.started_at);
  const bStarted = text(b.started_at);
  if (aStarted !== bStarted && aStarted !== "" && bStarted !== "") {
    return aStarted > bStarted;
  }
  const aId = typeof a.id === "number" ? a.id : 0;
  const bId = typeof b.id === "number" ? b.id : 0;
  return aId > bId;
}

/** The newest run of each check, where a check is a name within one
 * workflow. One commit can carry several runs of the same check: a
 * description edit or a re-run starts a new workflow run, which often
 * cancels the old one, and GitHub lists both. Only the newest of those
 * counts, so an old cancelled or failed run that a later one replaced
 * doesn't. Runs from different workflows never replace each other, even
 * with the same name: a pull request can add a workflow whose job copies a
 * required check's name, and GitHub still holds the real check's failure
 * against it. `workflowOf` maps a run's check suite to its workflow; a run
 * outside GitHub Actions is grouped by its app. */
export function newestRunPerCheck(
  runs: readonly Record<string, unknown>[],
  workflowOf: ReadonlyMap<number, number> = new Map(),
): Record<string, unknown>[] {
  const newest = new Map<string, Record<string, unknown>>();
  for (const run of runs) {
    const suite = typeof run.suite === "number" ? run.suite : undefined;
    const workflow = suite === undefined ? undefined : workflowOf.get(suite);
    const source =
      workflow === undefined
        ? `app ${typeof run.app === "number" ? String(run.app) : ""}`
        : `workflow ${String(workflow)}`;
    const key = `${source}\n${text(run.name)}`;
    const seen = newest.get(key);
    if (seen === undefined || isNewer(run, seen)) {
      newest.set(key, run);
    }
  }
  return [...newest.values()];
}
