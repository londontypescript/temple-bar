import assert from "node:assert/strict";
import test from "node:test";

import {
  addDevDependencyCommand,
  FOREIGN_LOCKFILES,
  foreignPackageManager,
  declaresWorkspaces,
  foreignLockfileMessage,
  isLaunchedByPnpm,
  installCommand,
  launchCommand,
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
  const message = packageManagerRequiredMessage(
    "npm@10.9.2",
    launchCommand("0.3.0"),
  );
  assert.match(message, /"packageManager": "npm@10\.9\.2"/);
  assert.match(message, /temple-bar needs pnpm/);
  assert.match(message, /Nothing was changed/);
  assert.match(message, /Set packageManager to pnpm/);
  assert.match(message, /"packageManager": "pnpm@[^"\n]+"/);
  assert.match(message, /re-scaffold with your framework's pnpm option/);
  assert.match(message, /Then run setup again/);
  assert.match(message, /pnpm create @londontypescript\/temple-bar@0\.3\.0\n$/);
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

void test("launchCommand names the launcher's own version, never @latest", () => {
  assert.equal(
    launchCommand("0.3.0"),
    "pnpm create @londontypescript/temple-bar@0.3.0",
  );
});

void test("pnpmRequiredMessage says why, how to install pnpm and what to run next", () => {
  const message = pnpmRequiredMessage(launchCommand("0.3.0"));
  assert.match(
    message,
    /temple-bar needs pnpm, and this wasn't started with pnpm/,
  );
  assert.match(message, /Nothing was changed/);
  assert.match(message, /npm install -g pnpm/);
  assert.match(message, /https:\/\/pnpm\.io\/installation/);
  assert.match(message, /pnpm create @londontypescript\/temple-bar@0\.3\.0\n$/);
});

void test("foreignLockfileMessage says to move the project to pnpm, never to install pnpm", () => {
  const launch = launchCommand("0.3.0");
  const message = foreignLockfileMessage({
    lockfiles: ["package-lock.json"],
    packageManager: undefined,
    workspaces: false,
    pnpmVersion: "10.34.5",
    launch,
  });
  assert.match(
    message,
    /this folder has a package-lock\.json, which another package manager wrote\. Nothing was changed\./,
  );
  assert.match(message, /Switch the project to pnpm first/);
  assert.match(
    message,
    /1\. Run `pnpm import`, which makes pnpm-lock\.yaml from package-lock\.json\./,
  );
  assert.match(message, /2\. Delete package-lock\.json\./);
  assert.match(
    message,
    /3\. Check the project still installs, builds and tests/,
  );
  assert.doesNotMatch(message, /packageManager/);
  assert.doesNotMatch(message, /npm install -g pnpm|pnpm\.io\/installation/);
  assert.ok(message.endsWith(`Then run setup again:\n  ${launch}\n`));
});

void test("foreignLockfileMessage names every lockfile and the packageManager field to change", () => {
  const message = foreignLockfileMessage({
    lockfiles: ["package-lock.json", "yarn.lock"],
    packageManager: "npm@10.9.2",
    workspaces: false,
    pnpmVersion: "10.34.5",
    launch: launchCommand("0.3.0"),
  });
  assert.match(message, /has package-lock\.json and yarn\.lock, which/);
  assert.match(message, /Delete package-lock\.json and yarn\.lock\./);
  assert.match(
    message,
    /1\. In package\.json, change "packageManager": "npm@10\.9\.2" to pnpm, for example "packageManager": "pnpm@10\.34\.5"/,
  );
  assert.match(message, /2\. Run `pnpm import`/);
});

void test("foreignLockfileMessage doesn't offer pnpm import for bun, which it can't read", () => {
  for (const lockfile of ["bun.lock", "bun.lockb"]) {
    const message = foreignLockfileMessage({
      lockfiles: [lockfile],
      packageManager: undefined,
      workspaces: false,
      pnpmVersion: "10.34.5",
      launch: launchCommand("0.3.0"),
    });
    assert.doesNotMatch(message, /pnpm import`/, lockfile);
    assert.ok(
      message.includes(`Run \`pnpm install\`. pnpm can't read ${lockfile}`),
      message,
    );
  }
});

void test("runInitCommand passes on only the two approval flags", () => {
  assert.deepEqual(
    runInitCommand(["--create-repo", "--evil", "--create-ruleset"]).args,
    ["exec", "temple-bar", "init", "--create-repo", "--create-ruleset"],
  );
});

void test("installCommand runs normal project installation with a frozen lockfile", () => {
  assert.deepEqual(installCommand(), {
    command: "pnpm",
    args: ["install", "--frozen-lockfile"],
  });
});

void test("declaresWorkspaces reads npm's and Yarn's workspaces field", () => {
  assert.equal(declaresWorkspaces('{"workspaces":["packages/*"]}'), true);
  assert.equal(
    declaresWorkspaces('{"workspaces":{"packages":["packages/*"]}}'),
    true,
  );
  for (const manifest of ["{}", '{"workspaces":null}', "{", undefined]) {
    assert.equal(declaresWorkspaces(manifest), false, manifest);
  }
});

void test("foreignLockfileMessage has a workspace write pnpm-workspace.yaml before importing", () => {
  const message = foreignLockfileMessage({
    lockfiles: ["package-lock.json"],
    packageManager: undefined,
    workspaces: true,
    pnpmVersion: "10.34.5",
    launch: launchCommand("0.3.0"),
  });
  assert.match(
    message,
    /1\. Create pnpm-workspace\.yaml listing the package folders/,
  );
  assert.match(message, /2\. Run `pnpm import`/);
});
