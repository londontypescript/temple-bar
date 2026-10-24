// The coverage check through the whole gate, on a faked workspace: what it
// requires, how it says what nothing covers and whose it is, and that one
// package's missing script, failed listing or unlistable form never hides
// another package's listing.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { route } from "../router.ts";
import { CommandRegistry } from "../registry.ts";
import type { Context } from "../context.ts";
import type { FakeProc } from "../testing/fakes.ts";
import { runCoverageCheck } from "./coverage.ts";
import { listGitPaths } from "./lengths.ts";
import { testGateCommand as gateCommand } from "./testing/fake-tools.ts";
import {
  ALL_SCRIPTS,
  NPM_EXEC,
  PNPM_EXEC,
  workspace,
  type WorkspaceOptions,
} from "./testing/workspace-fixture.ts";

async function runGate(options: WorkspaceOptions) {
  const fixture = workspace(options);
  const registry = new CommandRegistry();
  registry.register(gateCommand);
  const code = await route(["gate"], fixture.ctx, registry);
  return {
    ...fixture,
    code,
    out: fixture.stdout.lines.join(""),
    err: fixture.stderr.lines.join(""),
  };
}

/** The tool listings made, as "folder: tool args" ("" the root). */
function execs(proc: FakeProc): string[] {
  return proc.calls
    .filter((call) => call.args.includes("exec"))
    .map((call) => {
      const folder = path
        .relative(path.normalize("/repo"), call.cwd)
        .split(path.sep)
        .join("/");
      return `${folder}: ${call.args.slice(call.args.indexOf("exec") + 1).join(" ")}`;
    });
}

/** Lists only the files under each package's own folder; the root lists
 * nothing. */
function ownFilesOnly(tracked: readonly string[]) {
  return (folder: string) =>
    folder === ""
      ? []
      : tracked.filter((file) => file.startsWith(`${folder}/`));
}

void test("a repo with no TypeScript or test files of its own skips both outcomes and lists nothing", async () => {
  const run = await runGate({
    extraTracked: [
      "README.md",
      "src/index.js",
      "dist/x.test.ts",
      "packages/a/node_modules/y/z.ts",
      "src/types.d.ts",
      "nested-worktree/",
    ],
  });
  assert.equal(run.code, 0, run.err);
  assert.match(
    run.out,
    /^ {2}skipped {2}type-check coverage \(no TypeScript files\)$/m,
  );
  assert.match(run.out, /^ {2}skipped {2}test coverage \(no test files\)$/m);
  assert.deepEqual(execs(run.proc), []);
});

void test("a package with no typecheck script has its files reported under it, with a note, while the other package's listing still runs", async () => {
  const noTypecheck = Object.fromEntries(
    Object.entries(ALL_SCRIPTS).filter(([name]) => name !== "typecheck"),
  );
  const files = ["packages/a/src/x.ts", "packages/b/src/y.ts"];
  const run = await runGate({
    packages: { "packages/a": noTypecheck, "packages/b": ALL_SCRIPTS },
    extraTracked: files,
    listings: ownFilesOnly(files),
  });
  assert.equal(run.code, 2, run.err);
  assert.ok(
    run.err.includes(
      [
        "gate: 1 TypeScript file(s) that no typecheck script checks:",
        "  packages/a:",
        "    packages/a has no typecheck script (reported above)",
        "    packages/a/src/x.ts",
        "  listings made: tsc (0 file(s)), tsc in packages/b",
        "",
      ].join("\n"),
    ),
    run.err,
  );
  assert.match(
    run.err,
    /^ {2}failed {3}type-check coverage \(1 file\(s\) unchecked\)$/m,
  );
  assert.deepEqual(execs(run.proc), [
    ": tsc --listFilesOnly",
    "packages/b: tsc --listFilesOnly",
    ": tsc --showConfig",
  ]);
});

