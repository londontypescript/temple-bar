import assert from "node:assert/strict";
import { normalize } from "node:path";
import test from "node:test";

import { addDevDependencyCommand } from "./package-manager.ts";
import {
  findWorkspaceResidue,
  parsePackageFolders,
  workspaceListFailedMessage,
  workspaceResidueMessage,
  type WorkspaceFiles,
} from "./workspace.ts";
import type { ProcessRunner, RunResult } from "./runner.ts";

void test("addDevDependencyCommand passes -w only at a workspace root", () => {
  assert.deepEqual(addDevDependencyCommand("1.2.3").args, [
    "add",
    "-D",
    "--save-exact",
    "@londontypescript/temple-bar@1.2.3",
  ]);
  assert.deepEqual(addDevDependencyCommand("1.2.3", true).args, [
    "add",
    "-Dw",
    "--save-exact",
    "@londontypescript/temple-bar@1.2.3",
  ]);
});

void test("parsePackageFolders returns each absolute path and rejects any other shape", () => {
  assert.deepEqual(
    parsePackageFolders(
      JSON.stringify([
        { name: "root", path: "/ws" },
        { path: "/ws/packages/a", private: false },
      ]),
    ),
    ["/ws", "/ws/packages/a"],
  );
  assert.deepEqual(parsePackageFolders("[]"), []);
  for (const bad of [
    "",
    "not json",
    "{}",
    "[1]",
    "[null]",
    '[{"name":"x"}]',
    '[{"path":3}]',
    '[{"path":"relative/dir"}]',
  ]) {
    assert.equal(parsePackageFolders(bad), undefined, bad);
  }
});

void test("the refusal messages say nothing changed and give the next step", () => {
  const residue = workspaceResidueMessage([
    "packages/a/pnpm-lock.yaml",
    "packages/b/yarn.lock",
  ]);
  assert.match(residue, /Nothing was changed/);
  assert.match(residue, /packages[/\\]a[/\\]pnpm-lock\.yaml|packages\/a/);
  assert.match(residue, /packages\/b\/yarn\.lock/);
  assert.match(residue, /Delete the files listed above/);
  assert.match(residue, /pnpm create @londontypescript\/temple-bar@latest/);
  const failed = workspaceListFailedMessage("pnpm exited with 1");
  assert.match(failed, /Nothing was changed/);
  assert.match(failed, /pnpm exited with 1/);
});

function fakeFiles(present: readonly string[]): WorkspaceFiles {
  const set = new Set(present.map((file) => normalize(file)));
  return {
    readText: (filePath) =>
      Promise.resolve(set.has(normalize(filePath)) ? "x" : undefined),
    realPath: (filePath) => Promise.resolve(filePath),
  };
}

function listing(result: RunResult): ProcessRunner {
  return () => Promise.resolve(result);
}

const list = (...folders: string[]): RunResult => ({
  code: 0,
  stdout: JSON.stringify(folders.map((folder) => ({ path: folder }))),
});
const options = { cwd: "/ws", env: {} };

void test("findWorkspaceResidue names every leftover kind in every package but ignores the root's own files", async () => {
  const result = await findWorkspaceResidue(
    "/ws",
    fakeFiles([
      "/ws/pnpm-lock.yaml",
      "/ws/pnpm-workspace.yaml",
      "/ws/packages/a/pnpm-lock.yaml",
      "/ws/packages/a/eslint.config.js",
      "/ws/packages/b/package-lock.json",
      "/ws/packages/b/yarn.lock",
      "/ws/packages/c/pnpm-workspace.yaml",
      "/ws/packages/d/AGENTS.md",
    ]),
    listing(
      list(
        "/ws",
        "/ws/packages/a",
        "/ws/packages/b",
        "/ws/packages/c",
        "/ws/packages/d",
      ),
    ),
    options,
  );
  assert.deepEqual(
    "found" in result ? result.found.map((file) => normalize(file)) : result,
    [
      "packages/a/pnpm-lock.yaml",
      "packages/b/package-lock.json",
      "packages/b/yarn.lock",
      "packages/c/pnpm-workspace.yaml",
    ].map((file) => normalize(file)),
  );
});

void test("findWorkspaceResidue asks pnpm to capture the listing", async () => {
  const seen: unknown[] = [];
  await findWorkspaceResidue(
    "/ws",
    fakeFiles([]),
    (command, args, opts) => {
      seen.push({ command, args, capture: opts.capture });
      return Promise.resolve(list("/ws"));
    },
    options,
  );
  assert.deepEqual(seen, [
    {
      command: "pnpm",
      args: ["list", "--recursive", "--depth", "-1", "--json"],
      capture: true,
    },
  ]);
});

void test("findWorkspaceResidue reports a failed or unreadable listing instead of guessing", async () => {
  for (const result of [
    { code: 1 },
    { code: null },
    { code: 0, stdout: "garbage" },
    { code: 0 },
  ]) {
    const outcome = await findWorkspaceResidue(
      "/ws",
      fakeFiles([]),
      listing(result),
      options,
    );
    assert.ok("failure" in outcome, JSON.stringify(result));
    assert.match(outcome.failure, /Nothing was changed/);
  }
});
