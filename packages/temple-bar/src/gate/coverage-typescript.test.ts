// tsc's listings, with a faked tsc: `tsc -b`'s references followed once
// each, every way a listing can fail, both of Windows' path spellings,
// and how a solution config is explained when it lists nothing.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  createFakeContext,
  createFakeFs,
  createFakeProc,
  createFakeWriter,
  type FakeProc,
} from "../testing/fakes.ts";
import { createListings, type Listing } from "./coverage-listing.ts";
import { listTypeScript, readListedFiles } from "./coverage-typescript.ts";
import { runCoverageCheck } from "./coverage.ts";
import { PNPM_EXEC } from "./testing/workspace-fixture.ts";

interface Reply {
  readonly code?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

/** tsc's arguments in a call made through pnpm's exec. */
function tscArgs(args: readonly string[]): readonly string[] {
  return args.slice(args.indexOf("exec") + 2);
}

/** A repo at /repo holding `files`, whose tsc answers `reply`. */
function repo(
  files: Readonly<Record<string, string>>,
  reply: (args: readonly string[]) => Reply,
) {
  const fs = createFakeFs({ "/repo/package.json": "{}", ...files });
  const proc = createFakeProc((call, run) => {
    const answer = reply(tscArgs(call.args));
    run.stdout.write(answer.stdout ?? "");
    run.stderr.write(answer.stderr ?? "");
    return answer.code ?? 0;
  });
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    fs,
    proc,
    stdout,
    stderr,
    env: { npm_execpath: PNPM_EXEC },
  });
  return { ctx, fs, proc, stdout, stderr };
}

async function rootListing(
  ctx: ReturnType<typeof repo>["ctx"],
  platform: NodeJS.Platform = process.platform,
) {
  const listingsFor = await createListings(
    ctx,
    { kind: "javascript", path: PNPM_EXEC },
    undefined,
    platform,
  );
  return listingsFor({
    folder: "/repo",
    realFolder: path.normalize("/repo"),
    where: "the root",
    script: "typecheck",
    command: "tsc -b",
  });
}

function calls(proc: FakeProc, flag: string): string[] {
  return proc.calls
    .map((call) => tscArgs(call.args))
    .filter((args) => args.includes(flag))
    .map((args) => args.join(" "));
}

function failureOf(listings: readonly Listing[]): string | undefined {
  const [first] = listings;
  return first !== undefined && "failure" in first ? first.failure : undefined;
}

/** A config's --showConfig output, with these references. */
function showing(...references: string[]): Reply {
  return {
    stdout: JSON.stringify({
      compilerOptions: {},
      references: references.map((reference) => ({ path: reference })),
    }),
  };
}

const PROJECTS = {
  "/repo/tsconfig.json": "",
  "/repo/a.json": "",
  "/repo/b.json": "",
  "/repo/c/tsconfig.json": "",
};

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

void test("a listing fails with tsc's first error, a diagnostic among the files, or what pnpm said", async () => {
  for (const [reply, failure] of [
    [
      {
        code: 1,
        stdout:
          "error TS18003: No inputs were found in config file 'tsconfig.json'.\n",
      },
      "error TS18003: No inputs were found in config file 'tsconfig.json'.",
    ],
    [
      {
        stdout:
          "/repo/src/a.ts\n/repo/tsconfig.json(1,88): error TS6310: Referenced project may not disable emit.\n",
      },
      "/repo/tsconfig.json(1,88): error TS6310: Referenced project may not disable emit.",
    ],
    [{ stdout: "/repo/src/a.ts\nwarning: odd\n" }, "warning: odd"],
    [
      {
        // pnpm's own shape when it can't find the tool: all on stdout.
        code: 254,
        stdout:
          'undefined\n ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "tsc" not found\n',
      },
      'ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "tsc" not found',
    ],
    [
      { code: 1, stdout: "undefined\n", stderr: "\nnode: bad option\n" },
      "node: bad option",
    ],
    [
      // A warning on stderr doesn't hide pnpm's own error on stdout.
      {
        code: 254,
        stdout:
          'undefined\n ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "tsc" not found\n',
        stderr: ' WARN  Issue while reading "/home/me/.npmrc".\n',
      },
      'ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "tsc" not found',
    ],
    [{ code: 3 }, "exited with 3"],
  ] as const) {
    const { ctx } = repo({}, () => reply);
    const listings = await listTypeScript(await rootListing(ctx), {
      tool: "tsc",
      project: "tsconfig.json",
    });
    assert.equal(failureOf(listings), failure);
  }
});

