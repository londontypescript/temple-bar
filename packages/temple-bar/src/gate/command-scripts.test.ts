// The gate's handling of required scripts that are missing or do nothing:
// every script that exists and does something still runs, and the gate
// fails (exit 2) on the gaps, saying what belongs there instead.

import assert from "node:assert/strict";
import test from "node:test";

import { route } from "../router.ts";
import { CommandRegistry } from "../registry.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
  createFakeProc,
  createFakeWriter,
  type FakeWriter,
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

function project(
  files: readonly string[],
  scripts: Record<string, string> | undefined,
  exitCodeFor: (script: string | undefined) => number = () => 0,
): {
  run: () => Promise<number>;
  proc: ReturnType<typeof createFakeProc>;
  stderr: FakeWriter;
} {
  const git = createFakeGit(
    withCoreGit(() => ({
      code: 0,
      stdout: `${files.join("\n")}\n`,
      stderr: "",
    })),
  );
  const proc = createFakeProc((call) => exitCodeFor(call.args[1]));
  const contents: Record<string, string> = coreFiles();
  for (const file of files) {
    contents[`/repo/${file}`] = "one\n";
  }
  if (scripts !== undefined) {
    contents["/repo/package.json"] = JSON.stringify({
      scripts: { ...CORE_SCRIPTS, ...scripts },
    });
  }
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    git,
    proc,
    fs: createFakeFs(contents),
    stderr,
  });
  const registry = new CommandRegistry();
  registry.register(gateCommand);
  return { run: () => route(["gate"], ctx, registry), proc, stderr };
}

function ran(proc: ReturnType<typeof createFakeProc>): (string | undefined)[] {
  return proc.calls.map((call) => call.args[1]);
}

/** The gate's own explanation, without the closing report. */
function messageBeforeReport(stderr: FakeWriter): string {
  const text = stderr.lines.join("");
  return text.slice(0, text.indexOf("gate: checks:"));
}

void test("gate: a Rust project with no scripts is not waved through as 'no code yet'", async () => {
  const { run, proc, stderr } = project(
    ["package.json", "AGENTS.md", ".gitignore", "Cargo.toml", "src/main.rs"],
    {},
  );

  assert.equal(await run(), 2);
  assert.equal(proc.calls.length, 0);
  const text = stderr.lines.join("");
  assert.match(
    text,
    /missing script\(s\): typecheck, lint, format:check, test\n/,
  );
  assert.doesNotMatch(text, /skipped +typecheck/);
});

void test("gate: one missing script doesn't stop the others running, and their failures are reported too", async () => {
  const { lint } = ALL_SCRIPTS;
  const { run, proc, stderr } = project(
    ["package.json", "src/index.ts"],
    { lint },
    (script) => (script === "lint" ? 1 : 0),
  );

  assert.equal(await run(), 2, "a missing script takes priority over exit 1");
  assert.deepEqual(ran(proc), ["lint"]);
  const text = stderr.lines.join("");
  assert.match(text, /missing script\(s\): typecheck, format:check, test\n/);
  assert.match(text, /^ {2}missing {2}typecheck \(not in package\.json\)$/m);
  assert.match(text, /^ {2}failed {3}lint \(exit 1\)$/m);
  assert.match(text, /^gate: failed: typecheck, lint, format:check, test$/m);
});

void test("gate: a script that does nothing is not run, and fails with what to put there", async () => {
  const { run, proc, stderr } = project(["package.json", "src/index.ts"], {
    ...ALL_SCRIPTS,
    lint: "echo ok",
    test: "",
  });

  assert.equal(await run(), 2);
  assert.deepEqual(ran(proc), ["typecheck", "format:check"]);
  const text = stderr.lines.join("");
  assert.match(text, /script\(s\) that check nothing: lint, test\n/);
  assert.match(
    text,
    /"lint" is "echo ok": replace it with a command that runs the project's linter/,
  );
  assert.match(
    text,
    /"test" is "": replace it with a command that runs the project's tests/,
  );
  assert.match(text, /^ {2}no-op {4}lint \("echo ok"\)$/m);
  assert.match(text, /^ {2}passed {3}typecheck$/m);
  assert.match(text, /^gate: failed: lint, test$/m);
});

void test("gate: the messages for missing and no-op scripts only say what belongs there", async () => {
  const { run, stderr } = project(["package.json", "src/index.ts"], {
    typecheck: "true",
  });

  assert.equal(await run(), 2);
  const message = messageBeforeReport(stderr);
  assert.match(message, /typecheck/);
  assert.match(message, /lint/);
  assert.doesNotMatch(
    message,
    /remove|delete|skip|ignore|disable|--no-verify|temple-bar\.config/i,
  );
});

void test("gate: a no-op script fails even before the repo has content of its own", async () => {
  const { run, proc } = project(["package.json", "README.md"], {
    ...ALL_SCRIPTS,
    test: "exit 0",
  });

  assert.equal(await run(), 2);
  assert.deepEqual(ran(proc), ["typecheck", "lint", "format:check"]);
});

void test("gate: real commands next to an echo still run and pass", async () => {
  const { run, proc } = project(["package.json", "src/index.ts"], {
    ...ALL_SCRIPTS,
    test: "echo running tests && node --test",
  });

  assert.equal(await run(), 0);
  assert.equal(proc.calls.length, 4);
});
