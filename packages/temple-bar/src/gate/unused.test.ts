import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createFakeContext,
  createFakeFs,
  createFakeWriter,
} from "../testing/fakes.ts";
import { createFakeTools } from "./testing/fake-tools.ts";
import { knipBinPath } from "./tools.ts";
import type { Inventory } from "./packages.ts";
import { KNIP_ARGS, runUnusedCheck } from "./unused.ts";

const WITH_PACKAGE = createFakeFs({ "/repo/package.json": "{}" });

/** A repo that is the root alone, as the inventory finds it. */
const ROOT_ONLY: Pick<Inventory, "packages" | "outcome"> = {
  packages: [],
  outcome: { name: "workspace packages", status: "passed" },
};

void test("knip runs with only the unused files, exports and types checks", async () => {
  const tools = createFakeTools();
  const outcome = await runUnusedCheck(
    createFakeContext({ fs: WITH_PACKAGE }),
    tools,
    ROOT_ONLY,
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
    ROOT_ONLY,
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
    ROOT_ONLY,
  );
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.detail, "could not run (exit 2)");
});

void test("without a package.json there is no project for knip, so it is skipped", async () => {
  const tools = createFakeTools();
  const outcome = await runUnusedCheck(createFakeContext(), tools, ROOT_ONLY);
  assert.equal(outcome.status, "skipped");
  assert.deepEqual(tools.knipRuns, []);
});

void test("knip's entry point is found in the copy temple-bar depends on", () => {
  assert.ok(existsSync(knipBinPath()), knipBinPath());
});

void test("verified comment-only findings pass only with Knip's finding exit", async () => {
  for (const code of [0, 1, 2]) {
    const tools = createFakeTools();
    const outcome = await runUnusedCheck(
      createFakeContext({ fs: WITH_PACKAGE }),
      {
        ...tools,
        knip: () =>
          Promise.resolve({ code, commentOnlyFiles: ["/repo/empty.ts"] }),
      },
      ROOT_ONLY,
    );
    assert.equal(outcome.status, code === 2 ? "failed" : "passed");
  }
  const outcome = await runUnusedCheck(
    createFakeContext({ fs: WITH_PACKAGE }),
    {
      ...createFakeTools(),
      knip: () => Promise.resolve({ code: 1, commentOnlyFiles: [] }),
    },
    ROOT_ONLY,
  );
  assert.equal(outcome.status, "failed");
});

const WORKSPACE: Pick<Inventory, "packages" | "outcome"> = {
  packages: ["apps/web", "packages/shared"].map((relative) => ({
    relative,
    folder: path.join("/repo", ...relative.split("/")),
  })),
  outcome: { name: "workspace packages", status: "passed" },
};

async function failWith(
  findingFiles: readonly string[] | undefined,
  inventory: Pick<Inventory, "packages" | "outcome"> = WORKSPACE,
) {
  const stderr = createFakeWriter();
  const outcome = await runUnusedCheck(
    createFakeContext({ fs: WITH_PACKAGE, stderr }),
    {
      ...createFakeTools(),
      knip: () =>
        Promise.resolve(
          findingFiles === undefined ? { code: 1 } : { code: 1, findingFiles },
        ),
    },
    inventory,
  );
  return { outcome, err: stderr.lines.join("") };
}

const at = (...parts: string[]): string => path.join("/repo", ...parts);

void test("the report names each package with findings, in the inventory's order, and the root", async () => {
  const { outcome, err } = await failWith([
    at("packages", "shared", "src", "index.ts"),
    at("apps", "web", "src", "old.ts"),
    at("packages", "shared", "src", "index.ts"),
    at("vitest.root.config.ts"),
  ]);
  assert.equal(outcome.status, "failed");
  assert.equal(
    outcome.detail,
    "unused files or exports in the root, apps/web, packages/shared",
  );
  assert.match(
    err,
    /delete each one, or use it\n {2}the root:\n {4}vitest\.root\.config\.ts\n {2}apps\/web:\n {4}apps\/web\/src\/old\.ts\n {2}packages\/shared:\n {4}packages\/shared\/src\/index\.ts\n$/,
  );
});

void test("unfamiliar evidence still fails the check, without attribution", async () => {
  const { outcome, err } = await failWith(undefined);
  assert.deepEqual(outcome, {
    name: "unused code (knip)",
    status: "failed",
    detail: "unused files or exports",
  });
  assert.doesNotMatch(err, /the root/);
});

void test("a failed inventory still fails the check, and says every finding is put down to the root", async () => {
  const { outcome, err } = await failWith(
    [at("apps", "web", "src", "old.ts")],
    {
      packages: WORKSPACE.packages,
      outcome: { name: "workspace packages", status: "failed" },
    },
  );
  assert.equal(outcome.status, "failed");
  assert.equal(
    outcome.detail,
    "unused files or exports in the root; packages unknown, as the workspace inventory failed",
  );
  assert.match(
    err,
    /couldn't be listed, so every finding is put down to the root\n {2}the root:\n {4}apps\/web\/src\/old\.ts\n$/,
  );
});
