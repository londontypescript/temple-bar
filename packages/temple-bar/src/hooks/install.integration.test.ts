// Integration tests for `temple-bar hook install`, run through the real
// fake bin (see testing/repo-fixture.ts) against a real git repo, so both
// install.ts and command.ts's wiring of it are exercised together.

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createHookFixture,
  installRealHooks,
  runGit,
  runSh,
} from "./testing/repo-fixture.ts";
import {
  POST_CHECKOUT_SHIM_0_0_7,
  PRE_COMMIT_SHIM_0_0_3,
  REFERENCE_TRANSACTION_SHIM_0_0_3,
} from "./testing/earlier-shims.ts";
import {
  POST_CHECKOUT_SHIM,
  PRE_COMMIT_SHIM,
  REFERENCE_TRANSACTION_SHIM,
} from "./shims.ts";

void test("install: writes every shim into the shared git folder, sets pull.ff and leaves core.hooksPath unset", () => {
  const fixture = createHookFixture();
  try {
    const result = installRealHooks(fixture);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /written: \.git\/hooks\/pre-commit/);
    assert.match(result.stdout, /written: \.git\/hooks\/commit-msg/);
    assert.match(result.stdout, /written: \.git\/hooks\/pre-push/);
    assert.match(result.stdout, /written: \.git\/hooks\/reference-transaction/);
    assert.match(result.stdout, /written: \.git\/hooks\/post-checkout/);
    assert.match(result.stdout, /unchanged: core\.hooksPath/);
    assert.match(result.stdout, /written: pull\.ff/);
    const record = path.join(
      fixture.repoDir,
      ".git",
      "hooks",
      "temple-bar-checkout",
    );
    assert.ok(existsSync(record), "records which checkout wrote the shims");
    assert.equal(
      // .native: on Windows the temp folder can be an 8.3 short name
      // (RUNNER~1) while git reports the long one.
      realpathSync.native(readFileSync(record, "utf8").trim()),
      realpathSync.native(fixture.repoDir),
      "names the checkout whose temple-bar wrote the shims",
    );

    const hooksPath = runGit(fixture.repoDir, [
      "config",
      "--get",
      "core.hooksPath",
    ]);
    assert.equal(hooksPath.code, 1, "core.hooksPath must stay unset");

    const ff = runGit(fixture.repoDir, [
      "config",
      "--local",
      "--get",
      "pull.ff",
    ]).stdout.trim();
    assert.equal(ff, "only");

    for (const name of [
      "pre-commit",
      "commit-msg",
      "pre-push",
      "reference-transaction",
      "post-checkout",
    ]) {
      const p = path.join(fixture.repoDir, ".git", "hooks", name);
      const content = readFileSync(p, "utf8");
      assert.match(content, /^#!\/bin\/sh/);
      if (process.platform !== "win32") {
        assert.equal(
          statSync(p).mode & 0o111,
          0o111,
          `${name} must be executable`,
        );
      }
    }
  } finally {
    fixture.cleanup();
  }
});

void test("install: a second run reports no changes", () => {
  const fixture = createHookFixture();
  try {
    assert.equal(installRealHooks(fixture).code, 0);

    const second = installRealHooks(fixture);

    assert.equal(second.code, 0);
    assert.doesNotMatch(second.stdout, /written:/);
    assert.match(second.stdout, /unchanged: \.git\/hooks\/pre-commit/);
    assert.match(second.stdout, /unchanged: \.git\/hooks\/post-checkout/);
    assert.match(second.stdout, /unchanged: core\.hooksPath/);
    assert.match(second.stdout, /unchanged: pull\.ff/);
  } finally {
    fixture.cleanup();
  }
});

void test("install: an existing different .git/hooks/pre-commit is reported as a conflict and left untouched", () => {
  const fixture = createHookFixture();
  try {
    const hooksDir = path.join(fixture.repoDir, ".git", "hooks");
    const customContent = "#!/bin/sh\necho custom\n";
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(path.join(hooksDir, "pre-commit"), customContent, "utf8");

    const result = installRealHooks(fixture);

    assert.equal(result.code, 1);
    assert.match(result.stdout, /conflict: \.git\/hooks\/pre-commit/);
    // reference-transaction and the config values still install cleanly.
    assert.match(result.stdout, /written: \.git\/hooks\/reference-transaction/);

    const stillCustom = readFileSync(path.join(hooksDir, "pre-commit"), "utf8");
    assert.equal(
      stillCustom,
      customContent,
      "the existing file must be untouched",
    );
  } finally {
    fixture.cleanup();
  }
});

