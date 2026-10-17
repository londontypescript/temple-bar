// The release tier: a fresh worktree of the five-package stack, installed by
// the packed post-checkout hook, and the packed judge on pull requests to
// the stack, served by the fake GitHub API as two whole trees read from the
// installed project. Each promise here also has a test on the minimal
// workspace that every pull request runs. See e2e/release/stack-project.ts.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";

import { extraApp, PACKAGE_SCRIPTS } from "../fixtures/stack-packages.ts";
import { judgePullRequest, PASSED, type Files } from "../support/judge.ts";
import { describe, type RunResult } from "../support/run.ts";
import {
  committedFiles,
  startStack,
  type StackProject,
} from "./stack-project.ts";

let stack: StackProject | undefined;
/** The stack as committed after setup: the base branch's tree. */
let base: Readonly<Record<string, string>> = {};

before(async () => {
  stack = await startStack("stack-worktree-judge");
  base = await committedFiles(stack);
});

after(async () => {
  await stack?.close();
});

function project(): StackProject {
  assert.ok(stack, "the stack was not set up");
  return stack;
}

const TIMEOUT = { timeout: 1_200_000 };

void test(
  "stack hooks: a fresh worktree installs through the post-checkout hook with the pinned pnpm, and the gate passes there",
  TIMEOUT,
  async () => {
    const { launcher, cwd } = project();
    const worktree = path.join(launcher.folder, "fresh");
    const added = await project().run("git", [
      "worktree",
      "add",
      "-q",
      "-b",
      "fresh",
      worktree,
    ]);
    assert.equal(added.code, 0, describe(added));
    // git shows a hook's output on stderr.
    assert.match(
      added.stderr,
      /^temple-bar: installing dependencies: pnpm install --frozen-lockfile$/m,
      describe(added),
    );
    const pinned = (
      JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")) as {
        packageManager: string;
      }
    ).packageManager;
    // pnpm records the pnpm that installed node_modules (as JSON, whatever
    // the file's name says).
    const modules = JSON.parse(
      readFileSync(
        path.join(worktree, "node_modules", ".modules.yaml"),
        "utf8",
      ),
    ) as { packageManager?: string };
    assert.equal(modules.packageManager, pinned);
    for (const installed of [
      "apps/web/node_modules/react",
      "apps/scene/node_modules/three",
      "apps/terminal/node_modules/ink",
      "apps/desktop/node_modules/@stack/shared",
    ]) {
      assert.ok(existsSync(path.join(worktree, installed)), installed);
    }

    const gate = await project().run("pnpm", ["gate"], worktree);
    assert.equal(gate.code, 0, describe(gate));
    assert.match(
      gate.stdout,
      /^ {2}passed {3}workspace packages \(the root and 5 package\(s\)\)$/m,
    );
    assert.match(gate.stdout, /^ {2}passed {3}test \(apps\/terminal\)$/m);
  },
);

async function judge(head: Files): Promise<RunResult> {
  const { cwd, env } = project();
  return judgePullRequest({ cwd, env }, base, head);
}

function assertRefuses(result: RunResult, finding: string): void {
  assert.equal(result.code, 1, describe(result));
  assert.doesNotMatch(result.stdout, PASSED);
  assert.match(result.stderr, /changes the checks that judge it/);
  assert.ok(
    result.stderr.split(/\r?\n/).includes(`  ${finding}`),
    `no finding ${finding}\n${describe(result)}`,
  );
}

void test(
  "stack judge: a pull request changing only app code passes, with the real lockfile on both sides",
  TIMEOUT,
  async () => {
    const app = "apps/web/src/App.tsx";
    const text = base[app] ?? "";
    const changed = text.replace("<h1>", '<h1 id="title">');
    assert.notEqual(changed, text);
    assert.equal(typeof base["pnpm-lock.yaml"], "string");
    const result = await judge({ ...base, [app]: changed });
    assert.equal(result.code, 0, describe(result));
    assert.match(result.stdout, PASSED);
  },
);

void test(
  "stack judge: a pull request adding a sixth app with scripts is refused",
  TIMEOUT,
  async () => {
    const result = await judge({ ...base, ...extraApp(PACKAGE_SCRIPTS) });
    assertRefuses(result, "apps/extra/package.json (added, with scripts)");
  },
);

void test(
  "stack judge: a pull request replacing an app's typecheck with a no-op is refused",
  TIMEOUT,
  async () => {
    const scene = "apps/scene/package.json";
    const manifest = JSON.parse(base[scene] ?? "") as {
      scripts: Record<string, string>;
    };
    manifest.scripts.typecheck = "exit 0";
    const result = await judge({
      ...base,
      [scene]: `${JSON.stringify(manifest, null, 2)}\n`,
    });
    assertRefuses(result, `${scene}: the "typecheck" script`);
  },
);
