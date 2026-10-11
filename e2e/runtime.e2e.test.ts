// The runtime checks, through the packed packages a release would publish:
// a new worktree installs with the pinned pnpm and is refused, before any
// install, with an old pnpm first on PATH; and the launcher refuses a child
// pnpm that isn't the one that started it, before it changes package.json.
// POSIX only: the stand-in pnpm is a `sh` script.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { devNull } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import {
  launch,
  makeProject,
  startPackedLauncher,
  type PackedLauncher,
} from "./support/launcher.ts";
import {
  OLD_PNPM_VERSION,
  realPnpmPath,
  withOldPnpmFirst,
} from "./support/old-pnpm.ts";
import { describe, run } from "./support/run.ts";
import { standaloneProject } from "./support/workspace.ts";

const skip = process.platform === "win32";

let launcher: PackedLauncher | undefined;

before(async () => {
  launcher = await startPackedLauncher("temple-bar-runtime-");
});

after(async () => {
  await launcher?.close();
});

function packed(): PackedLauncher {
  assert.ok(launcher, "the packed launcher was not started");
  return launcher;
}

async function git(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) {
  return run("git", args, { cwd, env });
}

void test(
  "packed temple-bar: a new worktree installs with the pinned pnpm, and is refused with an old pnpm first on PATH",
  { timeout: 600_000, skip },
  async () => {
    const options = await makeProject(packed(), "runtime", standaloneProject());
    const setup = await launch(packed(), options);
    assert.equal(setup.code, 0, describe(setup));
    const pinned = (
      JSON.parse(
        readFileSync(path.join(options.cwd, "package.json"), "utf8"),
      ) as {
        packageManager: string;
      }
    ).packageManager;
    assert.match(pinned, /^pnpm@/);

    // Hooks refuse commits to main, so the finished setup goes on a branch.
    for (const args of [
      ["switch", "-q", "-c", "setup"],
      ["add", "-A"],
      [
        "-c",
        `core.hooksPath=${devNull}`,
        "commit",
        "-q",
        "-m",
        "chore: set up",
      ],
    ]) {
      const result = await git(options.cwd, args, options.env);
      assert.equal(result.code, 0, describe(result));
    }

    const good = path.join(packed().folder, "good");
    const added = await git(
      options.cwd,
      ["worktree", "add", "-q", "-b", "good", good],
      options.env,
    );
    assert.equal(added.code, 0, describe(added));
    assert.ok(existsSync(path.join(good, "node_modules")), describe(added));

    const oldFirst = withOldPnpmFirst(
      path.join(packed().folder, "old-pnpm"),
      options.env,
    );
    const stale = path.join(packed().folder, "stale");
    const refused = await git(
      options.cwd,
      ["worktree", "add", "-q", "-b", "stale", stale],
      oldFirst,
    );
    const output = refused.stdout + refused.stderr;
    assert.notEqual(refused.code, 0, describe(refused));
    assert.ok(output.includes(`pnpm ${pinned.slice("pnpm@".length)}`), output);
    assert.ok(output.includes(`found: ${OLD_PNPM_VERSION}`), output);
    assert.match(output, /only the install remains/, output);
    assert.ok(existsSync(path.join(stale, "package.json")));
    assert.ok(!existsSync(path.join(stale, "node_modules")));
  },
);

void test(
  "packed launcher: a child pnpm that isn't the one that started setup is refused before package.json is touched",
  { timeout: 600_000, skip },
  async () => {
    const original = '{\n  "name": "widgets",\n  "private": true\n}\n';
    const options = await makeProject(packed(), "launcher-mismatch", {
      ".gitignore": "node_modules/\n",
      "package.json": original,
    });
    const env = withOldPnpmFirst(
      path.join(packed().folder, "old-pnpm-launcher"),
      options.env,
      { onlyForChildren: true },
    );
    // The real pnpm starts the launcher; only the pnpm the launcher then
    // runs by name is the old one.
    const result = await run(
      realPnpmPath(options.env),
      [
        `--package=${packed().tarballs.createTempleBar}`,
        "dlx",
        "create-temple-bar",
      ],
      { cwd: options.cwd, env },
    );
    assert.equal(result.code, 1, describe(result));
    assert.match(result.stderr, /Nothing was changed/, describe(result));
    assert.match(result.stderr, new RegExp(`found ${OLD_PNPM_VERSION}`));
    assert.equal(
      readFileSync(path.join(options.cwd, "package.json"), "utf8"),
      original,
    );
    assert.ok(!existsSync(path.join(options.cwd, "node_modules")));
    const status = await run("git", ["status", "--porcelain"], options);
    assert.equal(status.stdout, "", describe(status));
  },
);