void test("an uncovered file is put down to the deepest package holding it, the root first, then packages in order", async () => {
  const run = await runGate({
    packages: {
      "packages/a": ALL_SCRIPTS,
      "packages/a/inner": ALL_SCRIPTS,
    },
    extraTracked: [
      "packages/a/inner/src/z.ts",
      "packages/a/src/x.ts",
      "src/b.ts",
      "src/a.ts",
    ],
    listings: () => [],
  });
  assert.equal(run.code, 1, run.err);
  assert.match(
    run.err,
    / {2}the root:\n {4}src\/a\.ts\n {4}src\/b\.ts\n {2}packages\/a:\n {4}packages\/a\/src\/x\.ts\n {2}packages\/a\/inner:\n {4}packages\/a\/inner\/src\/z\.ts\n/,
  );
});

void test("identical listings are made once: a repeated command, and Vitest's run and default forms", async () => {
  const run = await runGate({
    workspaceFile: false,
    packages: {},
    rootScripts: {
      ...ALL_SCRIPTS,
      typecheck: "tsc -p tsconfig.json && tsc -p tsconfig.json",
      test: "vitest run && vitest",
    },
    extraTracked: ["src/a.ts", "src/a.test.ts"],
  });
  assert.equal(run.code, 0, run.err);
  assert.deepEqual(execs(run.proc), [
    ": tsc -p tsconfig.json --listFilesOnly",
    ": vitest list --filesOnly --json",
  ]);
  assert.match(
    run.out,
    /^ {2}passed {3}type-check coverage \(all 2 TypeScript file\(s\) checked by 1 listing\(s\)\)$/m,
  );
  assert.match(
    run.out,
    /^ {2}passed {3}test coverage \(all 1 test file\(s\) run by 1 listing\(s\)\)$/m,
  );
  assert.match(
    run.out,
    /^gate: listing the files tsc -p tsconfig\.json checks in the root$/m,
  );
});

void test("a tool runs through the package manager that started the gate, the way its scripts run, with no shell", async () => {
  const listing = (env: NodeJS.ProcessEnv) =>
    runGate({
      workspaceFile: false,
      packages: {},
      extraTracked: ["src/a.ts"],
      env,
    }).then(({ proc }) =>
      proc.calls.filter((call) => call.args.includes("exec")),
    );

  const [pnpm] = await listing({ npm_execpath: PNPM_EXEC });
  assert.equal(pnpm?.command, process.execPath);
  assert.deepEqual(pnpm.args, [PNPM_EXEC, "exec", "tsc", "--listFilesOnly"]);
  assert.equal(pnpm.cwd, path.normalize("/repo"));

  const [npm] = await listing({ npm_execpath: NPM_EXEC });
  assert.equal(npm?.command, process.execPath);
  assert.deepEqual(npm.args, [
    NPM_EXEC,
    "exec",
    "--no",
    "--",
    "tsc",
    "--listFilesOnly",
  ]);

  // Run by hand, through the package manager the project names.
  const [byHand] = await listing({});
  assert.equal(byHand?.command, "pnpm");
  assert.deepEqual(byHand.args, ["exec", "tsc", "--listFilesOnly"]);
});

void test("a failed listing fails its outcome with tsc's line, and the other package's listing still runs", async () => {
  const files = ["packages/a/src/x.ts", "packages/b/src/y.ts"];
  const run = await runGate({
    extraTracked: files,
    listings: (folder) =>
      folder === "packages/a"
        ? { error: "error TS5058: The specified path does not exist: 'x'." }
        : ownFilesOnly(files)(folder),
  });
  assert.equal(run.code, 1, run.err);
  assert.match(
    run.err,
    /^gate: listing the files tsc checks in packages\/a failed: error TS5058: The specified path does not exist: 'x'\.$/m,
  );
  assert.match(
    run.err,
    /^ {2}failed {3}type-check coverage \(listing failed\)$/m,
  );
  assert.doesNotMatch(run.err, /that no typecheck script checks/);
  assert.ok(execs(run.proc).includes("packages/b: tsc --listFilesOnly"));
});

