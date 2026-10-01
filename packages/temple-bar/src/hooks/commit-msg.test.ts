import assert from "node:assert/strict";
import test from "node:test";

import {
  createFakeContext,
  createFakeFs,
  createFakeWriter,
} from "../testing/fakes.ts";
import { commitMsgCheck } from "./commit-msg.ts";

function ctxWithMessage(message: string | undefined) {
  const stderr = createFakeWriter();
  const files =
    message === undefined ? {} : { "/repo/.git/COMMIT_EDITMSG": message };
  const ctx = createFakeContext({
    cwd: "/repo",
    stderr,
    fs: createFakeFs(files),
  });
  return { ctx, stderr };
}

void test("commit-msg: a conventional message passes, silently", async () => {
  const { ctx, stderr } = ctxWithMessage("feat: add a thing\n");
  assert.equal(await commitMsgCheck(".git/COMMIT_EDITMSG", ctx), 0);
  assert.equal(stderr.lines.length, 0);
});

void test("commit-msg: an unprefixed message is refused with the rule and an example", async () => {
  const { ctx, stderr } = ctxWithMessage("add a thing\n");
  const code = await commitMsgCheck(".git/COMMIT_EDITMSG", ctx);
  const text = stderr.lines.join("");
  assert.match(text, /the commit subject needs a conventional prefix/);
  assert.match(text, /Example: /);
  assert.equal(code, 1);
});

void test("commit-msg: an unreadable message file fails closed", async () => {
  const { ctx, stderr } = ctxWithMessage(undefined);
  assert.equal(await commitMsgCheck(".git/COMMIT_EDITMSG", ctx), 1);
  assert.match(stderr.lines.join(""), /cannot read the commit message/);
});
