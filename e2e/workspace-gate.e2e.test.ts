// The packed gate in a pnpm workspace, with real pnpm: a root and two
// packages, each with real scripts, set up by the packed launcher. The gate
// passes, through `pnpm gate` and through `pnpm ready`, and fails the pull
// requests a workspace trial got past the gate before it checked packages:
// a package with no scripts, a package's typecheck removed, and a
// package.json outside the workspace's list; and a pnpm first on the
// project's PATH never stands in for the one that started the gate (see
// docs/adr/0015-every-package-checked-and-guarded.md).

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";

import {
  launch,
  makeProject,
  startPackedLauncher,
  type PackedLauncher,
} from "./support/launcher.ts";
import { realPnpmPath, withOldPnpmFirst } from "./support/old-pnpm.ts";
import { describe, run, type RunOptions } from "./support/run.ts";
import {
  checkedWorkspace,
  packageManifest,
  PASSING_COMMAND,
  PASSING_SCRIPTS,
} from "./support/workspace.ts";

let launcher: PackedLauncher | undefined;
let project: RunOptions | undefined;

async function git(args: readonly string[]): Promise<void> {
  const result = await run("git", args, inProject());
  assert.equal(result.code, 0, describe(result));
}

before(async () => {
  launcher = await startPackedLauncher("temple-bar-workspace-gate-");
  const options = await makeProject(launcher, "workspace", checkedWorkspace());
  const setup = await launch(launcher, options);
  assert.equal(setup.code, 0, describe(setup));
  // The ruleset checks would read GitHub's API for a GitHub origin; this
  // project is made up, and GitHub is never contacted.
  await run(
    "git",
    ["remote", "set-url", "origin", "https://git.example.invalid/acme/w.git"],
    options,
  );
  project = options;
});

after(async () => {
  await launcher?.close();
});

function inProject(): RunOptions {
  assert.ok(project, "the workspace was not set up");
  return project;
}

function file(relative: string): string {
  return path.join(inProject().cwd, ...relative.split("/"));
}

/** Runs `change`, then the gate through `pnpm gate` (or `start`), then puts
 * the files it names back as they were. */
async function gateWith(
  touched: readonly string[],
  change: () => void,
  start = () => run("pnpm", ["gate"], inProject()),
): Promise<{ code: number; stdout: string; stderr: string }> {
  const saved = touched.map((relative) => {
    try {
      return readFileSync(file(relative), "utf8");
    } catch {
      return undefined;
    }
  });
  try {
    change();
    return await start();
  } finally {
    for (const [index, relative] of touched.entries()) {
      const content = saved[index];
      if (content === undefined) {
        rmSync(file(relative), { force: true });
      } else {
        writeFileSync(file(relative), content);
      }
    }
  }
}

