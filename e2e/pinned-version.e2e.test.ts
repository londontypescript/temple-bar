// The packed temple-bar refuses to gate or merge when the project's
// package.json pins another exact version: the state a checkout is left in
// when it pulls a pin bump without reinstalling. Each project installs the
// packed tarball, then has its pin edited by hand, so node_modules keeps the
// packed version while package.json names another.

import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { describe, run, type RunResult } from "./support/run.ts";
import {
  installUpgradePackage,
  packedTarball,
  upgradeEnv,
  upgradeProject,
} from "./support/upgrade.ts";

const NAME = "@londontypescript/temple-bar";
const TIMEOUT = { timeout: 300_000 };
/** An exact version the packed package never is. */
const OTHER = "0.0.0-not-this-one";

// Runs before the fake gh's own answers and records every call it gets, so
// a test can show that GitHub was never asked anything.
const RECORDER = `"use strict";
const path = require("node:path");
if (path.basename(process.execPath).replace(/\\.exe$/i, "") === "gh" && process.env.GH_CALL_LOG) {
  require("node:fs").appendFileSync(
    process.env.GH_CALL_LOG,
    JSON.stringify(process.argv.slice(1)) + "\\n",
  );
}
`;

let workDir = "";
let env: NodeJS.ProcessEnv;
let tarball = "";
let version = "";
let ghLog = "";

before(async () => {
  workDir = realpathSync.native(
    mkdtempSync(path.join(tmpdir(), "temple-bar-pinned-version-")),
  );
  const recorder = path.join(workDir, "gh-recorder.cjs");
  writeFileSync(recorder, RECORDER);
  ghLog = path.join(workDir, "gh-calls.log");
  const base = upgradeEnv(workDir);
  env = {
    ...base,
    GH_CALL_LOG: ghLog,
    NODE_OPTIONS:
      `--require "${recorder.replaceAll("\\", "/")}" ${base.NODE_OPTIONS ?? ""}`.trim(),
  };
  tarball = await packedTarball(workDir, env);
  version = (
    JSON.parse(
      readFileSync(path.join(workDir, "stage/temple-bar/package.json"), "utf8"),
    ) as { version: string }
  ).version;
});

after(() => {
  if (workDir !== "") rmSync(workDir, { recursive: true, force: true });
});

/** A project with the packed temple-bar installed, then its pin set to
 * `pin` without reinstalling. */
async function project(name: string, pin: string): Promise<string> {
  const dir = await upgradeProject(workDir, name, env);
  await installUpgradePackage(dir, tarball, env);
  const manifestPath = path.join(dir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    devDependencies: Record<string, string>;
  };
  manifest.devDependencies[NAME] = pin;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

function templeBar(dir: string, args: readonly string[]): Promise<RunResult> {
  return run("pnpm", ["exec", "temple-bar", ...args], { cwd: dir, env });
}

function assertRefused(result: RunResult, dir: string, label: string): void {
  assert.equal(result.code, 1, describe(result));
  const manifest = path.join(dir, "package.json");
  assert.ok(
    result.stderr.includes(
      `temple-bar ${version} is running, but ${manifest} pins ${OTHER}`,
    ),
    describe(result),
  );
  assert.ok(
    result.stderr.includes(
      `Fix: run \`pnpm install --frozen-lockfile\` in ${dir}, then run this again.`,
    ),
    describe(result),
  );
  assert.ok(
    result.stderr.split(/\r?\n/).some((line) => line.startsWith(`${label}: `)),
    describe(result),
  );
}

/** The gate got past its first step and ran its checks to a verdict. */
function assertGateRan(result: RunResult): void {
  const output = result.stdout + result.stderr;
  assert.doesNotMatch(output, /is running, but/, describe(result));
  assert.match(output, /^gate: (passed|failed)/m, describe(result));
}

void test(
  "packed gate: a different exact pin refuses before any check",
  TIMEOUT,
  async () => {
    const dir = await project("gate-stale", OTHER);
    const result = await templeBar(dir, ["gate"]);
    assertRefused(result, dir, "gate");
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /^gate: (checks|passed|failed)/m,
    );
  },
);

void test(
  "packed gate: the installed version pinned exactly runs its checks",
  TIMEOUT,
  async () => {
    const dir = await project("gate-current", version);
    assertGateRan(await templeBar(dir, ["gate"]));
  },
);

void test(
  "packed gate: a range runs its checks, saying the version wasn't checked",
  TIMEOUT,
  async () => {
    const dir = await project("gate-range", `^${version}`);
    const result = await templeBar(dir, ["gate"]);
    assertGateRan(result);
    assert.match(
      result.stdout,
      /not an exact version, so which temple-bar runs wasn't checked/,
    );
  },
);

void test(
  "packed merge: a different exact pin refuses before any GitHub call",
  TIMEOUT,
  async () => {
    const dir = await project("merge-stale", OTHER);
    rmSync(ghLog, { force: true });
    const result = await templeBar(dir, ["merge", "7"]);
    assertRefused(result, dir, "merge");
    assert.match(result.stderr, /^merge: refused: /m);
    assert.equal(existsSync(ghLog), false, "gh was called");

    // The recorder does see gh when merge gets that far.
    const current = await project("merge-current", version);
    const reached = await templeBar(current, ["merge", "7"]);
    assert.equal(reached.code, 1, describe(reached));
    assert.ok(existsSync(ghLog), describe(reached));
  },
);
