// `gate --part`: one part of the gate runs, from the same plan as the whole
// gate, and writes its report; everything it refuses, it refuses before
// running a check.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createGateCommand } from "./command.ts";
import { createFakeTools } from "./testing/fake-tools.ts";
import {
  ACTIONS_ENV,
  createFakePartFiles,
  HEAD,
  partArgs,
  readReport,
  REPORTS,
  runGate,
  withHead,
} from "./testing/parts-fixture.ts";
import {
  ALL_SCRIPTS,
  pnpmListing,
  scriptRuns,
  workspace,
  type WorkspaceOptions,
} from "./testing/workspace-fixture.ts";
import { readOwnVersion } from "../package-info.ts";

function fixture(options: WorkspaceOptions = {}) {
  const made = workspace({ env: ACTIONS_ENV, ...options });
  return { ...made, ctx: withHead(made.ctx), files: createFakePartFiles() };
}

const EVERY = ["typecheck", "lint", "format:check", "test"];

void test("gate --part root runs only the root's scripts and reports them, with this run's identity", async () => {
  const { ctx, proc, files, stdout } = fixture();

  assert.equal(await runGate(ctx, files, partArgs("root", "root.json")), 0);

  assert.deepEqual(
    scriptRuns(proc),
    EVERY.map((script) => `:${script}`),
  );
  assert.match(stdout.lines.join(""), /^gate: passed$/m);
  const report = readReport(files, "root.json");
  assert.deepEqual(
    { ...report, outcomes: report.outcomes.map((outcome) => outcome.name) },
    {
      format: "temple-bar-gate-part",
      version: 1,
      repository: "owner/project",
      commit: HEAD,
      run: "4242",
      attempt: "1",
      leg: "windows",
      node: process.version,
      pnpm: "javascript",
      gate: readOwnVersion(),
      part: "root",
      exitCode: 0,
      outcomes: EVERY,
    },
  );
});

void test("gate --part <package> runs only that package's scripts", async () => {
  const { ctx, proc, files } = fixture();

  assert.equal(await runGate(ctx, files, partArgs("packages/b", "b.json")), 0);

  assert.deepEqual(
    scriptRuns(proc),
    EVERY.map((script) => `packages/b:${script}`),
  );
  assert.deepEqual(
    readReport(files, "b.json").outcomes.map((outcome) => outcome.name),
    EVERY.map((script) => `${script} (packages/b)`),
  );
});

void test("gate --part repo runs every check but the scripts, the inventory's outcome first", async () => {
  const { ctx, proc, files } = fixture();

  assert.equal(await runGate(ctx, files, partArgs("repo", "repo.json")), 0);

  assert.deepEqual(scriptRuns(proc), []);
  const names = readReport(files, "repo.json").outcomes.map(
    (outcome) => outcome.name,
  );
  assert.equal(names[0], "workspace packages");
  assert.ok(names.includes("test coverage"));
  assert.ok(names.includes("gate and title checks rule"));
  assert.ok(!names.includes("test"));
});

void test("gate --part exits as the whole gate would for its checks: 2 for a missing script, 1 for a failed one, and still reports", async () => {
  const missing = fixture({
    packages: { "packages/a": { lint: "eslint ." }, "packages/b": ALL_SCRIPTS },
  });
  assert.equal(
    await runGate(missing.ctx, missing.files, partArgs("packages/a", "a.json")),
    2,
  );
  assert.equal(readReport(missing.files, "a.json").exitCode, 2);

  const failing = fixture({
    exitCode: (folder, script) => (folder === "" && script === "lint" ? 1 : 0),
  });
  assert.equal(
    await runGate(failing.ctx, failing.files, partArgs("root", "root.json")),
    1,
  );
  const report = readReport(failing.files, "root.json");
  assert.equal(report.exitCode, 1);
  assert.deepEqual(report.outcomes[1], {
    name: "lint",
    status: "failed",
    detail: "exit 1",
  });
});

void test("gate --part refuses outside GitHub Actions, naming each variable it lacks, before running anything", async () => {
  const { ctx, proc, files, stderr } = fixture({
    env: { npm_execpath: ACTIONS_ENV.npm_execpath, GITHUB_RUN_ID: "1" },
  });

  assert.equal(await runGate(ctx, files, partArgs("root", "root.json")), 1);

  assert.match(
    stderr.lines.join(""),
    /^gate: --part runs only in GitHub Actions; missing: GITHUB_ACTIONS=true, GITHUB_REPOSITORY, GITHUB_RUN_ATTEMPT$/m,
  );
  assert.equal(proc.calls.length, 0);
  assert.deepEqual(files.written, []);
});

