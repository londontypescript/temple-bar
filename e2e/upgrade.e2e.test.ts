import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { INSTALLED_SHIMS } from "../packages/temple-bar/src/gate/core.ts";
import { CHECKED_WORKFLOWS } from "../packages/temple-bar/src/init/workflows.ts";
import {
  JUDGE_WORKFLOW_PATH,
  judgeWorkflow,
} from "../packages/temple-bar/src/judge/workflow.ts";
import { INSTALLED_CHECKOUT_FILE } from "../packages/temple-bar/src/hooks/shims.ts";
import { outputFromRelease } from "../packages/temple-bar/src/testing/published-output.ts";
import { describe, run } from "./support/run.ts";
import { realLink } from "../packages/temple-bar/src/init/testing/write-target-repo.ts";
import {
  installUpgradePackage,
  packedTarball,
  publishedTarball,
  upgradeEnv,
  upgradeProject,
} from "./support/upgrade.ts";

let workDir = "";
let env: NodeJS.ProcessEnv;
let packed = "";
let published = "";
const workflows = [
  { path: JUDGE_WORKFLOW_PATH, content: judgeWorkflow() },
  ...CHECKED_WORKFLOWS,
];

before(async () => {
  // Git expands Windows short temp paths before the post-checkout install.
  // Later pnpm commands and their caches must use the same canonical spelling.
  workDir = realpathSync.native(
    mkdtempSync(path.join(tmpdir(), "temple-bar-upgrade-")),
  );
  env = upgradeEnv(workDir);
  packed = await packedTarball(workDir, env);
  published = await publishedTarball(workDir, "0.0.9");
});

after(() => {
  if (workDir !== "") rmSync(workDir, { recursive: true, force: true });
});

async function setup(dir: string) {
  return run("pnpm", ["exec", "temple-bar", "init"], { cwd: dir, env });
}

async function gate(dir: string) {
  return run("pnpm", ["run", "gate"], { cwd: dir, env });
}

function assertCurrent(dir: string): void {
  for (const [name, content] of Object.entries(INSTALLED_SHIMS))
    assert.equal(
      readFileSync(path.join(dir, ".git/hooks", name), "utf8"),
      content,
      `${name}: recognized old artifact was not upgraded`,
    );
  for (const workflow of workflows)
    assert.equal(
      readFileSync(path.join(dir, workflow.path), "utf8"),
      workflow.content,
      `${workflow.path}: recognized old artifact was not upgraded`,
    );
}

void test(
  "packed upgrade: exact published 0.0.9 setup upgrades through prepare and reruns unchanged",
  { timeout: 300_000 },
  async () => {
    const dir = await upgradeProject(workDir, "previous-release", env);
    await installUpgradePackage(dir, published, env);
    const original = await setup(dir);
    assert.equal(original.code, 0, describe(original));
    for (const [name] of Object.entries(INSTALLED_SHIMS))
      assert.equal(
        readFileSync(path.join(dir, ".git/hooks", name), "utf8"),
        outputFromRelease(`hooks/${name}`, "0.0.9"),
        "published setup writes the independently frozen published shim",
      );
    for (const workflow of workflows)
      assert.equal(
        readFileSync(path.join(dir, workflow.path), "utf8"),
        outputFromRelease(workflow.path, "0.0.9"),
      );
    const oldGate = await gate(dir);
    assert.equal(oldGate.code, 0, describe(oldGate));
    await installUpgradePackage(dir, packed, env);
    const upgraded = await setup(dir);
    assert.equal(upgraded.code, 0, describe(upgraded));
    assertCurrent(dir);
    const passing = await gate(dir);
    assert.equal(passing.code, 0, describe(passing));
    assert.match(passing.stdout, /passed +core setup/);
    assert.match(passing.stdout, /passed +gate and title workflows/);
    const again = await setup(dir);
    assert.equal(again.code, 0, describe(again));
    assert.doesNotMatch(again.stdout, /Wrote |Updated |written:/);
    assertCurrent(dir);
  },
);

