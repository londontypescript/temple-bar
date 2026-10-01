// The test that proves the published packages work from node_modules
// (subtask 1.8, P9.1a, the G5 class of bug). Both packages are built and
// packed as a release would pack them. Then, in a fresh repo, with pnpm
// (the only supported package manager; npm and foreign lockfiles are
// refused), the launcher runs from its tarball: it adds
// temple-bar (served from a local registry, from its tarball) and runs
// `temple-bar init`, with a fake `gh` standing in for GitHub. The result
// must refuse a commit to main, allow one on a branch, and run the gate.

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { initTestRepo } from "../packages/temple-bar/src/testing/git-repo.ts";
import { createFakeGh } from "./support/fake-gh.ts";
import { packBoth, type Tarballs } from "./support/pack.ts";
import { serveTarball, type LocalRegistry } from "./support/registry.ts";
import { describe, run, type RunResult } from "./support/run.ts";

const PACKAGE_NAME = "@londontypescript/temple-bar";

let workDir = "";
let tarballs: Tarballs;
let version = "";
let registry: LocalRegistry;
let baseEnv: NodeJS.ProcessEnv;

/** The environment minus anything the outer package manager set (the test
 * suite itself runs under `pnpm run`), so each launcher sees a clean one. */
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^npm_/i.test(key)),
  );
}

before(async () => {
  workDir = mkdtempSync(path.join(tmpdir(), "temple-bar-pack-install-"));
  tarballs = await packBoth(workDir);
  const manifest = JSON.parse(
    readFileSync(
      path.join(workDir, "stage", "temple-bar", "package.json"),
      "utf8",
    ),
  ) as { name: string; version: string };
  version = manifest.version;
  registry = await serveTarball(manifest, tarballs.templeBar);
  baseEnv = {
    ...createFakeGh(workDir, cleanEnv()),
    npm_config_registry: registry.url,
    npm_config_cache: path.join(workDir, "npm-cache"),
    npm_config_store_dir: path.join(workDir, "pnpm-store"),
    npm_config_cache_dir: path.join(workDir, "pnpm-cache"),
  };
});

after(async () => {
  await registry.close();
  rmSync(workDir, { recursive: true, force: true });
});

/** A project with one commit on main, node_modules ignored, and a GitHub
 * origin (never contacted: the fake gh answers for GitHub). */
async function makeProject(name: string): Promise<string> {
  const dir = path.join(workDir, name);
  const git = (args: string[]) => run("git", args, { cwd: dir, env: baseEnv });
  mkdirSync(dir);
  initTestRepo(dir);
  writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n");
  writeFileSync(path.join(dir, "README.md"), "# widgets\n");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "Initial commit"]);
  await git(["remote", "add", "origin", "git@github.com:acme/widgets.git"]);
  return dir;
}

interface CommandLine {
  readonly command: string;
  readonly args: readonly string[];
}

/** How each package manager runs a `create-*` launcher from a tarball. */
const launchers: Record<"npm" | "pnpm", (tarball: string) => CommandLine> = {
  npm: (tarball) => ({
    command: "npm",
    args: ["exec", "--yes", `--package=${tarball}`, "--", "create-temple-bar"],
  }),
  pnpm: (tarball) => ({
    command: "pnpm",
    args: [`--package=${tarball}`, "dlx", "create-temple-bar"],
  }),
};

/** The refusal must leave the repo exactly as it was. */
function assertRefusedWithHelp(launch: RunResult, dir: string): void {
  assert.notEqual(launch.code, 0, describe(launch));
  assert.match(launch.stderr, /temple-bar needs pnpm/);
  assert.match(launch.stderr, /https:\/\/pnpm\.io\/installation/);
  assert.match(
    launch.stderr,
    /pnpm create @londontypescript\/temple-bar@latest/,
  );
  assert.ok(!existsSync(path.join(dir, "package.json")), "no package.json");
  assert.ok(!existsSync(path.join(dir, "AGENTS.md")), "no AGENTS.md");
  assert.ok(!existsSync(path.join(dir, "node_modules")), "no install");
}

void test(
  "npm: the packed launcher refuses with a helpful message and changes nothing",
  { timeout: 300_000 },
  async () => {
    const dir = await makeProject("npm-refused");
    const launcher = launchers.npm(tarballs.createTempleBar);
    const launch = await run(launcher.command, launcher.args, {
      cwd: dir,
      env: baseEnv,
    });
    assertRefusedWithHelp(launch, dir);
  },
);

void test(
  "pnpm: the packed launcher refuses a repo with another package manager's lockfile",
  { timeout: 300_000 },
  async () => {
    const dir = await makeProject("lockfile-refused");
    writeFileSync(path.join(dir, "yarn.lock"), "");
    const launcher = launchers.pnpm(tarballs.createTempleBar);
    const launch = await run(launcher.command, launcher.args, {
      cwd: dir,
      env: baseEnv,
    });
    assertRefusedWithHelp(launch, dir);
  },
);

for (const pm of ["pnpm"] as const) {
  void test(
    `${pm}: the packed launcher sets up a repo that refuses commits to main and runs the gate`,
    { timeout: 300_000 },
    async () => {
      const dir = await makeProject(`${pm}-project`);
      const inDir = { cwd: dir, env: baseEnv };
      const launcher = launchers[pm](tarballs.createTempleBar);

      const launch = await run(launcher.command, launcher.args, inDir);
      assert.equal(launch.code, 0, describe(launch));
      assert.ok(
        registry.requested.includes(PACKAGE_NAME),
        "added from the registry",
      );

      const pkg = JSON.parse(
        readFileSync(path.join(dir, "package.json"), "utf8"),
      ) as {
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
      };
      // Exact, not a ^ range, so a later install can't drift.
      assert.equal(pkg.devDependencies?.[PACKAGE_NAME], version);
      assert.equal(pkg.scripts?.gate, "temple-bar gate");
      assert.equal(pkg.scripts.prepare, "temple-bar hook install");
      assert.ok(existsSync(path.join(dir, "AGENTS.md")));
      assert.ok(existsSync(path.join(dir, ".githooks", "pre-commit")));

      const onMain = await run(
        "git",
        ["commit", "--allow-empty", "-m", "direct"],
        inDir,
      );
      assert.notEqual(onMain.code, 0, describe(onMain));
      assert.match(onMain.stderr, /refusing to commit directly to main/);

      await run("git", ["switch", "-q", "-c", "feature"], inDir);
      const onBranch = await run(
        "git",
        ["commit", "--allow-empty", "-m", "chore: work"],
        inDir,
      );
      assert.equal(onBranch.code, 0, describe(onBranch));

      const gate = await run(pm, ["run", "gate"], inDir);
      assert.equal(gate.code, 0, describe(gate));
      assert.match(gate.stdout, /within the \d+-line cap/);

      writeFileSync(path.join(dir, "index.js"), "export {};\n");
      const gateWithCode = await run(pm, ["run", "gate"], inDir);
      assert.notEqual(gateWithCode.code, 0, describe(gateWithCode));
      assert.match(
        gateWithCode.stderr,
        /missing script\(s\): typecheck, lint, format:check, test/,
      );
    },
  );
}
