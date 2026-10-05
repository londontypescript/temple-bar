import assert from "node:assert/strict";
import test from "node:test";

import { ASK_FOR_ADMIN_MERGE } from "./changes.ts";
import { judgeCommand } from "./command.ts";
import type { HttpResult } from "../seams/http.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeHttp,
  createFakeWriter,
} from "../testing/fakes.ts";

const API = "https://api.github.com/repos/acme/widgets";
const EVENT = "/runner/event.json";

const BASE_MANIFEST = JSON.stringify({
  scripts: { gate: "temple-bar gate", lint: "eslint ." },
  devDependencies: { "@londontypescript/temple-bar": "0.0.7" },
});

const BASE_LOCKFILE = `lockfileVersion: '9.0'

packages:

  '@londontypescript/temple-bar@0.0.7':
    resolution: {integrity: sha512-seven==}

  eslint@10.0.0:
    resolution: {integrity: sha512-ten==}
`;

interface FakeGithub {
  readonly files: readonly object[];
  readonly changedFiles?: number;
  readonly headManifest?: string;
  readonly headLockfile?: string;
  readonly status?: number;
}

const json = (value: unknown): HttpResult => ({
  kind: "response",
  status: 200,
  body: JSON.stringify(value),
});

const contents = (text: string): HttpResult =>
  json({ content: Buffer.from(text).toString("base64"), encoding: "base64" });

/** GitHub's answers for pull request #7 of acme/widgets. */
function github(state: FakeGithub) {
  return createFakeHttp((url) => {
    if (state.status !== undefined) {
      return { kind: "response", status: state.status, body: "{}" };
    }
    if (url === `${API}/pulls/7`) {
      return json({
        head: { sha: "headsha" },
        base: { ref: "main" },
        changed_files: state.changedFiles ?? state.files.length,
      });
    }
    const page = /\/pulls\/7\/files\?per_page=100&page=(\d+)$/.exec(url);
    if (page !== null) {
      const start = (Number(page[1]) - 1) * 100;
      return json(state.files.slice(start, start + 100));
    }
    if (url === `${API}/contents/package.json?ref=main`) {
      return contents(BASE_MANIFEST);
    }
    if (url === `${API}/contents/package.json?ref=headsha`) {
      return state.headManifest === undefined
        ? { kind: "response", status: 404, body: "{}" }
        : contents(state.headManifest);
    }
    // The lockfile, read through each side's tree and its blob.
    const tree = /\/git\/trees\/(main|headsha)$/.exec(url);
    if (tree !== null) {
      return json({
        tree: [
          { path: "package.json", type: "blob", sha: "manifestblob" },
          { path: "pnpm-lock.yaml", type: "blob", sha: `${tree[1] ?? ""}lock` },
        ],
      });
    }
    const blob = /\/git\/blobs\/(main|headsha)lock$/.exec(url);
    if (blob !== null) {
      return contents(
        blob[1] === "main"
          ? BASE_LOCKFILE
          : (state.headLockfile ?? BASE_LOCKFILE),
      );
    }
    return { kind: "response", status: 404, body: "{}" };
  });
}

