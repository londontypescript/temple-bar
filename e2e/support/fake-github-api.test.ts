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

void test("the judge reads a pull request, its base's tip, both trees and their blobs from the fake", async () => {
  const api = await serveFakeGithubApi(
    "acme",
    "widgets",
    [
      {
        number: 1,
        headShas: [HEAD],
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
    // The recursive tree lists folders too, depth first, as GitHub does.
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
    // An object the repository doesn't hold is not found, as on GitHub,
    // even one named like an inherited property.
    for (const missing of ["git/trees/constructor", "git/blobs/constructor"]) {
      const res = await fetch(`${api.url}/repos/acme/widgets/${missing}`);
      assert.equal(res.status, 404, missing);
    }
  } finally {
    await api.close();
  }
});

void test("the fake moves the head and base between reads, and records each request", async () => {
  const api = await serveFakeGithubApi("acme", "widgets", [
    {
      number: 1,
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
    [{ number: 1, baseRef: "release/1.x" }],
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
