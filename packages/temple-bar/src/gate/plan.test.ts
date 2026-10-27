// The check plan: which parts a workspace has, the exact outcomes each one
// reports, and the run's own check that it reported exactly those.

import assert from "node:assert/strict";
import test from "node:test";

import { createFakeContext } from "../testing/fakes.ts";
import {
  buildPlan,
  expectedOutcomes,
  partsOf,
  reservedPackages,
  type PlanEntry,
} from "./plan.ts";
import { prepare, runEntries } from "./plan-run.ts";
import type { Inventory } from "./packages.ts";
import { createFakeTools } from "./testing/fake-tools.ts";

function inventory(...relatives: string[]): Inventory {
  return {
    packages: relatives.map((relative) => ({
      relative,
      folder: `/repo/${relative}`,
    })),
    outcome: { name: "workspace packages", status: "passed" },
  };
}

void test("plan: the parts are repo, root, then each package in the inventory's order", () => {
  assert.deepEqual(partsOf(buildPlan(inventory("apps/web", "packages/a"))), [
    "repo",
    "root",
    "apps/web",
    "packages/a",
  ]);
});

void test("plan: each part's outcomes come from the plan alone, coverage's two and the ruleset's four included", () => {
  const plan = buildPlan(inventory("packages/a"));

  assert.deepEqual(expectedOutcomes(plan, "root"), [
    "typecheck",
    "lint",
    "format:check",
    "test",
  ]);
  assert.deepEqual(expectedOutcomes(plan, "packages/a"), [
    "typecheck (packages/a)",
    "lint (packages/a)",
    "format:check (packages/a)",
    "test (packages/a)",
  ]);
  assert.deepEqual(expectedOutcomes(plan, "repo"), [
    "workspace packages",
    "type-check coverage",
    "test coverage",
    "core setup",
    "gate and title workflows",
    "file-length cap",
    "AGENTS.md size",
    "markdown lint",
    "local links",
    "unused code (knip)",
    "branch ruleset",
    "judge ruleset",
    "code scanning rule",
    "gate and title checks rule",
  ]);
});

void test("plan: a package folder named repo or root is reserved", () => {
  assert.deepEqual(reservedPackages(inventory("repo", "lib", "root")), [
    "repo",
    "root",
  ]);
  assert.deepEqual(reservedPackages(inventory("apps/repo", "roots")), []);
});

void test("plan: a run that reports other outcomes than its entries declare fails, naming both", async () => {
  const ctx = createFakeContext();
  const prepared = await prepare(ctx);
  const entry: PlanEntry = {
    part: "repo",
    stage: "base",
    outcomes: ["first", "second"],
    run: () =>
      Promise.resolve({ outcomes: [{ name: "first", status: "passed" }] }),
  };

  await assert.rejects(runEntries(ctx, prepared, createFakeTools(), [entry]), {
    message:
      'the checks reported ["first"], but the check plan expects ["first","second"]',
  });
});
