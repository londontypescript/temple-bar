import assert from "node:assert/strict";
import test from "node:test";

import {
  addDevDependencyCommand,
  FOREIGN_LOCKFILES,
  foreignPackageManager,
  isLaunchedByPnpm,
  packageManagerRequiredMessage,
  pnpmRequiredMessage,
  runInitCommand,
} from "./package-manager.ts";

void test("foreignPackageManager identifies only string values naming another manager", () => {
  for (const value of ["npm@10.9.2", "yarn@4.1.0", "bun@1.1.0", "npm"]) {
    assert.equal(
      foreignPackageManager(JSON.stringify({ packageManager: value })),
      value,
    );
  }
  for (const value of [
    "pnpm@10.34.5",
    "pnpm@10.34.5+sha512.abcdef",
    "pnpm",
    "",
    undefined,
    null,
    42,
    false,
    {},
    [],
  ]) {
    assert.equal(
      foreignPackageManager(JSON.stringify({ packageManager: value })),
      undefined,
    );
  }
  for (const contents of [undefined, "{", "null", "42", '"npm@10.9.2"']) {
    assert.equal(foreignPackageManager(contents), undefined);
  }
});

void test("packageManagerRequiredMessage explains the field change and rerun without installing pnpm", () => {
  const message = packageManagerRequiredMessage("npm@10.9.2");
  assert.match(message, /"packageManager": "npm@10\.9\.2"/);
  assert.match(message, /temple-bar needs pnpm/);
  assert.match(message, /Nothing was changed/);
  assert.match(message, /Set packageManager to pnpm/);
  assert.match(message, /"packageManager": "pnpm@[^"\n]+"/);
  assert.match(message, /re-scaffold with your framework's pnpm option/);
  assert.match(message, /Then run setup again/);
  assert.match(message, /pnpm create @londontypescript\/temple-bar@latest\n$/);
  assert.doesNotMatch(message, /install|pnpm\.io\/installation/i);
});

void test("isLaunchedByPnpm reads npm_config_user_agent", () => {
  assert.equal(isLaunchedByPnpm("pnpm/9.1.0 node/v24.0.0"), true);
  assert.equal(isLaunchedByPnpm("yarn/4.1.0 npm/? node/v24.0.0"), false);
  assert.equal(isLaunchedByPnpm("bun/1.1.0"), false);
  assert.equal(isLaunchedByPnpm("npm/10.0.0 node/v24.0.0"), false);
  assert.equal(isLaunchedByPnpm(undefined), false);
});

void test("foreign lockfiles cover npm, yarn and bun", () => {
  for (const name of [
    "package-lock.json",
    "yarn.lock",
    "bun.lockb",
    "bun.lock",
  ]) {
    assert.ok(FOREIGN_LOCKFILES.includes(name), name);
  }
});

void test("addDevDependencyCommand pins the exact version with pnpm", () => {
  assert.deepEqual(addDevDependencyCommand("0.1.2"), {
    command: "pnpm",
    args: ["add", "-D", "--save-exact", "@londontypescript/temple-bar@0.1.2"],
  });
});

void test("runInitCommand runs the project's temple-bar through pnpm exec", () => {
  assert.deepEqual(runInitCommand(), {
    command: "pnpm",
    args: ["exec", "temple-bar", "init"],
  });
});

void test("pnpmRequiredMessage says why, how to install pnpm and what to run next", () => {
  const message = pnpmRequiredMessage("this was started with npm");
  assert.match(message, /temple-bar needs pnpm, and this was started with npm/);
  assert.match(message, /Nothing was changed/);
  assert.match(message, /npm install -g pnpm/);
  assert.match(message, /https:\/\/pnpm\.io\/installation/);
  assert.match(message, /pnpm create @londontypescript\/temple-bar@latest\n$/);
});

void test("runInitCommand passes on only the two approval flags", () => {
  assert.deepEqual(
    runInitCommand(["--create-repo", "--evil", "--create-ruleset"]).args,
    ["exec", "temple-bar", "init", "--create-repo", "--create-ruleset"],
  );
});