void test(
  "packed upgrade: distinct published 0.0.8 hooks and 0.0.7 judge actually replace earlier output",
  { timeout: 300_000 },
  async () => {
    const dir = await upgradeProject(workDir, "distinct-history", env);
    await installUpgradePackage(dir, published, env);
    assert.equal((await setup(dir)).code, 0);
    for (const [name] of Object.entries(INSTALLED_SHIMS))
      writeFileSync(
        path.join(dir, ".git/hooks", name),
        outputFromRelease(`hooks/${name}`, "0.0.8"),
      );
    writeFileSync(
      path.join(dir, JUDGE_WORKFLOW_PATH),
      outputFromRelease(JUDGE_WORKFLOW_PATH, "0.0.7").replaceAll("\n", "\r\n"),
    );
    await installUpgradePackage(dir, packed, env);
    // The normal frozen install invokes prepare through the installed packed package.
    for (const [name, content] of Object.entries(INSTALLED_SHIMS))
      assert.equal(
        readFileSync(path.join(dir, ".git/hooks", name), "utf8"),
        content,
        `${name}: recognized old artifact was not upgraded during prepare`,
      );
    const upgraded = await setup(dir);
    assert.equal(upgraded.code, 0, describe(upgraded));
    assert.match(
      upgraded.stdout,
      /Updated the judge workflow.*recognized an earlier temple-bar release/,
    );
    assertCurrent(dir);
    const passing = await gate(dir);
    assert.equal(passing.code, 0, describe(passing));

    const hook = path.join(dir, ".git/hooks/pre-commit");
    const editedHook = `${outputFromRelease("hooks/pre-commit", "0.0.8")}# our edit\n`;
    const writer = readFileSync(
      path.join(dir, ".git/hooks", INSTALLED_CHECKOUT_FILE),
      "utf8",
    );
    writeFileSync(hook, editedHook);
    const retained = await run(
      "pnpm",
      ["exec", "temple-bar", "hook", "install"],
      { cwd: dir, env },
    );
    assert.equal(retained.code, 0, describe(retained));
    assert.match(
      retained.stdout,
      /unrecognized temple-bar-marked shim retained/,
    );
    assert.equal(readFileSync(hook, "utf8"), editedHook);
    assert.equal(
      readFileSync(
        path.join(dir, ".git/hooks", INSTALLED_CHECKOUT_FILE),
        "utf8",
      ),
      writer,
    );
    const failed = await gate(dir);
    assert.notEqual(failed.code, 0, describe(failed));
    assert.match(
      failed.stderr,
      /the pre-commit hook differs from the one temple-bar installs/,
    );
    writeFileSync(hook, INSTALLED_SHIMS["pre-commit"] ?? "");

    for (const workflow of workflows)
      writeFileSync(
        path.join(dir, workflow.path),
        `${outputFromRelease(workflow.path, workflow.path === JUDGE_WORKFLOW_PATH ? "0.0.7" : "0.0.9")}# our edit\n`,
      );
    const refused = await setup(dir);
    assert.equal(refused.code, 1, describe(refused));
    for (const workflow of workflows) {
      assert.ok(
        refused.stderr.includes(`${workflow.path} differs`),
        describe(refused),
      );
      assert.match(
        readFileSync(path.join(dir, workflow.path), "utf8"),
        /# our edit\n$/,
      );
    }
    assert.match(refused.stderr, /judge\.yml.*setup cannot complete/);
    const changedGate = await gate(dir);
    assert.notEqual(changedGate.code, 0, describe(changedGate));
    assert.match(changedGate.stderr, /temple-bar-gate\.yml differs/);
    assert.match(changedGate.stderr, /temple-bar-pr-title\.yml differs/);

    const oldJudge = outputFromRelease(JUDGE_WORKFLOW_PATH, "0.0.7");
    const outsideJudge = path.join(workDir, "outside-old-judge");
    writeFileSync(outsideJudge, oldJudge);
    const judgePath = path.join(dir, JUDGE_WORKFLOW_PATH);
    rmSync(judgePath);
    realLink(outsideJudge, judgePath);
    const linkedJudge = await setup(dir);
    assert.equal(linkedJudge.code, 1, describe(linkedJudge));
    assert.match(
      linkedJudge.stderr,
      /temple-bar-judge\.yml is a symlink; left it alone/,
    );
    assert.equal(
      readFileSync(outsideJudge, "utf8"),
      oldJudge,
      "packed setup never upgrades through a linked historical workflow",
    );
  },
);

