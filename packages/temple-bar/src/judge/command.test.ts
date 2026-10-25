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
import {
  BASE,
  CODE_ONLY,
  newRepo,
  pinnedLockfile,
  pinnedManifest,
  type Files,
} from "./testing/trees.ts";

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

/** A base pinning temple-bar 0.1.0 in package.json and the lockfile, with
 * `baseExtra` on top, and a head moving both to 0.2.0 with `extra` on top. */
function pinBump(t: TestContext, extra: Files = {}, baseExtra: Files = {}) {
  const pinned = {
    ...BASE,
    "package.json": pinnedManifest("0.1.0"),
    "pnpm-lock.yaml": pinnedLockfile("0.1.0"),
    ...baseExtra,
  };
  const bumped = {
    ...pinned,
    "package.json": pinnedManifest("0.2.0"),
    "pnpm-lock.yaml": pinnedLockfile("0.2.0"),
    ...extra,
  };
  return actionsContext(github(t, bumped, pinned));
}

const REFUSED = "judge: this pull request changes the checks that judge it:\n";

const PIN_FINDINGS =
  '  package.json: the temple-bar version in devDependencies["@londontypescript/temple-bar"] ("0.1.0" on the base branch, "0.2.0" here)\n' +
  "  pnpm-lock.yaml: temple-bar's entries: importers > . > devDependencies > @londontypescript/temple-bar (changed)\n";

/** How every refusal ends, word for word as before pin bumps were
 * disclosed. */
const WHO_DECIDES =
  "Its own CI can't vouch for a change to that CI, so the maintainer " +
  `decides. ${ASK_FOR_ADMIN_MERGE} Keep a change like this in a pull ` +
  "request of its own, with other work in another one.\n" +
  "If the branch is behind main, bring it up to date first: main's " +
  "newer changes show up here as if this pull request undid them.\n";

void test("judge: a pin bump on its own is refused, saying it changes nothing else", async (t) => {
  const { ctx, stderr } = pinBump(t);
  assert.equal(await judgeCommand.run([], ctx), 1);
  assert.equal(
    stderr.lines.join(""),
    REFUSED +
      PIN_FINDINGS +
      "This pull request changes nothing else.\n" +
      WHO_DECIDES,
  );
});

void test("judge: a pin bump with other changes lists each of them, guarded or not", async (t) => {
  const { ctx, stderr } = pinBump(t, {
    "packages/a/src/index.ts": "export const a = 2;\n",
    ".github/workflows/ci.yml": "name: CI\non: {}\n",
  });
  assert.equal(await judgeCommand.run([], ctx), 1);
  assert.equal(
    stderr.lines.join(""),
    REFUSED +
      "  .github/workflows/ci.yml (modified)\n" +
      PIN_FINDINGS +
      "This pull request also changes:\n" +
      "  .github/workflows/ci.yml\n" +
      "  packages/a/src/index.ts\n" +
      WHO_DECIDES,
  );
});

void test("judge: a pin bump beside a workflow folder's package.json judges that file whole and lists it", async (t) => {
  const workflowManifest = ".github/workflows/package.json";
  const { ctx, stderr } = pinBump(
    t,
    { [workflowManifest]: JSON.stringify({ name: "w", private: true }) },
    { [workflowManifest]: JSON.stringify({ name: "w" }) },
  );
  assert.equal(await judgeCommand.run([], ctx), 1);
  assert.equal(
    stderr.lines.join(""),
    REFUSED +
      "  .github/workflows/package.json (modified)\n" +
      PIN_FINDINGS +
      "This pull request also changes:\n" +
      "  .github/workflows/package.json\n" +
      WHO_DECIDES,
  );
});

void test("judge: a refusal that leaves the pin alone says nothing about other paths", async (t) => {
  const { ctx, stderr } = actionsContext(
    github(t, {
      ...CODE_ONLY,
      "package.json": JSON.stringify({ name: "root", scripts: { test: "y" } }),
    }),
  );
  assert.equal(await judgeCommand.run([], ctx), 1);
  // The whole refusal, word for word as before pin bumps were disclosed,
  // though another path changed alongside.
  assert.equal(
    stderr.lines.join(""),
    REFUSED + '  package.json: the "test" script\n' + WHO_DECIDES,
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
