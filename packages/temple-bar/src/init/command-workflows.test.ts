// What setup says about the gate and title workflows and the pnpm version
// they install: each workflow written or left alone, a changed copy
// reported, either one counted as a change to land, and a pnpm version it
// can't name ending the run non-zero.

import assert from "node:assert/strict";
import test from "node:test";

import { createInitCommand } from "./command.ts";
import {
  GATE_WORKFLOW_PATH,
  gateWorkflow,
  PR_TITLE_WORKFLOW_PATH,
} from "./workflows.ts";
import {
  makeFixture,
  runInitFor,
  setUpFiles,
  unchangedReport,
} from "./testing/command-fixture.ts";
import { createFakeFs } from "../testing/fakes.ts";

/** Runs setup over `fs` with the hooks already installed, as on a rerun,
 * with `env` in place of pnpm's. */
async function rerun(
  fs: ReturnType<typeof createFakeFs>,
  env?: NodeJS.ProcessEnv,
) {
  const fixture = makeFixture({ fs, ...(env === undefined ? {} : { env }) });
  const command = createInitCommand({
    installHooks: () => Promise.resolve(unchangedReport),
  });
  const code = await command.run([], fixture.ctx);
  return {
    code,
    stdout: fixture.stdout.lines.join(""),
    stderr: fixture.stderr.lines.join(""),
  };
}

const escaped = (text: string) => text.replaceAll(".", "\\.");

void test("init workflows: a fresh repo gets both workflows and the running pnpm's version, each reported", async () => {
  const fixture = makeFixture({ fs: createFakeFs() });
  assert.equal(await runInitFor(fixture), 0, fixture.stderr.lines.join(""));
  const out = fixture.stdout.lines.join("");
  assert.match(
    out,
    new RegExp(`Wrote the gate workflow, ${escaped(GATE_WORKFLOW_PATH)}\\.`),
  );
  assert.match(
    out,
    new RegExp(
      `Wrote the pull request title workflow, ${escaped(PR_TITLE_WORKFLOW_PATH)}\\.`,
    ),
  );
  assert.match(
    out,
    /Set "packageManager" in package\.json to "pnpm@10\.34\.5"/,
  );
});

void test("init workflows: a different gate workflow is left alone and reported, and the run ends non-zero", async () => {
  const edited = gateWorkflow().replace("pnpm gate", "pnpm gate || true");
  const fs = setUpFiles({ [`/repo/${GATE_WORKFLOW_PATH}`]: edited });
  const { code, stdout, stderr } = await rerun(fs);
  assert.equal(code, 1);
  assert.equal(fs.files.get(`/repo/${GATE_WORKFLOW_PATH}`), edited);
  assert.equal(fs.writes.length, 0);
  assert.match(
    stderr,
    /\.github\/workflows\/temple-bar-gate\.yml differs from the copy this temple-bar writes, from line \d+, so it was left alone, and the gate fails until it matches\. Fix: move the project's own changes into a workflow of their own, delete this file/,
  );
  assert.doesNotMatch(stdout, /temple-bar is set up/);
  assert.match(
    stdout,
    new RegExp(
      `${escaped(PR_TITLE_WORKFLOW_PATH)} already exists; left it alone\\.`,
    ),
  );
});

void test("init workflows: a symlinked gate workflow is left alone and reported, and the run ends non-zero", async () => {
  const fs = setUpFiles();
  fs.symlinks.add(`/repo/${GATE_WORKFLOW_PATH}`);
  const { code, stdout, stderr } = await rerun(fs);
  assert.equal(code, 1);
  assert.equal(fs.writes.length, 0);
  assert.match(
    stderr,
    /\.github\/workflows\/temple-bar-gate\.yml is a symlink or folder, not an ordinary file, so it was left alone, and the gate fails until it matches\. Fix: move the project's own changes/,
  );
  assert.doesNotMatch(stdout, /temple-bar is set up/);
});

void test("init workflows: one workflow written alone is a change to land, and the next steps add both", async () => {
  const fs = setUpFiles();
  fs.files.delete(`/repo/${PR_TITLE_WORKFLOW_PATH}`);
  const { code, stdout } = await rerun(fs);
  assert.equal(code, 0);
  assert.deepEqual(
    fs.writes.map((write) => write.path),
    [`/repo/${PR_TITLE_WORKFLOW_PATH}`],
  );
  const addLine = /^ {2}git add .*$/m.exec(stdout)?.[0] ?? "";
  assert.match(addLine, new RegExp(` ${escaped(GATE_WORKFLOW_PATH)}( |$)`));
  assert.match(addLine, new RegExp(` ${escaped(PR_TITLE_WORKFLOW_PATH)}( |$)`));
});

void test("init workflows: a packageManager setup can't use ends the run non-zero, and is left alone", async () => {
  const manifest = JSON.stringify({
    name: "widgets",
    packageManager: "npm@10.9.2",
    scripts: { prepare: "temple-bar hook install", gate: "temple-bar gate" },
  });
  const fs = setUpFiles({ "/repo/package.json": manifest });
  const { code, stdout, stderr } = await rerun(fs);
  assert.equal(code, 1);
  assert.equal(fs.files.get("/repo/package.json"), manifest);
  assert.match(stderr, /package\.json's packageManager is "npm@10\.9\.2"/);
  assert.doesNotMatch(stdout, /temple-bar is set up/);
});

void test("init workflows: when it can't tell which pnpm runs it, setup writes no version, says to rerun through pnpm and ends non-zero", async () => {
  const manifest = JSON.stringify({
    name: "widgets",
    scripts: { prepare: "temple-bar hook install", gate: "temple-bar gate" },
  });
  const fs = setUpFiles({ "/repo/package.json": manifest });
  const { code, stdout, stderr } = await rerun(fs, {});
  assert.equal(code, 1);
  assert.equal(fs.files.get("/repo/package.json"), manifest);
  assert.match(
    stderr,
    /Couldn't tell which pnpm is running setup.*run `pnpm exec temple-bar init` again/,
  );
  assert.doesNotMatch(stdout, /temple-bar is set up/);
});
