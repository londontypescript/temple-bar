// The `main` ruleset setup creates: pull request required (squash merge
// only), 0 approvals, linear history, signed commits, no force-push, no
// deletion, targets the default branch, no bypass. Its definition lives here
// and only here: setup creates it from rulesetBody(), and the gate compares
// GitHub's rules with the same function. Offering it, beside the judge's
// ruleset and CodeQL, is github-protection.ts.

import type { Context } from "../context.ts";
import { JUDGE_RULESET_NAME } from "./judge-ruleset.ts";

const MAIN_RULESET_NAME = "main: pull requests only";

export const MANUAL_RULESET_STEPS =
  "On GitHub, under Settings > Rules > Rulesets, add a ruleset targeting " +
  "the default branch that:\n" +
  "  - requires a pull request before merging, with 0 required approvals,\n" +
  "    and allows squash merges only\n" +
  "  - requires linear history and signed commits\n" +
  "  - blocks force pushes\n" +
  "  - restricts deletions\n" +
  "  - has no bypass list";

export interface RulesetSummary {
  readonly id?: unknown;
  readonly target?: unknown;
  readonly name?: unknown;
}

function isRulesetSummaryArray(value: unknown): value is RulesetSummary[] {
  return Array.isArray(value);
}

/** Best-effort: a ruleset targeting a branch at all is treated as covering
 * the default branch, since a from-scratch repo has only one branch. The
 * judge's ruleset doesn't count: it protects nothing else. */
export function hasBranchRuleset(rulesets: readonly RulesetSummary[]): boolean {
  return rulesets.some(
    (entry) => entry.target === "branch" && entry.name !== JUDGE_RULESET_NAME,
  );
}

/** The id of the ruleset setup created, found by its name. A ruleset the
 * project made itself is never edited: setup didn't make it, so it says
 * what to add by hand instead. */
export function mainRulesetId(
  rulesets: readonly RulesetSummary[],
): number | undefined {
  const found = rulesets.find((entry) => entry.name === MAIN_RULESET_NAME);
  return typeof found?.id === "number" ? found.id : undefined;
}

/** The rulesets GitHub already has. A listing that can't be read counts as
 * empty: setup then offers to create them, rather than guess they exist. */
export async function listRulesets(
  ctx: Context,
  repoRoot: string,
  path: string,
): Promise<RulesetSummary[]> {
  const listed = await ctx.gh.run(["api", path], repoRoot);
  if (listed.code !== 0) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(listed.stdout);
    return isRulesetSummaryArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * A ruleset's JSON body, sent whole through `gh api --input -`. Its shape
 * matches a ruleset read back from GitHub's API. `gh api -f` field paths
 * were tried first and can't express this: they attached the pull_request
 * parameters to the wrong rule and sent `exclude` as `[""]`.
 */
export interface RulesetRule {
  readonly type: string;
  readonly parameters?: Record<string, unknown>;
}

export interface RulesetBody {
  readonly name: string;
  readonly target: string;
  readonly enforcement: string;
  readonly bypass_actors: unknown[];
  readonly conditions: object;
  readonly rules: RulesetRule[];
}

export function rulesetBody(): RulesetBody {
  return {
    name: MAIN_RULESET_NAME,
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
          // GitHub signs its own squash merges, but not rebase merges, so
          // squash is the only method that satisfies required_signatures.
          allowed_merge_methods: ["squash"],
        },
      },
      { type: "required_linear_history" },
      { type: "required_signatures" },
      // The judge's ruleset requires up-to-date branches for its check.
      // CodeQL's rule is added once it has analysed the default branch.
      // The gate and title checks are added once their workflows land,
      // with their own up-to-date policy (required-checks.ts).
    ],
  };
}
