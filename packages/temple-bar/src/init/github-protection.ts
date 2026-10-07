// Offers what protects `main` on GitHub, under one yes:
//
// - the `main` ruleset (github-ruleset.ts);
// - the judge's ruleset, once the judge workflow is on the default branch
//   (judge-ruleset.ts);
// - CodeQL code scanning: turned on first, and its results required in the
//   `main` ruleset on a later run, once CodeQL has analysed the default
//   branch (code-scanning.ts);
// - the gate and title checks, once their workflows are on the default
//   branch (required-checks.ts).
//
// Only an explicit yes (the prompt, or the --create-ruleset flag an agent
// passes after the user said yes in chat) changes anything, and the question
// names everything that yes covers. With no terminal, or when a change
// fails, the manual steps are printed and `init` ends non-zero, so an
// unprotected repo never looks set up.

import type { Context } from "../context.ts";
import {
  addCodeScanningRule,
  CODEQL_PRIVATE,
  CODEQL_WAITING,
  MANUAL_CODE_SCANNING_RULE_STEPS,
  MANUAL_CODEQL_STEPS,
  planCodeScanning,
  turnOnCodeQl,
  unreadableMessage,
  withCodeQl,
} from "./code-scanning.ts";
import {
  hasBranchRuleset,
  listRulesets,
  mainRulesetId,
  MANUAL_RULESET_STEPS,
  rulesetBody,
  type RulesetBody,
} from "./github-ruleset.ts";
import {
  hasJudgeRuleset,
  judgeIsOnDefaultBranch,
  judgeRulesetBody,
  JUDGE_WAITING,
  MANUAL_JUDGE_RULESET_STEPS,
} from "./judge-ruleset.ts";
import {
  addRequiredChecks,
  checksSummary,
  manualChecksSteps,
  planRequiredChecks,
  withRequiredChecks,
  type RequiredChecksPlan,
} from "./required-checks.ts";
import { rerunInit, type GithubOrigin } from "./requirements.ts";

const MAIN_SUMMARY =
  "pull request required, squash merges only, linear history, signed " +
  "commits, no force-push, no deletion, no bypass";

const JUDGE_SUMMARY =
  "the judge's check required, and branches up to date with `main`";

const CODEQL_RESULTS =
  "CodeQL's results required, blocking a merge on errors and on security " +
  "alerts rated high or critical";

/** What one yes would do on GitHub. */
export interface ProtectionWork {
  readonly main: boolean;
  readonly judge: boolean;
  /** Turn on CodeQL's default setup. */
  readonly turnOnCodeQl: boolean;
  /** Require CodeQL's results: inside a `main` ruleset created now, or
   * added to the existing one. */
  readonly requireCodeQl: boolean;
  readonly checks?: RequiredChecksPlan["checks"];
}

/** The one question, naming everything the yes covers. */
export function protectionQuestion(work: ProtectionWork): string {
  const parts: string[] = [];
  const checks = work.checks ?? [];
  const additions = [
    ...(work.requireCodeQl ? [CODEQL_RESULTS] : []),
    ...(checks.length > 0 ? [checksSummary(checks)] : []),
  ].join(", and ");
  if (work.main) {
    parts.push(
      `create the \`main\` ruleset (${MAIN_SUMMARY}${additions === "" ? "" : `, ${additions}`})`,
    );
  } else if (additions !== "") {
    parts.push(`add to the \`main\` ruleset: ${additions}`);
  }
  if (work.judge) {
    parts.push(`create the judge's ruleset (${JUDGE_SUMMARY})`);
  }
  if (work.turnOnCodeQl) {
    parts.push(
      "turn on CodeQL code scanning (GitHub's default setup; its results " +
        "are required on a later run, once it has analysed the default branch)",
    );
  }
  const last = parts.pop() ?? "";
  const list = parts.length === 0 ? last : `${parts.join(", ")}, and ${last}`;
  return `On GitHub now, ${list}?`;
}

export type RulesetOutcome =
  | { readonly kind: "exists"; readonly message: string }
  | { readonly kind: "created"; readonly message: string }
  /** The user said no: their choice, so `init` still succeeds. */
  | { readonly kind: "declined"; readonly message: string }
  /** No terminal to ask in, or a change failed: `init` ends non-zero. */
  | { readonly kind: "not-created"; readonly message: string };

/** What one change on GitHub came to: a ruleset created (its name, quoted),
 * something else done (what to tell the user), or an error. */
