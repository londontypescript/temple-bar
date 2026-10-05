// CodeQL code scanning: setup turns on GitHub's default setup, then requires
// CodeQL's results through a `code_scanning` rule in the `main` ruleset.
//
// The two happen on different runs. A ruleset that requires CodeQL's results
// before CodeQL has analysed the default branch blocks every pull request,
// the setup pull request included, so the rule is added only once an
// analysis exists there; until then setup says to run it again. The judge's
// ruleset waits for its workflow in the same way (judge-ruleset.ts).
//
// Code scanning is free only on public repositories. On a private one setup
// says so and leaves it off; the gate doesn't check private repositories'
// rules at all.
//
// Everything here reads and writes GitHub through the `gh` seam, with the
// user's own `gh` sign-in, which can read code scanning. CI's token can't,
// which is why the gate never asks these questions.

import type { Context } from "../context.ts";
import type { RulesetRule } from "./github-ruleset.ts";
import { RERUN_INIT, type GithubOrigin } from "./requirements.ts";

/** The rule setup adds: CodeQL's results required, and a merge blocked by
 * any error-level alert or any security alert rated high or critical. These
 * match temple-bar's own `main` ruleset. */
export function codeScanningRule(): RulesetRule {
  return {
    type: "code_scanning",
    parameters: {
      code_scanning_tools: [
        {
          tool: "CodeQL",
          alerts_threshold: "errors",
          security_alerts_threshold: "high_or_higher",
        },
      ],
    },
  };
}

export const MANUAL_CODEQL_STEPS =
  "On GitHub, under Settings > Advanced Security, set up CodeQL analysis " +
  'with the "Default" setup.';

export const MANUAL_CODE_SCANNING_RULE_STEPS =
  "On GitHub, under Settings > Rules > Rulesets, edit the `main` ruleset " +
  "so that it:\n" +
  "  - requires code scanning results from CodeQL, blocking a merge on\n" +
  '    alerts at "Errors" and security alerts at "High or higher"';

export const CODEQL_PRIVATE =
  "Code scanning is free only on public repositories, and this one is " +
  "private, so setup left CodeQL off and doesn't require it. Turning it on " +
  "here needs GitHub's paid Code Security.";

export const CODEQL_WAITING =
  "CodeQL isn't required yet: it hasn't analysed the default branch, and " +
  "requiring it before then would block every pull request. Once its first " +
  "analysis has finished (the CodeQL run in the repository's Actions tab), " +
  `run ${RERUN_INIT} again to require it.`;

const CODEQL_NO_CODE =
  "CodeQL couldn't be turned on yet, probably because the default branch " +
  "has no code it can analyse. Once it has, run " +
  `${RERUN_INIT} again to turn it on.`;

/** What setup still has to do for code scanning. */
export type CodeScanningPlan =
  /** Not free here: explained, nothing to do. */
  | { readonly kind: "private" }
  /** The default branch already requires CodeQL's results. */
  | { readonly kind: "required" }
  /** Default setup is off: turning it on needs the user's yes. */
  | { readonly kind: "turn-on" }
  /** On, but no analysis of the default branch yet. */
  | { readonly kind: "waiting" }
  /** Analysed: requiring its results needs the user's yes. */
  | { readonly kind: "require" }
  | { readonly kind: "unreadable"; readonly reason: string };

