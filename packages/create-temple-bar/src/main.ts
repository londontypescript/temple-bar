// The launcher's whole job: detect the package manager, create package.json
// if there isn't one, add @londontypescript/temple-bar as a pinned dev
// dependency, then run `temple-bar init` through the same package manager
// and exit with its code. Everything that touches the outside world (fs,
// process spawning) is injected, so this orchestration is testable with a
// fake of each.

import path from "node:path";

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
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly ownVersion: string;
  readonly fs: FsLike;
  readonly run: ProcessRunner;
  readonly stderr: WriterLike;
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
  const pm = detectPackageManager(deps.env.npm_config_user_agent);
  await ensurePackageJson(deps);

  const options: RunOptions = { cwd: deps.cwd, env: deps.env };

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
