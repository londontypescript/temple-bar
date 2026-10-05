// The markdown checks with the real markdownlint and real repos, run
// through the whole gate: a lint error or a broken local link fails it,
// and the fixed file passes.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { COMPANION_FILES } from "../init/companion-docs.ts";
import { initTestRepo } from "../testing/git-repo.ts";
import { createGateCommand } from "./command.ts";
import { installCore } from "./testing/core-fixture.ts";
import { realContext } from "./testing/real-repo.ts";
import { createRealGateTools } from "./tools.ts";

const gate = createGateCommand(createRealGateTools());

async function runGate(dir: string) {
  const { ctx, stdout, stderr } = realContext(dir);
  const code = await gate.run([], ctx);
  return { code, out: stdout.lines.join(""), err: stderr.lines.join("") };
}

async function docsRepo(
  files: Record<string, string>,
): Promise<{ dir: string; write: (name: string, text: string) => void }> {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-md-"));
  initTestRepo(dir);
  const write = (name: string, text: string): void => {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
    execFileSync("git", ["add", "-A"], { cwd: dir });
  };
  // Docs are content of the repo's own, so the four scripts are required;
  // these pass, leaving the markdown checks to decide the result.
  const passes = 'node -e ""';
  write(
    "package.json",
    JSON.stringify({
      name: "docs",
      scripts: {
        typecheck: passes,
        lint: passes,
        "format:check": passes,
        test: passes,
      },
    }),
  );
  for (const [name, text] of Object.entries(files)) {
    write(name, text);
  }
  await installCore(dir);
  return { dir, write };
}

const COMPANION_MARKDOWN = COMPANION_FILES.filter((file) =>
  file.path.endsWith(".md"),
).length;

const LONG_LINE = `${"word ".repeat(40)}end\n`;

void test("markdown e2e: setup's own files and a long-lined README pass both checks", async () => {
  const { dir } = await docsRepo({
    "README.md": `# Sample\n\n${LONG_LINE}\nSee [the guide](docs/guide.md) and \`docs/guide.md\`.\n`,
    "docs/guide.md": "# Guide\n\nText.\n",
  });
  try {
    const result = await runGate(dir);
    assert.equal(result.code, 0, result.err);
    // The README, the guide, and every markdown file setup writes.
    const count = String(3 + COMPANION_MARKDOWN);
    assert.match(
      result.out,
      new RegExp(
        `^ {2}passed {3}markdown lint \\(${count} markdown file\\(s\\)\\)$`,
        "m",
      ),
    );
    assert.match(
      result.out,
      new RegExp(
        `^ {2}passed {3}local links \\(${count} markdown file\\(s\\)\\)$`,
        "m",
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("markdown e2e: a lint error fails the gate, and the fixed file passes", async () => {
  const { dir, write } = await docsRepo({
    "README.md": "# Sample\n\n### Skipped a level\n",
  });
  try {
    const failing = await runGate(dir);
    assert.equal(failing.code, 1);
    assert.match(failing.err, /README\.md:3.* MD001/);
    assert.match(failing.err, /^ {2}failed {3}markdown lint \(lint errors\)$/m);
    assert.match(failing.err, /fix each one in the file it names/);

    write("README.md", "# Sample\n\n## One level down\n");
    assert.equal((await runGate(dir)).code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("markdown e2e: Next.js's one-line CLAUDE.md passes straight after setup", async () => {
  // Without setup's heading, markdown lint fails it (first-line-heading).
  const { dir } = await docsRepo({ "CLAUDE.md": "@AGENTS.md\n" });
  try {
    const result = await runGate(dir);
    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /^ {2}passed {3}markdown lint /m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("markdown e2e: a project's own markdownlint config replaces the default", async () => {
  const { dir } = await docsRepo({
    "README.md": "# Sample\n\n### Skipped a level\n",
    ".markdownlint.jsonc":
      '{\n  // off for this project\n  "heading-increment": false,\n}\n',
  });
  try {
    const result = await runGate(dir);
    assert.equal(result.code, 0, result.err);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("markdown e2e: a broken local link fails the gate, and the fixed link passes", async () => {
  const { dir, write } = await docsRepo({
    "README.md": "# Sample\n\nRead [the guide](docs/guide.md).\n",
  });
  try {
    const failing = await runGate(dir);
    assert.equal(failing.code, 1);
    assert.match(failing.err, /^ {2}README\.md:3: link docs\/guide\.md$/m);
    assert.match(failing.err, /^ {2}failed {3}local links \(1 broken\)$/m);

    write("docs/guide.md", "# Guide\n");
    assert.equal((await runGate(dir)).code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
