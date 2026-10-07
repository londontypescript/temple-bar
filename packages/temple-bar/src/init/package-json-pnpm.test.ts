// Setup names the project's pnpm version when nothing does, because the
// workflows it writes install the version package.json names and fail
// without one. It records only the pnpm running it, never a guess, and
// never changes a value that's already there.

import assert from "node:assert/strict";
import test from "node:test";

import { ensurePackageJsonScripts } from "./package-json.ts";
import { PNPM_USER_AGENT } from "./testing/command-fixture.ts";
import { createFakeContext, createFakeFs } from "../testing/fakes.ts";

const SCRIPTS = {
  prepare: "temple-bar hook install",
  gate: "temple-bar gate",
};

/** Runs the package.json step over `manifest` with `env`, by default as
 * `pnpm exec` sets it. */
async function runStep(
  manifest: Record<string, unknown>,
  env: NodeJS.ProcessEnv = { npm_config_user_agent: PNPM_USER_AGENT },
) {
  const original = JSON.stringify(manifest, null, 2);
  const fs = createFakeFs({ "/repo/package.json": original });
  const ctx = createFakeContext({ fs, env });
  const outcome = await ensurePackageJsonScripts(ctx, "/repo");
  const after = fs.files.get("/repo/package.json") ?? "";
  return {
    outcome,
    fs,
    unchanged: after === original,
    written: JSON.parse(after) as Record<string, unknown>,
  };
}

void test("pnpm version: added from the running pnpm when neither field names one", async () => {
  const { outcome, written } = await runStep({
    name: "widgets",
    scripts: SCRIPTS,
  });
  assert.equal(written.packageManager, "pnpm@10.34.5");
  assert.equal(outcome.wrote, true);
  assert.equal(outcome.addedPnpm, "10.34.5");
  assert.equal(outcome.pnpmProblem, undefined);
});

void test("pnpm version: a prerelease pnpm is recorded exactly", async () => {
  const { written } = await runStep(
    { name: "widgets", scripts: SCRIPTS },
    { npm_config_user_agent: "pnpm/11.0.0-rc.2 npm/? node/v24.0.0 linux x64" },
  );
  assert.equal(written.packageManager, "pnpm@11.0.0-rc.2");
});

void test("pnpm version: a value already naming pnpm is left alone, in either field", async () => {
  for (const named of [
    { packageManager: "pnpm@9.15.0" },
    { packageManager: "pnpm@10.0.0+sha512.abcdef" },
    { devEngines: { packageManager: { name: "pnpm", version: "^10.0.0" } } },
  ]) {
    const { outcome, unchanged } = await runStep({
      name: "widgets",
      scripts: SCRIPTS,
      ...named,
    });
    assert.ok(unchanged, JSON.stringify(named));
    assert.equal(outcome.wrote, false);
    assert.equal(outcome.addedPnpm, undefined);
    assert.equal(outcome.pnpmProblem, undefined);
  }
});

void test("pnpm version: a value setup can't use is left alone and reported", async () => {
  for (const unusable of [
    { packageManager: "" },
    { packageManager: 10 },
    { packageManager: "npm@10.9.2" },
    { packageManager: "pnpm" },
    { devEngines: { packageManager: { name: "yarn", version: "4.1.0" } } },
    { devEngines: { packageManager: { name: "pnpm" } } },
    { devEngines: { packageManager: "pnpm@10.0.0" } },
    {
      devEngines: { packageManager: { name: "pnpm", version: "10.0.0" } },
      packageManager: "npm@10.9.2",
    },
  ]) {
    const { outcome, unchanged } = await runStep({
      name: "widgets",
      scripts: SCRIPTS,
      ...unusable,
    });
    const label = JSON.stringify(unusable);
    assert.ok(unchanged, label);
    assert.equal(outcome.addedPnpm, undefined, label);
    assert.match(
      outcome.pnpmProblem ?? "",
      /package\.json's (devEngines\.)?packageManager is .*, which doesn't name a pnpm version, so it was left alone\./,
      label,
    );
  }
});

void test("pnpm version: with no pnpm user agent, or one it can't read, nothing is written and setup says to rerun through pnpm", async () => {
  for (const userAgent of [
    undefined,
    "",
    "npm/10.9.2 node/v24.0.0 darwin arm64",
    "yarn/4.1.0 npm/? node/v24.0.0 darwin arm64",
    "pnpm/10 npm/? node/v24.0.0 darwin arm64",
    "pnpm/latest npm/? node/v24.0.0 darwin arm64",
    "pnpm/10.34.5",
    " pnpm/10.34.5 npm/? node/v24.0.0 darwin arm64",
  ]) {
    const { outcome, unchanged } = await runStep(
      { name: "widgets", scripts: SCRIPTS },
      userAgent === undefined ? {} : { npm_config_user_agent: userAgent },
    );
    const label = String(userAgent);
    assert.ok(unchanged, label);
    assert.equal(outcome.addedPnpm, undefined, label);
    assert.match(
      outcome.pnpmProblem ?? "",
      /Couldn't tell which pnpm is running setup.*Fix: run `pnpm exec temple-bar init` again/,
      label,
    );
  }
});

void test("pnpm version: a rerun writes nothing", async () => {
  const first = await runStep({ name: "widgets", scripts: SCRIPTS });
  const writes = first.fs.writes.length;
  const ctx = createFakeContext({
    fs: first.fs,
    env: { npm_config_user_agent: PNPM_USER_AGENT },
  });
  const second = await ensurePackageJsonScripts(ctx, "/repo");
  assert.equal(second.wrote, false);
  assert.equal(second.addedPnpm, undefined);
  assert.equal(first.fs.writes.length, writes);
});
