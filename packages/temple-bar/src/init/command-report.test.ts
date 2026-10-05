// What setup says about AGENTS.md and the files beside it: a refused block
// ends the run non-zero, an oversized file is a warning, and every file
// written or added to is named, and counted as something to commit.

import assert from "node:assert/strict";
import test from "node:test";

import { BLOCK_BEGIN, freshAgentsMd } from "./agents-template.ts";
import { COMPANION_FILES } from "./companion-docs.ts";
import { GATE_SCRIPT, GITIGNORE_LINES, PREPARE_SCRIPT } from "./files.ts";
import { judgeWorkflow } from "../judge/workflow.ts";
import { createFakeFs } from "../testing/fakes.ts";
import {
  makeFixture,
  runInitFor,
  unchangedReport,
} from "./testing/command-fixture.ts";
import { createInitCommand } from "./command.ts";

/** Everything a finished setup leaves, so only what a test changes is new. */
function setUpFiles(overrides: Record<string, string> = {}) {
  return createFakeFs({
    "/repo/AGENTS.md": freshAgentsMd(),
    ...Object.fromEntries(
      COMPANION_FILES.map((file) => [`/repo/${file.path}`, file.content]),
    ),
    "/repo/.gitignore": `${GITIGNORE_LINES.join("\n")}\n`,
    "/repo/.github/workflows/temple-bar-judge.yml": judgeWorkflow(),
    "/repo/package.json": JSON.stringify({
      name: "widgets",
      scripts: { prepare: PREPARE_SCRIPT, gate: GATE_SCRIPT },
    }),
    ...overrides,
  });
}

async function runWithHooksUnchanged(fs: ReturnType<typeof createFakeFs>) {
  const fixture = makeFixture({ fs });
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

void test("init report: a fresh repo names the companion files it wrote, and the next steps add them", async () => {
  const fixture = makeFixture({ fs: createFakeFs() });
  const code = await runInitFor(fixture);
  assert.equal(code, 0, fixture.stderr.lines.join(""));
  const out = fixture.stdout.lines.join("");
  assert.match(out, /Wrote temple-bar's rules into AGENTS\.md\./);
  assert.match(
    out,
    new RegExp(
      `Wrote the files AGENTS\\.md links to, where missing: ${COMPANION_FILES.map((file) => file.path.replaceAll(".", "\\.")).join(", ")}\\.`,
    ),
  );
  assert.match(out, /git add AGENTS\.md CLAUDE\.md docs\/ package\.json/);
});

void test("init report: an AGENTS.md block setup can't update goes to stderr and ends the run non-zero, after the rest of setup", async () => {
  const broken = `# Rules\n\n${BLOCK_BEGIN}\n\nNo end marker.\n`;
  const fs = setUpFiles({ "/repo/AGENTS.md": broken });
  const { code, stdout, stderr } = await runWithHooksUnchanged(fs);
  assert.equal(code, 1);
  assert.match(stderr, /1 BEGIN and 0 END lines/);
  assert.doesNotMatch(stdout, /AGENTS\.md/);
  assert.doesNotMatch(stdout, /temple-bar is set up/);
  assert.match(stdout, /Git hooks already installed/);
  assert.equal(fs.files.get("/repo/AGENTS.md"), broken);
});

void test("init report: an AGENTS.md over its size limit is a warning, and the run still succeeds", async () => {
  const own = `# Framework rules\n\n${"Use the router.\n".repeat(98)}`;
  const fs = setUpFiles({ "/repo/AGENTS.md": own });
  const { code, stdout, stderr } = await runWithHooksUnchanged(fs);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /Warning: AGENTS\.md is over its size limit/);
  assert.match(stdout, /temple-bar is set up/);
});

void test("init report: what was added to an existing CLAUDE.md is named, and counts as a change to land", async () => {
  const fs = setUpFiles({ "/repo/CLAUDE.md": "@AGENTS.md\n" });
  const { code, stdout } = await runWithHooksUnchanged(fs);
  assert.equal(code, 0);
  assert.match(stdout, /Added to CLAUDE\.md: a heading\./);
  assert.match(stdout, /Next: /);
});

void test("init report: a companion file written alone counts as a change to land", async () => {
  const fs = setUpFiles();
  fs.files.delete("/repo/docs/conventions.md");
  const { code, stdout } = await runWithHooksUnchanged(fs);
  assert.equal(code, 0);
  assert.match(
    stdout,
    /Wrote the files AGENTS\.md links to, where missing: docs\/conventions\.md\./,
  );
  assert.match(stdout, /Next: /);
});
