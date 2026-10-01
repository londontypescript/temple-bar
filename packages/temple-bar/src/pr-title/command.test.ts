import assert from "node:assert/strict";
import test from "node:test";

import {
  createFakeContext,
  createFakeFs,
  createFakeWriter,
} from "../testing/fakes.ts";
import { prTitleCommand } from "./command.ts";

const EVENT = "/event.json";

function eventWithTitle(title: unknown): string {
  return JSON.stringify({ pull_request: { title } });
}

void test("pr-title: a conventional title given as an argument exits 0", async () => {
  const stderr = createFakeWriter();
  const ctx = createFakeContext({ stderr });

  assert.equal(await prTitleCommand.run(["feat(gate): add a check"], ctx), 0);
  assert.equal(stderr.lines.length, 0);
});

void test("pr-title: an unprefixed title exits 1 with the same refusal as the hook", async () => {
  const stderr = createFakeWriter();
  const ctx = createFakeContext({ stderr });

  const code = await prTitleCommand.run(["Add a check"], ctx);
  const text = stderr.lines.join("");
  assert.match(text, /the pull request title needs a conventional prefix/);
  assert.match(text, /feat, fix, docs, chore/);
  assert.equal(code, 1);
});

void test("pr-title: with no argument it reads the title from the event payload", async () => {
  const good = createFakeContext({
    env: { GITHUB_EVENT_PATH: EVENT },
    fs: createFakeFs({ [EVENT]: eventWithTitle("fix: a thing") }),
  });
  assert.equal(await prTitleCommand.run([], good), 0);

  const stderr = createFakeWriter();
  const bad = createFakeContext({
    env: { GITHUB_EVENT_PATH: EVENT },
    fs: createFakeFs({ [EVENT]: eventWithTitle("a thing") }),
    stderr,
  });
  const code = await prTitleCommand.run([], bad);
  assert.match(stderr.lines.join(""), /the pull request title needs/);
  assert.equal(code, 1);
});

void test("pr-title: no title anywhere exits 2 and says what to do", async () => {
  const noEnv = createFakeWriter();
  assert.equal(
    await prTitleCommand.run([], createFakeContext({ stderr: noEnv })),
    2,
  );
  assert.match(noEnv.lines.join(""), /no pull request title to check/);

  for (const content of [
    "not json",
    JSON.stringify({ ref: "refs/heads/x" }),
    eventWithTitle(42),
  ]) {
    const ctx = createFakeContext({
      env: { GITHUB_EVENT_PATH: EVENT },
      fs: createFakeFs({ [EVENT]: content }),
    });
    assert.equal(await prTitleCommand.run([], ctx), 2, content);
  }

  const missingFile = createFakeContext({ env: { GITHUB_EVENT_PATH: EVENT } });
  assert.equal(await prTitleCommand.run([], missingFile), 2);
});