void test(
  "packed upgrade: shared worktrees retain the newest installed bytes in both version orders",
  { timeout: 300_000 },
  async () => {
    for (const currentFirst of [false, true]) {
      const dir = await upgradeProject(
        workDir,
        currentFirst ? "current-first" : "published-first",
        env,
      );
      await installUpgradePackage(dir, currentFirst ? packed : published, env);
      const firstSetup = await setup(dir);
      assert.equal(firstSetup.code, 0, describe(firstSetup));
      for (const args of [
        ["switch", "-c", "fixture/setup"],
        ["add", "-A"],
        ["commit", "-qm", "chore: set up upgrade fixture"],
      ]) {
        const git = await run("git", args, { cwd: dir, env });
        assert.equal(git.code, 0, describe(git));
      }
      const linked = path.join(
        workDir,
        currentFirst ? "linked-published" : "linked-current",
      );
      const worktree = await run(
        "git",
        ["worktree", "add", "-b", "fixture/linked", linked],
        { cwd: dir, env },
      );
      assert.equal(worktree.code, 0, describe(worktree));
      await installUpgradePackage(
        linked,
        currentFirst ? published : packed,
        env,
      );
      const secondSetup = await setup(linked);
      assert.equal(secondSetup.code, 0, describe(secondSetup));
      assertCurrent(dir);
      const primaryGate = await gate(dir);
      const linkedGate = await gate(linked);
      // This release deliberately keeps 0.0.9's template bytes. Both immutable
      // gates can therefore pass; a future changed template needs new evidence.
      assert.equal(primaryGate.code, 0, describe(primaryGate));
      assert.equal(linkedGate.code, 0, describe(linkedGate));

      const hooks = path.join(dir, ".git/hooks");
      const marker = path.join(hooks, INSTALLED_CHECKOUT_FILE);
      const writer = readFileSync(marker, "utf8");
      const unrecognized = `${INSTALLED_SHIMS["pre-commit"] ?? ""}# a future or edited template\n`;
      writeFileSync(path.join(hooks, "pre-commit"), unrecognized);
      for (const checkout of [dir, linked]) {
        const retained = await run(
          "pnpm",
          ["exec", "temple-bar", "hook", "install"],
          { cwd: checkout, env },
        );
        assert.equal(retained.code, 0, describe(retained));
        assert.equal(
          readFileSync(path.join(hooks, "pre-commit"), "utf8"),
          unrecognized,
          "neither installer downgrades unknown marked shared content",
        );
        assert.equal(
          readFileSync(marker, "utf8"),
          writer,
          "unknown shared bytes never transfer writer ownership",
        );
      }
      const immutableOld = await gate(currentFirst ? linked : dir);
      assert.notEqual(immutableOld.code, 0, describe(immutableOld));
      assert.match(
        immutableOld.stderr,
        /the pre-commit hook differs from the one temple-bar installs/,
      );
      writeFileSync(
        path.join(hooks, "pre-commit"),
        INSTALLED_SHIMS["pre-commit"] ?? "",
      );
      const newCheckout = currentFirst ? dir : linked;
      const writerInstall = await run(
        "pnpm",
        ["exec", "temple-bar", "hook", "install"],
        { cwd: newCheckout, env },
      );
      assert.equal(writerInstall.code, 0, describe(writerInstall));
      rmSync(path.join(newCheckout, "node_modules"), {
        recursive: true,
        force: true,
      });
      const fallbackCheckout = currentFirst ? linked : dir;
      const allowed = await run(
        "git",
        [
          "commit",
          "--allow-empty",
          "-m",
          "chore: exercise remaining installed runtime",
        ],
        { cwd: fallbackCheckout, env },
      );
      assert.equal(allowed.code, 0, describe(allowed));
      for (const [name, content] of Object.entries(INSTALLED_SHIMS))
        assert.equal(
          readFileSync(path.join(hooks, name), "utf8"),
          content,
          "writer disappearance does not roll back shared shims",
        );
      rmSync(path.join(fallbackCheckout, "node_modules"), {
        recursive: true,
        force: true,
      });
      const closed = await run(
        "git",
        ["commit", "--allow-empty", "-m", "chore: runtime no longer available"],
        { cwd: fallbackCheckout, env },
      );
      assert.notEqual(closed.code, 0, describe(closed));
      assert.match(
        closed.stderr,
        /temple-bar is not installed in any checkout of this repo/,
      );
    }
  },
);
