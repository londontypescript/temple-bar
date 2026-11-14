// The test-shapes check through the gate command: the whole gate and
// `gate --part repo` fail a test file the check refuses or can't read,
// each with its own message, list the outcome in their reports, and pass
// once the file is fixed.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  ACTIONS_ENV,
  createFakePartFiles,
  partArgs,
  readReport,
  runGate,
  withHead,
} from "./testing/parts-fixture.ts";
import { workspace } from "./testing/workspace-fixture.ts";

const TEST_FILE = "packages/a/src/view.test.ts";
const NAME = "regex shapes in tests";
const ONE_FINDING = "1 finding(s) in 1 test file(s)";

/** Runs the gate with `args` in a workspace whose one test file holds
 * `text`. A read error isn't a case here: the length cap reads every
 * listed file before this check, so the gate's own error handling meets it
 * first; the check's handling of one is tested on its own. */
async function runWithTestFile(text: string, args: readonly string[]) {
  const absolute = path.join("/repo", ...TEST_FILE.split("/"));
  const made = workspace({
    env: ACTIONS_ENV,
    extraTracked: [TEST_FILE],
    untracked: { [absolute]: text },
  });
  const ctx = withHead(made.ctx);
  const files = createFakePartFiles();
  const code = await runGate(ctx, files, args);
  return { ...made, files, code };
}

const doubling = ["const a0 = '<b>';"];
for (let index = 1; index <= 20; index++) {
  doubling.push(
    `const a${String(index)} = a${String(index - 1)} + a${String(index - 1)};`,
  );
}
doubling.push("html.replace(new RegExp(a20), '');");

const CASES: readonly {
  readonly label: string;
  readonly text: string;
  readonly line: RegExp;
  readonly detail: string;
}[] = [
  {
    label: "deletes markup tags",
    text: "const text = html.replace(/<[^>]+>/g, '');\n",
    line: /^ {2}packages\/a: src\/view\.test\.ts:1: a regular expression deletes markup tags$/m,
    detail: ONE_FINDING,
  },
  {
    label: "doesn't parse",
    text: "const x = ;\n",
    line: /^ {2}packages\/a: src\/view\.test\.ts:1: the file can't be read \(.+\)$/m,
    detail: ONE_FINDING,
  },
  {
    label: "is binary",
    text: "a\0b",
    line: /^ {2}packages\/a: src\/view\.test\.ts: the file can't be read as text$/m,
    detail: ONE_FINDING,
  },
  {
    label: "holds a value past the work budget",
    text: doubling.join("\n"),
    line: /^ {2}packages\/a: src\/view\.test\.ts:22: a value here is too complex for the check to read$/m,
    detail: ONE_FINDING,
  },
];

for (const { label, text, line, detail } of CASES) {
  void test(`the whole gate and gate --part repo fail a test file that ${label}, each reporting it`, async () => {
    const whole = await runWithTestFile(text, []);
    assert.equal(whole.code, 1);
    const output = whole.stdout.lines.join("") + whole.stderr.lines.join("");
    assert.match(whole.stderr.lines.join(""), line);
    assert.ok(
      output.includes(`failed   ${NAME} (${detail})`),
      `the closing report lists the outcome:\n${output}`,
    );

    const part = await runWithTestFile(text, partArgs("repo", "repo.json"));
    assert.equal(part.code, 1);
    const report = readReport(part.files, "repo.json");
    assert.equal(report.exitCode, 1);
    assert.deepEqual(
      report.outcomes.find((each) => each.name === NAME),
      { name: NAME, status: "failed", detail },
    );
  });
}

void test("the whole gate and gate --part repo pass the same test file once it is fixed", async () => {
  const fixed = "const text = html.replace(/</g, '&lt;');\n";
  assert.equal((await runWithTestFile(fixed, [])).code, 0);
  const part = await runWithTestFile(fixed, partArgs("repo", "repo.json"));
  assert.equal(part.code, 0);
  assert.deepEqual(
    readReport(part.files, "repo.json").outcomes.find(
      (each) => each.name === NAME,
    ),
    { name: NAME, status: "passed", detail: "1 test file(s) read" },
  );
});
