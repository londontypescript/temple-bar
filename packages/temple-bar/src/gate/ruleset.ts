// The gate's ruleset check: the default branch must still be protected by
// the rules `init` sets up (pull request, squash only, linear history, signed
// commits, no force-push, no deletion; the judge's check, CodeQL's results
// and the gate and title checks are checked beside it). GitHub enforces
// them, but nothing else notices if the ruleset is deleted or loosened later.
//
// How it reads GitHub: Node's built-in fetch against the public API, not
// `gh`. A token from GH_TOKEN/GITHUB_TOKEN is sent when present. Locally an
// anonymous read is fine. In GitHub Actions a token is required: anonymous
// calls are limited to 60 an hour per IP address, and shared runners often
// use that up, so without one the check would fail at random. Failing every
// time, with the one line that fixes it, is better than failing sometimes.
//
// Public repos only for now: on a private repo the rules need a permission
// that Actions' default token can't have, so those are skipped, not failed.

import type { Context } from "../context.ts";
import { MANUAL_RULESET_STEPS } from "../init/github-ruleset.ts";
import { checkOrigin, rerunInit } from "../init/requirements.ts";
import {
  CODE_SCANNING_CHECK,
  codeScanningOutcome,
} from "./code-scanning-rule.ts";
import {
  findWorkflow,
  judgeRulesetOutcome,
  JUDGE_RULESET_CHECK,
  type WorkflowLookup,
} from "./judge-ruleset.ts";
import type { CheckOutcome } from "./report.ts";
import { JUDGE_WORKFLOW_PATH } from "../judge/workflow.ts";
import {
  REQUIRED_CHECKS_CHECK,
  requiredChecksOutcome,
} from "./required-checks-rule.ts";
import {
  findRulesetProblems,
  isEffectiveRuleList,
  type EffectiveRule,
  type RulesetProblem,
} from "./ruleset-compare.ts";

const RULESET_CHECK = "branch ruleset";

const API = "https://api.github.com";

type Read =
  | { readonly kind: "skipped"; readonly reason: string }
  /** GitHub couldn't be asked, or answered something unusable. */
  | { readonly kind: "unreadable"; readonly reason: string }
  /** In GitHub Actions with no token to read with. */
  | { readonly kind: "needs-token" }
  | {
      readonly kind: "read";
      readonly rules: EffectiveRule[];
      /** For a follow-up question about the same repository. */
      readonly repoUrl: string;
      readonly defaultBranch: string;
      readonly token: string | undefined;
    };

