// Effective rules shared by gate tests; excluded from the package build.
import { codeScanningRule } from "../../init/code-scanning.ts";
import {
  REQUIRED_CHECKS,
  requiredChecksRule,
} from "../../init/required-checks.ts";
import type { EffectiveRule } from "../ruleset-compare.ts";

// The shape of a real answer from GET /repos/{o}/{r}/rules/branches/main:
// the rules setup creates plus extras a repo added on its own.
const SOURCE = {
  ruleset_source_type: "Repository",
  ruleset_source: "o/r",
  ruleset_id: 1,
};
export function rule(
  type: string,
  parameters?: Record<string, unknown>,
): EffectiveRule {
  return parameters === undefined
    ? { type, ...SOURCE }
    : { type, parameters, ...SOURCE };
}
export function pullRequest(
  overrides: Record<string, unknown> = {},
): EffectiveRule {
  return rule("pull_request", {
    required_approving_review_count: 0,
    dismiss_stale_reviews_on_push: false,
    required_reviewers: [],
    require_code_owner_review: false,
    require_last_push_approval: false,
    required_review_thread_resolution: false,
    allowed_merge_methods: ["squash"],
    ...overrides,
  });
}
export function goodRules(): EffectiveRule[] {
  return [
    rule("deletion"),
    rule("non_fast_forward"),
    pullRequest(),
    rule("required_linear_history"),
    rule("required_signatures"),
    // Extras a repo may add on top.
    rule("required_status_checks", {
      strict_required_status_checks_policy: true,
      required_status_checks: [{ context: "check" }],
    }),
    rule(
      "required_status_checks",
      requiredChecksRule(REQUIRED_CHECKS).parameters,
    ),
    rule("code_scanning", codeScanningRule().parameters),
    // The judge's ruleset, reported as a rule of its own.
    rule("required_status_checks", {
      strict_required_status_checks_policy: true,
      do_not_enforce_on_create: false,
      required_status_checks: [
        { context: "temple-bar judge", integration_id: 15368 },
      ],
    }),
  ];
}
export function without(type: string): EffectiveRule[] {
  return goodRules().filter((entry) => entry.type !== type);
}
