// The packed launcher, served the way a release would publish it: both
// tarballs packed, temple-bar served from a local registry, and throwaway
// git projects to run it in. Shared by the tests that run real setup.

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { initTestRepo } from "../../packages/temple-bar/src/testing/git-repo.ts";
import { environments } from "../../scripts/scaffold-check/environment.ts";
import { packBoth, type Tarballs } from "./pack.ts";
import { serveTarball } from "./registry.ts";
import { describe, run, type RunOptions, type RunResult } from "./run.ts";

export interface PackedLauncher {
  readonly folder: string;
  readonly tarballs: Tarballs;
  /** The version both packages were packed at. */
  readonly version: string;
  readonly env: NodeJS.ProcessEnv;
  close(): Promise<void>;
}

/** Packs both packages into a new temp folder and serves temple-bar. */
export async function startPackedLauncher(
  prefix: string,
): Promise<PackedLauncher> {
  // Native realpath expands Windows short-name temp paths. pnpm and the
  // frameworks otherwise disagree with tools that resolve the long names.
  const folder = realpathSync.native(mkdtempSync(path.join(tmpdir(), prefix)));
  const tarballs = await packBoth(folder);
  const manifest = JSON.parse(
    readFileSync(
      path.join(folder, "stage", "temple-bar", "package.json"),
      "utf8",
    ),
  ) as { name: string; version: string };
  const registry = await serveTarball(manifest, tarballs.templeBar);
  const env = environments(folder, process.env, registry.url).setup;
  // Exclude inherited project tools, but keep pnpm's own install directory:
  // CI's package-manager setup also puts its executable in node_modules/.bin.
  const pathKey =
    Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = (env[pathKey] ?? "")
    .split(path.delimiter)
    .filter(
      (entry) =>
        !/[\\/]node_modules[\\/]\.bin(?:[\\/]|$)/.test(entry) ||
        ["pnpm", "pnpm.cmd", "pnpm.exe"].some((name) =>
          existsSync(path.join(entry, name)),
        ),
    )
    .join(path.delimiter);
  return {
    folder,
    tarballs,
    version: manifest.version,
    env,
    close: async () => {
      await registry.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

/** A committed git project holding `files`, with a GitHub-shaped origin that
 * is never contacted. */
export async function makeProject(
  launcher: PackedLauncher,
  name: string,
  files: Readonly<Record<string, string>>,
): Promise<RunOptions> {
  const cwd = path.join(launcher.folder, name);
  mkdirSync(cwd);
  initTestRepo(cwd);
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(cwd, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  const options = { cwd, env: launcher.env };
  for (const args of [
    ["add", "-A"],
    ["commit", "-q", "-m", "Initial commit"],
    ["remote", "add", "origin", "git@github.com:acme/widgets.git"],
  ]) {
    const result = await run("git", args, options);
    assert.equal(result.code, 0, describe(result));
  }
  return options;
}

/** Runs the packed launcher in a project, as `pnpm create` would. */
export function launch(
  launcher: PackedLauncher,
  options: RunOptions,
): Promise<RunResult> {
  return run(
    "pnpm",
    [
      `--package=${launcher.tarballs.createTempleBar}`,
      "dlx",
      "create-temple-bar",
    ],
    options,
  );
}
