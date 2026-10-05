// Bypass merges: pushes to the default branch that went past a ruleset,
// read from GitHub's rule-suite history. The maintainer merges a change to
// the checks past the judge as a repository admin, and that is the one
// bypass expected. But agents work under the maintainer's account, so GitHub
// can't tell that merge from an agent's, and nothing can stop an agent
// making it. This is detection, not prevention: it lists every bypass, with
// the rules it went past, so each one is seen by a person who can say
// whether it was theirs. Prevention needs agents to have their own GitHub
// identity.
//
// GitHub only answers with a token that can read the repository's
// administration settings (the classic `repo` scope, or Administration:
// read on a fine-grained token), even on a public repo. Actions' own token
// can't be given that, so this runs where the maintainer's `gh` login is,
// in `temple-bar merge`, and never decides anything: an answer it can't get
// is reported as such.

import type { Context } from "../context.ts";

/** GitHub keeps rule suites for a month, and "month" is the longest window
 * its list offers. */
const WINDOW = "month";

interface Bypass {
  /** The commit the bypass put on the branch. */
  readonly commit: string;
  readonly actor: string;
  readonly at: string;
  /** Each rule it went past: the ruleset's name and the rule. */
  readonly rules: readonly string[];
}

export type BypassHistory =
  | { readonly ok: true; readonly bypasses: readonly Bypass[] }
  | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function ghApi(
  ctx: Context,
  args: readonly string[],
  cwd: string,
): Promise<{ ok: true; stdout: string } | { ok: false; reason: string }> {
  const result = await ctx.gh.run(["api", ...args], cwd);
  if (result.notFound) {
    return { ok: false, reason: "the gh CLI is not installed" };
  }
  if (result.code !== 0) {
    const said = result.stderr.trim();
    return {
      ok: false,
      reason: said === "" ? `gh exited with code ${String(result.code)}` : said,
    };
  }
  return { ok: true, stdout: result.stdout };
}

/** The rules one bypassed rule suite went past. */
async function rulesPassed(
  ctx: Context,
  repo: string,
  id: number,
  cwd: string,
): Promise<string[] | string> {
  const read = await ghApi(
    ctx,
    [`repos/${repo}/rulesets/rule-suites/${String(id)}`],
    cwd,
  );
  if (!read.ok) {
    return read.reason;
  }
  const suite = parse(read.stdout);
  const evaluations = isRecord(suite) ? suite.rule_evaluations : undefined;
  if (!Array.isArray(evaluations)) {
    return "GitHub described the rule suite unexpectedly";
  }
  const rules: string[] = [];
  for (const evaluation of evaluations) {
    if (!isRecord(evaluation) || evaluation.result !== "fail") {
      continue;
    }
    const source = isRecord(evaluation.rule_source)
      ? evaluation.rule_source.name
      : undefined;
    const type = evaluation.rule_type;
    rules.push(
      `${typeof source === "string" ? source : "a ruleset"} (${typeof type === "string" ? type : "a rule"})`,
    );
  }
  return rules;
}

/** Every bypass of a ruleset on `branch` of `repo` ("owner/name") in the
 * past month, newest first. */
export async function readBypasses(
  ctx: Context,
  repo: string,
  branch: string,
  cwd: string,
): Promise<BypassHistory> {
  const ref = encodeURIComponent(`refs/heads/${branch}`);
  const list = await ghApi(
    ctx,
    [
      "--paginate",
      `repos/${repo}/rulesets/rule-suites?ref=${ref}&time_period=${WINDOW}&rule_suite_result=bypass&per_page=100`,
      "--jq",
      ".[] | {id, after_sha, actor_name, pushed_at}",
    ],
    cwd,
  );
  if (!list.ok) {
    return { ok: false, reason: list.reason };
  }
  const bypasses: Bypass[] = [];
  for (const line of list.stdout.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const suite = parse(line);
    const {
      id,
      after_sha: commit,
      actor_name: actor,
      pushed_at: at,
    } = isRecord(suite) ? suite : {};
    if (
      typeof id !== "number" ||
      typeof commit !== "string" ||
      typeof actor !== "string" ||
      typeof at !== "string"
    ) {
      return { ok: false, reason: "GitHub listed rule suites unexpectedly" };
    }
    const rules = await rulesPassed(ctx, repo, id, cwd);
    if (typeof rules === "string") {
      return { ok: false, reason: rules };
    }
    bypasses.push({ commit, actor, at, rules });
  }
  return { ok: true, bypasses };
}

/** What merge prints about the history: a heading line, then one line per
 * bypass. */
export function bypassReport(branch: string, history: BypassHistory): string[] {
  if (!history.ok) {
    return [
      `bypass merges on ${branch}: GitHub's rule-suite history couldn't be read (${history.reason}). ` +
        "It needs a token that can read the repository's administration settings.",
    ];
  }
  if (history.bypasses.length === 0) {
    return [`bypass merges on ${branch} in the past month: none`];
  }
  return [
    `bypass merges on ${branch} in the past month: ${String(history.bypasses.length)}. ` +
      "The maintainer merges changes to the checks this way; check each one was theirs:",
    ...history.bypasses.map(
      (bypass) =>
        `  ${bypass.commit.slice(0, 7)} by ${bypass.actor} at ${bypass.at}, past ${bypass.rules.join(", ") || "no named rule"}`,
    ),
  ];
}
