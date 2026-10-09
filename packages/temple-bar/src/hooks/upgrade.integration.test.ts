import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

import { INSTALLED_SHIMS } from "../gate/core.ts";
import { INSTALLED_CHECKOUT_FILE } from "./shims.ts";
import {
  createHookFixture,
  installRealHooks,
  runGit,
  runSh,
} from "./testing/repo-fixture.ts";
import {
  PUBLISHED_OUTPUTS,
  publishedOutput,
  outputFromRelease,
} from "../testing/published-output.ts";

for (const output of PUBLISHED_OUTPUTS.filter((output) =>
  output.item.startsWith("hooks/"),
)) {
  void test(`hook upgrade: genuine ${output.item} from ${output.releases.join(", ")} becomes the current shim`, () => {
    const fixture = createHookFixture();
    try {
      const file = path.join(fixture.repoDir, ".git", output.item);
      mkdirSync(path.dirname(file), { recursive: true });
      const old = publishedOutput(output);
      writeFileSync(file, old);
      const report = installRealHooks(fixture);
      assert.equal(report.code, 0, report.stdout + report.stderr);
      const expected = INSTALLED_SHIMS[output.item.slice("hooks/".length)];
      assert.equal(
        readFileSync(file, "utf8"),
        expected,
        `${output.item}: recognized old artifact was not upgraded`,
      );
      if (old !== expected)
        assert.match(report.stdout, /replaced an earlier temple-bar version/);
      assert.equal(installRealHooks(fixture).code, 0);
      assert.equal(
        readFileSync(file, "utf8"),
        expected,
        "rerun remains current",
      );
    } finally {
      fixture.cleanup();
    }
  });
}

void test("hook upgrade: edited old marked bytes and unknown future bytes retain the established writer", () => {
  for (const original of [
    outputFromRelease("hooks/pre-commit", "0.0.8"),
    INSTALLED_SHIMS["pre-commit"],
  ]) {
    assert.ok(original);
    const fixture = createHookFixture();
    try {
      assert.equal(installRealHooks(fixture).code, 0);
      const hooks = path.join(fixture.repoDir, ".git/hooks");
      const marker = path.join(hooks, INSTALLED_CHECKOUT_FILE);
      const writer = readFileSync(marker, "utf8");
      const edited = `${original}# unknown content\n`;
      writeFileSync(path.join(hooks, "pre-commit"), edited);
      const report = installRealHooks(fixture);
      assert.equal(report.code, 0, report.stdout + report.stderr);
      assert.match(
        report.stdout,
        /Warning: unrecognized temple-bar-marked shim retained; it may be edited or from a newer release/,
      );
      assert.equal(
        readFileSync(path.join(hooks, "pre-commit"), "utf8"),
        edited,
      );
      assert.equal(
        readFileSync(marker, "utf8"),
        writer,
        "retained shim does not transfer writer ownership",
      );
    } finally {
      fixture.cleanup();
    }
  }
});

void test("hook upgrade: another worktree upgrades recognized shared shims without claiming unknown content", () => {
  const fixture = createHookFixture();
  try {
    writeFileSync(path.join(fixture.repoDir, "seed.txt"), "seed\n");
    assert.equal(runGit(fixture.repoDir, ["add", "seed.txt"]).code, 0);
    assert.equal(runGit(fixture.repoDir, ["commit", "-qm", "seed"]).code, 0);
    const linked = path.join(fixture.root, "linked");
    assert.equal(
      runGit(fixture.repoDir, ["worktree", "add", "-q", "-b", "linked", linked])
        .code,
      0,
    );
    const hooks = path.join(fixture.repoDir, ".git/hooks");
    for (const [name] of Object.entries(INSTALLED_SHIMS))
      writeFileSync(
        path.join(hooks, name),
        outputFromRelease(`hooks/${name}`, "0.0.8"),
      );
    const install = runSh(fixture.binPath, ["hook", "install"], linked);
    assert.equal(install.code, 0, install.stdout + install.stderr);
    for (const [name, content] of Object.entries(INSTALLED_SHIMS))
      assert.equal(readFileSync(path.join(hooks, name), "utf8"), content);
    const marker = path.join(hooks, INSTALLED_CHECKOUT_FILE);
    assert.equal(
      realpathSync.native(readFileSync(marker, "utf8").trim()),
      realpathSync.native(linked),
    );
    const unknown = `${INSTALLED_SHIMS["pre-commit"] ?? ""}# future or edited\n`;
    writeFileSync(path.join(hooks, "pre-commit"), unknown);
    assert.equal(installRealHooks(fixture).code, 0);
    assert.equal(
      realpathSync.native(readFileSync(marker, "utf8").trim()),
      realpathSync.native(linked),
    );
    assert.equal(readFileSync(path.join(hooks, "pre-commit"), "utf8"), unknown);
    assert.ok(existsSync(marker));
  } finally {
    fixture.cleanup();
  }
});
