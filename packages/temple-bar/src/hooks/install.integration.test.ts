// Integration tests for `temple-bar hook install`, run through the real
// fake bin (see testing/repo-fixture.ts) against a real git repo, so both
// install.ts and command.ts's wiring of it are exercised together.

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createHookFixture,
  installRealHooks,
  runGit,
} from "./testing/repo-fixture.ts";

void test("install: writes both shims and both config values", () => {
  const fixture = createHookFixture();
  try {
    const result = installRealHooks(fixture);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /written: \.githooks\/pre-commit/);
    assert.match(result.stdout, /written: \.githooks\/reference-transaction/);
    assert.match(result.stdout, /written: core\.hooksPath/);
    assert.match(result.stdout, /written: pull\.ff/);

    const hooksPath = runGit(fixture.repoDir, [
      "config",
      "--local",
      "--get",
      "core.hooksPath",
    ]).stdout.trim();
    assert.equal(hooksPath, ".githooks");

    const ff = runGit(fixture.repoDir, [
      "config",
      "--local",
      "--get",
      "pull.ff",
    ]).stdout.trim();
    assert.equal(ff, "only");

    for (const name of ["pre-commit", "reference-transaction"]) {
      const p = path.join(fixture.repoDir, ".githooks", name);
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
    assert.match(second.stdout, /unchanged: \.githooks\/pre-commit/);
    assert.match(second.stdout, /unchanged: \.githooks\/reference-transaction/);
    assert.match(second.stdout, /unchanged: core\.hooksPath/);
    assert.match(second.stdout, /unchanged: pull\.ff/);
  } finally {
    fixture.cleanup();
  }
});

void test("install: an existing different .githooks/pre-commit is reported as a conflict and left untouched", () => {
  const fixture = createHookFixture();
  try {
    const hooksDir = path.join(fixture.repoDir, ".githooks");
    const customContent = "#!/bin/sh\necho custom\n";
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(path.join(hooksDir, "pre-commit"), customContent, "utf8");

    const result = installRealHooks(fixture);

    assert.equal(result.code, 1);
    assert.match(result.stdout, /conflict: \.githooks\/pre-commit/);
    // reference-transaction and the config values still install cleanly.
    assert.match(result.stdout, /written: \.githooks\/reference-transaction/);

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
