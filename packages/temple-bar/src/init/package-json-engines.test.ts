// Setup declares the Node temple-bar needs in engines.node: adds it, raises
// a plain lower bound that is too low, and leaves (but reports) anything it
// can't compare.

import assert from "node:assert/strict";
import test from "node:test";

import { ensurePackageJsonScripts } from "./package-json.ts";
import { PNPM_USER_AGENT } from "./testing/command-fixture.ts";
import { createFakeContext, createFakeFs } from "../testing/fakes.ts";

const BASE = {
  name: "widgets",
  packageManager: "pnpm@10.34.5",
  scripts: { prepare: "temple-bar hook install", gate: "temple-bar gate" },
};

async function runStep(extra: Record<string, unknown>) {
  const original = JSON.stringify({ ...BASE, ...extra }, null, 2);
  const fs = createFakeFs({ "/repo/package.json": original });
  const ctx = createFakeContext({
    fs,
    env: { npm_config_user_agent: PNPM_USER_AGENT },
  });
  const outcome = await ensurePackageJsonScripts(ctx, "/repo");
  const after = fs.files.get("/repo/package.json") ?? "";
  return {
    outcome,
    unchanged: after === original,
    written: JSON.parse(after) as { engines?: unknown },
  };
}

void test("engines.node: missing, it is added and other engines keys are kept", async () => {
  const none = await runStep({});
  assert.deepEqual(none.written.engines, { node: ">=24" });
  assert.equal(none.outcome.node.kind, "added");

  const other = await runStep({ engines: { npm: ">=10" } });
  assert.deepEqual(other.written.engines, { npm: ">=10", node: ">=24" });
  assert.equal(other.outcome.node.kind, "added");
});

void test("engines.node: a plain >= below the minimum is raised and reported", async () => {
  for (const low of [">=22.12.0", ">=20", ">= 18.1"]) {
    const { written, outcome } = await runStep({ engines: { node: low } });
    assert.deepEqual(written.engines, { node: ">=24" }, low);
    assert.deepEqual(outcome.node, { kind: "raised", from: low }, low);
  }
});

void test("engines.node: a plain >= at or above the minimum is left alone", async () => {
  for (const ok of [">=24", ">=24.1.0", ">=26"]) {
    const { unchanged, outcome } = await runStep({ engines: { node: ok } });
    assert.ok(unchanged, ok);
    assert.equal(outcome.node.kind, "ok", ok);
  }
});

void test("engines.node: any other form is left alone and reported as a problem, with the fix", async () => {
  for (const odd of [
    { engines: { node: "^22" } },
    { engines: { node: ">=22 <25" } },
    { engines: { node: "^20 || >=22" } },
    { engines: { node: 22 } },
    { engines: "node 24" },
    { engines: ["node"] },
    { engines: null },
  ]) {
    const { unchanged, outcome } = await runStep(odd);
    const label = JSON.stringify(odd);
    assert.ok(unchanged, label);
    assert.ok(outcome.node.kind === "problem", label);
    assert.match(
      outcome.node.message,
      /left alone and couldn't be checked.*Fix: set engines\.node to ">=24"/,
      label,
    );
  }
});
