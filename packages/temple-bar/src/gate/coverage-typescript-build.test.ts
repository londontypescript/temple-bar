// tsc -b's listings, with a faked tsc: every config the build reaches is
// listed once, by the path tsc reaches it by, through shared references,
// links and cycles, and a reference or --showConfig output that can't be
// followed fails the listing.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { listTypeScript } from "./coverage-typescript.ts";
import {
  calls,
  failureOf,
  PROJECTS,
  repo,
  rootListing,
  showing,
  type Reply,
} from "./testing/typescript-listing-fixture.ts";

void test("tsc -b follows references depth first, lists a shared one once, and stops at a cycle", async () => {
  const references: Readonly<Record<string, Reply>> = {
    "tsconfig.json": showing("./a.json", "b.json"),
    "a.json": showing("c"),
    "b.json": showing("./c/tsconfig.json"),
    "c/tsconfig.json": showing("../tsconfig.json"),
  };
  const { ctx, proc, stdout } = repo(PROJECTS, (args) => {
    const config = args[args.indexOf("-p") + 1] ?? "";
    return args.includes("--showConfig")
      ? (references[config] ?? { code: 1 })
      : { stdout: `/repo/src/${config}.ts\n/lib/lib.es2024.d.ts\n` };
  });

  const listings = await listTypeScript(await rootListing(ctx), {
    tool: "tsc-build",
    projects: [],
  });

  assert.deepEqual(
    listings.map((listing) => `${listing.command} (${listing.note ?? ""})`),
    [
      "tsc -p tsconfig.json (from tsc -b)",
      "tsc -p a.json (from tsc -b)",
      "tsc -p c/tsconfig.json (from tsc -b)",
      "tsc -p b.json (from tsc -b)",
    ],
  );
  assert.equal(calls(proc, "--showConfig").length, 4);
  assert.deepEqual(calls(proc, "--listFilesOnly"), [
    "-p tsconfig.json --listFilesOnly",
    "-p a.json --listFilesOnly",
    "-p c/tsconfig.json --listFilesOnly",
    "-p b.json --listFilesOnly",
  ]);
  const [first] = listings;
  assert.ok(first !== undefined && "files" in first);
  assert.deepEqual(
    [...first.files],
    [
      path.normalize("/repo/src/tsconfig.json.ts"),
      path.normalize("/lib/lib.es2024.d.ts"),
    ],
  );
  assert.match(
    stdout.lines.join(""),
    /^gate: listing the files tsc -p a\.json checks in the root$/m,
  );
});

void test("linked configs are listed, and their references followed, by the paths tsc reaches them by: two links to one file are two projects, and a cycle is still visited once", async () => {
  // a/tsconfig.json and b/tsconfig.json both link to shared/base.json. tsc
  // tells projects apart by path and reads each link's include and
  // references from the folder its own path names, so both are built, and
  // b's ./app.json is b/app.json, never shared/app.json.
  const references: Readonly<Record<string, Reply>> = {
    "tsconfig.json": showing("./a", "./b"),
    "a/tsconfig.json": showing("../tsconfig.json"),
    "b/tsconfig.json": showing("./app.json"),
    "b/app.json": showing(),
  };
  const { ctx, fs, proc } = repo(
    {
      "/repo/tsconfig.json": "",
      "/repo/a/tsconfig.json": "",
      "/repo/b/tsconfig.json": "",
      "/repo/b/app.json": "",
      "/repo/shared/base.json": "",
      "/repo/shared/app.json": "",
    },
    (args) => {
      const config = args[args.indexOf("-p") + 1] ?? "";
      return args.includes("--showConfig")
        ? (references[config] ?? { code: 1, stdout: `no ${config}\n` })
        : {};
    },
  );
  fs.realpaths.set("/repo/a/tsconfig.json", "/repo/shared/base.json");
  fs.realpaths.set("/repo/b/tsconfig.json", "/repo/shared/base.json");

  const listings = await listTypeScript(await rootListing(ctx), {
    tool: "tsc-build",
    projects: [],
  });

  assert.deepEqual(
    listings.map((listing) => listing.command),
    [
      "tsc -p tsconfig.json",
      "tsc -p a/tsconfig.json",
      "tsc -p b/tsconfig.json",
      "tsc -p b/app.json",
    ],
  );
  assert.deepEqual(calls(proc, "--showConfig"), [
    "-p tsconfig.json --showConfig",
    "-p a/tsconfig.json --showConfig",
    "-p b/tsconfig.json --showConfig",
    "-p b/app.json --showConfig",
  ]);
});

void test("tsc -b on a project, or reaching a reference, that doesn't exist fails the listing", async () => {
  const { ctx } = repo(PROJECTS, (args) =>
    args.includes("--showConfig") ? showing("./missing.json") : {},
  );
  const lc = await rootListing(ctx);

  assert.equal(
    failureOf(await listTypeScript(lc, { tool: "tsc-build", projects: [] })),
    "tsconfig.json references ./missing.json, which doesn't exist",
  );
  assert.equal(
    failureOf(
      await listTypeScript(lc, { tool: "tsc-build", projects: ["nowhere"] }),
    ),
    "nowhere doesn't exist",
  );
});

void test("--showConfig output that isn't a config with a list of references fails the listing", async () => {
  for (const [stdout, failure] of [
    [
      "error TS1005: '}' expected.\n{}",
      "tsc -p tsconfig.json --showConfig: printed no JSON object: error TS1005: '}' expected.",
    ],
    ["[]", "tsc -p tsconfig.json --showConfig: printed no JSON object: []"],
    [
      '{ "references": "a.json" }',
      `tsc -p tsconfig.json --showConfig: its "references" isn't a list of objects with a string "path"`,
    ],
    [
      '{ "references": [{ "path": 1 }] }',
      `tsc -p tsconfig.json --showConfig: its "references" isn't a list of objects with a string "path"`,
    ],
  ] as const) {
    const { ctx } = repo(PROJECTS, () => ({ stdout }));
    assert.equal(
      failureOf(
        await listTypeScript(await rootListing(ctx), {
          tool: "tsc-build",
          projects: [],
        }),
      ),
      failure,
      stdout,
    );
  }
});