interface RepoInfo {
  readonly isPrivate: boolean;
  readonly defaultBranch: string;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function parseRepoInfo(body: string): RepoInfo | undefined {
  const parsed = parseJson(body);
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const isPrivate: unknown = "private" in parsed ? parsed.private : undefined;
  const branch: unknown =
    "default_branch" in parsed ? parsed.default_branch : undefined;
  if (typeof isPrivate !== "boolean" || typeof branch !== "string") {
    return undefined;
  }
  return { isPrivate, defaultBranch: branch };
}

function answered(status: number): string {
  const hint =
    status === 403 || status === 429
      ? " (probably the rate limit: set GH_TOKEN to a GitHub token)"
      : "";
  return `GitHub answered ${String(status)}${hint}`;
}

/** An empty variable counts as unset: Actions sets some to "". */
function tokenFrom(ctx: Context): string | undefined {
  for (const value of [ctx.env.GH_TOKEN, ctx.env.GITHUB_TOKEN]) {
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  return undefined;
}

async function readRuleset(ctx: Context): Promise<Read> {
  const origin = await checkOrigin(ctx, ctx.cwd);
  if (origin.state === "missing") {
    return { kind: "skipped", reason: "no origin remote" };
  }
  if (origin.state === "wrong-host") {
    return { kind: "skipped", reason: "origin is not on GitHub" };
  }

  const token = tokenFrom(ctx);
  if (token === undefined && ctx.env.GITHUB_ACTIONS === "true") {
    return { kind: "needs-token" };
  }
  const repoUrl = `${API}/repos/${origin.origin.owner}/${origin.origin.repo}`;

  // One call gives both facts needed: whether the repo is private, and which
  // branch is the default. A private repo answers 404 to an anonymous read
  // and `private: true` to a token that can see it; both mean "not ours to
  // check yet".
  const repoReply = await ctx.http.get(repoUrl, token);
  if (repoReply.kind === "network-error") {
    return { kind: "unreadable", reason: repoReply.message };
  }
  if (repoReply.status === 404) {
    return {
      kind: "skipped",
      reason: "private repository (only public repositories are checked)",
    };
  }
  if (repoReply.status !== 200) {
    return { kind: "unreadable", reason: answered(repoReply.status) };
  }
  const repo = parseRepoInfo(repoReply.body);
  if (repo === undefined) {
    return { kind: "unreadable", reason: "unexpected repository reply" };
  }
  if (repo.isPrivate) {
    return {
      kind: "skipped",
      reason: "private repository (only public repositories are checked)",
    };
  }

  // The effective rules: every active ruleset applying to the branch, merged.
  // Rulesets in "evaluate" or "disabled" mode don't appear, which is right:
  // they enforce nothing.
  const rulesReply = await ctx.http.get(
    `${repoUrl}/rules/branches/${encodeURIComponent(repo.defaultBranch)}`,
    token,
  );
  if (rulesReply.kind === "network-error") {
    return { kind: "unreadable", reason: rulesReply.message };
  }
  if (rulesReply.status !== 200) {
    return { kind: "unreadable", reason: answered(rulesReply.status) };
  }
  const rules = parseJson(rulesReply.body);
  if (!isEffectiveRuleList(rules)) {
    return { kind: "unreadable", reason: "unexpected rules reply" };
  }
  return {
    kind: "read",
    rules,
    repoUrl,
    defaultBranch: repo.defaultBranch,
    token,
  };
}

function formatRulesetFailure(problems: readonly RulesetProblem[]): string {
  const lines = ["gate: the default branch's ruleset is missing or weakened:"];
  for (const problem of problems) {
    lines.push(`  ${problem.kind}: ${problem.message}`);
  }
  lines.push(
    `  fix: if there is no ruleset, run ${rerunInit("--create-ruleset")}.`,
    "  setup leaves an existing ruleset alone, so a weakened one is edited by",
    "  hand: Settings > Rules > Rulesets, active (not evaluate), so that it",
    `  matches:\n${MANUAL_RULESET_STEPS.split("\n")
      .slice(1)
      .map((line) => `  ${line}`)
      .join("\n")}`,
  );
  return `${lines.join("\n")}\n`;
}

const NEEDS_TOKEN_MESSAGE =
  "gate: the branch ruleset check needs a token in GitHub Actions. Add this to the gate step:\n" +
  "  env:\n" +
  "    GH_TOKEN: ${{ github.token }}\n";

/** Every outcome alike, for an answer that judges none of the rules. */
function every(outcome: Omit<CheckOutcome, "name">): CheckOutcome[] {
  return [
    { ...outcome, name: RULESET_CHECK },
    { ...outcome, name: JUDGE_RULESET_CHECK },
    { ...outcome, name: CODE_SCANNING_CHECK },
    { ...outcome, name: REQUIRED_CHECKS_CHECK },
  ];
}

/** One effective-rules read serves all four checks. A missing rule asks
 * about its workflow only when needed, at most once per path. */
export async function runRulesetChecks(ctx: Context): Promise<CheckOutcome[]> {
  const result = await readRuleset(ctx);
  if (result.kind === "needs-token") {
    ctx.stderr.write(NEEDS_TOKEN_MESSAGE);
    return every({ status: "failed", detail: "no GH_TOKEN in GitHub Actions" });
  }
  if (result.kind === "skipped") {
    return every({ status: "skipped", detail: result.reason });
  }
  if (result.kind === "unreadable") {
    // Offline on a laptop is normal, so it is skipped there with its reason.
    // In CI the check is the point: silence would let a loosened ruleset
    // through, so an unreachable GitHub fails the gate.
    const detail = `could not read GitHub: ${result.reason}`;
    if (ctx.env.GITHUB_ACTIONS === "true") {
      ctx.stderr.write(
        `gate: could not read the branch ruleset from GitHub: ${result.reason}\n`,
      );
      return every({ status: "failed", detail });
    }
    return every({ status: "skipped", detail });
  }
  const problems = findRulesetProblems(result.rules);
  let branch: CheckOutcome;
  if (problems.length > 0) {
    ctx.stderr.write(formatRulesetFailure(problems));
    branch = {
      name: RULESET_CHECK,
      status: "failed",
      detail: problems
        .map((problem) => `${problem.kind} ${problem.rule}`)
        .join(", "),
    };
  } else {
    branch = {
      name: RULESET_CHECK,
      status: "passed",
      detail: "the default branch has every rule setup creates",
    };
  }
  const lookups = new Map<string, Promise<WorkflowLookup>>();
  const workflow = (path: string): Promise<WorkflowLookup> => {
    let lookup = lookups.get(path);
    if (lookup === undefined) {
      lookup = findWorkflow(
        ctx,
        result.repoUrl,
        result.defaultBranch,
        result.token,
        path,
      );
      lookups.set(path, lookup);
    }
    return lookup;
  };
  const judgeWorkflow = () => workflow(JUDGE_WORKFLOW_PATH);
  const judge = await judgeRulesetOutcome(ctx, result.rules, judgeWorkflow);
  const codeScanning = await codeScanningOutcome(
    ctx,
    result.rules,
    judgeWorkflow,
  );
  const checks = await requiredChecksOutcome(ctx, result.rules, workflow);
  return [branch, judge, codeScanning, checks];
}
