// Which script commands the gate treats as doing nothing. The list is short
// and exact: a placeholder is caught, a real command never is.

import assert from "node:assert/strict";
import test from "node:test";

import { isNoOpScript } from "./stack.ts";

void test("isNoOpScript: placeholders that always succeed are no-ops", () => {
  for (const command of [
    "",
    "   ",
    "true",
    ":",
    "exit 0",
    "exit",
    "echo",
    "echo ok",
    'echo "no tests yet"',
    "echo 'lint: TODO' > /dev/null",
    "  true  ",
    "exit   0",
  ]) {
    assert.equal(isNoOpScript(command), true, JSON.stringify(command));
  }
});

void test("isNoOpScript: a chain made only of placeholders is a no-op", () => {
  for (const command of [
    "echo ok && exit 0",
    "true; true",
    "echo skipping || true",
    "true;",
    "echo one\necho two",
  ]) {
    assert.equal(isNoOpScript(command), true, JSON.stringify(command));
  }
});

void test("isNoOpScript: real commands are never no-ops, even next to an echo", () => {
  for (const command of [
    "tsc",
    "eslint .",
    "prettier --check .",
    "node --test",
    "cargo test",
    "echo checking && eslint .",
    "eslint . && echo done",
    "echo src | xargs eslint",
    "echo $(eslint .)",
    "echo `eslint .`",
    "truex",
    "exit 1",
    "false",
  ]) {
    assert.equal(isNoOpScript(command), false, JSON.stringify(command));
  }
});
