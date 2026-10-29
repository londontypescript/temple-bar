// Merge's first check: a temple-bar other than the one the primary
// checkout's package.json pins refuses before GitHub is asked anything.
// pinned-version.test.ts covers which pins count.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { readOwnVersion } from "../package-info.ts";
import type { FsSeam } from "../seams/fs.ts";
import { createGateCommand } from "../gate/command.ts";
import { createFakeTools } from "../gate/testing/fake-tools.ts";
import { createMergeCommand } from "./command.ts";
import {
  defaultWorld,
  harness,
  HEAD,
  MERGED_IN,
  type Harness,
} from "./testing/world.ts";

const NAME = "@londontypescript/temple-bar";
/** The primary checkout, first in the fake `git worktree list`. */
const PRIMARY = path.join("/repo", "package.json");
/** The pull request's worktree, where the harness starts merge. */
const LINKED = path.join("/wt/x", "package.json");
/** An exact version this package never runs as. */
const OTHER = "0.0.0-not-this-one";

function devPin(version: string): string {
  return JSON.stringify({ devDependencies: { [NAME]: version } });
}

async function merge(h: Harness): Promise<number> {
  return createMergeCommand(h.deps).run(["7"], h.ctx);
}

void test("merge: a different exact pin in the primary checkout refuses before any GitHub call", async () => {
  for (const version of [OTHER, "999.0.0"]) {
    const h = harness(defaultWorld());
    h.fs.files.set(PRIMARY, devPin(version));

    assert.equal(await merge(h), 1);

    assert.equal(
      h.err(),
      `merge: refused: temple-bar ${readOwnVersion()} is running, but ${PRIMARY} pins ${version}, so nothing was merged or changed.\n` +
        `Fix: run \`pnpm install --frozen-lockfile\` in /repo, then run this again.\n`,
    );
    assert.deepEqual(h.gh.calls, []);
    // Only the read-only listing that found the primary checkout.
    assert.deepEqual(
      h.git.calls.map((call) => call.args.slice(0, 2)),
      [["worktree", "list"]],
    );
    assert.equal(h.out(), "");
  }
});

void test("merge: only the primary checkout's pin counts, not the worktree merge was started in", async () => {
  const stale = harness(defaultWorld());
  stale.fs.files.set(PRIMARY, devPin(OTHER));
  stale.fs.files.set(LINKED, devPin(readOwnVersion()));
  assert.equal(await merge(stale), 1);
  assert.match(stale.err(), /pins 0\.0\.0-not-this-one/);
  assert.deepEqual(stale.gh.calls, []);

  const current = harness(defaultWorld());
  current.fs.files.set(PRIMARY, devPin(readOwnVersion()));
  current.fs.files.set(LINKED, devPin(OTHER));
  assert.equal(await merge(current), 0, current.err());
});

void test("merge: the running version pinned, no pin, or no package.json merges as before", async () => {
  for (const manifest of [
    devPin(readOwnVersion()),
    JSON.stringify({ name: "x" }),
    undefined,
  ]) {
    const h = harness(defaultWorld());
    if (manifest !== undefined) {
      h.fs.files.set(PRIMARY, manifest);
    }
    assert.equal(await merge(h), 0, h.err());
    assert.doesNotMatch(h.out(), /wasn't checked/);
  }
});

void test("merge: a pin that isn't one exact version merges, saying it wasn't checked", async () => {
  const h = harness(defaultWorld());
  h.fs.files.set(PRIMARY, devPin("^0.2.0"));
  assert.equal(await merge(h), 0, h.err());
  assert.ok(
    h
      .out()
      .startsWith(
        `merge: ${PRIMARY} asks for temple-bar ^0.2.0, not an exact version, so which temple-bar runs wasn't checked\n`,
      ),
    h.out(),
  );
});

void test("merge: a primary package.json that isn't a JSON object refuses before any GitHub call", async () => {
  for (const text of ["{ not json", "null", "[]"]) {
    const h = harness(defaultWorld());
    h.fs.files.set(PRIMARY, text);
    assert.equal(await merge(h), 1);
    assert.match(
      h.err(),
      /^merge: refused: .*package\.json isn't a JSON object, so which temple-bar it pins is unknown, and nothing was merged or changed\.$/m,
    );
    assert.deepEqual(h.gh.calls, []);
  }
});

void test("merge: dependencies of the wrong shape hide no mismatching devDependencies pin", async () => {
  const h = harness(defaultWorld());
  h.fs.files.set(
    PRIMARY,
    JSON.stringify({ dependencies: null, devDependencies: { [NAME]: OTHER } }),
  );
  assert.equal(await merge(h), 1);
  assert.deepEqual(h.gh.calls, []);
});

void test("merge: a primary package.json that can't be read is a refusal before any GitHub call, never a crash", async () => {
  const h = harness(defaultWorld());
  const fs: FsSeam = {
    ...h.fs,
    readText: () => Promise.reject(new Error("EACCES: permission denied")),
  };
  const code = await createMergeCommand(h.deps).run(["7"], { ...h.ctx, fs });
  assert.equal(code, 1);
  assert.match(
    h.err(),
    /^merge: refused: .*package\.json could not be read \(EACCES: permission denied\)/m,
  );
  assert.deepEqual(h.gh.calls, []);
});

void test("merge: the gate it runs in a branch's worktree checks that branch's own pin", async () => {
  const world = defaultWorld();
  world.behind = true;
  world.heads = [HEAD, MERGED_IN];
  const h = harness(world);
  h.fs.files.set(PRIMARY, devPin(readOwnVersion()));
  h.fs.files.set(LINKED, devPin(OTHER));
  // The real gate, in process, as merge/command.ts runs it.
  const gate = createGateCommand(createFakeTools());
  const deps = { ...h.deps, runGate: (ctx: typeof h.ctx) => gate.run([], ctx) };

  assert.equal(await createMergeCommand(deps).run(["7"], h.ctx), 1);

  assert.match(
    h.err(),
    new RegExp(
      `^gate: temple-bar .* is running, but ${LINKED.replaceAll("\\", "\\\\")} pins ${OTHER}, so no check ran\\.$`,
      "m",
    ),
  );
  assert.match(h.err(), /fails the gate, so nothing was pushed/);
  assert.equal(h.pushedBranch(), false);
  assert.ok(!h.ran("gh", "pr", "merge"));
});
