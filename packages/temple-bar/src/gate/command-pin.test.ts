// The gate's first step, in every mode: a temple-bar other than the one the
// root package.json pins runs nothing, writes no report and says how to
// reinstall. pinned-version.test.ts covers which pins count.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { readOwnVersion } from "../package-info.ts";
import type { FsSeam } from "../seams/fs.ts";
import { createGateCommand } from "./command.ts";
import { createFakeTools } from "./testing/fake-tools.ts";
import {
  ACTIONS_ENV,
  createFakePartFiles,
  partArgs,
  REPORTS,
  reportFile,
  withHead,
} from "./testing/parts-fixture.ts";
import { PARTS } from "./testing/verify-fixture.ts";
import { workspace, type Workspace } from "./testing/workspace-fixture.ts";

const NAME = "@londontypescript/temple-bar";
const ROOT = path.normalize("/repo");
const ROOT_MANIFEST = path.join(ROOT, "package.json");
/** An exact version this package never runs as. */
const OTHER = "0.0.0-not-this-one";

/** The fake workspace with its root package.json changed by `change`. */
function pinned(
  change: (manifest: Record<string, unknown>) => void,
): Workspace {
  const made = workspace({ env: ACTIONS_ENV });
  const manifest = JSON.parse(
    made.fs.files.get(ROOT_MANIFEST) ?? "{}",
  ) as Record<string, unknown>;
  change(manifest);
  made.fs.files.set(ROOT_MANIFEST, JSON.stringify(manifest));
  return { ...made, ctx: withHead(made.ctx) };
}

function devPin(version: string): Workspace {
  return pinned((manifest) => {
    manifest.devDependencies = { [NAME]: version };
  });
}

/** Runs the gate with `args` and fresh fakes, recording what it did. */
async function run(made: Workspace, args: readonly string[]) {
  const tools = createFakeTools();
  const files = createFakePartFiles();
  const code = await createGateCommand(tools, files).run(args, made.ctx);
  return {
    code,
    files,
    tools,
    out: made.stdout.lines.join(""),
    err: made.stderr.lines.join(""),
  };
}

const MODES: Record<string, readonly string[]> = {
  whole: [],
  part: partArgs("root", "root.json"),
  verify: ["--verify-parts", REPORTS, "--leg", "windows"],
};

function refusal(pinnedVersion: string): string {
  return (
    `gate: temple-bar ${readOwnVersion()} is running, but ${ROOT_MANIFEST} pins ${pinnedVersion}, so no check ran.\n` +
    `gate: Fix: run \`pnpm install --frozen-lockfile\` in ${ROOT}, then run this again.\n`
  );
}

for (const [mode, args] of Object.entries(MODES)) {
  void test(`gate (${mode}): a different exact pin refuses before any check, script, tool or report`, async () => {
    const made = devPin(OTHER);

    const result = await run(made, args);

    assert.equal(result.code, 1);
    assert.equal(result.err, refusal(OTHER));
    assert.equal(result.out, "");
    assert.deepEqual(made.proc.calls, []);
    assert.deepEqual(result.tools.knipRuns, []);
    assert.deepEqual(result.tools.linted, []);
    assert.deepEqual(result.files.written, []);
  });

  void test(`gate (${mode}): a manifest that can't be read refuses before any check`, async () => {
    const made = devPin(OTHER);
    const fs: FsSeam = {
      ...made.fs,
      readText: (target) =>
        path.normalize(target) === ROOT_MANIFEST
          ? Promise.reject(new Error("EACCES: permission denied"))
          : made.fs.readText(target),
    };

    const result = await run({ ...made, ctx: { ...made.ctx, fs } }, args);

    assert.equal(result.code, 1);
    assert.match(
      result.err,
      /^gate: .*package\.json could not be read \(EACCES: permission denied\), so which temple-bar it pins is unknown, and no check ran\.$/m,
    );
    assert.equal(result.out, "");
    assert.deepEqual(made.proc.calls, []);
    assert.deepEqual(result.files.written, []);
  });
}

void test("gate: an older and a newer exact pin both refuse", async () => {
  for (const version of ["0.0.1", "999.0.0"]) {
    const result = await run(devPin(version), []);
    assert.equal(result.code, 1);
    assert.equal(result.err, refusal(version));
  }
});

void test("gate: the pin in dependencies is compared too", async () => {
  const made = pinned((manifest) => {
    manifest.dependencies = { [NAME]: OTHER };
  });
  const result = await run(made, []);
  assert.equal(result.code, 1);
  assert.equal(result.err, refusal(OTHER));
});

void test("gate: dependencies of the wrong shape hide no mismatching devDependencies pin", async () => {
  const made = pinned((manifest) => {
    manifest.dependencies = null;
    manifest.devDependencies = { [NAME]: OTHER };
  });
  const result = await run(made, []);
  assert.equal(result.code, 1);
  assert.equal(result.err, refusal(OTHER));
});

void test("gate: a root package.json that isn't a JSON object refuses before any check", async () => {
  for (const text of ["{ not json", "null", "[]"]) {
    const made = workspace({ env: ACTIONS_ENV });
    made.fs.files.set(ROOT_MANIFEST, text);

    const result = await run(made, []);

    assert.equal(result.code, 1);
    assert.match(result.err, /^gate: .*isn't a JSON object/m);
    assert.deepEqual(made.proc.calls, []);
  }
});

void test("gate: the running version, pinned exactly, runs the whole gate", async () => {
  const result = await run(devPin(readOwnVersion()), []);

  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /^gate: passed$/m);
  assert.doesNotMatch(result.out, /wasn't checked/);
});

void test("gate: no temple-bar pin runs the whole gate and says nothing about it", async () => {
  const result = await run(
    pinned(() => undefined),
    [],
  );

  assert.equal(result.code, 0, result.err);
  assert.doesNotMatch(result.out + result.err, /temple-bar/);
});

void test("gate: a pin that isn't one exact version runs, with one line saying it wasn't checked", async () => {
  for (const declared of [
    "^0.2.0",
    "workspace:*",
    `npm:${NAME}@0.2.0`,
    "latest",
  ]) {
    const result = await run(devPin(declared), []);

    assert.equal(result.code, 0, result.err);
    const line = `gate: ${ROOT_MANIFEST} asks for temple-bar ${declared}, not an exact version, so which temple-bar runs wasn't checked`;
    assert.ok(result.out.split("\n").includes(line), result.out);
    assert.match(result.out, /^gate: passed$/m);
  }
});

void test("gate: every part, and the verifier, run with the running version pinned", async () => {
  const files = createFakePartFiles();
  for (const part of PARTS) {
    const made = devPin(readOwnVersion());
    const code = await createGateCommand(createFakeTools(), files).run(
      partArgs(part, reportFile(part)),
      made.ctx,
    );
    assert.equal(code, 0, made.stderr.lines.join(""));
  }
  const made = devPin(readOwnVersion());
  const code = await createGateCommand(createFakeTools(), files).run(
    MODES.verify ?? [],
    made.ctx,
  );
  assert.equal(code, 0, made.stderr.lines.join(""));

  // The same reports, verified by a stale install, are refused unread.
  const stale = devPin(OTHER);
  const refused = await createGateCommand(createFakeTools(), files).run(
    MODES.verify ?? [],
    stale.ctx,
  );
  assert.equal(refused, 1);
  assert.equal(stale.stdout.lines.join(""), "");
  assert.equal(stale.stderr.lines.join(""), refusal(OTHER));
});
