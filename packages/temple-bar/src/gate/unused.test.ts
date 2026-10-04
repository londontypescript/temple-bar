import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import {
  createFakeContext,
  createFakeFs,
  createFakeWriter,
} from "../testing/fakes.ts";
import { createFakeTools } from "./testing/fake-tools.ts";
import { knipBinPath } from "./tools.ts";
import { KNIP_ARGS, runUnusedCheck } from "./unused.ts";

const WITH_PACKAGE = createFakeFs({ "/repo/package.json": "{}" });

void test("knip runs with only the unused files, exports and types checks", async () => {
  const tools = createFakeTools();
  const outcome = await runUnusedCheck(
    createFakeContext({ fs: WITH_PACKAGE }),
    tools,
  );
  assert.equal(outcome.status, "passed");
  assert.deepEqual(tools.knipRuns, [KNIP_ARGS]);
  assert.deepEqual(KNIP_ARGS, [
    "--include",
    "files,exports,types",
    "--no-progress",
  ]);
});

void test("unused code fails the check with what to do about it", async () => {
  const stderr = createFakeWriter();
  const outcome = await runUnusedCheck(
    createFakeContext({ fs: WITH_PACKAGE, stderr }),
    createFakeTools({ knip: 1 }),
  );
  assert.deepEqual(outcome, {
    name: "unused code (knip)",
    status: "failed",
    detail: "unused files or exports",
  });
  assert.match(stderr.lines.join(""), /delete each one, or use it/);
});

void test("a knip that can't run fails rather than passes", async () => {
  const outcome = await runUnusedCheck(
    createFakeContext({ fs: WITH_PACKAGE }),
    createFakeTools({ knip: 2 }),
  );
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.detail, "could not run (exit 2)");
});

void test("without a package.json there is no project for knip, so it is skipped", async () => {
  const tools = createFakeTools();
  const outcome = await runUnusedCheck(createFakeContext(), tools);
  assert.equal(outcome.status, "skipped");
  assert.deepEqual(tools.knipRuns, []);
});

void test("knip's entry point is found in the copy temple-bar depends on", () => {
  assert.ok(existsSync(knipBinPath()), knipBinPath());
});
