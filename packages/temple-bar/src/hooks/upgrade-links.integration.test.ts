import assert from "node:assert/strict";
import {
  lstatSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

import { installHooks } from "./install.ts";
import { INSTALLED_SHIMS } from "../gate/core.ts";
import {
  realLink,
  writeTargetRepo,
} from "../init/testing/write-target-repo.ts";
import { outputFromRelease } from "../testing/published-output.ts";

for (const name of Object.keys(INSTALLED_SHIMS)) {
  void test(`historical hook write safety: authentic 0.0.8 ${name} behind a link is never upgraded or chmoded`, async () => {
    const repo = writeTargetRepo();
    try {
      const old = outputFromRelease(`hooks/${name}`, "0.0.8");
      const target = path.join(repo.outside, "old-shim");
      const file = path.join(repo.root, ".git/hooks", name);
      writeFileSync(target, old, { mode: 0o600 });
      const mode = lstatSync(target).mode;
      realLink(target, file);
      const report = await installHooks(repo.ctx, repo.root);
      assert.equal(report.hasConflicts, true);
      const item = report.items.find((item) => item.item.endsWith(`/${name}`));
      assert.match(item?.detail ?? "", /symlink.*Fix:/);
      assert.equal(readFileSync(target, "utf8"), old);
      assert.equal(lstatSync(target).mode, mode);
      assert.equal(readlinkSync(file), target);
    } finally {
      repo.cleanup();
    }
  });
}

void test("historical hook write safety: recognized old content below a linked hooks folder is never changed", async () => {
  const repo = writeTargetRepo();
  try {
    for (const name of Object.keys(INSTALLED_SHIMS))
      writeFileSync(
        path.join(repo.outside, name),
        outputFromRelease(`hooks/${name}`, "0.0.8"),
      );
    const hooks = path.join(repo.root, ".git/hooks");
    rmSync(hooks, { recursive: true });
    realLink(repo.outside, hooks, true);
    const report = await installHooks(repo.ctx, repo.root);
    assert.equal(report.hasConflicts, true);
    for (const name of Object.keys(INSTALLED_SHIMS)) {
      assert.equal(
        readFileSync(path.join(repo.outside, name), "utf8"),
        outputFromRelease(`hooks/${name}`, "0.0.8"),
      );
      assert.match(
        report.items.find((item) => item.item.endsWith(`/${name}`))?.detail ??
          "",
        /linked folder.*Fix:/,
      );
    }
  } finally {
    repo.cleanup();
  }
});

void test("historical hook write safety: a target replaced by a link after reading is reclassified before upgrade", async () => {
  const repo = writeTargetRepo();
  try {
    const file = path.join(repo.root, ".git/hooks/pre-commit");
    const target = path.join(repo.outside, "old-shim");
    const old = outputFromRelease("hooks/pre-commit", "0.0.8");
    writeFileSync(file, old);
    writeFileSync(target, old, { mode: 0o600 });
    const mode = lstatSync(target).mode;
    let probes = 0;
    const ctx = {
      ...repo.ctx,
      fs: {
        ...repo.ctx.fs,
        classify: (candidate: string) => {
          if (candidate === file && ++probes === 2) {
            rmSync(file);
            realLink(target, file);
          }
          return repo.ctx.fs.classify(candidate);
        },
      },
    };
    const report = await installHooks(ctx, repo.root);
    assert.equal(report.hasConflicts, true);
    assert.match(
      report.items.find((item) => item.item.endsWith("/pre-commit"))?.detail ??
        "",
      /symlink.*Fix:/,
    );
    assert.equal(readFileSync(target, "utf8"), old);
    assert.equal(lstatSync(target).mode, mode);
    assert.equal(readlinkSync(file), target);
  } finally {
    repo.cleanup();
  }
});
