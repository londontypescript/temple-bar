// Shared fixture for the `init` command tests (command.test.ts and
// command-stops.test.ts): fake git and gh scripts for a normal repo, hook
// install reports, and a context builder. Excluded from the build
// (tsconfig.build.json excludes src/**/testing/**).

import { freshAgentsMd } from "../agents-template.ts";
import { createInitCommand } from "../command.ts";
import { COMPANION_FILES } from "../companion-docs.ts";
import { GITIGNORE_LINES } from "../files.ts";
import { GATE_SCRIPT, PREPARE_SCRIPT } from "../package-json.ts";
import { CHECKED_WORKFLOWS } from "../workflows.ts";
import { JUDGE_WORKFLOW_PATH, judgeWorkflow } from "../../judge/workflow.ts";
import { JUDGE_RULESET_NAME } from "../judge-ruleset.ts";
import { codeScanningAnswer } from "./code-scanning-fake.ts";
import type { InstallReport } from "../../hooks/install.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGh,
  createFakeGit,
  createFakePrompt,
  createFakeWriter,
  type FakeWriter,
} from "../../testing/fakes.ts";
import type { Context } from "../../context.ts";
import type { GhResult } from "../../seams/gh.ts";
import type { GitResult } from "../../seams/git.ts";
import type { ConfirmResult } from "../../seams/prompt.ts";

export function defaultGitScript(args: readonly string[]): GitResult {
  if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
    return { code: 0, stdout: "/repo\n", stderr: "" };
  }
  if (args[0] === "rev-parse" && args[1] === "HEAD") {
    return { code: 0, stdout: "abc123\n", stderr: "" };
  }
  if (args[0] === "remote") {
    return { code: 0, stdout: "git@github.com:acme/widgets.git\n", stderr: "" };
  }
  return { code: 0, stdout: "", stderr: "" };
}

export function defaultGhScript(args: readonly string[]): GhResult {
  if (args[0] === "--version") {
    return { code: 0, stdout: "gh 2.0.0", stderr: "", notFound: false };
  }
  if (args[0] === "auth") {
    return { code: 0, stdout: "", stderr: "", notFound: false };
  }
  if (args.includes("POST")) {
    return { code: 0, stdout: "", stderr: "", notFound: false };
  }
  // The usual state: main is already protected by both rulesets and
  // requires CodeQL (a real second run), so most tests aren't about GitHub
  // at all.
  const codeScanning = codeScanningAnswer(args, "required");
  if (codeScanning !== undefined) {
    return codeScanning;
  }
  if (args.some((a) => a.endsWith("/rulesets"))) {
    return {
      code: 0,
      stdout: JSON.stringify([
        { target: "branch", name: "main: pull requests only" },
        { target: "branch", name: JUDGE_RULESET_NAME },
      ]),
      stderr: "",
      notFound: false,
    };
  }
  return { code: 0, stdout: "", stderr: "", notFound: false };
}

/** Like defaultGhScript, but GitHub has no ruleset yet. */
export function noRulesetGhScript(args: readonly string[]): GhResult {
  if (args.some((a) => a.endsWith("/rulesets")) && !args.includes("POST")) {
    return { code: 0, stdout: "[]", stderr: "", notFound: false };
  }
  return defaultGhScript(args);
}

const installedReport: InstallReport = {
  items: [{ item: ".git/hooks/pre-commit", status: "written" }],
  hasConflicts: false,
};

export const unchangedReport: InstallReport = {
  items: [{ item: ".git/hooks/pre-commit", status: "unchanged" }],
  hasConflicts: false,
};

export const fakeInstallHooks =
  (installed: { calls: number }) => (): Promise<InstallReport> => {
    installed.calls += 1;
    return Promise.resolve(installedReport);
  };

/** What pnpm sets npm_config_user_agent to for `pnpm exec`, which is how
 * setup runs. */
export const PNPM_USER_AGENT = "pnpm/10.34.5 npm/? node/v24.0.0 darwin arm64";

/** Everything a finished setup leaves, so a run over it has nothing to do
 * and only what a test overrides is new. */
export function setUpFiles(overrides: Record<string, string> = {}) {
  return createFakeFs({
    "/repo/AGENTS.md": freshAgentsMd(),
    ...Object.fromEntries(
      COMPANION_FILES.map((file) => [`/repo/${file.path}`, file.content]),
    ),
    "/repo/.gitignore": `${GITIGNORE_LINES.join("\n")}\n`,
    [`/repo/${JUDGE_WORKFLOW_PATH}`]: judgeWorkflow(),
    ...Object.fromEntries(
      CHECKED_WORKFLOWS.map((file) => [`/repo/${file.path}`, file.content]),
    ),
    "/repo/package.json": JSON.stringify({
      name: "widgets",
      packageManager: "pnpm@10.34.5",
      scripts: { prepare: PREPARE_SCRIPT, gate: GATE_SCRIPT },
    }),
    ...overrides,
  });
}

export interface Fixture {
  readonly ctx: Context;
  readonly hookCalls: { calls: number };
  readonly stdout: FakeWriter;
  readonly stderr: FakeWriter;
}

export function makeFixture(
  overrides: Partial<Context> = {},
  promptAnswer: ConfirmResult = "no-terminal",
): Fixture {
  const hookCalls = { calls: 0 };
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    git: createFakeGit(defaultGitScript),
    gh: createFakeGh(defaultGhScript),
    prompt: createFakePrompt({
      interactive: promptAnswer !== "no-terminal",
      answer: promptAnswer,
    }),
    fs: createFakeFs(),
    env: { npm_config_user_agent: PNPM_USER_AGENT },
    stdout,
    stderr,
    ...overrides,
  });
  return { ctx, hookCalls, stdout, stderr };
}

export async function runInitFor(fixture: Fixture): Promise<number> {
  const command = createInitCommand({
    installHooks: fakeInstallHooks(fixture.hookCalls),
  });
  return command.run([], fixture.ctx);
}
