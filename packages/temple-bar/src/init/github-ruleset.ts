// Offers to create the `main` ruleset (decision 4, plan §3 1.7): pull
// request required, 0 approvals, no force-push, no deletion, targets the
// default branch, no bypass. Only an explicit yes creates it. With no
// terminal, or when creation fails, the manual steps are printed and `init`
// ends non-zero, so an unprotected repo never looks set up.

import type { Context } from "../context.ts";
import type { GithubOrigin } from "./requirements.ts";

export const MANUAL_RULESET_STEPS =
  "On GitHub, under Settings > Rules > Rulesets, add a ruleset targeting " +
  "the default branch that:\n" +
  "  - requires a pull request before merging, with 0 required approvals\n" +
  "  - blocks force pushes\n" +
  "  - restricts deletions\n" +
  "  - has no bypass list";

export function rulesetQuestion(): string {
  return (
    "Create the `main` ruleset on GitHub now (pull request required, no " +
    "force-push, no deletion, no bypass)?"
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

  const answer = await ctx.prompt.confirm(rulesetQuestion());
  if (answer === "no") {
    return {
      kind: "declined",
      message: `OK, no ruleset was created. To add it yourself:\n${MANUAL_RULESET_STEPS}`,
    };
  }
  if (answer === "no-terminal") {
    return {
      kind: "not-created",
      message: `No terminal to ask in, so no ruleset was created. To add it yourself:\n${MANUAL_RULESET_STEPS}`,
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
