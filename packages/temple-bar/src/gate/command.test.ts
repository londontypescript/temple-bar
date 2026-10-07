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
import { DEFAULT_MAX_FILE_LINES } from "./lengths.ts";
import {
  CORE_SCRIPTS,
  coreFiles,
  withCoreGit,
} from "./testing/core-fixture.ts";

function registryWithGate(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register(gateCommand);
  return registry;
}

const SMALL_FILE = "one\ntwo\nthree\n";

const ALL_SCRIPTS = {
  typecheck: "tsc",
  lint: "eslint .",
  "format:check": "prettier --check .",
  test: "node --test",
};

function codeProject(
  scripts: Record<string, string>,
  exitCodeFor: (script: string | undefined) => number = () => 0,
): {
  ctx: ReturnType<typeof createFakeContext>;
  proc: ReturnType<typeof createFakeProc>;
  stdout: FakeWriter;
  stderr: FakeWriter;
} {
  const git = createFakeGit(
    withCoreGit(() => ({
      code: 0,
      stdout: "package.json\nsrc/index.ts\n",
      stderr: "",
    })),
  );
  const proc = createFakeProc((call) => exitCodeFor(call.args[1]));
  const fs = createFakeFs({
    ...coreFiles(),
    "/repo/package.json": JSON.stringify({
      scripts: { ...CORE_SCRIPTS, ...scripts },
    }),
    "/repo/src/index.ts": SMALL_FILE,
  });
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const ctx = createFakeContext({ git, proc, fs, stdout, stderr });
  return { ctx, proc, stdout, stderr };
}

void test("gate: a passing project (stack + length cap both pass) exits 0", async () => {
  const git = createFakeGit(
    withCoreGit(() => ({
      code: 0,
      stdout: "package.json\nsrc/index.ts\n",
      stderr: "",
    })),
  );
  const proc = createFakeProc(() => 0);
  const fs = createFakeFs({
    ...coreFiles(),
    "/repo/package.json": JSON.stringify({
      scripts: { ...CORE_SCRIPTS, ...ALL_SCRIPTS },
    }),
    "/repo/src/index.ts": SMALL_FILE,
  });
  const ctx = createFakeContext({ git, proc, fs });

  const code = await route(["gate"], ctx, registryWithGate());

  assert.equal(code, 0);
  assert.equal(proc.calls.length, 4);
});

void test("gate: a failing test script exits 1, but the other scripts still run", async () => {
  const git = createFakeGit(
    withCoreGit(() => ({
      code: 0,
      stdout: "package.json\nsrc/index.ts\n",
      stderr: "",
    })),
  );
  const proc = createFakeProc((call) => (call.args[1] === "test" ? 1 : 0));
  const fs = createFakeFs({
    ...coreFiles(),
    "/repo/package.json": JSON.stringify({
      scripts: { ...CORE_SCRIPTS, ...ALL_SCRIPTS },
    }),
    "/repo/src/index.ts": SMALL_FILE,
  });
  const ctx = createFakeContext({ git, proc, fs });

  const code = await route(["gate"], ctx, registryWithGate());

  assert.equal(code, 1);
  assert.deepEqual(
    proc.calls.map((c) => c.args[1]),
    ["typecheck", "lint", "format:check", "test"],
  );
});

void test("gate: content exists but package.json has no scripts exits 2, naming every required script", async () => {
  const git = createFakeGit(
    withCoreGit(() => ({
      code: 0,
      stdout: "package.json\nsrc/index.ts\n",
      stderr: "",
    })),
  );
  const proc = createFakeProc();
  const fs = createFakeFs({
    ...coreFiles(),
    "/repo/package.json": JSON.stringify({ scripts: CORE_SCRIPTS }),
    "/repo/src/index.ts": SMALL_FILE,
  });
  const ctx = createFakeContext({ git, proc, fs });

  const code = await route(["gate"], ctx, registryWithGate());

  assert.equal(code, 2);
  assert.equal(proc.calls.length, 0, "no script exists, so none is run");
  const text = (ctx.stderr as FakeWriter).lines.join("");
  assert.match(
    text,
    /missing script\(s\): typecheck, lint, format:check, test\n/,
  );
});

void test("gate: format:check is required: a project without it exits 2, and the scripts it has still run", async () => {
  const { typecheck, lint, test: testScript } = ALL_SCRIPTS;
  const { ctx, proc, stderr } = codeProject({
    typecheck,
    lint,
    test: testScript,
  });

  const code = await route(["gate"], ctx, registryWithGate());

  assert.equal(code, 2);
  assert.deepEqual(
    proc.calls.map((c) => c.args[1]),
    ["typecheck", "lint", "test"],
  );
  const text = stderr.lines.join("");
  assert.match(text, /missing script\(s\): format:check\n/);
  assert.match(
    text,
    /add "format:check" to "scripts" in package\.json: a command that checks the project's formatting/,
  );
  assert.match(text, /^ {2}passed {3}typecheck$/m);
  assert.match(text, /^ {2}missing {2}format:check \(not in package\.json\)$/m);
  assert.match(text, /^gate: failed: format:check$/m);
});

