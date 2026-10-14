// When the runner can't confirm a command stopped, the check must not move on
// to the next scaffold beside processes that may still be running, and an
// interrupt's account of what was stopped must reach the report unchanged.

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { check } from "./check.ts";
import { CleanupFailed, Interrupted } from "./runner.ts";
import { fixture, world } from "./testing.ts";

for (const [stage, matches] of [
  ["scaffold", (args: readonly string[]) => args[0] === "create"],
  ["setup", (args: readonly string[]) => args[0] === "init"],
] as const) {
  void test(`a command left running during ${stage} ends the whole check, naming it`, async () => {
    const fake = world([fixture("vite"), fixture("next")]);
    fake.override = (call) => {
      if (call.cwd.split(path.sep).includes("vite") && matches(call.args))
        throw new CleanupFailed("pnpm: taskkill exited 1.");
      return undefined;
    };
    try {
      const result = await check({
        update: false,
        runner: fake.runner,
        resources: fake.resources,
        fixtures: fake.fixtures,
        tempRoot: fake.root,
      });
      assert.equal(result.code, 1);
      assert.match(result.report, /pnpm: taskkill exited 1\./);
      assert.equal(
        fake.calls.some((call) => call.cwd.split(path.sep).includes("next")),
        false,
        "no later scaffold starts beside a process that may still be running",
      );
      assert.equal(fake.closed, 1, "the registry is still closed");
    } finally {
      fake.close();
    }
  });
}

void test("an interrupt's own account of what it stopped reaches the report", async () => {
  const fake = world([fixture("vite")]);
  const controller = new AbortController();
  fake.override = (call) => {
    if (call.args[0] === "create") {
      controller.abort();
      throw new Interrupted(
        "could not confirm the command stopped: taskkill exited 1.",
      );
    }
    return undefined;
  };
  try {
    const result = await check({
      update: false,
      runner: fake.runner,
      resources: fake.resources,
      fixtures: fake.fixtures,
      tempRoot: fake.root,
      signal: controller.signal,
    });
    assert.equal(result.code, 1);
    assert.match(
      result.report,
      /Interrupted; could not confirm the command stopped: taskkill exited 1\./,
    );
  } finally {
    fake.close();
  }
});
