import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createWorktreeRemover,
  finishRemoval,
  type FolderState,
  type WorktreeRemover,
} from "./finish-removal.ts";

const FOLDER = path.resolve("/repo-wt/x");
const SAME: FolderState = {
  kind: "directory",
  identity: "1:2",
  entries: ["node_modules"],
};

/** A remover that answers `states` in turn and records each removal. */
function fakeRemover(
  states: readonly FolderState[],
  removeError?: Error,
): WorktreeRemover & { removed: string[] } {
  const queue = [...states];
  const removed: string[] = [];
  return {
    removed,
    inspect: () => Promise.resolve(queue.shift() ?? { kind: "missing" }),
    removeTree: (folder) => {
      removed.push(folder);
      return removeError === undefined
        ? Promise.resolve()
        : Promise.reject(removeError);
    },
  };
}

void test("a folder git removed completely needs nothing more", async () => {
  const remover = fakeRemover([{ kind: "missing" }]);
  assert.equal(await finishRemoval(remover, FOLDER, SAME, []), undefined);
  assert.deepEqual(remover.removed, []);
});

void test("a folder left holding only node_modules is removed and confirmed gone", async () => {
  const remover = fakeRemover([SAME, { kind: "missing" }]);
  assert.equal(await finishRemoval(remover, FOLDER, SAME, []), undefined);
  assert.deepEqual(remover.removed, [FOLDER]);
});

void test("anything but the same folder holding only node_modules is reported, never removed", async () => {
  const cases: [string, FolderState, FolderState, readonly string[], RegExp][] =
    [
      [
        "more than node_modules",
        { ...SAME, entries: ["node_modules", ".env"] },
        SAME,
        [],
        /holds more than node_modules/,
      ],
      [
        "a different folder",
        { ...SAME, identity: "9:9" },
        SAME,
        [],
        /not the folder git was asked to remove/,
      ],
      [
        "a link where the folder was",
        { kind: "other" },
        SAME,
        [],
        /not the folder git was asked to remove/,
      ],
      [
        "no record from before",
        SAME,
        { kind: "unreadable", message: "x" },
        [],
        /not the folder git was asked to remove/,
      ],
      [
        "unreadable now",
        { kind: "unreadable", message: "EACCES" },
        SAME,
        [],
        /could not be read: EACCES/,
      ],
      [
        "a checkout inside it",
        SAME,
        SAME,
        [path.join(FOLDER, "nested")],
        /another checkout is inside it/,
      ],
      [
        "the primary checkout itself",
        SAME,
        SAME,
        [FOLDER],
        /another checkout is inside it/,
      ],
    ];
  for (const [name, now, before, checkouts, reason] of cases) {
    const remover = fakeRemover([now]);
    const problem = await finishRemoval(remover, FOLDER, before, checkouts);
    assert.match(problem ?? "", reason, name);
    assert.match(problem ?? "", /The pull request did merge/, name);
    assert.deepEqual(remover.removed, [], name);
  }
});

void test("a failed removal, or a folder still there after it, is reported", async () => {
  const failing = fakeRemover([SAME], new Error("EBUSY"));
  assert.match(
    (await finishRemoval(failing, FOLDER, SAME, [])) ?? "",
    /removing it failed: EBUSY/,
  );
  const stubborn = fakeRemover([SAME, SAME]);
  assert.match(
    (await finishRemoval(stubborn, FOLDER, SAME, [])) ?? "",
    /still there after removing it/,
  );
});

void test("on disk: links in the leftover node_modules are removed, never what they point to", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "temple-bar-finish-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const outside = path.join(root, "store", "pkg");
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(outside, "index.js"), "sentinel\n");
  const folder = path.join(root, "wt");
  mkdirSync(path.join(folder, "node_modules", ".pnpm"), { recursive: true });
  // pnpm links packages with junctions on Windows and symlinks elsewhere.
  symlinkSync(
    outside,
    path.join(folder, "node_modules", "pkg"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const remover = createWorktreeRemover();
  const before = await remover.inspect(folder);
  assert.equal(before.kind, "directory");

  assert.equal(
    await finishRemoval(remover, folder, before, [root + "-x"]),
    undefined,
  );
  assert.equal(existsSync(folder), false);
  assert.equal(existsSync(path.join(outside, "index.js")), true);
});

void test("on disk: a folder that is a link is never removed through it", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "temple-bar-finish-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const real = path.join(root, "real");
  mkdirSync(path.join(real, "node_modules"), { recursive: true });
  const folder = path.join(root, "wt");
  symlinkSync(real, folder, process.platform === "win32" ? "junction" : "dir");
  const remover = createWorktreeRemover();
  const before = await remover.inspect(folder);
  assert.equal(before.kind, "other");
  assert.match(
    (await finishRemoval(remover, folder, before, [])) ?? "",
    /not the folder git was asked to remove/,
  );
  assert.equal(existsSync(path.join(real, "node_modules")), true);
});
