// Setup requires each fixed workflow's check only once that workflow is on
// the default branch. Requiring it earlier would block the pull request
// that adds it. The checks go in setup's `main` ruleset, with no bypass.

import type { Context } from "../context.ts";
import { GITHUB_ACTIONS_APP_ID } from "../judge/workflow.ts";
import { withCodeQl } from "./code-scanning.ts";
import type { RulesetRule } from "./github-ruleset.ts";
import { RERUN_INIT, type GithubOrigin } from "./requirements.ts";
import {
  field,
  readJson,
  readRuleset,
  rulesFrom,
  updateRuleset,
  type RulesetRead,
} from "./ruleset-update.ts";
import {
  GATE_CHECK,
  GATE_WORKFLOW_PATH,
  PR_TITLE_CHECK,
  PR_TITLE_WORKFLOW_PATH,
} from "./workflows.ts";

export const REQUIRED_CHECKS = [
  { context: GATE_CHECK, path: GATE_WORKFLOW_PATH },
  { context: PR_TITLE_CHECK, path: PR_TITLE_WORKFLOW_PATH },
] as const;

type RequiredCheck = (typeof REQUIRED_CHECKS)[number];

export function checksSummary(checks: readonly RequiredCheck[]): string {
  return `the ${checks.map((check) => `"${check.context}"`).join(" and ")} ${checks.length === 1 ? "check" : "checks"} required from GitHub Actions, on branches up to date with \`main\``;
}

export function manualChecksSteps(checks: readonly RequiredCheck[]): string {
  return (
    "On GitHub, under Settings > Rules > Rulesets, edit the `main` ruleset so that it:\n" +
    `  - requires the status ${checks.length === 1 ? "check" : "checks"} ${checks.map((check) => `"${check.context}"`).join(" and ")} from GitHub Actions\n` +
    "  - requires branches to be up to date before merging"
  );
}

export function requiredChecksRule(
  checks: readonly RequiredCheck[],
): RulesetRule {
  return {
    type: "required_status_checks",
    parameters: {
      strict_required_status_checks_policy: true,
      do_not_enforce_on_create: false,
      required_status_checks: checks.map((check) => ({
        context: check.context,
        integration_id: GITHUB_ACTIONS_APP_ID,
      })),
    },
  };
}

function entries(rule: RulesetRule): unknown[] {
  const listed: unknown =
    rule.type === "required_status_checks"
      ? rule.parameters?.required_status_checks
      : undefined;
  return Array.isArray(listed) ? listed : [];
}

/** Shared with the gate: one qualifying active rule is enough per context;
 * effective rules already exclude disabled and evaluate-only rulesets. */
export function contextIsRequired(
  rules: readonly RulesetRule[],
  context: string,
): boolean {
  return rules.some(
    (rule) =>
      rule.parameters?.strict_required_status_checks_policy === true &&
      entries(rule).some(
        (entry) =>
          field(entry, "context") === context &&
          field(entry, "integration_id") === GITHUB_ACTIONS_APP_ID,
      ),
  );
}

export function contextIsListed(
  rules: readonly RulesetRule[],
  context: string,
): boolean {
  return rules.some((rule) =>
    entries(rule).some((entry) => field(entry, "context") === context),
  );
}

/** One rule per type: replace stale entries for our contexts, retaining
 * the project's checks and every other rule. */
export function withRequiredChecks(
  rules: readonly RulesetRule[],
  checks: readonly RequiredCheck[],
): RulesetRule[] {
  if (checks.length === 0) {
    return [...rules];
  }
  const wanted = requiredChecksRule(checks);
  const existing = rules.find((rule) => rule.type === wanted.type);
  if (existing === undefined) {
    return [...rules, wanted];
  }
  const merged: RulesetRule = {
    type: wanted.type,
    parameters: {
      ...existing.parameters,
      ...wanted.parameters,
      required_status_checks: [
        ...entries(existing).filter(
          (entry) =>
            !checks.some((check) => field(entry, "context") === check.context),
        ),
        ...entries(wanted),
      ],
    },
  };
  return rules.map((rule) => (rule === existing ? merged : rule));
}

type WorkflowRead =
  | { readonly kind: "present" | "missing" }
  | { readonly kind: "unreadable"; readonly reason: string };

