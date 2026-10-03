// The second ruleset setup creates: it requires the judge's check, and
// branches up to date with `main` before they merge. See
// docs/adr/0011-which-checks-judge-a-pull-request.md.
//
// It is a ruleset of its own, beside the `main` ruleset, for two reasons:
//
// - It can only be created once the judge workflow is on the default
//   branch. Requiring a check that never reports would block every pull
//   request, the one that adds the judge included. On a repo setup creates
//   from scratch the workflow is in the first commit; anywhere else it
//   arrives with the setup pull request, and a second run of setup adds this
//   ruleset afterwards without touching the first.
// - A change to the checks fails the judge on purpose, and the maintainer
//   merges it after review. That needs the maintainer's role allowed past
//   this one rule, and only this one: the `main` ruleset stays with nobody
//   allowed past it.

import type { Context } from "../context.ts";
import {
  GITHUB_ACTIONS_APP_ID,
  JUDGE_CHECK,
  JUDGE_WORKFLOW_PATH,
} from "../judge/workflow.ts";
import type { RulesetBody } from "./github-ruleset.ts";
import { RERUN_INIT, type GithubOrigin } from "./requirements.ts";

export const JUDGE_RULESET_NAME = "main: the judge";

/** GitHub's id for the repository admin role in a ruleset's actor list. */
const REPOSITORY_ADMIN_ROLE = 5;

export const MANUAL_JUDGE_RULESET_STEPS =
  `On GitHub, under Settings > Rules > Rulesets, add a ruleset named ` +
  `"${JUDGE_RULESET_NAME}" targeting the default branch that:\n` +
  `  - requires the status check "${JUDGE_CHECK}" from GitHub Actions\n` +
  "  - requires branches to be up to date before merging";

export const JUDGE_WAITING =
  `The judge's check isn't required yet: ${JUDGE_WORKFLOW_PATH} isn't on ` +
  "the default branch, and requiring a check that never runs would block " +
  "every pull request. Once the setup pull request is merged, run " +
  `${RERUN_INIT} again to require it.`;

export function judgeRulesetBody(): RulesetBody {
  return {
    name: JUDGE_RULESET_NAME,
    target: "branch",
    enforcement: "active",
    bypass_actors: [
      {
        actor_id: REPOSITORY_ADMIN_ROLE,
        actor_type: "RepositoryRole",
        // Through a pull request only: never a direct push to `main`.
        bypass_mode: "pull_request",
      },
    ],
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          // A branch must contain the latest `main` before it merges, so
          // the judge and CI have seen exactly what will land.
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: false,
          required_status_checks: [
            { context: JUDGE_CHECK, integration_id: GITHUB_ACTIONS_APP_ID },
          ],
        },
      },
    ],
  };
}

interface NamedRuleset {
  readonly name?: unknown;
}

/** Best-effort, by name: setup is what creates it, under this name. */
export function hasJudgeRuleset(rulesets: readonly NamedRuleset[]): boolean {
  return rulesets.some((entry) => entry.name === JUDGE_RULESET_NAME);
}

/** Whether the judge workflow is on the default branch, where
 * pull_request_target reads it from. */
export async function judgeIsOnDefaultBranch(
  ctx: Context,
  repoRoot: string,
  origin: GithubOrigin,
): Promise<boolean> {
  const result = await ctx.gh.run(
    [
      "api",
      `repos/${origin.owner}/${origin.repo}/contents/${JUDGE_WORKFLOW_PATH}`,
      "--silent",
    ],
    repoRoot,
  );
  return result.code === 0;
}
