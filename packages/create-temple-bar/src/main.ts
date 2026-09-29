// The launcher's whole job: detect the package manager, create package.json
// if there isn't one, add @londontypescript/temple-bar as a pinned dev
// dependency, then run `temple-bar init` through the same package manager
// and exit with its code. Everything that touches the outside world (fs,
// process spawning) is injected, so this orchestration is testable with a
// fake of each.

import path from "node:path";

import { HELP_TEXT, wantsHelp } from "./help.ts";
import {
  addDevDependencyCommand,
  detectPackageManager,
  runInitCommand,
} from "./package-manager.ts";
import type { ProcessRunner, RunOptions } from "./runner.ts";

export interface FsLike {
  readText(filePath: string): Promise<string | undefined>;
  writeText(filePath: string, content: string): Promise<void>;
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
 * `npm create temple-bar` runs this launcher through
 * `npm exec --package=@londontypescript/create-temple-bar`, and npm passes
 * that `--package` down to every child as `npm_config_package`. Left in, it
 * makes the `npx temple-bar init` step below look for `temple-bar` inside
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

function folderName(cwd: string): string {
  return path.basename(cwd) || "app";
}

async function ensurePackageJson(deps: MainDeps): Promise<void> {
  const packageJsonPath = path.join(deps.cwd, "package.json");
  const existing = await deps.fs.readText(packageJsonPath);
  if (existing !== undefined) {
    return;
  }
  const minimal = { name: folderName(deps.cwd), private: true };
  await deps.fs.writeText(
    packageJsonPath,
    `${JSON.stringify(minimal, null, 2)}\n`,
  );
}

export async function main(deps: MainDeps): Promise<number> {
  if (wantsHelp(deps.argv)) {
    deps.stdout.write(HELP_TEXT);
    return 0;
  }
  const pm = detectPackageManager(deps.env.npm_config_user_agent);
  await ensurePackageJson(deps);

  const options: RunOptions = { cwd: deps.cwd, env: childEnv(deps.env) };

  const addDep = addDevDependencyCommand(pm, deps.ownVersion);
  const addResult = await deps.run(addDep.command, addDep.args, options);
  if (addResult.code !== 0) {
    deps.stderr.write(
      `Failed to add ${addDep.args.at(-1) ?? "@londontypescript/temple-bar"} as a dev dependency ` +
        `(ran: ${addDep.command} ${addDep.args.join(" ")}).\n`,
    );
    return addResult.code ?? 1;
  }

  const init = runInitCommand(pm);
  const initResult = await deps.run(init.command, init.args, options);
  return initResult.code ?? 1;
}