void test(
  "workspace gate: pnpm gate lists both packages through pnpm and runs every package's scripts",
  { timeout: 600_000 },
  async () => {
    const setUp = JSON.parse(readFileSync(file("package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    assert.equal(setUp.scripts?.ready, "temple-bar ready");

    const gate = await run("pnpm", ["gate"], inProject());
    assert.equal(gate.code, 0, describe(gate));
    assert.match(
      gate.stdout,
      /^ {2}passed {3}workspace packages \(the root and 2 package\(s\)\)$/m,
    );
    for (const folder of ["packages/a", "packages/b"]) {
      for (const script of Object.keys(PASSING_SCRIPTS)) {
        assert.match(
          gate.stdout,
          new RegExp(`^ {2}passed {3}${script} \\(${folder}\\)$`, "m"),
        );
      }
    }
    assert.match(gate.stdout, /^gate: running test in packages\/b$/m);
  },
);

void test(
  "workspace gate: a package's failing script fails the gate with its exit code",
  { timeout: 600_000 },
  async () => {
    const gate = await gateWith(["packages/b/package.json"], () => {
      writeFileSync(
        file("packages/b/package.json"),
        packageManifest("pkg-b", {
          ...PASSING_SCRIPTS,
          test: 'node -e "process.exit(3)"',
        }),
      );
    });
    assert.equal(gate.code, 1, describe(gate));
    assert.match(
      gate.stderr,
      /^ {2}failed {3}test \(packages\/b\) \(exit 3\)$/m,
    );
  },
);

void test(
  "workspace gate: a new package with no scripts fails, naming its package.json",
  { timeout: 600_000 },
  async () => {
    const gate = await gateWith(["packages/c/package.json"], () => {
      mkdirSync(file("packages/c"), { recursive: true });
      writeFileSync(file("packages/c/package.json"), packageManifest("pkg-c"));
    });
    assert.equal(gate.code, 2, describe(gate));
    assert.match(
      gate.stderr,
      /^gate: packages\/c\/package\.json is missing script\(s\): typecheck, lint, format:check, test$/m,
    );
    assert.match(
      gate.stderr,
      /workspace packages \(the root and 3 package\(s\)\)/,
    );
  },
);

void test(
  "workspace gate: a package's typecheck removed fails, naming the package",
  { timeout: 600_000 },
  async () => {
    const { typecheck, ...rest } = PASSING_SCRIPTS;
    assert.equal(typecheck, PASSING_COMMAND);
    const gate = await gateWith(["packages/a/package.json"], () => {
      writeFileSync(
        file("packages/a/package.json"),
        packageManifest("pkg-a", rest),
      );
    });
    assert.equal(gate.code, 2, describe(gate));
    assert.match(
      gate.stderr,
      /^ {2}missing {2}typecheck \(packages\/a\) \(not in packages\/a\/package\.json\)$/m,
    );
  },
);

void test(
  "workspace gate: a package.json outside the workspace's list fails, named relative to the root",
  { timeout: 600_000 },
  async () => {
    const gate = await gateWith(["tools/d/package.json"], () => {
      mkdirSync(file("tools/d"), { recursive: true });
      writeFileSync(
        file("tools/d/package.json"),
        packageManifest("tool-d", PASSING_SCRIPTS),
      );
    });
    rmSync(file("tools"), { recursive: true, force: true });
    assert.equal(gate.code, 1, describe(gate));
    assert.match(gate.stderr, /^ {2}tools\/d\/package\.json$/m);
    // Without the package list, coverage can't be trusted either.
    assert.match(
      gate.stderr,
      /^gate: failed: workspace packages, type-check coverage, test coverage$/m,
    );
  },
);

void test(
  "workspace gate: a pnpm first on the project's PATH neither lists the packages nor runs their scripts",
  { timeout: 600_000 },
  async () => {
    // The stand-in answers every command with nothing and success. Had the
    // gate asked it, the listing would come back empty and the inventory
    // fail, and package b's failing test would pass unseen.
    assert.ok(launcher, "the packed launcher was not started");
    const env = withOldPnpmFirst(
      path.join(launcher.folder, "pnpm-on-path"),
      inProject().env,
    );
    const real = realPnpmPath(inProject().env);
    const gate = await gateWith(
      ["packages/b/package.json"],
      () => {
        writeFileSync(
          file("packages/b/package.json"),
          packageManifest("pkg-b", {
            ...PASSING_SCRIPTS,
            test: 'node -e "process.exit(3)"',
          }),
        );
      },
      () => run(real, ["gate"], { ...inProject(), env }),
    );
    assert.equal(gate.code, 1, describe(gate));
    // A failed gate prints its whole report on stderr.
    for (const line of [
      /^ {2}passed {3}workspace packages \(the root and 2 package\(s\)\)$/m,
      /^ {2}passed {3}test \(packages\/a\)$/m,
      /^ {2}failed {3}test \(packages\/b\) \(exit 3\)$/m,
    ]) {
      assert.match(gate.stderr, line, describe(gate));
    }
  },
);

void test(
  "workspace gate: pnpm ready lists the packages too, and marks the commit",
  { timeout: 600_000 },
  async () => {
    await git(["switch", "-q", "-c", "feature"]);
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "chore: set up temple-bar"]);
    // What GitHub's default branch would be: the commit setup started from.
    await git(["update-ref", "refs/remotes/origin/main", "main"]);

    const ready = await run("pnpm", ["ready"], inProject());
    assert.equal(ready.code, 0, describe(ready));
    assert.match(
      ready.stdout,
      /^ {2}passed {3}workspace packages \(the root and 2 package\(s\)\)$/m,
    );
    assert.match(ready.stdout, /^ {2}passed {3}lint \(packages\/a\)$/m);
    assert.match(ready.stdout, /passed the gate and is marked ready to push/);
  },
);
