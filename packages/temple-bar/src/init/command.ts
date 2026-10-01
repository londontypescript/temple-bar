// `temple-bar init`: checks the requirements, offers the two GitHub actions
// (repo creation, the `main` ruleset) only on an explicit yes, writes
// AGENTS.md and package.json if they're missing, then installs the hooks.
// Every hard stop below happens before any write, so a failed run leaves the
// repo untouched. See docs/plans/temple-bar.md §3 subtask 1.7.

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
import { offerRuleset } from "./github-ruleset.ts";
import {
  ensureGitignore,
  writeSetupFiles,
  type SetupFilesOutcome,
} from "./files.ts";
import type { InitDeps } from "./types.ts";

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

/** Resolves origin: either it already exists, or offers to create it. Returns
 * undefined when the run should stop here (message already printed).
 * `writeFiles` writes setup's files; it runs here only if the first commit
 * has to be made, so those files are in it. */
async function resolveOrigin(
  ctx: Context,
  repoRoot: string,
  writeFiles: () => Promise<unknown>,
): Promise<GithubOrigin | undefined> {
  const originCheck = await checkOrigin(ctx, repoRoot);

  if (originCheck.state === "ok") {
    return originCheck.origin;
  }
  if (originCheck.state === "wrong-host") {
    ctx.stderr.write(`${wrongHostMessage(originCheck.url)}\n`);
    return undefined;
  }

  const outcome = await offerRepoCreation(ctx, repoRoot, async () => {
    await writeFiles();
  });
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

async function runInit(deps: InitDeps, ctx: Context): Promise<number> {
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

  const origin = await resolveOrigin(ctx, repoRoot, writeFiles);
  if (!origin) {
    return 1;
  }
  await recordDefaultBranch(ctx, repoRoot);

  let exitCode = 0;

  // An unprotected main is not "set up": a ruleset that couldn't be created
  // (no terminal, or the API call failed) ends the run non-zero. The local
  // setup below still runs, so a second run only has the ruleset left to do.
  const rulesetOutcome = await offerRuleset(ctx, repoRoot, origin);
  if (rulesetOutcome.kind === "not-created") {
    ctx.stderr.write(`${rulesetOutcome.message}\n`);
    exitCode = 1;
  } else {
    ctx.stdout.write(`${rulesetOutcome.message}\n`);
  }

  const { wroteGitignore, wroteAgents, packageOutcome } = await writeFiles();
  ctx.stdout.write(
    gitignoreFirst || wroteGitignore
      ? "Updated .gitignore.\n"
      : ".gitignore already has the required lines; left it alone.\n",
  );
  ctx.stdout.write(
    wroteAgents
      ? "Wrote AGENTS.md.\n"
      : "AGENTS.md already exists; left it alone.\n",
  );

  if (packageOutcome.invalid !== undefined) {
    ctx.stderr.write(`${packageOutcome.invalid}\n`);
    exitCode = 1;
  }
  if (packageOutcome.conflicts.length > 0) {
    for (const conflict of packageOutcome.conflicts) {
      ctx.stderr.write(
        `package.json already has a "${conflict.name}" script that isn't ` +
          `temple-bar's. Add this yourself: "${conflict.name}": "${conflict.expected}"\n`,
      );
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
      wroteAgents ||
      packageOutcome.wrote ||
      hooksReport.items.some((item) => item.status === "written");
    if (changed) {
      ctx.stdout.write(NEXT_STEPS);
    }
  }
  return exitCode;
}

/** The setup is uncommitted, and main now refuses direct commits: say how
 * to land it. Files are named, not `git add -A`, so unrelated work stays
 * out of the setup commit. */
export const NEXT_STEPS =
  "Next: main now refuses direct commits, so land this setup through a " +
  "pull request:\n" +
  "  git switch -c temple-bar-setup\n" +
  "  git add AGENTS.md package.json .gitignore .githooks  (plus your lockfile)\n" +
  '  git commit -m "Set up temple-bar"\n' +
  "  git push -u origin temple-bar-setup\n" +
  "  gh pr create --fill\n";

export function createInitCommand(deps: InitDeps): CommandEntry {
  return {
    name: "init",
    summary: "Set up temple-bar in this repository.",
    run: (_args, ctx) => runInit(deps, ctx),
  };
}
