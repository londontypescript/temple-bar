// Everything `temple-bar merge` asks GitHub, through the gh seam. Each reader
// returns plain data; deciding whether to refuse is left to the caller, so
// these stay easy to fake and to read.

import type { Context } from "../context.ts";
import type { GhResult } from "../seams/gh.ts";
import { newestRunPerCheck } from "./check-runs.ts";
import { refuse } from "./refusal.ts";

export interface Repository {
  /** "owner/name", as the REST API paths want it. */
  readonly nameWithOwner: string;
  readonly defaultBranch: string;
}

type PullRequestState = "OPEN" | "CLOSED" | "MERGED";

export interface PullRequest {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: PullRequestState;
  readonly isDraft: boolean;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly headRefOid: string;
  readonly isCrossRepository: boolean;
}

function failure(result: GhResult): string {
  if (result.notFound) {
    return "the gh CLI is not installed (https://cli.github.com)";
  }
  return result.stderr.trim() || `gh exited with code ${String(result.code)}`;
}

async function ghJson(
  ctx: Context,
  args: readonly string[],
  cwd: string,
  what: string,
): Promise<Record<string, unknown>> {
  const result = await ctx.gh.run(args, cwd);
  if (result.code !== 0) {
    refuse(`could not read ${what}: ${failure(result)}`);
  }
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Falls through to the refusal below.
  }
  return refuse(`could not read ${what}: gh returned something unexpected`);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function readRepository(
  ctx: Context,
  cwd: string,
): Promise<Repository> {
  const raw = await ghJson(
    ctx,
    ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"],
    cwd,
    "the repository from GitHub",
  );
  const ref = raw.defaultBranchRef as Record<string, unknown> | null;
  const repository = {
    nameWithOwner: text(raw.nameWithOwner),
    defaultBranch: text(ref?.name),
  };
  if (repository.nameWithOwner === "" || repository.defaultBranch === "") {
    refuse("could not read the repository's default branch from GitHub");
  }
  return repository;
}

const PULL_REQUEST_FIELDS =
  "number,title,body,state,isDraft,baseRefName,headRefName,headRefOid,isCrossRepository";

export async function readPullRequest(
  ctx: Context,
  prNumber: number,
  cwd: string,
): Promise<PullRequest> {
  const raw = await ghJson(
    ctx,
    ["pr", "view", String(prNumber), "--json", PULL_REQUEST_FIELDS],
    cwd,
    `pull request #${String(prNumber)}`,
  );
  const state = text(raw.state);
  return {
    number: typeof raw.number === "number" ? raw.number : prNumber,
    title: text(raw.title),
    body: text(raw.body),
    state: state === "MERGED" || state === "CLOSED" ? state : "OPEN",
    isDraft: raw.isDraft === true,
    baseRefName: text(raw.baseRefName),
    headRefName: text(raw.headRefName),
    headRefOid: text(raw.headRefOid),
    isCrossRepository: raw.isCrossRepository === true,
  };
}

/** Runs a paginated `gh api` call whose --jq filter prints one JSON object
 * per line, and returns those objects. */
async function apiLines(
  ctx: Context,
  endpoint: string,
  jq: string,
  cwd: string,
): Promise<{ result: GhResult; items: Record<string, unknown>[] }> {
  const result = await ctx.gh.run(
    ["api", "--paginate", endpoint, "--jq", jq],
    cwd,
  );
  const items: Record<string, unknown>[] = [];
  if (result.code === 0) {
    for (const line of result.stdout.split("\n")) {
      if (line.trim() !== "") {
        items.push(JSON.parse(line) as Record<string, unknown>);
      }
    }
  }
  return { result, items };
}

type CheckState = "pending" | "passed" | "failed";

export interface Check {
  readonly name: string;
  readonly state: CheckState;
  /** GitHub's own word for the outcome, e.g. "failure" or "in_progress". */
  readonly detail: string;
}

// A check run that ended in one of these didn't find a problem. Anything
// else that finished (failure, cancelled, timed_out, action_required,
// stale) did, or never really ran.
const PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

/** Every check on exactly `sha`: GitHub Actions check runs and the older
 * commit statuses, the newest run of each. Read by commit, never by pull
 * request, because a pull request's head can lag behind the pushed
 * commit. */
