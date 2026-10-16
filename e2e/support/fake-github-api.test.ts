// The fake is only useful if it answers the way the judge reads GitHub, so
// these tests read it through the judge's own GitHub client, over a real
// connection, rather than checking the fake against itself.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readLockfiles,
  readManifests,
  readPullRequest,
  type PullRequestRef,
} from "../../packages/temple-bar/src/judge/github.ts";
import { createHttpSeam } from "../../packages/temple-bar/src/seams/http.ts";
import { createFakeContext } from "../../packages/temple-bar/src/testing/fakes.ts";
import { serveFakeGithubApi, type FakeGithubApi } from "./fake-github-api.ts";

const HEAD = "c".repeat(40);
const ctx = createFakeContext({ http: createHttpSeam() });

function ref(api: FakeGithubApi, number: number): PullRequestRef {
  return { api: api.url, owner: "acme", repo: "widgets", number, token: "t" };
}

void test("the judge reads a pull request's files, statuses and both sides' manifests from the fake", async () => {
  const api = await serveFakeGithubApi(
    "acme",
    "widgets",
    [
      {
        number: 1,
        headShas: [HEAD],
        files: [
          "package.json",
          { filename: "packages/b/package.json", status: "added" },
          { filename: "packages/c/package.json", status: "removed" },
          {
            filename: "packages/e/package.json",
            status: "renamed",
            previousFilename: "packages/d/package.json",
          },
          "pnpm-lock.yaml",
        ],
      },
    ],
    {
      trees: {
        main: { "package.json": "base", "pnpm-lock.yaml": "base lock" },
        [HEAD]: {
          "package.json": "head",
          "pnpm-lock.yaml": "head lock",
          "packages/b/package.json": "nested",
        },
      },
    },
  );
  try {
    const facts = await readPullRequest(ctx, ref(api, 1));
    assert.ok(facts.ok, facts.ok ? "" : facts.reason);
    assert.equal(facts.value.headSha, HEAD);
    assert.equal(facts.value.baseRef, "main");
    assert.deepEqual(facts.value.files.slice(1, 4), [
      { filename: "packages/b/package.json", status: "added" },
      { filename: "packages/c/package.json", status: "removed" },
      {
        filename: "packages/e/package.json",
        status: "renamed",
        previousFilename: "packages/d/package.json",
      },
    ]);
    const manifests = await readManifests(ctx, ref(api, 1), facts.value);
    assert.deepEqual(manifests, {
      ok: true,
      value: { base: "base", head: "head" },
    });
    const lockfiles = await readLockfiles(ctx, ref(api, 1), facts.value);
    assert.deepEqual(lockfiles, {
      ok: true,
      value: { base: "base lock", head: "head lock" },
    });

    // A nested file at a ref, by the contents API and by a recursive tree,
    // for checks that read every manifest.
    const nested = await fetch(
      `${api.url}/repos/acme/widgets/contents/packages/b/package.json?ref=${HEAD}`,
    );
    const body = (await nested.json()) as { content: string };
    assert.equal(Buffer.from(body.content, "base64").toString(), "nested");
    const tree = await fetch(
      `${api.url}/repos/acme/widgets/git/trees/${HEAD}?recursive=1`,
    );
    const listed = (await tree.json()) as {
      tree: { path: string; type: string; sha: string }[];
      truncated: boolean;
    };
    assert.equal(listed.truncated, false);
    assert.deepEqual(
      listed.tree.map((entry) => `${entry.type} ${entry.path}`),
      [
        "blob package.json",
        "tree packages",
        "tree packages/b",
        "blob packages/b/package.json",
        "blob pnpm-lock.yaml",
      ],
    );
    // A folder's own tree, reached by its id as a reader walking down would.
    const folder = listed.tree.find((entry) => entry.path === "packages/b");
    const sub = await fetch(
      `${api.url}/repos/acme/widgets/git/trees/${folder?.sha ?? ""}`,
    );
    assert.deepEqual(
      ((await sub.json()) as { tree: { path: string }[] }).tree.map(
        (entry) => entry.path,
      ),
      ["package.json"],
    );
    // A folder through the contents API is a list, not a missing file.
    const dir = await fetch(
      `${api.url}/repos/acme/widgets/contents/packages?ref=${HEAD}`,
    );
    const [entry] = (await dir.json()) as {
      type: string;
      name: string;
      path: string;
      sha: string;
    }[];
    assert.deepEqual(
      { ...entry, sha: undefined },
      { type: "dir", name: "b", path: "packages/b", sha: undefined },
    );
    assert.equal(entry?.sha, folder?.sha);
    // The root through the contents API, with and without a trailing slash.
    for (const root of ["contents", "contents/"]) {
      const top = await fetch(
        `${api.url}/repos/acme/widgets/${root}?ref=${HEAD}`,
      );
      assert.deepEqual(
        ((await top.json()) as { path: string }[]).map((item) => item.path),
        ["package.json", "packages", "pnpm-lock.yaml"],
      );
    }
    // A path that is an inherited property name is absent, not a crash.
    const odd = await fetch(
      `${api.url}/repos/acme/widgets/contents/constructor?ref=${HEAD}`,
    );
    assert.equal(odd.status, 404);
    const absent = await fetch(
      `${api.url}/repos/acme/widgets/contents/packages/c/package.json?ref=${HEAD}`,
    );
    assert.equal(absent.status, 404);
  } finally {
    await api.close();
  }
});

