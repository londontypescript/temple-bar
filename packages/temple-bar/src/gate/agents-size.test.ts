import assert from "node:assert/strict";
import test from "node:test";

import { route } from "../router.ts";
import { CommandRegistry } from "../registry.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
  type FakeWriter,
} from "../testing/fakes.ts";
import {
  AGENTS_MAX_BYTES,
  AGENTS_MAX_LINES,
  checkAgentsSize,
  measureAgentsFile,
} from "./agents-size.ts";
import { testGateCommand as gateCommand } from "./testing/fake-tools.ts";
import {
  CORE_SCRIPTS,
  coreFiles,
  withCoreGit,
} from "./testing/core-fixture.ts";

function linesOf(count: number): string {
  return `${Array.from({ length: count }, () => "x").join("\n")}\n`;
}

function gateWith(agents: string | undefined) {
  const registry = new CommandRegistry();
  registry.register(gateCommand);
  const files: Record<string, string> = {
    ...coreFiles(),
    "/repo/package.json": JSON.stringify({ scripts: CORE_SCRIPTS }),
    "/repo/README.md": "hi\n",
  };
  if (agents !== undefined) {
    files["/repo/AGENTS.md"] = agents;
  }
  const ctx = createFakeContext({
    git: createFakeGit(
      withCoreGit(() => ({ code: 0, stdout: "README.md\n", stderr: "" })),
    ),
    fs: createFakeFs(files),
  });
  return { ctx, registry };
}

void test("measureAgentsFile allows exactly the limits and refuses one past them", () => {
  const atLines = measureAgentsFile(linesOf(AGENTS_MAX_LINES));
  assert.equal(atLines.overLines, false);
  assert.equal(
    measureAgentsFile(linesOf(AGENTS_MAX_LINES + 1)).overLines,
    true,
  );

  const atBytes = measureAgentsFile("a".repeat(AGENTS_MAX_BYTES));
  assert.equal(atBytes.overBytes, false);
  assert.equal(
    measureAgentsFile("a".repeat(AGENTS_MAX_BYTES + 1)).overBytes,
    true,
  );
});

void test("measureAgentsFile counts bytes, not characters", () => {
  // Each "é" is two bytes, so this is 16385 characters but 32770 bytes.
  const result = measureAgentsFile("é".repeat(AGENTS_MAX_BYTES / 2 + 1));
  assert.equal(result.overBytes, true);
});

void test("checkAgentsSize reports a missing AGENTS.md as not found", async () => {
  const result = await checkAgentsSize(createFakeContext());
  assert.equal(result.found, false);
});

void test("gate: a 201-line AGENTS.md fails with the size message, and the trimmed file passes", async () => {
  const over = gateWith(linesOf(AGENTS_MAX_LINES + 1));
  assert.equal(await route(["gate"], over.ctx, over.registry), 1);
  const text = (over.ctx.stderr as FakeWriter).lines.join("");
  assert.match(text, /gate: AGENTS\.md is over its size limit:/);
  assert.match(text, /201 lines \(limit 200\)/);
  assert.match(text, /^gate: failed: AGENTS\.md size$/m);

  const trimmed = gateWith(linesOf(AGENTS_MAX_LINES));
  assert.equal(await route(["gate"], trimmed.ctx, trimmed.registry), 0);
  assert.match(
    (trimmed.ctx.stdout as FakeWriter).lines.join(""),
    /passed {3}AGENTS\.md size \(200\/200 lines/,
  );
});

void test("gate: an AGENTS.md over 32 KiB but under 200 lines fails on bytes", async () => {
  const wide = gateWith(`${"a".repeat(AGENTS_MAX_BYTES + 1)}\n`);
  assert.equal(await route(["gate"], wide.ctx, wide.registry), 1);
  const text = (wide.ctx.stderr as FakeWriter).lines.join("");
  assert.match(text, /bytes \(limit 32768, 32 KiB\)/);
  assert.doesNotMatch(text, /lines \(limit/);
});

void test("gate: a repo without AGENTS.md skips the size check and still passes", async () => {
  const none = gateWith(undefined);
  assert.equal(await route(["gate"], none.ctx, none.registry), 0);
  assert.match(
    (none.ctx.stdout as FakeWriter).lines.join(""),
    /skipped {2}AGENTS\.md size \(no AGENTS\.md\)/,
  );
});
