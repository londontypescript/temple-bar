// `temple-bar init`: checks the requirements and which repository it may
// set up (a public one owned by an organisation, ADR 0021), offers the
// GitHub changes (repo creation; the rulesets and CodeQL under one yes) only
// on an explicit yes, writes AGENTS.md, its companion docs, the workflows
// and package.json where they're missing, then installs the hooks. Every
// hard stop below happens before any write, so a failed run leaves the repo
// untouched; a stop at a GitHub question writes only .gitignore. A path
// setup refuses to write through (a symlink) is reported when it's found,
// and the run still writes every other file and installs the hooks, then
// ends non-zero.

import type { CommandEntry } from "../registry.ts";
import type { Context } from "../context.ts";
import {
  checkGhInstalled,
  checkGhSignedIn,
  checkGitRepo,
  wrongHostMessage,
  type GithubOrigin,
} from "./requirements.ts";
import { finishCreation } from "./first-push.ts";
import { licenseNote, offerRepoCreation } from "./github-repo.ts";
import { parseInitArgs, type InitArgs } from "./init-args.ts";
import { planRepository, type RepositoryPlan } from "./repo-owner.ts";
import { offerProtection } from "./github-protection.ts";
import {
  ensureGitignore,
  writeSetupFiles,
  type SetupFilesOutcome,
} from "./files.ts";
import { reportSetupFiles, wroteSetupFiles } from "./files-report.ts";
import { setupWriteTargets } from "./write-target.ts";
import type { InitDeps } from "./types.ts";
import { JUDGE_WORKFLOW_PATH } from "../judge/workflow.ts";
import { CHECKED_WORKFLOWS } from "./workflows.ts";
import { CLAUDE_MD_PATH } from "./companion-docs.ts";
import { PRETTIER_IGNORE_PATH } from "./prettier-ignore.ts";
import { GITATTRIBUTES_PATH } from "./gitattributes.ts";
import { findProtectedBranch } from "../hooks/protected-branch.ts";

export type { InitDeps } from "./types.ts";

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

/** Carries out the plan for origin: an existing one as it is (making its
 * first push when `--create-repo` asks), or a new one offered. Returns
 * undefined when the run should stop here (message already printed).
 * `writeFiles` writes setup's files; it runs here only if the first commit
 * has to be made, so those files are in it. */
async function resolveOrigin(
  ctx: Context,
  repoRoot: string,
  plan: Exclude<RepositoryPlan, { kind: "refused" }>,
  args: InitArgs,
  writeFiles: () => Promise<unknown>,
): Promise<GithubOrigin | undefined> {
  if (plan.kind === "wrong-host") {
    ctx.stderr.write(`${wrongHostMessage(plan.url)}\n`);
    return undefined;
  }
  if (plan.kind === "existing") {
    if (plan.finish) {
      const stop = await finishCreation(
        ctx,
        repoRoot,
        plan.origin,
        args.identities,
      );
      if (stop !== undefined) {
        ctx.stderr.write(`${stop}\n`);
        return undefined;
      }
      ctx.stdout.write(
        `Pushed this branch to ${plan.origin.owner}/${plan.origin.repo}.\n`,
      );
    }
    return plan.origin;
  }

  const outcome = await offerRepoCreation(
    ctx,
    repoRoot,
    {
      owner: args.owner,
      approved: args.createRepo,
      identitiesCode: args.identities,
    },
    async () => {
      await writeFiles();
    },
  );
  if (outcome.kind === "created") {
    ctx.stdout.write(
      `Created the GitHub repository ${outcome.origin.owner}/${outcome.origin.repo} and pushed.\n`,
    );
    return outcome.origin;
  }
  // declined and failed both stop init with an explanatory message. Only a
  // first commit setup couldn't make has written anything: setup's files,
  // staged for the commit the user is asked to make.
  ctx.stderr.write(`${outcome.message}\n`);
  return undefined;
}

