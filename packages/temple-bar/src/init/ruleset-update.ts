// Ruleset reads and updates shared by setup's CodeQL and status checks.
// GitHub includes provenance in a read, so only rule settings are sent back.

import type { Context } from "../context.ts";
import type { RulesetRule } from "./github-ruleset.ts";
import type { GithubOrigin } from "./requirements.ts";

export async function readJson(
  ctx: Context,
  repoRoot: string,
  path: string,
): Promise<
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string }
> {
  const result = await ctx.gh.run(["api", path], repoRoot);
  if (result.code !== 0) {
    return { ok: false, error: (result.stderr || result.stdout).trim() };
  }
  try {
    return { ok: true, value: JSON.parse(result.stdout) as unknown };
  } catch {
    return { ok: false, error: `unexpected reply from ${path}` };
  }
}

export function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** Only what a ruleset update needs from each rule: GitHub's read-back
 * carries extra fields (where the rule came from) that aren't settings. */
function asRule(rule: unknown): RulesetRule | undefined {
  const type = field(rule, "type");
  const parameters = field(rule, "parameters");
  if (typeof type !== "string") {
    return undefined;
  }
  return typeof parameters === "object" && parameters !== null
    ? { type, parameters: parameters as Record<string, unknown> }
    : { type };
}

export function rulesFrom(value: unknown): RulesetRule[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const rules = value.map(asRule).filter((rule) => rule !== undefined);
  return rules.length === value.length ? rules : undefined;
}

export type RulesetRead =
  | {
      readonly ok: true;
      readonly rules: RulesetRule[];
      /** "active", "evaluate" or "disabled": only an active ruleset
       * enforces anything. */
      readonly enforcement?: unknown;
    }
  | { readonly ok: false; readonly error: string };

function rulesetPath(origin: GithubOrigin, id: number): string {
  return `repos/${origin.owner}/${origin.repo}/rulesets/${String(id)}`;
}

export async function readRuleset(
  ctx: Context,
  repoRoot: string,
  origin: GithubOrigin,
  id: number,
): Promise<RulesetRead> {
  const current = await readJson(ctx, repoRoot, rulesetPath(origin, id));
  if (!current.ok) {
    return current;
  }
  const rules = rulesFrom(field(current.value, "rules"));
  return rules === undefined
    ? { ok: false, error: "unexpected ruleset reply" }
    : { ok: true, rules, enforcement: field(current.value, "enforcement") };
}

/** Applies all planned additions in one write, keeping the other rules.
 * It reads the ruleset again just before writing, rather than reusing the
 * read setup planned from: the user may take minutes to answer the
 * question, and writing back an older copy would undo any edit made
 * meanwhile. */
export async function updateRuleset(
  ctx: Context,
  repoRoot: string,
  origin: GithubOrigin,
  id: number,
  change: (rules: readonly RulesetRule[]) => RulesetRule[],
): Promise<
  { readonly ok: true } | { readonly ok: false; readonly error: string }
> {
  const read = await readRuleset(ctx, repoRoot, origin, id);
  if (!read.ok) {
    return read;
  }
  const result = await ctx.gh.run(
    ["api", "--method", "PUT", rulesetPath(origin, id), "--input", "-"],
    repoRoot,
    JSON.stringify({ rules: change(read.rules) }),
  );
  return result.code === 0
    ? { ok: true }
    : { ok: false, error: (result.stderr || result.stdout).trim() };
}
