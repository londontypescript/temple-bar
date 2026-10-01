import assert from "node:assert/strict";
import test from "node:test";

import {
  commitSubject,
  describeRefusal,
  isAcceptableCommitMessage,
  isConventionalSubject,
} from "./subject.ts";

void test("subject: each allowed prefix passes, with and without a scope", () => {
  for (const prefix of ["feat", "fix", "docs", "chore"]) {
    assert.equal(isConventionalSubject(`${prefix}: do a thing`), true);
    assert.equal(isConventionalSubject(`${prefix}(gate): do a thing`), true);
  }
});

void test("subject: a missing prefix, unknown prefix or malformed separator fails", () => {
  for (const bad of [
    "add a thing",
    "feature: add a thing",
    "Feat: add a thing",
    "feat add a thing",
    "feat:add a thing",
    "feat:  ",
    "feat: ",
    "feat()",
    "feat(): add a thing",
    "feat(a)(b): add a thing",
    " feat: add a thing",
    "",
  ]) {
    assert.equal(isConventionalSubject(bad), false, `"${bad}"`);
  }
});

void test("commit message: git's own merge, revert and rebase subjects are accepted", () => {
  for (const generated of [
    "Merge branch 'x' into main",
    'Revert "feat: add a thing"',
    "fixup! feat: add a thing",
    "squash! fix: a thing",
    "amend! docs: a thing",
  ]) {
    assert.equal(isAcceptableCommitMessage(`${generated}\n`), true, generated);
  }
});

void test("commit message: the look-alikes of git's subjects are not exempt", () => {
  for (const bad of ["Merged the thing", "Reverted it", "fixup the thing"]) {
    assert.equal(isAcceptableCommitMessage(`${bad}\n`), false, bad);
  }
});

void test("commit message: comment lines and leading blank lines are skipped", () => {
  const message = "\n# Please enter a message\nfix: real subject\n\nbody\n";
  assert.equal(commitSubject(message), "fix: real subject");
  assert.equal(isAcceptableCommitMessage(message), true);
  assert.equal(isAcceptableCommitMessage("# only\n# comments\n"), true);
  assert.equal(isAcceptableCommitMessage("# note\nno prefix\n"), false);
});

void test("commit message: only the subject line is judged, not the body", () => {
  assert.equal(isAcceptableCommitMessage("fix: ok\n\nno prefix here\n"), true);
  assert.equal(isAcceptableCommitMessage("oops\n\nfix: in the body\n"), false);
  assert.equal(isAcceptableCommitMessage("fix: ok\r\n"), true);
});

void test("refusal: names the allowed prefixes, shows an example and the bad subject", () => {
  const text = describeRefusal("add a thing", "the commit subject");
  assert.match(text, /the commit subject needs a conventional prefix/);
  assert.match(text, /add a thing/);
  assert.match(text, /feat, fix, docs, chore/);
  assert.match(text, /Example: fix\(gate\): /);
});
