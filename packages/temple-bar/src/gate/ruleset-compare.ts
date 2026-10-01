// Compares the rules GitHub enforces on the default branch with the rules
// `init` creates. The expected side comes from rulesetBody(), the one
// definition of those rules, so the check can't drift from what setup makes.
// Pure: no network, no filesystem.

import { rulesetBody, type RulesetRule } from "../init/github-ruleset.ts";

export interface RulesetProblem {
  readonly kind: "missing" | "weakened";
  readonly rule: string;
  readonly message: string;
}

/** A rule as GitHub reports it from `GET .../rules/branches/{branch}`. */
export interface EffectiveRule {
  readonly type: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export function isEffectiveRuleList(value: unknown): value is EffectiveRule[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry: unknown) =>
        typeof entry === "object" &&
        entry !== null &&
        "type" in entry &&
        typeof entry.type === "string",
    )
  );
}

function show(value: unknown): string {
  return value === undefined ? "not set" : JSON.stringify(value);
}

// For most settings "stricter" means a bigger value or more entries, so an
// extra check or a higher approval count is fine. Merge methods run the
// other way: every extra method is a way around squash-only.
const FEWER_IS_STRICTER = new Set(["allowed_merge_methods"]);

function weakness(
  key: string,
  expected: unknown,
  actual: unknown,
): string | undefined {
  if (Array.isArray(expected)) {
    const actualList: unknown[] = Array.isArray(actual) ? actual : [];
    if (FEWER_IS_STRICTER.has(key)) {
      const extra = actualList.filter((item) => !expected.includes(item));
      const absent = actual === undefined || actualList.length === 0;
      return extra.length > 0 || absent
        ? `${key} is ${show(actual)}, must be only ${show(expected)}`
        : undefined;
    }
    const lacking = expected.filter(
      (item) => !actualList.some((got) => show(got) === show(item)),
    );
    return lacking.length > 0
      ? `${key} is ${show(actual)}, must include ${show(lacking)}`
      : undefined;
  }
  if (expected === true) {
    return actual === true
      ? undefined
      : `${key} is ${show(actual)}, must be true`;
  }
  if (typeof expected === "number") {
    return typeof actual === "number" && actual >= expected
      ? undefined
      : `${key} is ${show(actual)}, must be at least ${String(expected)}`;
  }
  // false, strings and objects: setup leaves these off or at a default, and
  // a repo choosing a stricter value is not a weakening.
  return undefined;
}

function compareRule(
  expected: RulesetRule,
  actual: EffectiveRule,
): RulesetProblem[] {
  const problems: RulesetProblem[] = [];
  for (const [key, want] of Object.entries(expected.parameters ?? {})) {
    const message = weakness(key, want, actual.parameters?.[key]);
    if (message !== undefined) {
      problems.push({
        kind: "weakened",
        rule: expected.type,
        message: `${expected.type}: ${message}`,
      });
    }
  }
  return problems;
}

/** Every required rule that is absent or looser than setup's. Extra rules a
 * repo adds (required checks, code scanning) are never a problem. */
export function findRulesetProblems(
  actual: readonly EffectiveRule[],
  expected: readonly RulesetRule[] = rulesetBody().rules,
): RulesetProblem[] {
  const problems: RulesetProblem[] = [];
  for (const want of expected) {
    const matches = actual.filter((rule) => rule.type === want.type);
    if (matches.length === 0) {
      problems.push({
        kind: "missing",
        rule: want.type,
        message: `${want.type}: no active rule of this type`,
      });
      continue;
    }
    // Several rulesets can carry the same rule type. Whether GitHub then
    // takes the strictest or the loosest is not something to bet on, so
    // every copy must meet the bar. Problems are listed once each.
    for (const rule of matches) {
      for (const problem of compareRule(want, rule)) {
        if (!problems.some((seen) => seen.message === problem.message)) {
          problems.push(problem);
        }
      }
    }
  }
  return problems;
}
