// The exact-copy check on the gate and title workflows: any edit fails,
// however small, naming the file and the first line that differs, and only
// a Windows checkout's CRLF line endings pass.

import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECKED_WORKFLOWS,
  GATE_WORKFLOW_PATH,
  gateWorkflow,
  PR_TITLE_WORKFLOW_PATH,
} from "../init/workflows.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeWriter,
} from "../testing/fakes.ts";
import { runWorkflowCopiesCheck } from "./workflow-copies.ts";

/** Runs the check over a repo holding both workflows as setup writes them,
 * with `gate` in place of the gate workflow (undefined: no such file). */
async function checkWithGate(gate: string | undefined) {
  const files: Record<string, string> = {};
  for (const workflow of CHECKED_WORKFLOWS) {
    const content =
      workflow.path === GATE_WORKFLOW_PATH ? gate : workflow.content;
    if (content !== undefined) {
      files[`/repo/${workflow.path}`] = content;
    }
  }
  const stderr = createFakeWriter();
  const ctx = createFakeContext({ fs: createFakeFs(files), stderr });
  const outcome = await runWorkflowCopiesCheck(ctx);
  return { outcome, stderr: stderr.lines.join("") };
}

/** The gate workflow's lines, each with its newline, to edit by index. */
function gateLines(): string[] {
  return gateWorkflow().split(/(?<=\n)/);
}

/** Asserts the check failed on the gate workflow, from `line`, saying how
 * to put it right. */
function assertDiffersAt(
  result: Awaited<ReturnType<typeof checkWithGate>>,
  line: number,
): void {
  assert.equal(result.outcome.status, "failed");
  assert.equal(
    result.outcome.detail,
    `${GATE_WORKFLOW_PATH} differs at line ${String(line)}`,
  );
  assert.match(
    result.stderr,
    new RegExp(
      `${GATE_WORKFLOW_PATH.replaceAll(".", "\\.")} differs from the copy this temple-bar writes, from line ${String(line)}\\.`,
    ),
  );
  assert.match(
    result.stderr,
    /move the project's own changes into a workflow of their own, delete this file, and run `pnpm exec temple-bar init` again/,
  );
}

void test("workflow copies: exact copies pass", async () => {
  const result = await checkWithGate(gateWorkflow());
  assert.deepEqual(result.outcome, {
    name: "gate and title workflows",
    status: "passed",
    detail: "2 exact copies",
  });
  assert.equal(result.stderr, "");
});

void test("workflow copies: a copy with CRLF line endings passes", async () => {
  const result = await checkWithGate(gateWorkflow().replaceAll("\n", "\r\n"));
  assert.equal(result.outcome.status, "passed");
});

void test("workflow copies: a missing file fails and says to run setup again", async () => {
  const result = await checkWithGate(undefined);
  assert.equal(result.outcome.status, "failed");
  assert.equal(result.outcome.detail, `${GATE_WORKFLOW_PATH} missing`);
  assert.match(
    result.stderr,
    /temple-bar-gate\.yml is missing\.\n {2}fix: run `pnpm exec temple-bar init` again/,
  );
});

void test("workflow copies: a symlink fails, even to the right text, since GitHub doesn't run it", async () => {
  const fs = createFakeFs(
    Object.fromEntries(
      CHECKED_WORKFLOWS.map((workflow) => [
        `/repo/${workflow.path}`,
        workflow.content,
      ]),
    ),
  );
  fs.symlinks.add(`/repo/${GATE_WORKFLOW_PATH}`);
  const stderr = createFakeWriter();
  const outcome = await runWorkflowCopiesCheck(
    createFakeContext({ fs, stderr }),
  );
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.detail, `${GATE_WORKFLOW_PATH} not an ordinary file`);
  assert.match(
    stderr.lines.join(""),
    /temple-bar-gate\.yml is a symlink or folder, not an ordinary file, so GitHub doesn't run it as a workflow\.\n {2}fix: move the project's own changes/,
  );
});

void test("workflow copies: an edited line fails, naming that line", async () => {
  const lines = gateLines();
  lines[11] = "    types: [opened, synchronize, reopened, edited]\n";
  assertDiffersAt(await checkWithGate(lines.join("")), 12);
});

void test("workflow copies: an inserted line fails at the line inserted", async () => {
  const lines = gateLines();
  lines.splice(30, 0, "        if: false\n");
  assertDiffersAt(await checkWithGate(lines.join("")), 31);
});

void test("workflow copies: a deleted line fails at the line that took its place", async () => {
  const lines = gateLines();
  lines.splice(20, 1);
  assertDiffersAt(await checkWithGate(lines.join("")), 21);
});

void test("workflow copies: a deleted last line fails at the line now missing", async () => {
  const lines = gateLines();
  lines.pop();
  assertDiffersAt(await checkWithGate(lines.join("")), gateLines().length);
});

void test("workflow copies: a missing or extra final newline fails", async () => {
  const lines = gateLines().length;
  assertDiffersAt(await checkWithGate(gateWorkflow().slice(0, -1)), lines);
  assertDiffersAt(await checkWithGate(`${gateWorkflow()}\n`), lines + 1);
});

void test("workflow copies: a whitespace-only edit fails", async () => {
  const lines = gateLines();
  // A space before the line's newline.
  lines[5] = `${lines[5]?.slice(0, -1) ?? ""} \n`;
  assertDiffersAt(await checkWithGate(lines.join("")), 6);
  assertDiffersAt(await checkWithGate(` ${gateWorkflow()}`), 1);
});

void test("workflow copies: both files wrong are both named", async () => {
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    fs: createFakeFs({ [`/repo/${PR_TITLE_WORKFLOW_PATH}`]: "edited\n" }),
    stderr,
  });
  const outcome = await runWorkflowCopiesCheck(ctx);
  assert.equal(outcome.status, "failed");
  assert.equal(
    outcome.detail,
    `${GATE_WORKFLOW_PATH} missing, ${PR_TITLE_WORKFLOW_PATH} differs at line 1`,
  );
  const text = stderr.lines.join("");
  assert.match(text, /temple-bar-gate\.yml is missing/);
  assert.match(text, /temple-bar-pr-title\.yml differs from the copy/);
});
