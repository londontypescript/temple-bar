// The exact-copy check on the gate and title workflows, as part of the
// gate: a failure fails an otherwise passing gate, reported once, and
// incomplete scripts' exit 2 still wins. A passing gate's report, this
// check's line included, is in command.test.ts.

import assert from "node:assert/strict";
import test from "node:test";

import {
  GATE_WORKFLOW_PATH,
  PR_TITLE_WORKFLOW_PATH,
} from "../init/workflows.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
  createFakeProc,
  createFakeWriter,
} from "../testing/fakes.ts";
import { testGateCommand as gateCommand } from "./testing/fake-tools.ts";
import {
  CORE_SCRIPTS,
  coreFiles,
  withCoreGit,
} from "./testing/core-fixture.ts";

const ALL_SCRIPTS = {
  typecheck: "tsc",
  lint: "eslint .",
  "format:check": "prettier --check .",
  test: "node --test",
};

/** Runs the gate over a set-up project with code of its own, every script
 * passing, and `workflows` laid over setup's workflows (undefined removes
 * one). */
async function runGate(
  scripts: Record<string, string>,
  workflows: Record<string, string | undefined> = {},
) {
  const fs = createFakeFs({
    ...coreFiles(),
    "/repo/package.json": JSON.stringify({
      scripts: { ...CORE_SCRIPTS, ...scripts },
    }),
    "/repo/src/index.ts": "export {};\n",
  });
  for (const [workflowPath, content] of Object.entries(workflows)) {
    if (content === undefined) {
      fs.files.delete(`/repo/${workflowPath}`);
    } else {
      fs.files.set(`/repo/${workflowPath}`, content);
    }
  }
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    git: createFakeGit(
      withCoreGit(() => ({
        code: 0,
        stdout: "package.json\nsrc/index.ts\n",
        stderr: "",
      })),
    ),
    proc: createFakeProc(() => 0),
    fs,
    stdout,
    stderr,
  });
  const code = await gateCommand.run([], ctx);
  return {
    code,
    stdout: stdout.lines.join(""),
    stderr: stderr.lines.join(""),
  };
}

/** The report's lines for the workflow check. */
function workflowLines(report: string): string[] {
  return report
    .split("\n")
    .filter(
      (line) =>
        line.includes("gate and title workflows") && /^ {2}\w/.test(line),
    );
}

void test("gate: an edited workflow fails an otherwise passing gate, and both wrong files are named", async () => {
  const result = await runGate(ALL_SCRIPTS, {
    [GATE_WORKFLOW_PATH]: undefined,
    [PR_TITLE_WORKFLOW_PATH]: "on: push\n",
  });
  assert.equal(result.code, 1);
  assert.deepEqual(workflowLines(result.stderr), [
    `  failed   gate and title workflows (${GATE_WORKFLOW_PATH} missing, ${PR_TITLE_WORKFLOW_PATH} differs at line 1)`,
  ]);
  assert.match(result.stderr, /^gate: failed: gate and title workflows$/m);
});

void test("gate: with a script missing, the workflow check still runs and is reported, and exit 2 wins", async () => {
  const { typecheck, lint } = ALL_SCRIPTS;
  const result = await runGate(
    { typecheck, lint, "format:check": "prettier --check ." },
    {
      [GATE_WORKFLOW_PATH]: "edited\n",
    },
  );
  assert.equal(result.code, 2);
  assert.deepEqual(workflowLines(result.stderr), [
    `  failed   gate and title workflows (${GATE_WORKFLOW_PATH} differs at line 1)`,
  ]);
  assert.match(
    result.stderr,
    /^gate: failed: test, gate and title workflows$/m,
  );
});