void test("gate: a pass lists every check that ran, each passed, on stdout", async () => {
  const { ctx, stdout, stderr } = codeProject(ALL_SCRIPTS);

  const code = await route(["gate"], ctx, registryWithGate());

  assert.equal(code, 0);
  assert.equal(stderr.lines.join(""), "");
  assert.equal(
    stdout.lines.join(""),
    [
      "gate: checks:",
      "  passed   typecheck",
      "  passed   lint",
      "  passed   format:check",
      "  passed   test",
      "  passed   core setup (5 hooks unchanged, git config, .gitignore, package.json scripts)",
      "  passed   gate and title workflows (2 exact copies)",
      `  passed   file-length cap (all 2 tracked text file(s) are within the ${String(DEFAULT_MAX_FILE_LINES)}-line cap)`,
      "  skipped  AGENTS.md size (no AGENTS.md)",
      "  skipped  markdown lint (no markdown files)",
      "  skipped  local links (no markdown files)",
      "  passed   unused code (knip)",
      "  skipped  branch ruleset (origin is not on GitHub)",
      "  skipped  judge ruleset (origin is not on GitHub)",
      "  skipped  code scanning rule (origin is not on GitHub)",
      "gate: passed",
      "",
    ].join("\n"),
  );
});

void test("gate: a failure lists every check the same way, on stderr, and names what failed", async () => {
  const { ctx, stdout, stderr } = codeProject(ALL_SCRIPTS, (script) =>
    script === "lint" || script === "test" ? 1 : 0,
  );

  const code = await route(["gate"], ctx, registryWithGate());

  assert.equal(code, 1);
  assert.equal(stdout.lines.join(""), "");
  const text = stderr.lines.join("");
  assert.match(text, /^ {2}passed {3}typecheck$/m);
  assert.match(text, /^ {2}failed {3}lint \(exit 1\)$/m);
  assert.match(text, /^ {2}passed {3}format:check$/m);
  assert.match(text, /^ {2}failed {3}test \(exit 1\)$/m);
  assert.match(text, /^ {2}passed {3}file-length cap /m);
  assert.match(text, /^gate: failed: lint, test$/m);
});

void test("gate: a repo with only its starting files and setup's scripts passes on the base checks alone", async () => {
  const git = createFakeGit(
    withCoreGit(() => ({
      code: 0,
      stdout: "README.md\nLICENSE\nAGENTS.md\n.gitignore\npackage.json\n",
      stderr: "",
    })),
  );
  const proc = createFakeProc();
  const fs = createFakeFs({
    ...coreFiles(),
    "/repo/package.json": JSON.stringify({ scripts: CORE_SCRIPTS }),
    "/repo/README.md": SMALL_FILE,
    "/repo/LICENSE": SMALL_FILE,
    "/repo/AGENTS.md": SMALL_FILE,
  });
  const ctx = createFakeContext({ git, proc, fs });

  const code = await route(["gate"], ctx, registryWithGate());

  assert.equal(code, 0);
  assert.equal(proc.calls.length, 0);
});

void test("gate: the length cap fails the gate even when the stack checks pass", async () => {
  const git = createFakeGit(
    withCoreGit(() => ({
      code: 0,
      stdout: "package.json\nsrc/index.ts\n",
      stderr: "",
    })),
  );
  const proc = createFakeProc(() => 0);
  const fs = createFakeFs({
    ...coreFiles(),
    "/repo/temple-bar.config.json": JSON.stringify({ maxFileLines: 2 }),
    "/repo/package.json": JSON.stringify({
      scripts: { ...CORE_SCRIPTS, ...ALL_SCRIPTS },
    }),
    "/repo/src/index.ts": "1\n2\n3\n",
  });
  const ctx = createFakeContext({ git, proc, fs });

  const code = await route(["gate"], ctx, registryWithGate());

  assert.equal(code, 1);
  assert.match((ctx.stderr as FakeWriter).lines.join(""), /src\/index\.ts/);
});

void test("gate: a nested worktree's own code doesn't make the scripts required or trip the length cap", async () => {
  const git = createFakeGit(
    withCoreGit(() => ({
      code: 0,
      stdout: "README.md\nnested-worktree/\n",
      stderr: "",
    })),
  );
  const proc = createFakeProc();
  const fs = createFakeFs({
    ...coreFiles(),
    "/repo/package.json": JSON.stringify({ scripts: CORE_SCRIPTS }),
    "/repo/README.md": SMALL_FILE,
  });
  const ctx = createFakeContext({ git, proc, fs });

  const code = await route(["gate"], ctx, registryWithGate());

  assert.equal(code, 0);
  assert.equal(proc.calls.length, 0);
});

void test("gate: a failed git listing exits 1 with a message, never a silent pass", async () => {
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    git: createFakeGit(() => ({
      code: 128,
      stdout: "",
      stderr: "fatal: not a git repository",
    })),
    stderr,
  });
  assert.equal(await gateCommand.run([], ctx), 1);
  assert.match(stderr.lines.join(""), /not a git repository/);
});
