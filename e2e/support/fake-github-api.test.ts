// The fake is only useful if it answers the way the judge reads GitHub, so
// these tests read it through the judge's own GitHub client, over a real
// connection, rather than checking the fake against itself.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readBlob,
  readBranchTip,
  readPullRequest,
  readTree,
  type PullRequestRef,
} from "../../packages/temple-bar/src/judge/github.ts";
import { createHttpSeam } from "../../packages/temple-bar/src/seams/http.ts";
import { createFakeContext } from "../../packages/temple-bar/src/testing/fakes.ts";
import { serveFakeGithubApi, type FakeGithubApi } from "./fake-github-api.ts";

const HEAD = "c".repeat(40);
const BASE = "b".repeat(40);
const ctx = createFakeContext({ http: createHttpSeam() });

function ref(api: FakeGithubApi, number: number): PullRequestRef {
  return { api: api.url, owner: "acme", repo: "widgets", number, token: "t" };
}

/** Each file's text at `commit`, read as the judge reads it: the commit's
 * whole tree, then each blob by the id the tree lists. */
async function readFiles(
  api: FakeGithubApi,
  commit: string,
): Promise<Record<string, string>> {
  const tree = await readTree(ctx, ref(api, 1), commit);
  assert.ok(tree.ok, tree.ok ? "" : tree.reason);
  const files: Record<string, string> = {};
  for (const [at, entry] of tree.value) {
    if (entry.type === "blob") {
      const blob = await readBlob(ctx, ref(api, 1), entry.id);
      assert.ok(blob.ok, blob.ok ? "" : blob.reason);
      files[at] = blob.value;
    }
  }
  return files;
}

/** The pull request's file list, page by page, as GitHub serves it. */
async function listFiles(
  api: FakeGithubApi,
  number: number,
  page: number,
): Promise<{ filename: string }[]> {
  const res = await fetch(
    `${api.url}/repos/acme/widgets/pulls/${String(number)}/files?per_page=100&page=${String(page)}`,
  );
  return (await res.json()) as { filename: string }[];
}

void test("the judge reads a pull request, its base's tip, both trees and their blobs from the fake", async () => {
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
        [BASE]: { "package.json": "base", "pnpm-lock.yaml": "base lock" },
        [HEAD]: {
          "package.json": "head",
          "pnpm-lock.yaml": "head lock",
          "packages/b/package.json": "nested",
        },
      },
      branches: { main: [BASE] },
    },
  );
  try {
    const facts = await readPullRequest(ctx, ref(api, 1));
    assert.deepEqual(facts, {
      ok: true,
      value: { headSha: HEAD, baseRef: "main" },
    });
    assert.deepEqual(await readBranchTip(ctx, ref(api, 1), "main"), {
      ok: true,
      value: BASE,
    });
    assert.deepEqual(await readFiles(api, BASE), {
      "package.json": "base",
      "pnpm-lock.yaml": "base lock",
    });
    assert.deepEqual(await readFiles(api, HEAD), {
      "package.json": "head",
      "packages/b/package.json": "nested",
      "pnpm-lock.yaml": "head lock",
    });
    // The list GitHub gives for the pull request, with each status.
    assert.deepEqual((await listFiles(api, 1, 1)).slice(1, 4), [
      { filename: "packages/b/package.json", status: "added" },
      { filename: "packages/c/package.json", status: "removed" },
      {
        filename: "packages/e/package.json",
        status: "renamed",
        previous_filename: "packages/d/package.json",
      },
    ]);

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
    const first = await listFiles(api, 1, 1);
    const second = await listFiles(api, 1, 2);
    assert.equal(first.length, 100);
    assert.equal(second.length, 50);
    assert.equal(second[49]?.filename, "src/f149.ts");
    // The count GitHub claims, which a test can make disagree with the list.
    const short = (await (
      await fetch(`${api.url}/repos/acme/widgets/pulls/2`)
    ).json()) as { changed_files: number };
    assert.equal(short.changed_files, 151);
    // GitHub stops listing at 3000 files, whatever the pull request holds.
    assert.equal((await listFiles(api, 4, 30)).length, 100);
    assert.deepEqual(await listFiles(api, 4, 31), []);
    // A repeated path is served as given.
    assert.deepEqual(
      (await listFiles(api, 3, 1)).map((file) => file.filename),
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
        ["d".repeat(40)]: {
          "package.json": "base",
          "pnpm-lock.yaml": "base lock",
        },
        [HEAD]: { "package.json": "head", "pnpm-lock.yaml": "head lock" },
      },
    },
  );
  try {
    const facts = await readPullRequest(ctx, ref(api, 1));
    assert.deepEqual(facts, {
      ok: true,
      value: { headSha: "a".repeat(40), baseRef: "release/1.x" },
    });
    // The judge's reader keeps the slash and gets the branch it asked for,
    // and the tip moves between reads, as a judge must notice.
    assert.deepEqual(await readBranchTip(ctx, ref(api, 1), "release/1.x"), {
      ok: true,
      value: "d".repeat(40),
    });
    assert.deepEqual(await readBranchTip(ctx, ref(api, 1), "release/1.x"), {
      ok: true,
      value: "e".repeat(40),
    });
    assert.ok(
      api.requests.includes("/repos/acme/widgets/git/ref/heads/release/1.x"),
      api.requests.join("\n"),
    );
    assert.deepEqual(await readFiles(api, "d".repeat(40)), {
      "package.json": "base",
      "pnpm-lock.yaml": "base lock",
    });
    assert.deepEqual(await readFiles(api, HEAD), {
      "package.json": "head",
      "pnpm-lock.yaml": "head lock",
    });
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
    // The judge's reader refuses it rather than judge part of a tree.
    const read = await readTree(ctx, ref(api, 1), HEAD);
    assert.equal(read.ok, false);
  } finally {
    await api.close();
  }
});
