// `temple-bar init`: checks the requirements, offers the GitHub changes
// (repo creation; the rulesets and CodeQL under one yes) only on an explicit
// yes, writes AGENTS.md, its companion docs and package.json where they're
// missing, then installs the hooks. Every hard stop below happens before any
// write, so a failed run leaves the repo untouched.

import type { CommandEntry } from "../registry.ts";
import type { Context } from "../context.ts";
import {
  checkGhInstalled,
  checkGhSignedIn,
  checkGitRepo,
  checkOrigin,
  wrongHostMessage,
  type GithubOrigin,
} from "./requirements.ts";
import { offerRepoCreation } from "./github-repo.ts";
import { offerProtection } from "./github-protection.ts";
import {
  ensureGitignore,
  writeSetupFiles,
  type SetupFilesOutcome,
} from "./files.ts";
import type { InitDeps } from "./types.ts";
import { JUDGE_WORKFLOW_PATH } from "../judge/workflow.ts";
import { CLAUDE_MD_PATH } from "./companion-docs.ts";
import { findProtectedBranch } from "../hooks/protected-branch.ts";

export type { InitDeps } from "./types.ts";

/** Each flag means "the user already said yes in chat" for one question. */
interface Approvals {
  readonly createRepo: boolean;
  readonly createRuleset: boolean;
}

function parseApprovals(args: readonly string[]): Approvals {
  return {
    createRepo: args.includes("--create-repo"),
    createRuleset: args.includes("--create-ruleset"),
  };
}

/** The hooks protect origin's default branch, which they read from
 * `refs/remotes/origin/HEAD`. A clone records it, but an origin added by
 * hand or by `gh repo create` doesn't, and without it the hooks protect
 * `main`: a repo whose default is `master` would be left unguarded. Asking
 * GitHub once records it. Not fatal: the message says how to fix it later. */
async function recordDefaultBranch(
  ctx: Context,
  repoRoot: string,
): Promise<void> {
  const result = await ctx.git.run(
    ["remote", "set-head", "origin", "--auto"],
    repoRoot,
  );
  if (result.code !== 0) {
    ctx.stderr.write(
      "Couldn't read the default branch from GitHub, so the hooks protect " +
        "main until `git remote set-head origin --auto` succeeds.\n",
    );
  }
}

/** Resolves origin: either it already exists, or offers to create it. Returns
 * undefined when the run should stop here (message already printed).
 * `writeFiles` writes setup's files; it runs here only if the first commit
 * has to be made, so those files are in it. */
async function resolveOrigin(
  ctx: Context,
  repoRoot: string,
  writeFiles: () => Promise<unknown>,
  approved: boolean,
): Promise<GithubOrigin | undefined> {
  const originCheck = await checkOrigin(ctx, repoRoot);

  if (originCheck.state === "ok") {
    return originCheck.origin;
  }
  if (originCheck.state === "wrong-host") {
    ctx.stderr.write(`${wrongHostMessage(originCheck.url)}\n`);
    return undefined;
  }

  const outcome = await offerRepoCreation(
    ctx,
    repoRoot,
    async () => {
      await writeFiles();
    },
    approved,
  );
  if (outcome.kind === "created") {
    ctx.stdout.write("Created the GitHub repository and pushed.\n");
    return outcome.origin;
  }
  // declined, commit-needed and failed all stop init with an explanatory
  // message. Only commit-needed has written anything: setup's files, staged
  // for the commit the user is asked to make.
  ctx.stderr.write(`${outcome.message}\n`);
  return undefined;
}