type StepResult =
  | { readonly kind: "created"; readonly name: string }
  | { readonly kind: "done"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

/** One change on GitHub: how to make it by hand, and the call that makes
 * it. */
interface Step {
  readonly manual: string;
  readonly run: () => Promise<StepResult>;
}

function fromCodeScanning(step: { ok: boolean; message: string }): StepResult {
  return step.ok
    ? { kind: "done", message: step.message }
    : { kind: "failed", message: step.message };
}

function joined(lines: readonly (string | undefined)[]): string {
  return lines.filter((line) => line !== undefined && line !== "").join("\n");
}

function createStep(
  ctx: Context,
  repoRoot: string,
  path: string,
  body: RulesetBody,
  manual: string,
): Step {
  return {
    manual,
    run: async () => {
      const result = await ctx.gh.run(
        ["api", "--method", "POST", path, "--input", "-"],
        repoRoot,
        JSON.stringify(body),
      );
      return result.code === 0
        ? { kind: "created", name: `"${body.name}"` }
        : {
            kind: "failed",
            message: `creating "${body.name}" failed:\n${(result.stderr || result.stdout).trim()}`,
          };
    },
  };
}

export async function offerProtection(
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
  const plan = await planCodeScanning(ctx, repoRoot, origin);
  const mainId = mainRulesetId(existing);
  const checksPlan = await planRequiredChecks(
    ctx,
    repoRoot,
    origin,
    needMain,
    mainId,
  );
  const checks = needMain || mainId !== undefined ? checksPlan.checks : [];

  const requireCodeQl =
    plan.kind === "require" && (needMain || mainId !== undefined);
  const work: ProtectionWork = {
    main: needMain,
    judge: judgeMissing && judgeReady,
    turnOnCodeQl: plan.kind === "turn-on",
    requireCodeQl,
    checks,
  };

  // Said after the outcome, whatever it is.
  const notes = joined([
    judgeMissing && !judgeReady ? JUDGE_WAITING : undefined,
    plan.kind === "waiting" ? CODEQL_WAITING : undefined,
    plan.kind === "private" ? CODEQL_PRIVATE : undefined,
    checksPlan.note,
  ]);
  // Left undone whatever the answer, so `init` ends non-zero.
  const problems = joined([
    checksPlan.problem,
    checksPlan.checks.length > 0 && checks.length === 0
      ? "The workflows are on the default branch, but its ruleset isn't one " +
        "setup created, so setup leaves it alone. To require their checks:\n" +
        manualChecksSteps(checksPlan.checks)
      : undefined,
    plan.kind === "unreadable" ? unreadableMessage(plan.reason) : undefined,
    plan.kind === "require" && !requireCodeQl
      ? "CodeQL has analysed the default branch, but its ruleset isn't one " +
        "setup created, so setup leaves it alone. To require CodeQL's " +
        `results:\n${MANUAL_CODE_SCANNING_RULE_STEPS}`
      : undefined,
  ]);

  const steps: Step[] = [];
  if (work.main) {
    const body = rulesetBody();
    steps.push(
      createStep(
        ctx,
        repoRoot,
        path,
        {
          ...body,
          rules: withRequiredChecks(
            requireCodeQl ? withCodeQl(body.rules) : body.rules,
            checks,
          ),
        },
        joined([
          requireCodeQl
            ? `${MANUAL_RULESET_STEPS}\n  - requires code scanning results from CodeQL`
            : MANUAL_RULESET_STEPS,
          checks.length > 0 ? manualChecksSteps(checks) : undefined,
        ]),
      ),
    );
  }
  if (work.judge) {
    steps.push(
      createStep(
        ctx,
        repoRoot,
        path,
        judgeRulesetBody(),
        MANUAL_JUDGE_RULESET_STEPS,
      ),
    );
  }
  if (work.turnOnCodeQl) {
    steps.push({
      manual: MANUAL_CODEQL_STEPS,
      run: async () =>
        fromCodeScanning(await turnOnCodeQl(ctx, repoRoot, origin)),
    });
  }
  if (
    (requireCodeQl || checks.length > 0) &&
    !needMain &&
    mainId !== undefined
  ) {
    steps.push({
      manual: joined([
        requireCodeQl ? MANUAL_CODE_SCANNING_RULE_STEPS : undefined,
        checks.length > 0 ? manualChecksSteps(checks) : undefined,
      ]),
      run: async () =>
        fromCodeScanning(
          checks.length > 0
            ? await addRequiredChecks(
                ctx,
                repoRoot,
                origin,
                mainId,
                checksPlan,
                requireCodeQl,
              )
            : await addCodeScanningRule(
                ctx,
                repoRoot,
                origin,
                mainId,
                checksPlan.current,
              ),
        ),
    });
  }

  const finish = (kind: RulesetOutcome["kind"], message: string) =>
    problems === ""
      ? { kind, message: joined([message, notes]) }
      : {
          kind: "not-created" as const,
          message: joined([message, notes, problems]),
        };

  if (steps.length === 0) {
    return finish(
      "exists",
      "The rulesets for the default branch already exist; left them alone.",
    );
  }

  const manual = steps.map((step) => step.manual).join("\nThen:\n");
  const answer = approved
    ? "yes"
    : await ctx.prompt.confirm(protectionQuestion(work));
  if (answer === "no") {
    return finish(
      "declined",
      `OK, nothing was changed on GitHub. To do it yourself:\n${manual}`,
    );
  }
  if (answer === "no-terminal") {
    return {
      kind: "not-created",
      message: joined([
        `No terminal to ask in, so nothing was changed on GitHub. An agent: ask the user, and only if they say yes run ${rerunInit("--create-ruleset")}. Or do it yourself:\n${manual}`,
        notes,
        problems,
      ]),
    };
  }

  const created: string[] = [];
  const said: string[] = [];
  for (const [index, step] of steps.entries()) {
    const result = await step.run();
    if (result.kind === "failed") {
      const rest = steps
        .slice(index)
        .map((left) => left.manual)
        .join("\nThen:\n");
      return {
        kind: "not-created",
        message: joined([
          created.length === 0
            ? capitalised(result.message)
            : `Created ${created.join(" and ")}, but ${result.message}`,
          ...said,
          `To do the rest yourself:\n${rest}`,
          notes,
          problems,
        ]),
      };
    }
    if (result.kind === "created") {
      created.push(result.name);
    } else {
      said.push(result.message);
    }
  }
  return finish(
    "created",
    joined([
      created.length === 0
        ? undefined
        : `Created the ${created.join(" and ")} ruleset${created.length > 1 ? "s" : ""} on GitHub.`,
      ...said,
    ]),
  );
}

function capitalised(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