void test("install: shims exactly as an earlier release wrote them are replaced, so upgrading doesn't fail", () => {
  const fixture = createHookFixture();
  try {
    const hooksDir = path.join(fixture.repoDir, ".git", "hooks");
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(path.join(hooksDir, "pre-commit"), PRE_COMMIT_SHIM_0_0_3);
    writeFileSync(
      path.join(hooksDir, "reference-transaction"),
      REFERENCE_TRANSACTION_SHIM_0_0_3,
    );
    writeFileSync(
      path.join(hooksDir, "post-checkout"),
      POST_CHECKOUT_SHIM_0_0_7,
    );

    const result = installRealHooks(fixture);

    assert.equal(result.code, 0, result.stdout);
    assert.match(
      result.stdout,
      /written: \.git\/hooks\/pre-commit \(replaced an earlier temple-bar version\)/,
    );
    assert.equal(
      readFileSync(path.join(hooksDir, "pre-commit"), "utf8"),
      PRE_COMMIT_SHIM,
    );
    assert.equal(
      readFileSync(path.join(hooksDir, "reference-transaction"), "utf8"),
      REFERENCE_TRANSACTION_SHIM,
    );
    assert.equal(
      readFileSync(path.join(hooksDir, "post-checkout"), "utf8"),
      POST_CHECKOUT_SHIM,
    );
  } finally {
    fixture.cleanup();
  }
});

void test("install: core.hooksPath set to .githooks by an earlier release is removed, so git runs the shared hooks", () => {
  const fixture = createHookFixture();
  try {
    runGit(fixture.repoDir, ["config", "core.hooksPath", ".githooks"]);

    const result = installRealHooks(fixture);

    assert.equal(result.code, 0, result.stdout);
    assert.match(
      result.stdout,
      /written: core\.hooksPath \(removed "\.githooks"/,
    );
    assert.equal(
      runGit(fixture.repoDir, ["config", "--get", "core.hooksPath"]).code,
      1,
    );
  } finally {
    fixture.cleanup();
  }
});

void test("install: any other core.hooksPath is a conflict and is left as it is", () => {
  const fixture = createHookFixture();
  try {
    runGit(fixture.repoDir, ["config", "core.hooksPath", ".husky"]);

    const result = installRealHooks(fixture);

    assert.equal(result.code, 1);
    assert.match(
      result.stdout,
      /conflict: core\.hooksPath \(set to "\.husky", so git would not run temple-bar's hooks\)/,
    );
    assert.equal(
      runGit(fixture.repoDir, [
        "config",
        "--get",
        "core.hooksPath",
      ]).stdout.trim(),
      ".husky",
    );
  } finally {
    fixture.cleanup();
  }
});

void test("install: an unrecognized marked shim is retained with an ambiguity warning and no writer claim", () => {
  const fixture = createHookFixture();
  try {
    const hooksDir = path.join(fixture.repoDir, ".git", "hooks");
    const otherVersion = PRE_COMMIT_SHIM.replace(
      "exec ",
      "# a later release\nexec ",
    );
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(path.join(hooksDir, "pre-commit"), otherVersion);

    const result = installRealHooks(fixture);

    assert.equal(result.code, 0, result.stdout);
    assert.match(
      result.stdout,
      /unchanged: \.git\/hooks\/pre-commit \(Warning: unrecognized temple-bar-marked shim retained; it may be edited or from a newer release/,
    );
    assert.equal(
      readFileSync(path.join(hooksDir, "pre-commit"), "utf8"),
      otherVersion,
    );
    assert.equal(
      existsSync(path.join(hooksDir, "temple-bar-checkout")),
      false,
      "the shims in place aren't this version's, so it must not name itself as their writer",
    );
  } finally {
    fixture.cleanup();
  }
});

void test("install: run in a linked worktree, it writes the shims into the git folder every worktree shares", () => {
  const fixture = createHookFixture();
  try {
    writeFileSync(path.join(fixture.repoDir, "a.txt"), "a\n");
    runGit(fixture.repoDir, ["add", "a.txt"]);
    runGit(fixture.repoDir, ["commit", "-q", "-m", "a"]);
    const worktree = path.join(fixture.root, "linked");
    assert.equal(
      runGit(fixture.repoDir, ["worktree", "add", "-q", worktree, "-b", "b"])
        .code,
      0,
    );

    const result = runSh(fixture.binPath, ["hook", "install"], worktree);

    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(
      result.stdout,
      /written: \.\.\/repo\/\.git\/hooks\/pre-commit/,
    );
    assert.ok(
      existsSync(path.join(fixture.repoDir, ".git", "hooks", "pre-commit")),
    );
  } finally {
    fixture.cleanup();
  }
});
