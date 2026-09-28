// Temporary break-it evidence for subtask 1.3: this test must turn every CI
// job red. It is reverted in the next commit on this branch.
import assert from "node:assert/strict";
import test from "node:test";

void test("break-it: CI must fail on a failing test", () => {
  assert.equal(1, 2);
});
