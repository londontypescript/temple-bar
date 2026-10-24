// The test listings: Vitest's own list, read strictly, and Node's patterns
// expanded as Node expands them, where a pattern that matches nothing is a
// failure rather than the pass Node gives it.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { realLink } from "../init/testing/write-target-repo.ts";
import { createFsSeam } from "../seams/fs.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeProc,
  createFakeWriter,
  type FakeFs,
} from "../testing/fakes.ts";
import { createListings, type Listing } from "./coverage-listing.ts";
import type { TestPart } from "./coverage-scripts.ts";
import { listTests } from "./coverage-tests.ts";
import { PNPM_EXEC } from "./testing/workspace-fixture.ts";

interface Reply {
  readonly code?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

const COMMAND = "vitest run --config x --root .";

/** A repo at /repo holding `files`, whose tools answer `reply`, and a
 * listing for its root's test script. */
async function listed(
  part: TestPart,
  options: {
    readonly files?: readonly string[];
    readonly reply?: Reply;
    readonly setUp?: (fs: FakeFs) => void;
  } = {},
) {
  const fs = createFakeFs(
    Object.fromEntries(
      ["package.json", ...(options.files ?? [])].map((file) => [
        path.join("/repo", ...file.split("/")),
        "",
      ]),
    ),
  );
  options.setUp?.(fs);
  const proc = createFakeProc((_call, run) => {
    run.stdout.write(options.reply?.stdout ?? "[]");
    run.stderr.write(options.reply?.stderr ?? "");
    return options.reply?.code ?? 0;
  });
  const ctx = createFakeContext({
    fs,
    proc,
    stdout: createFakeWriter(),
    env: { npm_execpath: PNPM_EXEC, HOME: "/home/me" },
  });
  const listingsFor = await createListings(
    ctx,
    { kind: "javascript", path: PNPM_EXEC },
    undefined,
  );
  const listing = await listTests(
    listingsFor({
      folder: path.normalize("/repo"),
      realFolder: path.normalize("/repo"),
      where: "the root",
      script: "test",
      command: COMMAND,
    }),
    part,
  );
  return { listing, proc };
}

function vitest(args: readonly string[] = []): TestPart {
  return { tool: "vitest", args, text: COMMAND };
}

function node(patterns: readonly string[]): TestPart {
  return { tool: "node", patterns, text: "node --test" };
}

/** The listing's files, relative to /repo and "/"-separated. */
function filesOf(listing: Listing): string[] {
  assert.ok("files" in listing, JSON.stringify(listing));
  return [...listing.files]
    .map((file) => path.relative(path.normalize("/repo"), file))
    .map((file) => file.split(path.sep).join("/"))
    .sort();
}

function failureOf(listing: Listing): string {
  assert.ok("failure" in listing, JSON.stringify(listing));
  return listing.failure;
}

void test("vitest list gets the run's own arguments in order, --json last, and its files are read", async () => {
  const { listing, proc } = await listed(
    vitest(["--config", "x", "--root", "."]),
    {
      files: ["src/a.test.ts"],
      reply: {
        stdout: JSON.stringify([
          { file: "/repo/src/a.test.ts", projectName: "web" },
          { file: "/repo/src/b.test.ts" },
        ]),
      },
    },
  );
  const [call] = proc.calls;
  assert.deepEqual(call?.args, [
    PNPM_EXEC,
    "exec",
    "vitest",
    "list",
    "--config",
    "x",
    "--root",
    ".",
    "--filesOnly",
    "--json",
  ]);
  assert.deepEqual(filesOf(listing), ["src/a.test.ts", "src/b.test.ts"]);
  assert.equal(listing.note, "2 file(s)");
});

void test("every listing gets CI=true and the script's name and command, over the gate's own environment", async () => {
  const { proc } = await listed(vitest());
  assert.deepEqual(proc.calls[0]?.env, {
    npm_execpath: PNPM_EXEC,
    HOME: "/home/me",
    CI: "true",
    npm_lifecycle_event: "test",
    npm_lifecycle_script: COMMAND,
  });
});

void test("vitest list output that isn't a list of absolute files fails, with what Vitest said when it said anything", async () => {
  for (const [reply, failure] of [
    [
      { stdout: "oops", stderr: "\n Vitest couldn't start\n" },
      "Vitest couldn't start",
    ],
    [{ stdout: "oops" }, "vitest list printed no JSON"],
    [{ stdout: '{"file":"/repo/a.test.ts"}' }, "vitest list printed no list"],
    [
      { stdout: '[{"file":"src/a.test.ts"}]' },
      'vitest list printed an entry without an absolute file: {"file":"src/a.test.ts"}',
    ],
    [
      { stdout: "[{}]" },
      "vitest list printed an entry without an absolute file: {}",
    ],
    [
      { code: 1, stdout: "", stderr: "Error: unknown command list\n" },
      "Error: unknown command list",
    ],
    [{ code: 1, stdout: "[]" }, "exited with 1"],
  ] as const) {
    const { listing } = await listed(vitest(), { reply });
    assert.equal(failureOf(listing), failure, JSON.stringify(reply));
  }
});

void test("an empty Vitest list covers nothing, and is not a failure", async () => {
  const { listing } = await listed(vitest(), { reply: { stdout: "[]" } });
  assert.deepEqual(filesOf(listing), []);
});

void test("Node's patterns are expanded from the package's folder, each file once, node_modules skipped", async () => {
  const { listing, proc } = await listed(
    node(["src/**/*.{test,spec}.ts", "src/a.test.ts"]),
    {
      files: [
        "src/a.test.ts",
        "src/deep/b.spec.ts",
        "src/node_modules/c.test.ts",
        "src/d.ts",
        "e.test.ts",
      ],
    },
  );
  assert.deepEqual(filesOf(listing), ["src/a.test.ts", "src/deep/b.spec.ts"]);
  assert.equal(listing.note, "2 file(s)");
  assert.equal(proc.calls.length, 0, "Node's patterns run no tool");
});

void test("a pattern the script names that matches no file fails, and so does a folder named as a pattern", async () => {
  for (const pattern of ["tests/**/*.test.ts", "src"]) {
    const { listing } = await listed(node(["src/**/*.test.ts", pattern]), {
      files: ["src/a.test.ts"],
    });
    assert.equal(
      failureOf(listing),
      `it names a pattern that matches no file: ${JSON.stringify(pattern)}`,
    );
  }
});

void test("with no patterns, Node's default test names are listed as one, and a default that matches nothing is fine", async () => {
  const { listing } = await listed(node([]), {
    files: [
      "a.test.ts",
      "lib/b-test.mjs",
      "lib/c_test.cjs",
      "lib/test-d.js",
      "test.mts",
      "test/e.ts",
      "src/f.ts",
      "src/g.spec.ts",
      "src/h.test.tsx",
    ],
  });
  assert.deepEqual(filesOf(listing), [
    "a.test.ts",
    "lib/b-test.mjs",
    "lib/c_test.cjs",
    "lib/test-d.js",
    "test.mts",
    "test/e.ts",
  ]);

  const none = await listed(node([]), { files: ["src/f.ts"] });
  assert.deepEqual(filesOf(none.listing), []);
});

void test("a pattern the disk can't expand fails the listing", async () => {
  const { listing } = await listed(node(["src/**"]), {
    setUp: (fs) => {
      fs.globErrors.set("src/**", new Error("EACCES: permission denied"));
    },
  });
  assert.equal(
    failureOf(listing),
    'couldn\'t expand "src/**": EACCES: permission denied',
  );
});

void test('the real glob gives regular files only, as "/"-separated paths, skipping node_modules and links', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-glob-"));
  try {
    for (const file of [
      "src/a.test.ts",
      "src/deep/b.test.ts",
      "node_modules/x/c.test.ts",
      "src/node_modules/d.test.ts",
    ]) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), "");
    }
    mkdirSync(path.join(dir, "src", "folder.test.ts"));
    realLink("a.test.ts", path.join(dir, "src", "link.test.ts"));
    const fs = createFsSeam();
    assert.deepEqual((await fs.glob(dir, "**/*.test.ts")).sort(), [
      "src/a.test.ts",
      "src/deep/b.test.ts",
    ]);
    assert.deepEqual(await fs.glob(dir, "src"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