function actionsContext(http: ReturnType<typeof createFakeHttp>) {
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

void test("judge: a pull request that leaves the checks alone passes", async () => {
  const http = github({ files: [{ filename: "src/a.ts", status: "added" }] });
  const { ctx, stdout } = actionsContext(http);
  assert.equal(await judgeCommand.run([], ctx), 0);
  assert.match(
    stdout.lines.join(""),
    /#7 leaves the checks alone \(1 changed files read\)/,
  );
  // It reads with the job's token, and never package.json when that is untouched.
  assert.ok(http.calls.every((call) => call.token === "t0ken"));
  assert.ok(http.calls.every((call) => !call.url.includes("/contents/")));
});

void test("judge: a pull request that weakens its own CI is refused, naming the file and who decides", async () => {
  const { ctx, stderr } = actionsContext(
    github({
      files: [{ filename: ".github/workflows/ci.yml", status: "modified" }],
    }),
  );
  assert.equal(await judgeCommand.run([], ctx), 1);
  const text = stderr.lines.join("");
  assert.match(text, /changes the checks that judge it/);
  assert.match(text, /\.github\/workflows\/ci\.yml \(modified\)/);
  assert.match(text, /the maintainer decides/);
  // Who lets it through, in the words merge uses too.
  assert.ok(text.includes(ASK_FOR_ADMIN_MERGE), text);
  assert.match(text, /merge it themselves as a repository admin/);
});

void test("judge: a changed gate script in package.json is refused, read from both sides", async () => {
  const head = JSON.stringify({
    scripts: { gate: "echo ok", lint: "eslint ." },
    devDependencies: { "@londontypescript/temple-bar": "0.0.7" },
  });
  const http = github({
    files: [{ filename: "package.json", status: "modified" }],
    headManifest: head,
  });
  const { ctx, stderr } = actionsContext(http);
  assert.equal(await judgeCommand.run([], ctx), 1);
  assert.match(stderr.lines.join(""), /package\.json: the "gate" script/);
});

void test("judge: a lockfile change that leaves temple-bar's entries alone passes", async () => {
  const http = github({
    files: [{ filename: "pnpm-lock.yaml", status: "modified" }],
    headLockfile: BASE_LOCKFILE.replace("sha512-ten==", "sha512-eleven=="),
  });
  const { ctx, stdout } = actionsContext(http);
  assert.equal(await judgeCommand.run([], ctx), 0);
  assert.match(stdout.lines.join(""), /leaves the checks alone/);
  assert.ok(
    http.calls.some((call) => call.url.endsWith("/git/blobs/headshalock")),
  );
});

void test("judge: a lockfile that points temple-bar at another tarball is refused", async () => {
  const http = github({
    files: [{ filename: "pnpm-lock.yaml", status: "modified" }],
    headLockfile: BASE_LOCKFILE.replace(
      "{integrity: sha512-seven==}",
      "{integrity: sha512-six==, tarball: https://example.test/temple-bar-0.0.6.tgz}",
    ),
  });
  const { ctx, stderr } = actionsContext(http);
  assert.equal(await judgeCommand.run([], ctx), 1);
  assert.match(
    stderr.lines.join(""),
    /pnpm-lock\.yaml: temple-bar's entries: packages > @londontypescript\/temple-bar@0\.0\.7 \(changed\)/,
  );
});

void test("judge: every page of changed files is read, so a workflow on page 2 is still found", async () => {
  const files = [
    ...Array.from({ length: 100 }, (_, i) => ({
      filename: `src/f${String(i)}.ts`,
      status: "added",
    })),
    { filename: ".github/workflows/sneaky.yml", status: "added" },
  ];
  const { ctx, stderr } = actionsContext(github({ files }));
  assert.equal(await judgeCommand.run([], ctx), 1);
  assert.match(stderr.lines.join(""), /sneaky\.yml/);
});

void test("judge: fewer files listed than the pull request has fails closed", async () => {
  const { ctx, stderr } = actionsContext(
    github({
      files: [{ filename: "a.ts", status: "added" }],
      changedFiles: 3001,
    }),
  );
  assert.equal(await judgeCommand.run([], ctx), 1);
  assert.match(stderr.lines.join(""), /listed 1 of the 3001 changed files/);
});

void test("judge: GitHub not answering fails closed, never passes unseen", async () => {
  const { ctx, stderr } = actionsContext(github({ files: [], status: 502 }));
  assert.equal(await judgeCommand.run([], ctx), 1);
  assert.match(
    stderr.lines.join(""),
    /could not read pull request #7 from GitHub: GitHub answered 502/,
  );
});

void test("judge: in Actions with no token it fails and says how to pass one", async () => {
  const { ctx, stderr } = actionsContext(github({ files: [] }));
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

void test("judge --pr: judges the named pull request outside Actions", async () => {
  const http = github({ files: [{ filename: "a.ts", status: "added" }] });
  const ctx = createFakeContext({
    http,
    env: { GITHUB_REPOSITORY: "acme/widgets" },
  });
  assert.equal(await judgeCommand.run(["--pr", "7"], ctx), 0);
  assert.equal(http.calls[0]?.url, `${API}/pulls/7`);
});
