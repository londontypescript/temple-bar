// tsc's listings, with a faked tsc: every way a listing can fail, both of
// Windows' path spellings, and how a solution config is explained when it
// lists nothing. tsc -b's references: coverage-typescript-build.test.ts.

import assert from "node:assert/strict";
import test from "node:test";

import { listTypeScript, readListedFiles } from "./coverage-typescript.ts";
import { runCoverageCheck } from "./coverage.ts";
import {
  calls,
  failureOf,
  repo,
  rootListing,
  showing,
  type Reply,
} from "./testing/typescript-listing-fixture.ts";
import { PNPM_EXEC } from "./testing/workspace-fixture.ts";

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
