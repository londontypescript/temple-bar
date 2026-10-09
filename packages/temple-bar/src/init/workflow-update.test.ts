import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { CHECKED_WORKFLOWS } from "./workflows.ts";
import { writeWorkflows } from "./workflow-update.ts";
import { JUDGE_WORKFLOW_PATH, judgeWorkflow } from "../judge/workflow.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
} from "../testing/fakes.ts";
import {
  PUBLISHED_OUTPUTS,
  publishedOutput,
  outputFromRelease,
} from "../testing/published-output.ts";

const workflows = [
  { path: JUDGE_WORKFLOW_PATH, content: judgeWorkflow() },
  ...CHECKED_WORKFLOWS,
];
const currentFiles = () =>
  Object.fromEntries(
    workflows.map((workflow) => [`/repo/${workflow.path}`, workflow.content]),
  );

for (const output of PUBLISHED_OUTPUTS.filter((output) =>
  output.item.startsWith(".github/"),
)) {
  for (const crlf of [false, true]) {
    void test(`workflow upgrade: genuine ${output.item} from ${output.releases.join(", ")} with ${crlf ? "CRLF" : "LF"}`, async () => {
      const old = publishedOutput(output);
      const found = crlf ? old.replaceAll("\n", "\r\n") : old;
      const file = `/repo/${output.item}`;
      const fs = createFakeFs({ ...currentFiles(), [file]: found });
      const outcomes = await writeWorkflows(createFakeContext({ fs }), "/repo");
      const outcome = outcomes.find(
        (outcome) => outcome.workflow.path === output.item,
      );
      assert.ok(outcome);
      assert.equal(outcome.state.kind, "exact");
      const expected = outcome.workflow.content;
      assert.equal(
        fs.files.get(file),
        old === expected ? found : expected,
        "recognized old workflow was not upgraded",
      );
      assert.equal(outcome.upgraded, old !== expected);
      const writes = fs.writes.length;
      await writeWorkflows(createFakeContext({ fs }), "/repo");
      assert.equal(fs.writes.length, writes, "rerun writes nothing");
    });
  }
}

void test("workflow upgrade: edited, unknown future, whitespace and final-newline differences are preserved for all three workflows", async () => {
  for (const workflow of workflows) {
    const published = outputFromRelease(
      workflow.path,
      workflow.path === JUDGE_WORKFLOW_PATH ? "0.0.7" : "0.0.9",
    );
    for (const changed of [
      `${published}# our edit\n`,
      `${workflow.content}# future template\n`,
      published.slice(0, -1),
      `${published} `,
      published.replaceAll("\n", "\r"),
    ]) {
      const file = `/repo/${workflow.path}`;
      const fs = createFakeFs({ ...currentFiles(), [file]: changed });
      const outcomes = await writeWorkflows(createFakeContext({ fs }), "/repo");
      const outcome = outcomes.find(
        (outcome) => outcome.workflow.path === workflow.path,
      );
      assert.ok(outcome);
      assert.equal(outcome.state.kind, "differs");
      assert.equal(outcome.wrote, false);
      assert.equal(
        fs.files.get(file),
        changed,
        "unknown workflow must not be downgraded or overwritten",
      );
      assert.deepEqual(fs.writes, []);
    }
  }
});

void test("workflow upgrade: missing files are created and all existing current files are unchanged", async () => {
  const fs = createFakeFs();
  const ctx = createFakeContext({ fs });
  const first = await writeWorkflows(ctx, "/repo");
  assert.equal(first.length, 3);
  assert.ok(
    first.every(
      (outcome) =>
        outcome.wrote && !outcome.upgraded && outcome.state.kind === "exact",
    ),
  );
  const second = await writeWorkflows(ctx, "/repo");
  assert.ok(
    second.every((outcome) => !outcome.wrote && outcome.state.kind === "exact"),
  );
  assert.equal(fs.writes.length, 3);
});

void test("workflow upgrade: known older judge behind a symlink or linked ancestor never writes through", async () => {
  for (const linked of [JUDGE_WORKFLOW_PATH, ".github", ".github/workflows"]) {
    const old = outputFromRelease(JUDGE_WORKFLOW_PATH, "0.0.7");
    const fs = createFakeFs({ ...currentFiles(), "/outside/judge": old });
    fs.linkTargets.set(
      `/repo/${linked}`,
      linked === JUDGE_WORKFLOW_PATH ? "/outside/judge" : "/outside",
    );
    const outcome = (
      await writeWorkflows(createFakeContext({ fs }), "/repo")
    )[0];
    assert.equal(outcome?.state.kind, "not-a-file");
    assert.equal(outcome.wrote, false);
    assert.equal(fs.files.get("/outside/judge"), old);
    assert.deepEqual(fs.writes, []);
  }
});

void test("workflow upgrade: recognized old bytes are reclassified immediately before writing", async () => {
  const file = `/repo/${JUDGE_WORKFLOW_PATH}`;
  const old = outputFromRelease(JUDGE_WORKFLOW_PATH, "0.0.7");
  const fs = createFakeFs({
    ...currentFiles(),
    [file]: old,
    "/outside/judge": old,
  });
  const classify = fs.classify.bind(fs);
  let probes = 0;
  fs.classify = (candidate) => {
    if (candidate === path.normalize(file) && ++probes === 2)
      fs.linkTargets.set(candidate, "/outside/judge");
    return classify(candidate);
  };
  const outcomes = await writeWorkflows(createFakeContext({ fs }), "/repo");
  assert.equal(outcomes[0]?.wrote, false);
  assert.equal(fs.files.get("/outside/judge"), old);
  assert.deepEqual(fs.writes, []);
});

void test("workflow upgrade: recognized old judge with unresolved index stages is refused", async () => {
  const old = outputFromRelease(JUDGE_WORKFLOW_PATH, "0.0.7");
  const fs = createFakeFs({
    ...currentFiles(),
    [`/repo/${JUDGE_WORKFLOW_PATH}`]: old,
  });
  const git = createFakeGit(() => ({
    code: 0,
    stdout:
      `100644 aaaa 1\t${JUDGE_WORKFLOW_PATH}\0` +
      `100644 bbbb 2\t${JUDGE_WORKFLOW_PATH}\0`,
    stderr: "",
  }));
  const outcome = (
    await writeWorkflows(createFakeContext({ fs, git }), "/repo")
  )[0];
  assert.equal(outcome?.state.kind, "not-a-file");
  assert.equal(outcome.wrote, false);
  assert.equal(fs.files.get(`/repo/${JUDGE_WORKFLOW_PATH}`), old);
  assert.deepEqual(fs.writes, []);
});