void test("gate --part refuses a part the inventory doesn't have, naming the parts", async () => {
  const { ctx, proc, files, stderr } = fixture();

  assert.equal(await runGate(ctx, files, partArgs("packages/c", "c.json")), 1);

  assert.match(
    stderr.lines.join(""),
    /^gate: there is no part named packages\/c: the parts are repo, root, packages\/a, packages\/b$/m,
  );
  assert.deepEqual(scriptRuns(proc), []);
  assert.deepEqual(files.written, []);
});

void test("gate --part refuses any part but repo when the inventory failed; repo still runs and reports it", async () => {
  const listingFails = {
    listing: { stdout: "", code: 1, stderr: "ERR_PNPM_BOOM" },
  };
  const root = fixture(listingFails);
  assert.equal(
    await runGate(root.ctx, root.files, partArgs("root", "root.json")),
    1,
  );
  assert.match(
    root.stderr.lines.join(""),
    /^gate: part root can't run: the workspace inventory failed \(pnpm list exited with 1: ERR_PNPM_BOOM; no package's scripts were run\); its own part, repo, reports it$/m,
  );
  assert.deepEqual(scriptRuns(root.proc), []);
  assert.deepEqual(root.files.written, []);

  const repo = fixture(listingFails);
  assert.equal(
    await runGate(repo.ctx, repo.files, partArgs("repo", "repo.json")),
    1,
  );
  const report = readReport(repo.files, "repo.json");
  assert.equal(report.outcomes[0]?.status, "failed");
});

void test("gate --part and --verify-parts refuse a package folder named repo or root before running anything; the whole gate runs", async () => {
  for (const name of ["repo", "root"]) {
    for (const args of [
      partArgs(name, "x.json"),
      ["--verify-parts", REPORTS, "--leg", "windows"],
    ]) {
      const { ctx, proc, files, stderr } = fixture({
        packages: { [name]: ALL_SCRIPTS },
        listing: { stdout: pnpmListing(["", name]) },
      });
      assert.equal(await runGate(ctx, files, args), 1);
      assert.match(
        stderr.lines.join(""),
        new RegExp(
          `^gate: the gate can't be split by part here: ${name} is a workspace package's folder, and the name of one of the gate's own parts$`,
          "m",
        ),
      );
      assert.deepEqual(scriptRuns(proc), []);
      assert.deepEqual(files.written, []);
    }

    const whole = fixture({
      packages: { [name]: ALL_SCRIPTS },
      listing: { stdout: pnpmListing(["", name]) },
    });
    assert.equal(await runGate(whole.ctx, whole.files, []), 0);
    assert.equal(scriptRuns(whole.proc).length, 8);
  }
});

void test("gate --part never overwrites a report: an existing one is refused before any check runs", async () => {
  const { ctx, proc, files, stderr } = fixture();
  files.entries.set(path.join(REPORTS, "root.json"), "earlier\n");

  assert.equal(await runGate(ctx, files, partArgs("root", "root.json")), 1);

  assert.match(
    stderr.lines.join(""),
    /^gate: --report .*root\.json already exists; a part's report is never overwritten$/m,
  );
  assert.equal(proc.calls.length, 0);
  assert.equal(files.entries.get(path.join(REPORTS, "root.json")), "earlier\n");
});

void test("gate --part fails when the report can't be created after its checks, even though they passed", async () => {
  const { ctx, files, stderr } = fixture();
  const racing = {
    ...files,
    createNew: () => Promise.reject(new Error("EEXIST: file already exists")),
  };

  assert.equal(
    await createGateCommand(createFakeTools(), racing).run(
      partArgs("root", "root.json"),
      ctx,
    ),
    1,
  );
  assert.match(
    stderr.lines.join(""),
    /^gate: could not write the report .*root\.json: EEXIST: file already exists$/m,
  );
});

void test("gate --part refuses a gate not started through pnpm, since its report must say how pnpm ran", async () => {
  const { ctx, proc, files, stderr } = fixture({
    workspaceFile: false,
    packages: {},
    env: { ...ACTIONS_ENV, npm_execpath: undefined },
  });

  assert.equal(await runGate(ctx, files, partArgs("root", "root.json")), 1);

  assert.match(
    stderr.lines.join(""),
    /^gate: --part needs the gate started through pnpm \(npm_execpath\)/m,
  );
  assert.deepEqual(scriptRuns(proc), []);
  assert.deepEqual(files.written, []);
});
