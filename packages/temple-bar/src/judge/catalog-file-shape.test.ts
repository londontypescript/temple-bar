// The root pnpm-workspace.yaml as a file: the characters the grammar
// refuses anywhere in it, what happens to the file itself (added, removed,
// a symlink, a mode change, unreadable), and the copies of it the grammar
// never reads. Each is a finding, as for every guarded file.

import assert from "node:assert/strict";
import test from "node:test";

import { findCheckChanges } from "./changes.ts";
import type { FileState } from "./file-state.ts";
import {
  BASE,
  char,
  INERT,
  refused,
  regular,
  swap,
  workspace,
  WORKSPACE,
} from "./testing/catalog-fixture.ts";

const verdict = (before: string, after: string): string[] =>
  findCheckChanges([workspace(before, after)]);

const bumped = swap(BASE, "vite: 8.3.3", "vite: 8.4.0");

void test("line endings and characters that change what YAML reads as a line, an indent or a character", () => {
  const crlf = (text: string) => text.replaceAll("\n", "\r\n");
  assert.deepEqual(
    verdict(BASE, crlf(bumped)),
    refused("file shape: a carriage return on line 1 here"),
  );
  assert.deepEqual(
    verdict(crlf(BASE), crlf(bumped)),
    refused("file shape: a carriage return on line 1 on the base branch"),
  );
  assert.deepEqual(
    verdict(BASE, `${char(0xfeff)}${bumped}`),
    refused("file shape: a byte order mark (U+FEFF) on line 1 here"),
  );
  const inComment: readonly [string, string][] = [
    [char(0x2028), "a line separator (U+2028)"],
    [char(0x2029), "a paragraph separator (U+2029)"],
    [char(0x0085), "a control character (U+0085)"],
    [char(0x0000), "a control character (U+0000)"],
    [char(0x007f), "a control character (U+007F)"],
    [char(0x009f), "a control character (U+009F)"],
    [char(0x001f), "a control character (U+001F)"],
    ["\t", "a tab"],
  ];
  for (const [char, name] of inComment) {
    const head = swap(bumped, "every package", `every${char}package`);
    assert.deepEqual(
      verdict(BASE, head),
      refused(`file shape: ${name} on line 4 here`),
      name,
    );
  }
  // A NEL inside an entry is caught before the entry is read.
  assert.deepEqual(
    verdict(
      BASE,
      swap(BASE, "  vite: 8.3.3", `  vite: 8.3.3${char(0x85)}  vitest: 9.9.9`),
    ),
    refused("file shape: a control character (U+0085) on line 18 here"),
  );
});

void test("the file added, removed, made a symlink or given another mode", () => {
  const link: FileState = { kind: "special", mode: "120000" };
  const cases: readonly [string, FileState, FileState, string][] = [
    ["added", { kind: "absent" }, regular(BASE), `${WORKSPACE} (added)`],
    ["removed", regular(BASE), { kind: "absent" }, `${WORKSPACE} (removed)`],
    ["a symlink", regular(BASE), link, `${WORKSPACE} (not a regular file)`],
    [
      "added as a symlink",
      { kind: "absent" },
      link,
      `${WORKSPACE} (not a regular file)`,
    ],
    [
      "a symlink made a file",
      link,
      regular(BASE),
      `${WORKSPACE} (mode changed from 120000 to 100644)`,
    ],
    [
      "made executable",
      regular(BASE),
      regular(bumped, "100755"),
      `${WORKSPACE} (mode changed from 100644 to 100755)`,
    ],
  ];
  for (const [what, base, head, finding] of cases) {
    assert.deepEqual(
      findCheckChanges([
        { path: WORKSPACE, base, head, catalogContext: INERT },
      ]),
      [finding],
      what,
    );
  }
});

void test("either side not valid UTF-8 is unreadable, never a pass", () => {
  const unreadable: FileState = {
    kind: "unreadable",
    reason: "it isn't valid UTF-8",
  };
  assert.deepEqual(
    findCheckChanges([
      { path: WORKSPACE, base: regular(BASE), head: unreadable },
    ]),
    [`${WORKSPACE} (could not read it here: it isn't valid UTF-8)`],
  );
  assert.deepEqual(
    findCheckChanges([
      { path: WORKSPACE, base: unreadable, head: regular(bumped) },
    ]),
    [
      `${WORKSPACE} (could not read it on the base branch: it isn't valid UTF-8)`,
    ],
  );
});

void test("a workspace file anywhere but the root, or a root name that only folds to it, stays guarded whole", () => {
  for (const path of [
    "packages/a/pnpm-workspace.yaml",
    "PNPM-WORKSPACE.YAML",
    "Pnpm-Workspace.yaml",
  ]) {
    assert.deepEqual(
      findCheckChanges([{ path, base: regular(BASE), head: regular(bumped) }]),
      [`${path} (modified)`],
      path,
    );
  }
});
