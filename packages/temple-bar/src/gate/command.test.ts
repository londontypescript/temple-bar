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
import { gateCommand } from "./command.ts";

function registryWithGate(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register(gateCommand);
  return registry;
}

const SMALL_FILE = "one\ntwo\nthree\n";

void test("gate: a passing project (stack + length cap both pass) exits 0", async () => {
  const git = createFakeGit(() => ({
    code: 0,
    stdout: "package.json\nsrc/index.ts\n",
    stderr: "",
  }));
  const proc = createFakeProc(() => 0);
  const fs = createFakeFs({
    "/repo/package.json": JSON.stringify({
      scripts: { typecheck: "tsc", lint: "eslint .", test: "node --test" },
    }),
    "/repo/src/index.ts": SMALL_FILE,
  });
  const ctx = createFakeContext({ git, proc, fs });

  const code = await route(["gate"], ctx, registryWithGate());

  assert.equal(code, 0);
  assert.equal(proc.calls.length, 3);
});

void test("gate: a failing test script exits 1, but typecheck and lint still run", async () => {
  const git = createFakeGit(() => ({
    code: 0,
    stdout: "package.json\nsrc/index.ts\n",
    stderr: "",
  }));
  const proc = createFakeProc((call) => (call.args[1] === "test" ? 1 : 0));
  const fs = createFakeFs({
    "/repo/package.json": JSON.stringify({
      scripts: { typecheck: "tsc", lint: "eslint .", test: "node --test" },
    }),
    "/repo/src/index.ts": SMALL_FILE,
  });
  const ctx = createFakeContext({ git, proc, fs });

  const code = await route(["gate"], ctx, registryWithGate());

  assert.equal(code, 1);
  assert.deepEqual(
    proc.calls.map((c) => c.args[1]),
    ["typecheck", "lint", "test"],
  );
});

void test("gate: code exists but package.json has no scripts exits 2, naming all three", async () => {
  const git = createFakeGit(() => ({
    code: 0,
    stdout: "package.json\nsrc/index.ts\n",
    stderr: "",
  }));
  const proc = createFakeProc();
  const fs = createFakeFs({
    "/repo/package.json": JSON.stringify({}),
    "/repo/src/index.ts": SMALL_FILE,
  });
  const ctx = createFakeContext({ git, proc, fs });

  const code = await route(["gate"], ctx, registryWithGate());

  assert.equal(code, 2);
  assert.equal(proc.calls.length, 0, "missing scripts: nothing is run");
  const text = (ctx.stderr as FakeWriter).lines.join("");
  assert.match(text, /typecheck/);
  assert.match(text, /lint/);
  assert.match(text, /test/);
});

void test("gate: a docs-only project with no package.json and no code passes on the base check alone", async () => {
  const git = createFakeGit(() => ({
    code: 0,
    stdout: "README.md\ndocs/plan.md\n",
    stderr: "",
  }));
  const proc = createFakeProc();
  const fs = createFakeFs({
    "/repo/README.md": SMALL_FILE,
    "/repo/docs/plan.md": SMALL_FILE,
  });
  const ctx = createFakeContext({ git, proc, fs });

  const code = await route(["gate"], ctx, registryWithGate());

  assert.equal(code, 0);
  assert.equal(proc.calls.length, 0);
});

void test("gate: the length cap fails the gate even when the stack checks pass", async () => {
  const git = createFakeGit(() => ({
    code: 0,
    stdout: "package.json\nsrc/index.ts\n",
    stderr: "",
  }));
  const proc = createFakeProc(() => 0);
  const fs = createFakeFs({
    "/repo/temple-bar.config.json": JSON.stringify({ maxFileLines: 2 }),
    "/repo/package.json": JSON.stringify({
      scripts: { typecheck: "tsc", lint: "eslint .", test: "node --test" },
    }),
    "/repo/src/index.ts": "1\n2\n3\n",
  });
  const ctx = createFakeContext({ git, proc, fs });

  const code = await route(["gate"], ctx, registryWithGate());

  assert.equal(code, 1);
  assert.match((ctx.stderr as FakeWriter).lines.join(""), /src\/index\.ts/);
});

void test("gate: a nested worktree's own code doesn't trip codeExists or the length cap (P3.7)", async () => {
  const git = createFakeGit(() => ({
    code: 0,
    stdout: "README.md\nnested-worktree/\n",
    stderr: "",
  }));
  const proc = createFakeProc();
  const fs = createFakeFs({ "/repo/README.md": SMALL_FILE });
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
