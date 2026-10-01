// Offers to create the `main` ruleset: pull request required (squash merge
// only), 0 approvals, linear history, signed commits, branches up to date
// before merging, no force-push, no deletion, targets the default branch, no
// bypass. Only an explicit yes (the prompt, or the --create-ruleset flag an
// agent passes after the user said yes in chat) creates it. With no
// terminal, or when creation fails, the manual steps are printed and `init`
// ends non-zero, so an unprotected repo never looks set up.

import type { Context } from "../context.ts";
import { RERUN_INIT, type GithubOrigin } from "./requirements.ts";

export const MANUAL_RULESET_STEPS =
  "On GitHub, under Settings > Rules > Rulesets, add a ruleset targeting " +
  "the default branch that:\n" +
  "  - requires a pull request before merging, with 0 required approvals,\n" +
  "    and allows squash merges only\n" +
  "  - requires linear history and signed commits\n" +
  "  - requires branches to be up to date before merging (add a required\n" +
  '    status check, and tick "Require branches to be up to date")\n' +
  "  - blocks force pushes\n" +
  "  - restricts deletions\n" +
  "  - has no bypass list";

export function rulesetQuestion(): string {
  return (
    "Create the `main` ruleset on GitHub now (pull request required, " +
    "squash merges only, linear history, signed commits, branches up to " +
    "date, no force-push, no deletion, no bypass)?"
  );
}

interface RulesetSummary {
  readonly target?: unknown;
}

function isRulesetSummaryArray(value: unknown): value is RulesetSummary[] {
  return Array.isArray(value);
}

/** Best-effort: a ruleset targeting a branch at all is treated as covering
 * the default branch, since a from-scratch repo has only one branch. */
function hasBranchRuleset(rulesets: unknown): boolean {
  if (!isRulesetSummaryArray(rulesets)) {
    return false;
  }
  return rulesets.some((entry) => entry.target === "branch");
}

/**
 * The ruleset's JSON body, sent whole through `gh api --input -`. Its shape
 * matches a ruleset read back from GitHub's API. `gh api -f` field paths
 * were tried first and can't express this: they attached the pull_request
 * parameters to the wrong rule and sent `exclude` as `[""]`.
 */
export function rulesetBody(): object {
  return {
    name: "main: pull requests only",
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
      {
        // Without strict, a pull request that passed CI on an older main
        // can merge untested against the current one. The list of checks
        // is empty because setup can't know a repo's check names; the
        // policy starts to bite once a check is added to it.
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: [],
        },
      },
    ],
  };
}

export type RulesetOutcome =
  | { readonly kind: "exists"; readonly message: string }
  | { readonly kind: "created"; readonly message: string }
  /** The user said no: their choice, so `init` still succeeds. */
  | { readonly kind: "declined"; readonly message: string }
  /** No terminal to ask in, or creation failed: `init` ends non-zero. */
  | { readonly kind: "not-created"; readonly message: string };

export async function offerRuleset(
  ctx: Context,
  repoRoot: string,
  origin: GithubOrigin,
  /** The user already said yes in chat and the agent passed
   * --create-ruleset: answers this question, and only this one. */
  approved = false,
): Promise<RulesetOutcome> {
  const path = `repos/${origin.owner}/${origin.repo}/rulesets`;
  const listed = await ctx.gh.run(["api", path], repoRoot);

  if (listed.code === 0) {
    try {
      const parsed: unknown = JSON.parse(listed.stdout);
      if (hasBranchRuleset(parsed)) {
        return {
          kind: "exists",
          message:
            "A ruleset for the default branch already exists; left it alone.",
        };
      }
    } catch {
      // Unparseable listing: fall through and offer creation anyway.
    }
  }

  const answer = approved ? "yes" : await ctx.prompt.confirm(rulesetQuestion());
  if (answer === "no") {
    return {
      kind: "declined",
      message: `OK, no ruleset was created. To add it yourself:\n${MANUAL_RULESET_STEPS}`,
    };
  }
  if (answer === "no-terminal") {
    return {
      kind: "not-created",
      message: `No terminal to ask in, so no ruleset was created. An agent: ask the user, and only if they say yes run ${RERUN_INIT} --create-ruleset. Or add it yourself:\n${MANUAL_RULESET_STEPS}`,
    };
  }

  const result = await ctx.gh.run(
    ["api", "--method", "POST", path, "--input", "-"],
    repoRoot,
    JSON.stringify(rulesetBody()),
  );
  if (result.code === 0) {
    return {
      kind: "created",
      message: "Created the `main` ruleset on GitHub.",
    };
  }
  return {
    kind: "not-created",
    message:
      `Creating the ruleset failed:\n${(result.stderr || result.stdout).trim()}\n` +
      `To add it yourself:\n${MANUAL_RULESET_STEPS}`,
  };
}