async function readJson(
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

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** Whether any rule requires CodeQL's results. How strictly is the gate's
 * question; setup only needs to know whether to offer the rule. */
function requiresCodeQl(rules: unknown): boolean {
  return (
    Array.isArray(rules) &&
    rules.some((rule: unknown) => {
      const tools = field(field(rule, "parameters"), "code_scanning_tools");
      return (
        field(rule, "type") === "code_scanning" &&
        Array.isArray(tools) &&
        tools.some((tool: unknown) => field(tool, "tool") === "CodeQL")
      );
    })
  );
}

/** GitHub answers 404 when a repository has no analyses at all. */
function isNotFound(error: string): boolean {
  return /\b404\b|no analysis found/i.test(error);
}

/** Reads, without changing anything, what code scanning still needs. */
export async function planCodeScanning(
  ctx: Context,
  repoRoot: string,
  origin: GithubOrigin,
): Promise<CodeScanningPlan> {
  const repoPath = `repos/${origin.owner}/${origin.repo}`;
  const repo = await readJson(ctx, repoRoot, repoPath);
  if (!repo.ok) {
    return { kind: "unreadable", reason: repo.error };
  }
  const isPrivate = field(repo.value, "private");
  const branch = field(repo.value, "default_branch");
  if (typeof isPrivate !== "boolean" || typeof branch !== "string") {
    return { kind: "unreadable", reason: "unexpected repository reply" };
  }
  if (isPrivate) {
    return { kind: "private" };
  }

  const rules = await readJson(
    ctx,
    repoRoot,
    `${repoPath}/rules/branches/${encodeURIComponent(branch)}`,
  );
  if (!rules.ok) {
    return { kind: "unreadable", reason: rules.error };
  }
  if (requiresCodeQl(rules.value)) {
    return { kind: "required" };
  }

  const setup = await readJson(
    ctx,
    repoRoot,
    `${repoPath}/code-scanning/default-setup`,
  );
  if (!setup.ok) {
    return { kind: "unreadable", reason: setup.error };
  }
  if (field(setup.value, "state") !== "configured") {
    return { kind: "turn-on" };
  }

  const ref = encodeURIComponent(`refs/heads/${branch}`);
  const analyses = await readJson(
    ctx,
    repoRoot,
    `${repoPath}/code-scanning/analyses?ref=${ref}&tool_name=CodeQL&per_page=1`,
  );
  if (!analyses.ok) {
    return isNotFound(analyses.error)
      ? { kind: "waiting" }
      : { kind: "unreadable", reason: analyses.error };
  }
  return Array.isArray(analyses.value) && analyses.value.length > 0
    ? { kind: "require" }
    : { kind: "waiting" };
}

/** A change made, with what to tell the user; or, when it failed, the
 * error, which the caller follows with the manual steps. */
export interface CodeScanningStep {
  readonly ok: boolean;
  readonly message: string;
}

/** Turns on default setup. A 422 is GitHub saying the repository isn't
 * ready for it, which in practice means nothing it can analyse yet: like
 * waiting for a first analysis, that is a later run's job, not a failure. */
export async function turnOnCodeQl(
  ctx: Context,
  repoRoot: string,
  origin: GithubOrigin,
): Promise<CodeScanningStep> {
  const result = await ctx.gh.run(
    [
      "api",
      "--method",
      "PATCH",
      `repos/${origin.owner}/${origin.repo}/code-scanning/default-setup`,
      "--input",
      "-",
    ],
    repoRoot,
    JSON.stringify({ state: "configured" }),
  );
  if (result.code === 0) {
    return {
      ok: true,
      message: `Turned on CodeQL code scanning.\n${CODEQL_WAITING}`,
    };
  }
  const error = (result.stderr || result.stdout).trim();
  if (/\b422\b/.test(error)) {
    return { ok: true, message: `${CODEQL_NO_CODE}\nGitHub said: ${error}` };
  }
  return { ok: false, message: `turning on CodeQL failed:\n${error}` };
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

function toolsIn(rule: RulesetRule): unknown[] {
  const listed: unknown = rule.parameters?.code_scanning_tools;
  const tools: unknown[] = Array.isArray(listed) ? listed : [];
  return tools;
}

/** The rules with CodeQL required. A ruleset holds one rule of each type,
 * so a code scanning rule already there for another tool gains CodeQL
 * beside that tool rather than a second rule. */
function withCodeQl(rules: readonly RulesetRule[]): RulesetRule[] {
  const wanted = codeScanningRule();
  const existing = rules.find((rule) => rule.type === wanted.type);
  if (existing === undefined) {
    return [...rules, wanted];
  }
  const merged: RulesetRule = {
    type: wanted.type,
    parameters: {
      ...existing.parameters,
      code_scanning_tools: [
        ...toolsIn(existing).filter((tool) => field(tool, "tool") !== "CodeQL"),
        ...toolsIn(wanted),
      ],
    },
  };
  return rules.map((rule) => (rule === existing ? merged : rule));
}

/** Adds the code scanning rule to an existing ruleset, keeping every rule
 * it already has. */
export async function addCodeScanningRule(
  ctx: Context,
  repoRoot: string,
  origin: GithubOrigin,
  rulesetId: number,
): Promise<CodeScanningStep> {
  const path = `repos/${origin.owner}/${origin.repo}/rulesets/${String(rulesetId)}`;
  const failed = (error: string): CodeScanningStep => ({
    ok: false,
    message: `requiring CodeQL in the \`main\` ruleset failed:\n${error}`,
  });
  const current = await readJson(ctx, repoRoot, path);
  if (!current.ok) {
    return failed(current.error);
  }
  const listed = field(current.value, "rules");
  const rules = (Array.isArray(listed) ? listed : [])
    .map(asRule)
    .filter((rule) => rule !== undefined);
  if (!Array.isArray(listed) || rules.length !== listed.length) {
    return failed("unexpected ruleset reply");
  }
  const result = await ctx.gh.run(
    ["api", "--method", "PUT", path, "--input", "-"],
    repoRoot,
    JSON.stringify({ rules: withCodeQl(rules) }),
  );
  if (result.code !== 0) {
    return failed((result.stderr || result.stdout).trim());
  }
  return {
    ok: true,
    message: "Required CodeQL's results in the `main` ruleset.",
  };
}

export function unreadableMessage(reason: string): string {
  return (
    "Couldn't read CodeQL's state from GitHub, so setup didn't turn it on " +
    `or require it:\n${reason}\nRun ${RERUN_INIT} again once GitHub answers.`
  );
}
