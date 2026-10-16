import assert from "node:assert/strict";
import test from "node:test";

import {
  isGuarded,
  isInstallSetting,
  isManifest,
  isRootManifest,
  readsText,
} from "./guarded-paths.ts";

void test("package.json and pnpm's install settings are guarded at any depth, in any case", () => {
  for (const file of [
    "package.json",
    "packages/a/package.json",
    "packages/a/Package.json",
    "deep/er/PACKAGE.JSON",
  ]) {
    assert.ok(isManifest(file), file);
  }
  for (const file of [
    ".npmrc",
    "packages/a/.NPMRC",
    "pnpm-workspace.yaml",
    "tools/PNPM-Workspace.yaml",
    ".pnpmfile.cjs",
    "packages/a/.PnpmFile.mjs",
    // The long s, which Windows takes for an "s", and full-width letters.
    "pnpm-workſpace.yaml",
    "．npmrc",
  ]) {
    assert.ok(isInstallSetting(file), file);
  }
});

void test("a package.json under a folder named exactly node_modules is left out; under NODE_MODULES it isn't", () => {
  assert.equal(isManifest("node_modules/a/package.json"), false);
  assert.equal(isManifest("packages/x/node_modules/a/package.json"), false);
  // On Linux this can be a real package: folding the name would hide it.
  assert.equal(isManifest("packages/NODE_MODULES/a/package.json"), true);
  assert.equal(isManifest("node_modules.json/package.json"), true);
  // Install settings are never left out.
  assert.equal(isInstallSetting("node_modules/a/.npmrc"), true);
  assert.equal(isGuarded("node_modules/a/.npmrc"), true);
});

void test("workflows, temple-bar's config and the lockfile keep their exact names and places", () => {
  assert.equal(isGuarded(".github/workflows/ci.yml"), true);
  // GitHub reads .github/workflows/ by its exact name.
  assert.equal(isGuarded(".GITHUB/workflows/ci.yml"), false);
  assert.equal(isGuarded(".github/dependabot.yml"), false);
  assert.equal(isGuarded("temple-bar.config.json"), true);
  assert.equal(isGuarded("packages/a/temple-bar.config.json"), false);
  assert.equal(isGuarded("pnpm-lock.yaml"), true);
  assert.equal(isGuarded("packages/a/pnpm-lock.yaml"), false);
  assert.equal(isGuarded("eslint.config.js"), false);
});

void test("only manifests and the root lockfile are read as text", () => {
  assert.equal(readsText("packages/a/package.json"), true);
  assert.equal(readsText("pnpm-lock.yaml"), true);
  assert.equal(readsText(".npmrc"), false);
  assert.equal(readsText(".github/workflows/ci.yml"), false);
  // A package.json under .github/workflows/ is a workflow folder's file:
  // any change to it counts, so its text isn't needed.
  assert.equal(readsText(".github/workflows/package.json"), false);
});

void test("the root manifest is the one at the top, in any case", () => {
  assert.equal(isRootManifest("package.json"), true);
  assert.equal(isRootManifest("PACKAGE.json"), true);
  assert.equal(isRootManifest("packages/a/package.json"), false);
});
