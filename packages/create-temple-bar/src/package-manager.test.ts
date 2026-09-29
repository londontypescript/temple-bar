import assert from "node:assert/strict";
import test from "node:test";

import {
  addDevDependencyCommand,
  detectPackageManager,
  runInitCommand,
} from "./package-manager.ts";

void test("detectPackageManager reads npm_config_user_agent", () => {
  assert.equal(detectPackageManager("pnpm/9.1.0 node/v24.0.0"), "pnpm");
  assert.equal(detectPackageManager("yarn/4.1.0 npm/? node/v24.0.0"), "yarn");
  assert.equal(detectPackageManager("bun/1.1.0"), "bun");
  assert.equal(detectPackageManager("npm/10.0.0 node/v24.0.0"), "npm");
});

void test("detectPackageManager defaults to npm when the agent is unrecognised or missing", () => {
  assert.equal(detectPackageManager(undefined), "npm");
  assert.equal(detectPackageManager("some-other-tool/1.0.0"), "npm");
});

void test("addDevDependencyCommand pins the exact version for every package manager", () => {
  assert.deepEqual(addDevDependencyCommand("pnpm", "0.1.2"), {
    command: "pnpm",
    args: ["add", "-D", "--save-exact", "@londontypescript/temple-bar@0.1.2"],
  });
  assert.deepEqual(addDevDependencyCommand("npm", "0.1.2"), {
    command: "npm",
    args: [
      "install",
      "-D",
      "--save-exact",
      "@londontypescript/temple-bar@0.1.2",
    ],
  });
  assert.deepEqual(addDevDependencyCommand("yarn", "0.1.2"), {
    command: "yarn",
    args: ["add", "-D", "--exact", "@londontypescript/temple-bar@0.1.2"],
  });
  assert.deepEqual(addDevDependencyCommand("bun", "0.1.2"), {
    command: "bun",
    args: ["add", "-d", "--exact", "@londontypescript/temple-bar@0.1.2"],
  });
});

void test("runInitCommand uses each package manager's own way to run a bin", () => {
  assert.deepEqual(runInitCommand("pnpm"), {
    command: "pnpm",
    args: ["exec", "temple-bar", "init"],
  });
  assert.deepEqual(runInitCommand("npm"), {
    command: "npx",
    args: ["--no-install", "temple-bar", "init"],
  });
  assert.deepEqual(runInitCommand("yarn"), {
    command: "yarn",
    args: ["exec", "temple-bar", "init"],
  });
  assert.deepEqual(runInitCommand("bun"), {
    command: "bunx",
    args: ["temple-bar", "init"],
  });
});
