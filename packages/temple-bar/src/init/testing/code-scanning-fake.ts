// GitHub's answers about code scanning, for tests that fake `gh`. Excluded
// from the build (tsconfig.build.json excludes src/**/testing/**).

import type { GhResult } from "../../seams/gh.ts";

/** Where a repository stands with CodeQL. */
export type CodeQlState =
  /** The default branch already requires CodeQL's results. */
  | "required"
  /** Default setup off. */
  | "off"
  /** On, no analysis of the default branch yet. */
  | "waiting"
  /** On and analysed, nothing requires it yet. */
  | "analysed"
  | "private";

export const MAIN_RULESET_ID = 42;

const ok = (body: unknown): GhResult => ({
  code: 0,
  stdout: JSON.stringify(body),
  stderr: "",
  notFound: false,
});

const failed = (stderr: string): GhResult => ({
  code: 1,
  stdout: "",
  stderr,
  notFound: false,
});

export const CODEQL_RULE = {
  type: "code_scanning",
  parameters: {
    code_scanning_tools: [
      {
        tool: "CodeQL",
        security_alerts_threshold: "high_or_higher",
        alerts_threshold: "errors",
      },
    ],
  },
};

/** GitHub's answer to a code scanning question, or undefined when `args`
 * asks something else. Writes (PATCH, PUT) succeed. */
export function codeScanningAnswer(
  args: readonly string[],
  state: CodeQlState,
): GhResult | undefined {
  const target = args.find((arg) => arg.startsWith("repos/")) ?? "";
  if (args.includes("PATCH") || args.includes("PUT")) {
    return target.includes("/code-scanning/") || target.includes("/rulesets/")
      ? ok({})
      : undefined;
  }
  if (target === "repos/acme/widgets") {
    return ok({ private: state === "private", default_branch: "main" });
  }
  if (target.includes("/rules/branches/")) {
    return ok(state === "required" ? [{ ...CODEQL_RULE, ruleset_id: 1 }] : []);
  }
  if (target.endsWith("/code-scanning/default-setup")) {
    return ok({ state: state === "off" ? "not-configured" : "configured" });
  }
  if (target.includes("/code-scanning/analyses")) {
    return state === "analysed"
      ? ok([{ ref: "refs/heads/main", tool: { name: "CodeQL" } }])
      : failed("gh: no analysis found (HTTP 404)");
  }
  if (target.endsWith(`/rulesets/${String(MAIN_RULESET_ID)}`)) {
    return ok({
      id: MAIN_RULESET_ID,
      name: "main: pull requests only",
      rules: [
        { type: "deletion" },
        {
          type: "pull_request",
          parameters: { allowed_merge_methods: ["squash"] },
        },
      ],
    });
  }
  return undefined;
}