void test("a script the gate can't list fails its outcome, naming the package, while the other packages are still listed", async () => {
  const run = await runGate({
    packages: {
      "packages/a": { ...ALL_SCRIPTS, test: "jest" },
      "packages/b": ALL_SCRIPTS,
    },
    extraTracked: ["packages/a/a.test.ts", "packages/b/b.test.ts"],
  });
  assert.equal(run.code, 1, run.err);
  assert.match(
    run.err,
    /^gate: packages\/a's test script isn't a form the gate can list: "jest"$/m,
  );
  assert.match(
    run.err,
    /^ {2}failed {3}test coverage \(unsupported script form\)$/m,
  );
  assert.match(
    run.err,
    /^ {2}passed {3}type-check coverage \(all 2 TypeScript file\(s\) checked by 3 listing\(s\)\)$/m,
  );
});

void test("files are matched by real path: a link to a file outside the root, and a name git spells in another case", async () => {
  const fixture = workspace({
    workspaceFile: false,
    packages: {},
    extraTracked: ["src/link.ts", "src/Name.ts"],
    listings: () => ["../elsewhere/real.ts", "src/name.ts", "../other/x.ts"],
  });
  fixture.fs.realpaths.set("/repo/src/link.ts", "/elsewhere/real.ts");
  fixture.fs.realpaths.set("/repo/src/Name.ts", "/repo/src/name.ts");
  const registry = new CommandRegistry();
  registry.register(gateCommand);
  assert.equal(
    await route(["gate"], fixture.ctx, registry),
    0,
    fixture.stderr.lines.join(""),
  );
  assert.match(
    fixture.stdout.lines.join(""),
    /^ {2}passed {3}type-check coverage \(all 2 TypeScript file\(s\) checked by 1 listing\(s\)\)$/m,
  );
});

void test("without the package list, or a package manager to ask, both outcomes fail as not checked, listing nothing", async () => {
  const inventoryFailed = await runGate({
    extraTracked: ["tools/c/package.json", "src/a.ts"],
  });
  assert.match(
    inventoryFailed.err,
    /^ {2}failed {3}type-check coverage \(not checked: 1 package\.json file\(s\) outside the workspace's packages\)$/m,
  );
  assert.match(
    inventoryFailed.err,
    /^ {2}failed {3}test coverage \(not checked: 1 package\.json file\(s\) outside the workspace's packages\)$/m,
  );
  assert.deepEqual(execs(inventoryFailed.proc), []);

  const shim = path.join("/tools", "pnpm", "pnpm.cmd");
  const refused = await runGate({
    env: { npm_execpath: shim },
    untracked: { [shim]: "" },
    extraTracked: ["src/a.ts"],
  });
  assert.equal(refused.code, 1);
  assert.match(
    refused.err,
    /^ {2}failed {3}type-check coverage \(not checked: the gate can't start its package manager\)$/m,
  );
  assert.deepEqual(execs(refused.proc), []);
});

void test("a tracked file that isn't on disk, such as one a staged rename moved, isn't required", async () => {
  const fixture = workspace({
    workspaceFile: false,
    packages: {},
    extraTracked: ["src/moved.ts"],
  });
  fixture.fs.files.delete(path.join("/repo", "src", "moved.ts"));
  const ctx: Context = fixture.ctx;
  const outcomes = await runCoverageCheck(ctx, {
    listed: await listGitPaths(ctx),
    launcher: { kind: "javascript", path: PNPM_EXEC },
    inventory: {
      packages: [],
      outcome: { name: "workspace packages", status: "passed" },
    },
    exclusions: [],
  });
  assert.deepEqual(outcomes[0], {
    name: "type-check coverage",
    status: "skipped",
    detail: "no TypeScript files",
  });
});