async function workflowOnDefaultBranch(
  ctx: Context,
  repoRoot: string,
  origin: GithubOrigin,
  path: string,
): Promise<WorkflowRead> {
  const result = await ctx.gh.run(
    [
      "api",
      `repos/${origin.owner}/${origin.repo}/contents/${path}`,
      "--silent",
    ],
    repoRoot,
  );
  if (result.code === 0) {
    return { kind: "present" };
  }
  return /\b404\b/.test(`${result.stderr}\n${result.stdout}`)
    ? { kind: "missing" }
    : { kind: "unreadable", reason: (result.stderr || result.stdout).trim() };
}

function unreadableChecks(reason: string): string {
  return (
    "Couldn't read GitHub, so setup didn't require the checks:\n" +
    `${reason}\nRun ${RERUN_INIT} again once GitHub answers.`
  );
}

export interface RequiredChecksPlan {
  readonly checks: readonly RequiredCheck[];
  readonly note: string;
  readonly problem: string;
  readonly current?: RulesetRead;
}

/** Look in setup's ruleset itself when it exists. A bypassable rule in
 * another ruleset does not replace requiring the check here. */
export async function planRequiredChecks(
  ctx: Context,
  repoRoot: string,
  origin: GithubOrigin,
  needMain: boolean,
  mainId: number | undefined,
): Promise<RequiredChecksPlan> {
  let current: RulesetRead | undefined;
  if (mainId !== undefined) {
    current = await readRuleset(ctx, repoRoot, origin, mainId);
  } else if (!needMain) {
    const repoPath = `repos/${origin.owner}/${origin.repo}`;
    const repo = await readJson(ctx, repoRoot, repoPath);
    const branch = repo.ok ? field(repo.value, "default_branch") : undefined;
    if (!repo.ok || typeof branch !== "string") {
      current = {
        ok: false,
        error: repo.ok ? "unexpected repository reply" : repo.error,
      };
    } else {
      const read = await readJson(
        ctx,
        repoRoot,
        `${repoPath}/rules/branches/${encodeURIComponent(branch)}`,
      );
      const rules = read.ok ? rulesFrom(read.value) : undefined;
      current =
        rules === undefined
          ? {
              ok: false,
              error: read.ok ? "unexpected rules reply" : read.error,
            }
          : { ok: true, rules };
    }
  }
  const checks: RequiredCheck[] = [];
  const waiting: RequiredCheck[] = [];
  const errors: string[] = [];
  for (const check of REQUIRED_CHECKS) {
    if (
      current?.ok === true &&
      contextIsRequired(current.rules, check.context)
    ) {
      continue;
    }
    const workflow = await workflowOnDefaultBranch(
      ctx,
      repoRoot,
      origin,
      check.path,
    );
    if (workflow.kind === "missing") {
      waiting.push(check);
    } else if (workflow.kind === "unreadable") {
      errors.push(`${check.path}: ${workflow.reason}`);
    } else if (current?.ok !== false) {
      checks.push(check);
    }
  }
  if (current?.ok === false) {
    errors.push(current.error);
  }
  return {
    checks,
    note:
      waiting.length === 0
        ? ""
        : `The checks aren't required yet: ${waiting.map((check) => check.path).join(" and ")} still to land on the default branch. Once they're on the default branch, run ${RERUN_INIT} again to require their checks.`,
    problem: errors.length === 0 ? "" : unreadableChecks(errors.join("\n")),
    ...(current === undefined ? {} : { current }),
  };
}

/** The two offers share one write when CodeQL is also being required. */
export async function addRequiredChecks(
  ctx: Context,
  repoRoot: string,
  origin: GithubOrigin,
  mainId: number,
  plan: RequiredChecksPlan,
  codeQl: boolean,
): Promise<{ ok: boolean; message: string }> {
  const result = await updateRuleset(
    ctx,
    repoRoot,
    origin,
    mainId,
    (rules) =>
      withRequiredChecks(codeQl ? withCodeQl(rules) : rules, plan.checks),
    plan.current,
  );
  const names = `${codeQl ? "CodeQL's results and " : ""}${plan.checks.map((check) => `"${check.context}"`).join(" and ")} ${plan.checks.length === 1 ? "check" : "checks"}`;
  return result.ok
    ? { ok: true, message: `Required ${names} in the \`main\` ruleset.` }
    : {
        ok: false,
        message: `requiring ${names} in the \`main\` ruleset failed:\n${result.error}`,
      };
}
