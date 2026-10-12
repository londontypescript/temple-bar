// The launcher's whole job: make sure this is pnpm, create package.json if
// there isn't one, add @londontypescript/temple-bar as a pinned dev
// dependency, finish a normal install (including project lifecycle scripts),
// then run `temple-bar init` through pnpm and exit with its code.
// Everything that touches the outside world (fs, process spawning) is
// injected, so this orchestration is testable with a fake of each.

import path from "node:path";

import { HELP_TEXT, wantsHelp } from "./help.ts";
import {
  addDevDependencyCommand,
  FOREIGN_LOCKFILES,
  foreignPackageManager,
  foreignLockfileMessage,
  isLaunchedByPnpm,
  installCommand,
  launchCommand,
  packageManagerRequiredMessage,
  pnpmRequiredMessage,
  runInitCommand,
} from "./package-manager.ts";
import { checkChildPnpm, startedWith } from "./pnpm-check.ts";
import type { ProcessRunner, RunOptions } from "./runner.ts";
import {
  findWorkspaceResidue,
  WORKSPACE_FILE,
  workspaceListFailedMessage,
  workspaceResidueMessage,
} from "./workspace.ts";

export interface FsLike {
  readText(filePath: string): Promise<string | undefined>;
  writeText(filePath: string, content: string): Promise<void>;
  /** The path with symlinks resolved, the form pnpm reports folders in. */
  realPath(filePath: string): Promise<string>;
}

export interface WriterLike {
  write(text: string): void;
}

export interface MainDeps {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly ownVersion: string;
  readonly fs: FsLike;
  readonly run: ProcessRunner;
  readonly stdout: WriterLike;
  readonly stderr: WriterLike;
}

/**
 * A `create` command runs this launcher through an exec step that can pass
 * its `--package` down to every child as `npm_config_package`. Left in, it
 * would make the `temple-bar init` step below look for `temple-bar` inside
 * the launcher package instead of the project. So the launcher's own
 * commands run without it.
 */
export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => key.toLowerCase() !== "npm_config_package",
    ),
  );
}

async function ensurePackageJson(
  deps: MainDeps,
  existing: string | undefined,
): Promise<void> {
  const packageJsonPath = path.join(deps.cwd, "package.json");
  if (existing !== undefined) {
    return;
  }
  const minimal = { private: true };
  await deps.fs.writeText(
    packageJsonPath,
    `${JSON.stringify(minimal, null, 2)}\n`,
  );
}

/** Every other package manager's lockfile in the folder, all named at once
 * so the user doesn't meet them one refusal at a time. Reads only. */
async function foreignLockfiles(deps: MainDeps): Promise<string[]> {
  const found: string[] = [];
  for (const name of FOREIGN_LOCKFILES) {
    if ((await deps.fs.readText(path.join(deps.cwd, name))) !== undefined) {
      found.push(name);
    }
  }
  return found;
}

export async function main(deps: MainDeps): Promise<number> {
  if (wantsHelp(deps.argv)) {
    deps.stdout.write(HELP_TEXT);
    return 0;
  }
  const launch = launchCommand(deps.ownVersion);
  const userAgent = deps.env.npm_config_user_agent;
  if (!isLaunchedByPnpm(userAgent)) {
    deps.stderr.write(pnpmRequiredMessage(launch));
    return 1;
  }
  const packageJson = await deps.fs.readText(
    path.join(deps.cwd, "package.json"),
  );
  const packageManager = foreignPackageManager(packageJson);
  const lockfiles = await foreignLockfiles(deps);
  if (lockfiles.length > 0) {
    deps.stderr.write(
      foreignLockfileMessage({
        lockfiles,
        packageManager,
        pnpmVersion: startedWith(userAgent),
        launch,
      }),
    );
    return 1;
  }
  if (packageManager !== undefined) {
    deps.stderr.write(packageManagerRequiredMessage(packageManager, launch));
    return 1;
  }

  const options: RunOptions = { cwd: deps.cwd, env: childEnv(deps.env) };

  // First, before any other pnpm command (even the read-only workspace
  // listing below, which an old pnpm would fail with a misleading message):
  // the pnpm that runs from here on.
  const pnpmCheck = await checkChildPnpm(
    packageJson,
    deps.env.npm_config_user_agent,
    deps.run,
    options,
    (filePath) => deps.fs.realPath(filePath),
  );
  if (pnpmCheck.refusal !== undefined) {
    deps.stderr.write(pnpmCheck.refusal);
    return 1;
  }
  if (pnpmCheck.note !== undefined) {
    deps.stdout.write(pnpmCheck.note);
  }

  // Checked before anything is written, so a refusal leaves no trace.
  const atWorkspaceRoot =
    (await deps.fs.readText(path.join(deps.cwd, WORKSPACE_FILE))) !== undefined;
  if (atWorkspaceRoot) {
    const residue = await findWorkspaceResidue(
      deps.cwd,
      deps.fs,
      deps.run,
      options,
    );
    if ("listingFailed" in residue) {
      deps.stderr.write(
        workspaceListFailedMessage(residue.listingFailed, launch),
      );
      return 1;
    }
    if (residue.found.length > 0) {
      deps.stderr.write(workspaceResidueMessage(residue.found, launch));
      return 1;
    }
  }

  await ensurePackageJson(deps, packageJson);

  const addDep = addDevDependencyCommand(deps.ownVersion, atWorkspaceRoot);
  const addResult = await deps.run(addDep.command, addDep.args, options);
  if (addResult.code !== 0) {
    deps.stderr.write(
      `Failed to add ${addDep.args.at(-1) ?? "@londontypescript/temple-bar"} as a dev dependency ` +
        `(ran: ${addDep.command} ${addDep.args.join(" ")}).\n`,
    );
    return addResult.code ?? 1;
  }

  // Adding a dependency does not run the project's root prepare script.
  // Frameworks use it to generate configuration needed by their checks.
  const install = installCommand();
  const installResult = await deps.run(install.command, install.args, options);
  if (installResult.code !== 0) {
    deps.stderr.write(
      `Failed to install the project (ran: ${install.command} ${install.args.join(" ")}).\n`,
    );
    return installResult.code ?? 1;
  }

  const init = runInitCommand(deps.argv);
  const initResult = await deps.run(init.command, init.args, options);
  return initResult.code ?? 1;
}