async function runInit(
  deps: InitDeps,
  ctx: Context,
  args: InitArgs,
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

  // Who owns the repository, and whether it is public, is settled before
  // anything is written.
  const plan = await planRepository(ctx, repoRoot, args);
  if (plan.kind === "refused") {
    ctx.stderr.write(`${plan.message}\n`);
    return 1;
  }

  // By now the launcher has installed temple-bar into node_modules/, so
  // .gitignore has to cover it even if the run stops at a GitHub question:
  // otherwise the user's next `git add -A` commits node_modules/.
  const targets = setupWriteTargets(ctx, repoRoot);
  const gitignoreFirst = await ensureGitignore(ctx, repoRoot, targets);

  // Written once, whether that happens before the first commit or after the
  // GitHub steps.
  let written: SetupFilesOutcome | undefined;
  const writeFiles = async (): Promise<SetupFilesOutcome> =>
    (written ??= await writeSetupFiles(ctx, repoRoot, targets));

  const origin = await resolveOrigin(ctx, repoRoot, plan, args, writeFiles);
  if (!origin) {
    return 1;
  }
  const note = await licenseNote(ctx, repoRoot);
  if (note !== undefined) {
    ctx.stdout.write(note);
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
    args.createRuleset,
  );
  if (rulesetOutcome.kind === "not-created") {
    ctx.stderr.write(`${rulesetOutcome.message}\n`);
    exitCode = 1;
  } else {
    ctx.stdout.write(`${rulesetOutcome.message}\n`);
  }

  const files = await writeFiles();
  if (!targets.refusals.has(".gitignore"))
    ctx.stdout.write(
      gitignoreFirst || files.wroteGitignore
        ? "Updated .gitignore.\n"
        : ".gitignore already has the required lines; left it alone.\n",
    );
  if (reportSetupFiles(ctx, files)) {
    exitCode = 1;
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
      wroteSetupFiles(files) ||
      hooksReport.items.some((item) => item.status === "written");
    if (changed) {
      ctx.stdout.write(await nextSteps(ctx, repoRoot, files));
    }
  }
  return exitCode;
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
    PRETTIER_IGNORE_PATH,
    ...(files.gitattributes.kind === "wrote" ? [GITATTRIBUTES_PATH] : []),
    JUDGE_WORKFLOW_PATH,
    ...CHECKED_WORKFLOWS.map((workflow) => workflow.path),
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
    args: "[--create-repo] [--owner <organisation>] [--identities <code>] [--create-ruleset]",
    details:
      "temple-bar sets up only public repositories owned by a GitHub " +
      "organisation: a personal account's repository, or one that isn't " +
      "public, is refused before anything is written. " +
      "Setup asks before creating a GitHub repository and making its first " +
      "push, showing every commit identity that push makes public, and once " +
      "more before changing GitHub's protection of `main`: its rulesets and " +
      "CodeQL code scanning. " +
      "With no terminal to ask in (an agent's shell), nothing is created " +
      "and setup says which flags to pass.\n\n" +
      "Options:\n" +
      "  --create-repo           The user already said yes to creating the\n" +
      "                          GitHub repository and to its first push.\n" +
      "                          Needs --owner and --identities.\n" +
      "  --owner <organisation>  The organisation the user agreed should own\n" +
      "                          the new repository.\n" +
      "  --identities <code>     The code setup showed with the commit\n" +
      "                          identities the user agreed to publish.\n" +
      "  --create-ruleset        The user already said yes to the rulesets\n" +
      "                          and CodeQL. Answers only that question.\n\n" +
      "An agent passes a flag only after the user said yes in chat. A wrong " +
      "call (an unknown option, a missing or malformed value) exits 2.",
    run: (args, ctx) => {
      const parsed = parseInitArgs(args);
      if (typeof parsed === "string") {
        ctx.stderr.write(`init: ${parsed}\n`);
        return Promise.resolve(2);
      }
      return runInit(deps, ctx, parsed);
    },
  };
}
