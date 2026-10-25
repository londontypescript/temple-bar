// The coverage check's exclusions: read from temple-bar.config.json by the
// gate, an exact path or a whole folder each, never a glob, and one that
// matches nothing counted rather than failed.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { route } from "../router.ts";
import { CommandRegistry } from "../registry.ts";
import { runCoverageCheck } from "./coverage.ts";
import { listGitPaths } from "./lengths.ts";
import { testGateCommand as gateCommand } from "./testing/fake-tools.ts";
import { PNPM_EXEC, workspace } from "./testing/workspace-fixture.ts";

void test("an exclusion in temple-bar.config.json lets the gate pass a file nothing checks, and is counted", async () => {
  const run = async (config: string | undefined) => {
    const fixture = workspace({
      workspaceFile: false,
      packages: {},
      extraTracked: ["src/a.ts", "src/generated/b.ts"],
      listings: () => ["src/a.ts"],
      untracked:
        config === undefined
          ? {}
          : { [path.join("/repo", "temple-bar.config.json")]: config },
    });
    const registry = new CommandRegistry();
    registry.register(gateCommand);
    const code = await route(["gate"], fixture.ctx, registry);
    return {
      code,
      out: fixture.stdout.lines.join(""),
      err: fixture.stderr.lines.join(""),
    };
  };

  const without = await run(undefined);
  assert.equal(without.code, 1, without.err);
  assert.match(without.err, /^ {4}src\/generated\/b\.ts$/m);

  const excluded = await run(
    JSON.stringify({ coverageExclusions: ["src/generated/", "src/gone.ts"] }),
  );
  assert.equal(excluded.code, 0, excluded.err);
  assert.match(
    excluded.out,
    /^ {2}passed {3}type-check coverage \(all 1 TypeScript file\(s\) checked by 1 listing\(s\); 2 exclusion\(s\), 1 matching nothing\)$/m,
  );
});

/** The coverage check alone on a root-only fixture, with `exclusions`. */
async function withExclusions(
  exclusions: readonly string[],
  listed: readonly string[],
) {
  const fixture = workspace({
    workspaceFile: false,
    packages: {},
    extraTracked: [
      "src/foo/a.ts",
      "src/foo-bar/a.ts",
      "src/keep.ts",
      "src/gone.test.ts",
    ],
    listings: () => listed,
  });
  const outcomes = await runCoverageCheck(fixture.ctx, {
    listed: await listGitPaths(fixture.ctx),
    launcher: { kind: "javascript", path: PNPM_EXEC },
    inventory: {
      packages: [],
      outcome: { name: "workspace packages", status: "passed" },
    },
    exclusions,
  });
  return { ...fixture, outcomes };
}

void test("an exclusion takes an exact path or a whole folder, never a folder that only starts the same, and one matching nothing is counted", async () => {
  const exclusions = ["src/foo/", "src/gone.test.ts", "src/never.ts"];
  const gap = await withExclusions(exclusions, ["src/keep.ts"]);
  assert.deepEqual(gap.outcomes, [
    {
      name: "type-check coverage",
      status: "failed",
      detail: "1 file(s) unchecked; 3 exclusion(s), 1 matching nothing",
    },
    {
      name: "test coverage",
      status: "skipped",
      detail: "all 1 test file(s) excluded",
    },
  ]);
  assert.match(gap.stderr.lines.join(""), /^ {4}src\/foo-bar\/a\.ts$/m);

  const covered = await withExclusions(exclusions, [
    "src/keep.ts",
    "src/foo-bar/a.ts",
  ]);
  assert.deepEqual(covered.outcomes[0], {
    name: "type-check coverage",
    status: "passed",
    detail:
      "all 2 TypeScript file(s) checked by 1 listing(s); 3 exclusion(s), 1 matching nothing",
  });

  const all = await withExclusions(["src/"], []);
  assert.deepEqual(all.outcomes, [
    {
      name: "type-check coverage",
      status: "skipped",
      detail: "all 4 TypeScript file(s) excluded",
    },
    {
      name: "test coverage",
      status: "skipped",
      detail: "all 1 test file(s) excluded",
    },
  ]);
  assert.ok(!all.proc.calls.some((call) => call.args.includes("exec")));
});
