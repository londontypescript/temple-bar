// A real published-to-packed upgrade, with isolated package-manager caches and
// fake GitHub responses. Historical artifacts are frozen independently of the
// installer being tested; no source module acts as this fixture's tooling.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { initTestRepo } from "../../packages/temple-bar/src/testing/git-repo.ts";
import { PUBLISHED_RELEASES } from "../../packages/temple-bar/src/testing/published-output.ts";
import { createFakeGh } from "./fake-gh.ts";
import { describe, run } from "./run.ts";

export function upgradeEnv(workDir: string): NodeJS.ProcessEnv {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^npm_/i.test(key)),
  );
  return {
    ...createFakeGh(workDir, clean),
    npm_config_cache: path.join(workDir, "npm-cache"),
    npm_config_store_dir: path.join(workDir, "pnpm-store"),
    npm_config_cache_dir: path.join(workDir, "pnpm-cache"),
  };
}

export async function publishedTarball(
  workDir: string,
  version: string,
): Promise<string> {
  const release = PUBLISHED_RELEASES.find(
    (release) => release.version === version,
  );
  assert.ok(release, "published package has frozen integrity provenance");
  const response = await fetch(release.tarball);
  assert.equal(
    response.ok,
    true,
    `download ${release.tarball}: ${String(response.status)}`,
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  assert.equal(
    integrity,
    release.integrity,
    "published package integrity differs from frozen provenance",
  );
  const tarball = path.join(workDir, `published-${version}.tgz`);
  writeFileSync(tarball, bytes);
  return tarball;
}

export async function packedTarball(
  workDir: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const root = path.resolve(import.meta.dirname, "../..");
  const packed = await run("pnpm", ["pack:local", workDir], { cwd: root, env });
  assert.equal(packed.code, 0, describe(packed));
  const manifest = JSON.parse(
    readFileSync(path.join(workDir, "stage/temple-bar/package.json"), "utf8"),
  ) as { version: string };
  return path.join(
    workDir,
    "tarballs",
    `londontypescript-temple-bar-${manifest.version}.tgz`,
  );
}

export async function upgradeProject(
  workDir: string,
  name: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const dir = path.join(workDir, name);
  mkdirSync(dir);
  initTestRepo(dir);
  writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n");
  writeFileSync(path.join(dir, "README.md"), "# widgets\n");
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "widgets",
      private: true,
      packageManager: "pnpm@10.34.5",
    }),
  );
  for (const args of [
    ["add", "-A"],
    ["commit", "-qm", "Initial commit"],
    ["remote", "add", "origin", "git@github.com:acme/widgets.git"],
  ]) {
    const git = await run("git", args, { cwd: dir, env });
    assert.equal(git.code, 0, describe(git));
  }
  return dir;
}

export async function installUpgradePackage(
  dir: string,
  tarball: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const installed = await run("pnpm", ["add", "--save-dev", tarball], {
    cwd: dir,
    env,
  });
  assert.equal(installed.code, 0, describe(installed));
  // `pnpm add` changes the dependency but does not run this project's prepare.
  // Fresh clones and worktrees exercise prepare through the normal install.
  const prepared = await run("pnpm", ["install", "--frozen-lockfile"], {
    cwd: dir,
    env,
  });
  assert.equal(prepared.code, 0, describe(prepared));
}