void test("on Windows, either separator after a drive letter is a file, both resolving to one real path", async () => {
  assert.deepEqual(
    readListedFiles(
      "C:/x/y.ts\r\nC:\\x\\z.ts\r\n\r\nerror TS5058: nope\r\n",
      "win32",
    ),
    {
      paths: ["C:/x/y.ts", "C:\\x\\z.ts"],
      diagnostics: ["error TS5058: nope"],
    },
  );
  assert.deepEqual(readListedFiles("C:/x/y.ts\n/x/z.ts\n", "linux"), {
    paths: ["/x/z.ts"],
    diagnostics: ["C:/x/y.ts"],
  });

  const { ctx, fs } = repo({}, () => ({
    stdout: "C:/repo/src/a.ts\nC:\\repo\\src\\b.ts\nC:/repo/src/missing.ts\n",
  }));
  fs.realpaths.set("C:/repo/src/a.ts", "C:\\repo\\src\\a.ts");
  fs.realpaths.set("C:\\repo\\src\\b.ts", "C:\\repo\\src\\b.ts");
  const [listing] = await listTypeScript(await rootListing(ctx, "win32"), {
    tool: "tsc",
    project: undefined,
  });
  assert.ok(listing !== undefined && "files" in listing);
  assert.deepEqual(
    [...listing.files],
    ["C:\\repo\\src\\a.ts", "C:\\repo\\src\\b.ts", "C:\\repo\\src\\missing.ts"],
  );
});

/** The coverage check over /repo/src/a.ts with this typecheck. */
async function check(
  typecheck: string,
  reply: (args: readonly string[]) => Reply,
) {
  const fixture = repo(
    {
      "/repo/package.json": JSON.stringify({
        scripts: { typecheck, test: "node --test" },
      }),
      "/repo/src/a.ts": "",
    },
    reply,
  );
  const outcomes = await runCoverageCheck(fixture.ctx, {
    listed: ["package.json", "src/a.ts"],
    launcher: { kind: "javascript", path: PNPM_EXEC },
    inventory: {
      packages: [],
      outcome: { name: "workspace packages", status: "passed" },
    },
    exclusions: [],
  });
  return { ...fixture, outcomes };
}

/** solution.json lists nothing; real.json lists `real`. */
function solutionAnd(real: string, showConfig: Reply) {
  return (args: readonly string[]): Reply => {
    if (args.includes("--showConfig")) return showConfig;
    return args.includes("real.json") ? { stdout: `${real}\n` } : {};
  };
}

void test("an empty listing beside one that covers every file passes, without asking tsc anything more", async () => {
  const { outcomes, proc } = await check(
    "tsc -p solution.json && tsc -p real.json",
    solutionAnd("/repo/src/a.ts", showing("./real.json")),
  );
  assert.deepEqual(outcomes[0], {
    name: "type-check coverage",
    status: "passed",
    detail: "all 1 TypeScript file(s) checked by 2 listing(s)",
  });
  assert.deepEqual(calls(proc, "--showConfig"), []);
});

void test("when the outcome fails, an empty tsc -p listing says whether it was a solution config", async () => {
  for (const [showConfig, said] of [
    [
      showing("./real.json"),
      "0 file(s): a solution config, which tsc -p doesn't check; use tsc -b",
    ],
    [showing(), "0 file(s)"],
    [
      { code: 1, stdout: "error TS5058: The specified path does not exist.\n" },
      "0 file(s); its config couldn't be read: error TS5058: The specified path does not exist.",
    ],
  ] as const) {
    const { outcomes, proc, stderr } = await check(
      "tsc -p solution.json && tsc -p real.json",
      solutionAnd("/lib/lib.d.ts", showConfig),
    );
    assert.equal(outcomes[0]?.status, "failed");
    assert.match(
      stderr.lines.join(""),
      new RegExp(
        `^ {2}listings made: tsc -p solution\\.json \\(${said.replace(/[().]/g, "\\$&")}\\), tsc -p real\\.json$`,
        "m",
      ),
    );
    assert.deepEqual(calls(proc, "--showConfig"), [
      "-p solution.json --showConfig",
    ]);
  }
});