async function runInit(
  deps: InitDeps,
  ctx: Context,
  approvals: Approvals,
): Promise<number> {
  const repoCheck = await checkGitRepo(ctx, ctx.cwd);
  if (!repoCheck.ok) {
    ctx.stderr.write(`${repoCheck.message}\n`);
    return 1;
  }
  const repoRoot = repoCheck.value;

  const ghInstalled = await checkGhInstalled(ctx, repoRoot);
  if (!ghInstalled.ok) {
    ctx.stderr.write(`${ghInstalled.message}\n`);
    return 1;
  }

  const ghSignedIn = await checkGhSignedIn(ctx, repoRoot);
  if (!ghSignedIn.ok) {
    ctx.stderr.write(`${ghSignedIn.message}\n`);
    return 1;
  }

  // By now the launcher has installed temple-bar into node_modules/, so
  // .gitignore has to cover it even if the run stops at a GitHub question:
  // otherwise the user's next `git add -A` commits node_modules/.
  const gitignoreFirst = await ensureGitignore(ctx, repoRoot);

  // Written once, whether that happens before the first commit or after the
  // GitHub steps.
  let written: SetupFilesOutcome | undefined;
  const writeFiles = async (): Promise<SetupFilesOutcome> =>
    (written ??= await writeSetupFiles(ctx, repoRoot));

  const origin = await resolveOrigin(
    ctx,
    repoRoot,
    writeFiles,
    approvals.createRepo,
  );
  if (!origin) {
    return 1;
  }
  await recordDefaultBranch(ctx, repoRoot);

  let exitCode = 0;

  // An unprotected main is not "set up": a ruleset or CodeQL that couldn't
  // be set up (no terminal, or the API call failed) ends the run non-zero.
  // The local setup below still runs, so a second run only has GitHub left.
  const rulesetOutcome = await offerProtection(
    ctx,
    repoRoot,
    origin,
    approvals.createRuleset,
  );
  if (rulesetOutcome.kind === "not-created") {
    ctx.stderr.write(`${rulesetOutcome.message}\n`);
    exitCode = 1;
  } else {
    ctx.stdout.write(`${rulesetOutcome.message}\n`);
  }

  const files = await writeFiles();
  const { wroteGitignore, wroteJudge, packageOutcome } = files;
  ctx.stdout.write(
    gitignoreFirst || wroteGitignore
      ? "Updated .gitignore.\n"
      : ".gitignore already has the required lines; left it alone.\n",
  );
  if (reportAgentsFiles(ctx, files)) {
    exitCode = 1;
  }
  ctx.stdout.write(
    wroteJudge
      ? `Wrote the judge workflow, ${JUDGE_WORKFLOW_PATH}.\n`
      : `${JUDGE_WORKFLOW_PATH} already exists; left it alone.\n`,
  );

  if (packageOutcome.invalid !== undefined) {
    ctx.stderr.write(`${packageOutcome.invalid}\n`);
    exitCode = 1;
  }
  if (packageOutcome.conflicts.length > 0) {
    for (const conflict of packageOutcome.conflicts) {
      ctx.stderr.write(conflictMessage(conflict.name, conflict.expected));
    }
    exitCode = 1;
  }
  if (packageOutcome.invalid === undefined) {
    ctx.stdout.write(
      packageOutcome.wrote
        ? "Updated package.json.\n"
        : "package.json already has the required scripts; left it alone.\n",
    );
  }

  const hooksReport = await deps.installHooks(ctx, repoRoot);
  for (const item of hooksReport.items) {
    if (item.status === "conflict") {
      ctx.stderr.write(
        `Hook install conflict: ${item.item} (${item.detail ?? "differs from temple-bar's"}); left it alone.\n`,
      );
    }
  }
  if (hooksReport.hasConflicts) {
    exitCode = 1;
  }
  ctx.stdout.write(
    hooksReport.items.some((item) => item.status === "written")
      ? "Installed the git hooks.\n"
      : "Git hooks already installed; left them alone.\n",
  );

  if (exitCode === 0) {
    ctx.stdout.write("temple-bar is set up.\n");
    const changed =
      gitignoreFirst ||
      wroteGitignore ||
      files.wroteAgents ||
      files.wroteCompanions.length > 0 ||
      files.claudeMdAdded.length > 0 ||
      wroteJudge ||
      packageOutcome.wrote ||
      hooksReport.items.some((item) => item.status === "written");
    if (changed) {
      ctx.stdout.write(await nextSteps(ctx, repoRoot, files));
    }
  }
  return exitCode;
}

/** Why a package.json script was left alone, and what to do about it. A
 * `prepare` script is the project's own command, so replacing it would throw
 * that away: it has to be changed so temple-bar's command can follow it. */
function conflictMessage(name: string, expected: string): string {
  const head = `package.json already has a "${name}" script that isn't temple-bar's.`;
  if (name === "prepare") {
    return (
      `${head} It can't safely have temple-bar's command chained after it, ` +
      `so change it to end with " && ${expected}" (or set it to ` +
      `"${expected}" if the project doesn't need its own).\n`
    );
  }
  return `${head} Add this yourself: "${name}": "${expected}"\n`;
}

/** Reports AGENTS.md and the files beside it; returns true when AGENTS.md
 * was refused, which ends the run non-zero: the rules agents read aren't
 * temple-bar's until the block is put right. A size warning doesn't: the
 * file is written, and the gate names the overage again until it's fixed. */
function reportAgentsFiles(ctx: Context, files: SetupFilesOutcome): boolean {
  if (files.agentsProblem !== undefined) {
    ctx.stderr.write(`${files.agentsProblem}\n`);
  } else {
    ctx.stdout.write(
      files.wroteAgents
        ? "Wrote temple-bar's rules into AGENTS.md.\n"
        : "AGENTS.md already has temple-bar's rules; left it alone.\n",
    );
  }
  if (files.agentsSizeWarning !== undefined) {
    ctx.stdout.write(`Warning: ${files.agentsSizeWarning}\n`);
  }
  if (files.wroteCompanions.length > 0) {
    ctx.stdout.write(
      `Wrote the files AGENTS.md links to, where missing: ${files.wroteCompanions.join(", ")}.\n`,
    );
  }
  if (files.claudeMdAdded.length > 0) {
    ctx.stdout.write(
      `Added to CLAUDE.md: ${files.claudeMdAdded.join(" and ")}.\n`,
    );
  }
  return files.agentsProblem !== undefined;
}