export async function readChecks(
  ctx: Context,
  repository: Repository,
  sha: string,
  cwd: string,
): Promise<Check[]> {
  const base = `repos/${repository.nameWithOwner}/commits/${sha}`;
  const runs = await apiLines(
    ctx,
    `${base}/check-runs?per_page=100`,
    ".check_runs[] | {name, status, conclusion, id, started_at, suite: .check_suite.id, app: .app.id}",
    cwd,
  );
  if (runs.result.code !== 0) {
    refuse(`could not read the checks on ${sha}: ${failure(runs.result)}`);
  }
  // Which workflow each check suite belongs to, so runs are only compared
  // with earlier runs of the same workflow.
  const workflowRuns = await apiLines(
    ctx,
    `repos/${repository.nameWithOwner}/actions/runs?head_sha=${sha}&per_page=100`,
    ".workflow_runs[] | {suite: .check_suite_id, workflow: .workflow_id}",
    cwd,
  );
  if (workflowRuns.result.code !== 0) {
    refuse(
      `could not read the workflow runs on ${sha}: ${failure(workflowRuns.result)}`,
    );
  }
  const workflowOf = new Map<number, number>();
  for (const item of workflowRuns.items) {
    if (typeof item.suite === "number" && typeof item.workflow === "number") {
      workflowOf.set(item.suite, item.workflow);
    }
  }
  const statuses = await apiLines(
    ctx,
    `${base}/status?per_page=100`,
    ".statuses[] | {context, state}",
    cwd,
  );
  if (statuses.result.code !== 0) {
    refuse(
      `could not read the statuses on ${sha}: ${failure(statuses.result)}`,
    );
  }

  // The combined status endpoint already gives only the newest status of
  // each context, so only the check runs need narrowing.
  const checks: Check[] = newestRunPerCheck(runs.items, workflowOf).map(
    (run) => {
      const status = text(run.status);
      const conclusion = text(run.conclusion);
      if (status !== "completed") {
        return { name: text(run.name), state: "pending", detail: status };
      }
      return {
        name: text(run.name),
        state: PASSING_CONCLUSIONS.has(conclusion) ? "passed" : "failed",
        detail: conclusion,
      };
    },
  );
  for (const status of statuses.items) {
    const state = text(status.state);
    checks.push({
      name: text(status.context),
      state:
        state === "success"
          ? "passed"
          : state === "pending"
            ? "pending"
            : "failed",
      detail: state,
    });
  }
  return checks;
}

/** The checks the default branch's rulesets require. Empty when there are
 * none or they can't be read: then any check at all is waited for. */
export async function readRequiredChecks(
  ctx: Context,
  repository: Repository,
  cwd: string,
): Promise<string[]> {
  const result = await ctx.gh.run(
    [
      "api",
      `repos/${repository.nameWithOwner}/rules/branches/${encodeURIComponent(repository.defaultBranch)}`,
      "--jq",
      '.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context',
    ],
    cwd,
  );
  if (result.code !== 0) {
    return [];
  }
  return [
    ...new Set(
      result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    ),
  ];
}

export interface Alert {
  readonly number: number;
  readonly rule: string;
  readonly path: string;
}

export function describeAlerts(alerts: readonly Alert[]): string {
  return alerts
    .map((alert) => `#${String(alert.number)} ${alert.rule} in ${alert.path}`)
    .join(", ");
}

/** Open code-scanning alerts, or "not-set-up" for a repository without code
 * scanning, which has no alerts to block on. Refuses when GitHub can't be
 * read, because "couldn't tell" must not pass for "none open". */
export async function readOpenAlerts(
  ctx: Context,
  repository: Repository,
  filter: { readonly pr: number } | { readonly branch: string },
  cwd: string,
): Promise<Alert[] | "not-set-up"> {
  const query =
    "pr" in filter
      ? `pr=${String(filter.pr)}`
      : `ref=${encodeURIComponent(`refs/heads/${filter.branch}`)}`;
  const { result, items } = await apiLines(
    ctx,
    `repos/${repository.nameWithOwner}/code-scanning/alerts?${query}&state=open&per_page=100`,
    ".[] | {number, rule: .rule.id, path: .most_recent_instance.location.path}",
    cwd,
  );
  if (result.code !== 0) {
    if (
      /no analysis found|not enabled|advanced security/i.test(result.stderr)
    ) {
      return "not-set-up";
    }
    refuse(`could not read code-scanning alerts: ${failure(result)}`);
  }
  return items.map((item) => ({
    number: typeof item.number === "number" ? item.number : 0,
    rule: text(item.rule),
    path: text(item.path),
  }));
}

/** How many open issues carry the `incident` label; undefined if unknown. */
export async function countOpenIncidents(
  ctx: Context,
  cwd: string,
): Promise<number | undefined> {
  const result = await ctx.gh.run(
    [
      "issue",
      "list",
      "--label",
      "incident",
      "--state",
      "open",
      "--limit",
      "1000",
      "--json",
      "number",
      "--jq",
      "length",
    ],
    cwd,
  );
  const count = Number.parseInt(result.stdout.trim(), 10);
  return result.code === 0 && Number.isFinite(count) ? count : undefined;
}

/** The squash merge itself. `--match-head-commit` makes GitHub refuse if
 * the head moved after the checks were read, so what merges is exactly
 * what was checked. No `--admin`: a ruleset is never bypassed. */
export async function squashMerge(
  ctx: Context,
  merge: {
    readonly prNumber: number;
    readonly sha: string;
    readonly subject: string;
    readonly body: string;
  },
  cwd: string,
): Promise<GhResult> {
  return ctx.gh.run(
    [
      "pr",
      "merge",
      String(merge.prNumber),
      "--squash",
      "--match-head-commit",
      merge.sha,
      "--subject",
      merge.subject,
      "--body",
      merge.body,
    ],
    cwd,
  );
}

export function describeGhFailure(result: GhResult): string {
  return failure(result);
}
