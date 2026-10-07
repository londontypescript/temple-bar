import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

import { INSTALLED_SHIMS } from "../gate/core.ts";
import {
  writeTargetRepo,
  realLink,
} from "../init/testing/write-target-repo.ts";
import { installHooks } from "./install.ts";
import { createHookCommand } from "./command.ts";
import { INSTALLED_CHECKOUT_FILE } from "./shims.ts";

const hookPaths = [...Object.keys(INSTALLED_SHIMS), INSTALLED_CHECKOUT_FILE];

for (const name of hookPaths) {
  for (const dangling of [true, false]) {
    void test(`hook write safety: ${name} leaves ${dangling ? "dangling" : "outside-file"} link and target untouched`, async () => {
      const repo = writeTargetRepo();
      try {
        const file = path.join(repo.root, ".git/hooks", name);
        const target = path.join(repo.outside, "target");
        if (!dangling)
          writeFileSync(target, "outside bytes\n", { mode: 0o600 });
        realLink(target, file);
        const before = lstatSync(file);
        const report = await installHooks(repo.ctx, repo.root);
        assert.equal(
          report.hasConflicts,
          true,
          `${name}: linked hooks conflict`,
        );
        const item = report.items.find((item) =>
          item.item.endsWith(`/${name}`),
        );
        assert.equal(
          item?.status,
          "conflict",
          `${name}: refusal is a hook conflict`,
        );
        assert.match(
          item.detail ?? "",
          /symlink.*Fix: replace it with an ordinary file, or remove it, then run temple-bar hook install again/,
        );
        assert.equal(
          readlinkSync(file),
          target,
          `${name}: stored target unchanged`,
        );
        assert.equal(
          lstatSync(file).ino,
          before.ino,
          `${name}: link never replaced`,
        );
        assert.equal(
          existsSync(target),
          !dangling,
          `${name}: dangling target never created`,
        );
        if (!dangling)
          assert.equal(readFileSync(target, "utf8"), "outside bytes\n");
        assert.equal(
          await repo.run(),
          1,
          `${name}: setup propagates hook conflict`,
        );
        assert.equal(
          await createHookCommand(() => Promise.resolve("")).run(
            ["install"],
            repo.ctx,
          ),
          1,
          `${name}: standalone hook install propagates the refusal`,
        );
        assert.equal(readlinkSync(file), target);
        assert.equal(existsSync(target), !dangling);
        if (!dangling)
          assert.equal(readFileSync(target, "utf8"), "outside bytes\n");
        assert.match(
          repo.stderr.lines.join(""),
          /Hook install conflict:.*symlink.*Fix:/,
        );
      } finally {
        repo.cleanup();
      }
    });
  }
}

void test("hook write safety: linked hooks folder refuses every shim and writes nothing outside", async () => {
  const repo = writeTargetRepo();
  try {
    const hooks = path.join(repo.root, ".git/hooks");
    rmSync(hooks, { recursive: true });
    realLink(repo.outside, hooks, true);
    const report = await installHooks(repo.ctx, repo.root);
    assert.equal(report.hasConflicts, true);
    for (const name of Object.keys(INSTALLED_SHIMS)) {
      const item = report.items.find((item) => item.item.endsWith(`/${name}`));
      assert.equal(item?.status, "conflict");
      assert.match(
        item.detail ?? "",
        /linked folder \.git\/hooks\. Fix: replace \.git\/hooks with an ordinary folder, or remove it, then run temple-bar hook install again/,
      );
    }
    assert.deepEqual(readdirSync(repo.outside), []);
  } finally {
    repo.cleanup();
  }
});

for (const [name, content] of Object.entries(INSTALLED_SHIMS)) {
  void test(`hook write safety: matching linked ${name} is never chmoded`, async () => {
    const repo = writeTargetRepo();
    try {
      const target = path.join(repo.outside, "matching-shim");
      writeFileSync(target, content);
      chmodSync(target, 0o600);
      const mode = lstatSync(target).mode;
      realLink(target, path.join(repo.root, ".git/hooks", name));
      assert.equal(
        (await installHooks(repo.ctx, repo.root)).hasConflicts,
        true,
      );
      assert.equal(
        lstatSync(target).mode,
        mode,
        "matching link never changes target permissions",
      );
      assert.equal(readFileSync(target, "utf8"), content);
    } finally {
      repo.cleanup();
    }
  });
}