/** The commit message setup's next steps suggest. It must pass the
 * commit-msg hook setup has just installed, so it has a conventional prefix. */
export const SETUP_COMMIT_MESSAGE = "chore: set up temple-bar";

const BRANCH_REF_PREFIX = "refs/heads/";

/** The branch HEAD is on, or undefined on a detached HEAD or when git can't
 * tell. A branch with no commits yet still has a name. The full ref is read
 * and its prefix removed, because git's short form turns into `heads/main`
 * when a tag is also called `main`. */
async function currentBranch(
  ctx: Context,
  cwd: string,
): Promise<string | undefined> {
  const result = await ctx.git.run(["symbolic-ref", "--quiet", "HEAD"], cwd);
  // Only git's line ending is removed: a branch name may end in other
  // whitespace, such as a non-breaking space.
  const ref = result.code === 0 ? result.stdout.replace(/\r?\n$/, "") : "";
  const name = ref.startsWith(BRANCH_REF_PREFIX)
    ? ref.slice(BRANCH_REF_PREFIX.length)
    : "";
  return name === "" ? undefined : name;
}

/** A branch name ready to paste into a shell. git allows characters such as
 * `$`, `;` and backquotes in branch names, and a shell would act on them, so
 * any name with more than letters, digits and `._/-` goes in single quotes. */
function shellQuoted(branch: string): string {
  return /^[\w./-]+$/.test(branch)
    ? branch
    : `'${branch.replaceAll("'", `'\\''`)}'`;
}

/** The setup is uncommitted, and the protected branch now refuses direct
 * commits: say how to land it. On that branch (or when the branch can't be
 * told) the steps start a new branch; on any other, setup already ran on a
 * branch worth keeping, so a second one would be needless. Files are named,
 * not `git add -A` or a whole folder, so unrelated work (in docs/, say)
 * stays out of the setup commit: only the companion files this run wrote
 * are listed. The steps are advice, so nothing here may fail the run. */
async function nextSteps(
  ctx: Context,
  repoRoot: string,
  files: SetupFilesOutcome,
): Promise<string> {
  const claudeMdUpdated =
    files.claudeMdAdded.length > 0 &&
    !files.wroteCompanions.includes(CLAUDE_MD_PATH);
  const paths = [
    "AGENTS.md",
    ...(claudeMdUpdated ? [CLAUDE_MD_PATH] : []),
    ...files.wroteCompanions,
    "package.json",
    ".gitignore",
    JUDGE_WORKFLOW_PATH,
  ];
  const protectedBranch = await findProtectedBranch(ctx, repoRoot);
  const current = await currentBranch(ctx, repoRoot);
  const onOther = current !== undefined && current !== protectedBranch;
  const branch = onOther ? current : SETUP_BRANCH;
  return (
    `Next: ${protectedBranch} now refuses direct commits, so land this ` +
    "setup through a pull request" +
    (onOther ? ` (setup ran on ${branch}, so no new branch is needed)` : "") +
    ":\n" +
    (onOther ? "" : `  git switch -c ${SETUP_BRANCH}\n`) +
    `  git add ${paths.join(" ")}  (plus your lockfile)\n` +
    `  git commit -m "${SETUP_COMMIT_MESSAGE}"\n` +
    `  git push -u origin ${shellQuoted(branch)}\n` +
    "  gh pr create --fill\n"
  );
}

/** The branch the next steps suggest when setup ran on the protected one. */
const SETUP_BRANCH = "temple-bar-setup";

export function createInitCommand(deps: InitDeps): CommandEntry {
  return {
    name: "init",
    summary: "Set up temple-bar in this repository.",
    args: "[--create-repo] [--create-ruleset]",
    details:
      "Asks before creating a GitHub repository, and once more before " +
      "changing GitHub's protection of `main`: its rulesets and CodeQL " +
      "code scanning. " +
      "With no terminal to ask in (an agent's shell), nothing is created " +
      "and setup says which flag to pass.\n\n" +
      "Options:\n" +
      "  --create-repo     The user already said yes to creating the GitHub\n" +
      "                    repository. Answers only that question.\n" +
      "  --create-ruleset  The user already said yes to the rulesets and\n" +
      "                    CodeQL. Answers only that question.\n\n" +
      "An agent passes a flag only after the user said yes in chat.",
    run: (args, ctx) => runInit(deps, ctx, parseApprovals(args)),
  };
}