void test("the fake pages a long file list, and can send one shorter than its count", async () => {
  const files = Array.from({ length: 150 }, (_, i) => `src/f${String(i)}.ts`);
  const huge = Array.from({ length: 3001 }, (_, i) => `src/g${String(i)}.ts`);
  const api = await serveFakeGithubApi("acme", "widgets", [
    { number: 1, files },
    { number: 2, files, changedFiles: 151 },
    { number: 3, files: ["a.ts", "a.ts"] },
    { number: 4, files: huge },
  ]);
  try {
    const whole = await readPullRequest(ctx, ref(api, 1));
    assert.ok(whole.ok, whole.ok ? "" : whole.reason);
    assert.equal(whole.value.files.length, 150);
    assert.equal(whole.value.files[149]?.filename, "src/f149.ts");
    const short = await readPullRequest(ctx, ref(api, 2));
    assert.deepEqual(short, {
      ok: false,
      reason: "GitHub listed 150 of the 151 changed files",
    });
    // GitHub stops listing at 3000 files, whatever the pull request holds.
    const past = await fetch(
      `${api.url}/repos/acme/widgets/pulls/4/files?per_page=100&page=31`,
    );
    assert.deepEqual(await past.json(), []);
    const capped = await readPullRequest(ctx, ref(api, 4));
    assert.deepEqual(capped, {
      ok: false,
      reason: "GitHub listed 3000 of the 3001 changed files",
    });
    // A repeated path reaches the judge as GitHub sent it, for the judge to
    // refuse.
    const repeated = await readPullRequest(ctx, ref(api, 3));
    assert.ok(repeated.ok, repeated.ok ? "" : repeated.reason);
    assert.deepEqual(
      repeated.value.files.map((file) => file.filename),
      ["a.ts", "a.ts"],
    );
  } finally {
    await api.close();
  }
});

void test("the fake moves the head and base between reads, and records each request", async () => {
  const api = await serveFakeGithubApi("acme", "widgets", [
    {
      number: 1,
      files: [],
      headShas: ["1".repeat(40), HEAD],
      baseShas: ["2".repeat(40), "3".repeat(40)],
    },
  ]);
  try {
    const pull = `${api.url}/repos/acme/widgets/pulls/1`;
    const seen = [];
    for (let i = 0; i < 2; i++) {
      const read = (await (await fetch(pull)).json()) as {
        head: { sha: string };
        base: { sha: string };
      };
      seen.push([read.head.sha, read.base.sha]);
    }
    assert.deepEqual(seen, [
      ["1".repeat(40), "2".repeat(40)],
      [HEAD, "3".repeat(40)],
    ]);
    const first = await readPullRequest(ctx, ref(api, 1));
    const second = await readPullRequest(ctx, ref(api, 1));
    const third = await readPullRequest(ctx, ref(api, 1));
    // Both stay where they moved to, through the judge's own reader too.
    assert.equal(first.ok && first.value.headSha, HEAD);
    assert.equal(second.ok && second.value.headSha, HEAD);
    assert.equal(third.ok && third.value.headSha, HEAD);
    assert.equal(
      api.requests.filter((url) => url === "/repos/acme/widgets/pulls/1")
        .length,
      5,
    );
  } finally {
    await api.close();
  }
});

void test("the fake serves a base branch whose name has a slash", async () => {
  const api = await serveFakeGithubApi(
    "acme",
    "widgets",
    [{ number: 1, files: ["pnpm-lock.yaml"], baseRef: "release/1.x" }],
    {
      branches: { "release/1.x": ["d".repeat(40), "e".repeat(40)] },
      trees: {
        "release/1.x": {
          "package.json": "base",
          "pnpm-lock.yaml": "base lock",
        },
        [HEAD]: { "package.json": "head", "pnpm-lock.yaml": "head lock" },
      },
    },
  );
  try {
    const facts = await readPullRequest(ctx, ref(api, 1));
    assert.ok(facts.ok, facts.ok ? "" : facts.reason);
    const pr = { ...facts.value, headSha: HEAD };
    assert.deepEqual(await readManifests(ctx, ref(api, 1), pr), {
      ok: true,
      value: { base: "base", head: "head" },
    });
    assert.deepEqual(await readLockfiles(ctx, ref(api, 1), pr), {
      ok: true,
      value: { base: "base lock", head: "head lock" },
    });
    // The branch's tip, read twice, moves: the second read is how a judge
    // notices the base changed under it.
    const tip = `${api.url}/repos/acme/widgets/git/ref/heads/${encodeURIComponent("release/1.x")}`;
    const first = (await (await fetch(tip)).json()) as {
      object: { sha: string };
    };
    const second = (await (await fetch(tip)).json()) as {
      object: { sha: string };
    };
    assert.equal(first.object.sha, "d".repeat(40));
    assert.equal(second.object.sha, "e".repeat(40));
  } finally {
    await api.close();
  }
});

void test("the fake can cut a recursive tree short and say so", async () => {
  const api = await serveFakeGithubApi("acme", "widgets", [], {
    trees: { [HEAD]: { "a.json": "1", "b/c.json": "2", "d.json": "3" } },
    truncated: [HEAD],
  });
  try {
    const whole = await fetch(
      `${api.url}/repos/acme/widgets/git/trees/${HEAD}`,
    );
    assert.equal(
      ((await whole.json()) as { truncated: boolean }).truncated,
      false,
    );
    const cut = await fetch(
      `${api.url}/repos/acme/widgets/git/trees/${HEAD}?recursive=1`,
    );
    const body = (await cut.json()) as { tree: unknown[]; truncated: boolean };
    assert.equal(body.truncated, true);
    assert.ok(body.tree.length < 4);
  } finally {
    await api.close();
  }
});
