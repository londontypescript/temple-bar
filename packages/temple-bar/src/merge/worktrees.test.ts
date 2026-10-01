import assert from "node:assert/strict";
import test from "node:test";

import { parseWorktreeList } from "./worktrees.ts";

void test("parses branches, detached and prunable worktrees, marking the first as primary", () => {
  const porcelain = [
    "worktree /repo",
    "HEAD 1111",
    "branch refs/heads/main",
    "",
    "worktree /wt/feat",
    "HEAD 2222",
    "branch refs/heads/feat/x",
    "",
    "worktree /wt/detached",
    "HEAD 3333",
    "detached",
    "",
    "worktree /wt/gone",
    "HEAD 4444",
    "branch refs/heads/old",
    "prunable gitdir file points to non-existent location",
    "",
  ].join("\n");
  assert.deepEqual(parseWorktreeList(porcelain), [
    {
      path: "/repo",
      branch: "main",
      head: "1111",
      primary: true,
      prunable: false,
    },
    {
      path: "/wt/feat",
      branch: "feat/x",
      head: "2222",
      primary: false,
      prunable: false,
    },
    {
      path: "/wt/detached",
      branch: undefined,
      head: "3333",
      primary: false,
      prunable: false,
    },
    {
      path: "/wt/gone",
      branch: "old",
      head: "4444",
      primary: false,
      prunable: true,
    },
  ]);
});
