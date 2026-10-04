// Offers to create the rulesets that protect `main`. The `main` ruleset:
// pull request required (squash merge only), 0 approvals, linear history,
// signed commits, no force-push, no deletion, targets the default branch, no
// bypass. Beside it, once the judge workflow is on the default branch, the
// judge's ruleset (judge-ruleset.ts): the judge's check required, and
// branches up to date. Only an explicit yes (the prompt, or the
// --create-ruleset flag an agent passes after the user said yes in chat)
// creates them. With no terminal, or when creation fails, the manual steps
// are printed and `init` ends non-zero, so an unprotected repo never looks
// set up.

import type { Context } from "../context.ts";
import {
  hasJudgeRuleset,
  judgeIsOnDefaultBranch,
  judgeRulesetBody,
  JUDGE_RULESET_NAME,
  JUDGE_WAITING,
  MANUAL_JUDGE_RULESET_STEPS,
} from "./judge-ruleset.ts";
import { rerunInit, type GithubOrigin } from "./requirements.ts";

export const MANUAL_RULESET_STEPS =
  "On GitHub, under Settings > Rules > Rulesets, add a ruleset targeting " +
  "the default branch that:\n" +
  "  - requires a pull request before merging, with 0 required approvals,\n" +
  "    and allows squash merges only\n" +
  "  - requires linear history and signed commits\n" +
  "  - blocks force pushes\n" +
  "  - restricts deletions\n" +
  "  - has no bypass list";

const MAIN_SUMMARY =
  "pull request required, squash merges only, linear history, signed " +
  "commits, no force-push, no deletion, no bypass";

const JUDGE_SUMMARY =
  "the judge's check required, and branches up to date with `main`";

/** The one question, naming whichever rulesets are about to be created. */
export function rulesetQuestion(main = true, judge = false): string {
  if (main && judge) {
    return `Create the \`main\` rulesets on GitHub now (${MAIN_SUMMARY}; ${JUDGE_SUMMARY})?`;
  }
  if (judge) {
    return `Create the judge's ruleset on GitHub now (${JUDGE_SUMMARY})?`;
  }
  return `Create the \`main\` ruleset on GitHub now (${MAIN_SUMMARY})?`;
}

interface RulesetSummary {
  readonly target?: unknown;
  readonly name?: unknown;
}

function isRulesetSummaryArray(value: unknown): value is RulesetSummary[] {
  return Array.isArray(value);
}

/** Best-effort: a ruleset targeting a branch at all is treated as covering
 * the default branch, since a from-scratch repo has only one branch. The
 * judge's ruleset doesn't count: it protects nothing else. */
function hasBranchRuleset(rulesets: readonly RulesetSummary[]): boolean {
  return rulesets.some(
    (entry) => entry.target === "branch" && entry.name !== JUDGE_RULESET_NAME,
  );
}

/** The rulesets GitHub already has. A listing that can't be read counts as
 * empty: setup then offers to create them, rather than guess they exist. */
async function listRulesets(
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
      // "Branches up to date" lives in the judge's ruleset: GitHub's rule
      // only acts on named required checks, and the judge's is the one
      // check setup knows every repo has.
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

function withWaiting(message: string, waiting: boolean): string {
  return waiting ? `${message}\n${JUDGE_WAITING}` : message;
}

export async function offerRuleset(
  ctx: Context,
  repoRoot: string,
  origin: GithubOrigin,
  /** The user already said yes in chat and the agent passed
   * --create-ruleset: answers this question, and only this one. */
  approved = false,
): Promise<RulesetOutcome> {
  const path = `repos/${origin.owner}/${origin.repo}/rulesets`;
  const existing = await listRulesets(ctx, repoRoot, path);
  const needMain = !hasBranchRuleset(existing);
  const judgeMissing = !hasJudgeRuleset(existing);
  const judgeReady =
    judgeMissing && (await judgeIsOnDefaultBranch(ctx, repoRoot, origin));
  const needJudge = judgeMissing && judgeReady;
  const waiting = judgeMissing && !judgeReady;

  const wanted = [
    ...(needMain ? [rulesetBody()] : []),
    ...(needJudge ? [judgeRulesetBody()] : []),
  ];
  if (wanted.length === 0) {
    return {
      kind: "exists",
      message: withWaiting(
        "The rulesets for the default branch already exist; left them alone.",
        waiting,
      ),
    };
  }

  const manual = [
    ...(needMain ? [MANUAL_RULESET_STEPS] : []),
    ...(needJudge ? [MANUAL_JUDGE_RULESET_STEPS] : []),
  ].join("\nThen:\n");
  const answer = approved
    ? "yes"
    : await ctx.prompt.confirm(rulesetQuestion(needMain, needJudge));
  if (answer === "no") {
    return {
      kind: "declined",
      message: `OK, no ruleset was created. To add it yourself:\n${manual}`,
    };
  }
  if (answer === "no-terminal") {
    return {
      kind: "not-created",
      message: `No terminal to ask in, so no ruleset was created. An agent: ask the user, and only if they say yes run ${rerunInit("--create-ruleset")}. Or add it yourself:\n${manual}`,
    };
  }

  const created: string[] = [];
  for (const body of wanted) {
    const result = await ctx.gh.run(
      ["api", "--method", "POST", path, "--input", "-"],
      repoRoot,
      JSON.stringify(body),
    );
    if (result.code !== 0) {
      const done =
        created.length === 0 ? "" : `Created ${created.join(" and ")}, but `;
      return {
        kind: "not-created",
        message:
          `${done}creating "${body.name}" failed:\n${(result.stderr || result.stdout).trim()}\n` +
          `To add it yourself:\n${body === wanted[0] ? manual : MANUAL_JUDGE_RULESET_STEPS}`,
      };
    }
    created.push(`"${body.name}"`);
  }
  return {
    kind: "created",
    message: withWaiting(
      `Created the ${created.join(" and ")} ruleset${created.length > 1 ? "s" : ""} on GitHub.`,
      waiting,
    ),
  };
}
