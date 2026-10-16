import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import type { HttpResult } from "../seams/http.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeHttp,
  createFakeWriter,
  type FakeHttp,
} from "../testing/fakes.ts";
import { commitFiles } from "../testing/git-commits.ts";
import { API, githubFromGit } from "../testing/github-from-git.ts";
import { ASK_FOR_ADMIN_MERGE } from "./changes.ts";
import { judgeCommand } from "./command.ts";
import { BASE, CODE_ONLY, newRepo, type Files } from "./testing/trees.ts";

const EVENT = "/runner/event.json";

function actionsContext(http: FakeHttp) {
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    http,
    stdout,
    stderr,
    fs: createFakeFs({
      [EVENT]: JSON.stringify({ pull_request: { number: 7 } }),
    }),
    env: {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "acme/widgets",
      GITHUB_EVENT_PATH: EVENT,
      GH_TOKEN: "t0ken",
    },
  });
  return { ctx, stdout, stderr };
}

/** GitHub serving pull request #7 from a base with `base`'s files to a head
 * with `head`'s; `heads` overrides the head on each read. */
function github(
  t: TestContext,
  head: Files,
  base: Files = BASE,
  heads?: (headSha: string) => string[],
) {
  const dir = newRepo(t);
  const baseSha = commitFiles(dir, base);
  const headSha = commitFiles(dir, head, baseSha);
  return githubFromGit({
    dir,
    heads: heads?.(headSha) ?? [headSha],
    tips: [baseSha],
  });
}

void test("judge: a pull request that leaves the checks alone passes, naming both commits", async (t) => {
  const http = github(t, CODE_ONLY);
  const { ctx, stdout } = actionsContext(http);
  assert.equal(await judgeCommand.run([], ctx), 0);
  assert.match(
    stdout.lines.join(""),
    /#7 leaves the checks alone \(its head [0-9a-f]{7} compared with main at [0-9a-f]{7}\)/,
  );
  assert.ok(http.calls.every((call) => call.token === "t0ken"));
});

void test("judge: a pull request that weakens its own CI is refused, naming the file and who decides", async (t) => {
  const { ctx, stderr } = actionsContext(
    github(t, { ...BASE, ".github/workflows/ci.yml": "name: CI\non: {}\n" }),
  );
  assert.equal(await judgeCommand.run([], ctx), 1);
  const text = stderr.lines.join("");
  assert.match(text, /changes the checks that judge it/);
  assert.match(text, /\n {2}\.github\/workflows\/ci\.yml \(modified\)\n/);
  assert.match(text, /the maintainer decides/);
  // Who lets it through, in the words merge uses too.
  assert.ok(text.includes(ASK_FOR_ADMIN_MERGE), text);
});

void test("judge: a nested package's changed script is refused, one finding a line", async (t) => {
  const { ctx, stderr } = actionsContext(
    github(t, {
      ...BASE,
      "packages/a/package.json": JSON.stringify({
        name: "a",
        scripts: { test: "node --version" },
      }),
    }),
  );
  assert.equal(await judgeCommand.run([], ctx), 1);
  assert.match(
    stderr.lines.join(""),
    /\n {2}packages\/a\/package\.json: the "test" script\n/,
  );
});

void test("judge: a branch behind its base is refused, with the advice to bring it up to date", async (t) => {
  // main gained a workflow after the branch left it: compared with main as
  // it is now, the branch looks as if it removes it.
  const main = { ...BASE, ".github/workflows/new.yml": "name: New\n" };
  const { ctx, stderr } = actionsContext(github(t, CODE_ONLY, main));
  assert.equal(await judgeCommand.run([], ctx), 1);
  const text = stderr.lines.join("");
  assert.match(text, /\.github\/workflows\/new\.yml \(removed\)/);
  assert.match(text, /If the branch is behind main, bring it up to date first/);
});

void test("judge: a head that moves while it reads fails closed and says it runs again", async (t) => {
  const { ctx, stdout, stderr } = actionsContext(
    github(t, CODE_ONLY, BASE, (head) => [head, "9".repeat(40)]),
  );
  assert.equal(await judgeCommand.run([], ctx), 1);
  assert.match(
    stderr.lines.join(""),
    /could not read pull request #7 from GitHub: the pull request or its base branch changed while the judge read it; it runs again on the next push or update\./,
  );
  assert.doesNotMatch(stdout.lines.join(""), /leaves the checks alone/);
});

void test("judge: GitHub not answering fails closed, never passes unseen", async () => {
  const http = createFakeHttp((): HttpResult => ({
    kind: "response",
    status: 502,
    body: "{}",
  }));
  const { ctx, stdout, stderr } = actionsContext(http);
  assert.equal(await judgeCommand.run([], ctx), 1);
  assert.match(
    stderr.lines.join(""),
    /could not read pull request #7 from GitHub: GitHub answered 502/,
  );
  assert.equal(stdout.lines.length, 0);
});

void test("judge: in Actions with no token it fails and says how to pass one", async () => {
  const { ctx, stderr } = actionsContext(createFakeHttp());
  const noToken = { ...ctx, env: { ...ctx.env, GH_TOKEN: "" } };
  assert.equal(await judgeCommand.run([], noToken), 1);
  assert.match(stderr.lines.join(""), /GH_TOKEN: \$\{\{ github\.token \}\}/);
});

void test("judge: no pull request to judge is a usage mistake", async () => {
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    stderr,
    env: { GITHUB_REPOSITORY: "acme/widgets" },
  });
  assert.equal(await judgeCommand.run([], ctx), 2);
  assert.match(stderr.lines.join(""), /pass --pr <number>/);
  assert.equal(await judgeCommand.run(["--pr", "x"], ctx), 2);
  assert.equal(await judgeCommand.run(["--wat"], ctx), 2);
});

void test("judge --pr: judges the named pull request outside Actions", async (t) => {
  const http = github(t, CODE_ONLY);
  const ctx = createFakeContext({
    http,
    env: { GITHUB_REPOSITORY: "acme/widgets" },
  });
  assert.equal(await judgeCommand.run(["--pr", "7"], ctx), 0);
  assert.equal(http.calls[0]?.url, `${API}/pulls/7`);
});
