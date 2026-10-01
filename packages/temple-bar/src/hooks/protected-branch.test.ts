import assert from "node:assert/strict";
import test from "node:test";

import { createFakeContext, createFakeGit } from "../testing/fakes.ts";
import {
  branchFromOriginHead,
  findProtectedBranch,
} from "./protected-branch.ts";

void test("protected branch: origin/HEAD's target names it", () => {
  assert.equal(branchFromOriginHead("refs/remotes/origin/master\n"), "master");
  assert.equal(branchFromOriginHead("refs/remotes/origin/trunk"), "trunk");
  assert.equal(
    branchFromOriginHead("refs/remotes/origin/release/v2"),
    "release/v2",
  );
});

void test("protected branch: main when origin/HEAD is missing or points elsewhere", () => {
  assert.equal(branchFromOriginHead(undefined), "main");
  assert.equal(branchFromOriginHead(""), "main");
  assert.equal(branchFromOriginHead("refs/remotes/upstream/master"), "main");
  assert.equal(branchFromOriginHead("refs/remotes/origin/HEAD"), "main");
});

void test("protected branch: read from refs/remotes/origin/HEAD, main when git has none", async () => {
  const withHead = createFakeContext({
    git: createFakeGit(() => ({
      code: 0,
      stdout: "refs/remotes/origin/master\n",
      stderr: "",
    })),
  });
  const withoutHead = createFakeContext({
    git: createFakeGit(() => ({ code: 1, stdout: "", stderr: "" })),
  });

  assert.equal(await findProtectedBranch(withHead, "/repo"), "master");
  assert.equal(await findProtectedBranch(withoutHead, "/repo"), "main");
});
