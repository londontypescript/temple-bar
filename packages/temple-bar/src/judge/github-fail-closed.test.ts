// The judge's reading of GitHub fails closed: every answer that isn't
// GitHub's documented shape, and every move of the head or the base while
// it reads, is "could not read", never an empty answer or a pass.

import assert from "node:assert/strict";
import test from "node:test";

import type { HttpResult } from "../seams/http.ts";
import { writeBlob } from "../testing/git-commits.ts";
import { API, type GithubScript } from "../testing/github-from-git.ts";
import { MOVED_WHILE_READ } from "./github-changes.ts";
import {
  answering,
  assertCantRead,
  BASE,
  blobUrl,
  CHANGED_MANIFEST,
  CODE_ONLY,
  MANIFEST,
  NESTED_CHANGE,
  response,
  setup,
  tipUrl,
  treeUrl,
} from "./testing/trees.ts";

for (const side of ["base", "head"] as const) {
  void test(`a ${side} tree GitHub can't list whole fails closed`, async (t) => {
    const { read } = setup(
      t,
      CODE_ONLY,
      answering(
        (shas) => treeUrl(shas[side]),
        response(200, { sha: "x", tree: [], truncated: true }),
      ),
    );
    await assertCantRead(read, /can't list the tree of [0-9a-f]{40} whole/);
  });
}

void test("a tree answered with an error, invalid JSON or the wrong shape fails closed", async (t) => {
  const answers: [HttpResult, RegExp][] = [
    [response(404, {}), /GitHub answered 404/],
    [response(500, {}), /GitHub answered 500/],
    [response(200, "{ not json"), /isn't a JSON object/],
    [response(200, []), /isn't a JSON object/],
    [
      response(200, { tree: {}, truncated: false }),
      /unexpected answer for the tree/,
    ],
    [response(200, { tree: [] }), /unexpected answer for the tree/],
    [
      response(200, { tree: [], truncated: "false" }),
      /unexpected answer for the tree/,
    ],
  ];
  for (const [answer, reason] of answers) {
    const { read } = setup(
      t,
      CODE_ONLY,
      answering((shas) => treeUrl(shas.head), answer),
    );
    await assertCantRead(read, reason);
  }
});

void test("a tree entry with a field missing, a mode and type that don't match, or a path listed twice fails closed", async (t) => {
  const id = "2".repeat(40);
  const entry = { path: "src/a.ts", mode: "100644", type: "blob", sha: id };
  const trees: [unknown[], RegExp][] = [
    [[{ path: "src/a.ts", type: "blob", sha: id }], /unexpected entry/],
    [[{ ...entry, sha: "short" }], /unexpected entry/],
    [[{ ...entry, path: "" }], /unexpected entry/],
    [[{ ...entry, type: "tree" }], /unexpected entry/],
    [[{ ...entry, mode: "120000", type: "commit" }], /unexpected entry/],
    [[{ ...entry, mode: "100600" }], /unexpected entry/],
    [[entry, { ...entry, sha: "3".repeat(40) }], /lists src\/a\.ts twice/],
  ];
  for (const [tree, reason] of trees) {
    const { read } = setup(
      t,
      CODE_ONLY,
      answering(
        (shas) => treeUrl(shas.base),
        response(200, { tree, truncated: false }),
      ),
    );
    await assertCantRead(read, reason);
  }
});

void test("a blob answered with an error, invalid JSON, the wrong shape or bad base64 fails closed", async (t) => {
  const headBlob = (shas: { dir: string }) =>
    blobUrl(writeBlob(shas.dir, CHANGED_MANIFEST));
  const good = Buffer.from(CHANGED_MANIFEST).toString("base64");
  const answers: [HttpResult, RegExp][] = [
    [response(404, {}), /GitHub answered 404/],
    [response(500, {}), /GitHub answered 500/],
    [response(200, "{ not json"), /isn't a JSON object/],
    [
      response(200, { content: good, encoding: "utf-8" }),
      /unexpected answer for the blob/,
    ],
    [response(200, { encoding: "base64" }), /unexpected answer for the blob/],
    // Unpadded, and with a character base64 doesn't have: Node would
    // decode both without a word, dropping what it can't read.
    [
      response(200, { content: good.replace(/=+$/, ""), encoding: "base64" }),
      /base64 that doesn't decode/,
    ],
    [
      response(200, {
        content: `${good.slice(0, 8)}*${good.slice(8)}`,
        encoding: "base64",
      }),
      /base64 that doesn't decode/,
    ],
    // Valid base64 of other content: not the blob the tree named.
    [
      response(200, {
        content: Buffer.from(MANIFEST).toString("base64"),
        encoding: "base64",
      }),
      /came back with other content/,
    ],
  ];
  // The fixture's base64 ends in padding, so dropping it is a change.
  assert.match(good, /=$/);
  for (const [answer, reason] of answers) {
    const { read } = setup(t, NESTED_CHANGE, (shas) => ({
      override: (url: string) => (url === headBlob(shas) ? answer : undefined),
    }));
    await assertCantRead(read, reason);
  }
});

void test("a base branch tip answered for another branch, a non-commit or as a list fails closed", async (t) => {
  // Each answer names the real base commit, so only its own flaw can stop
  // the read.
  const answers: ((base: string) => [HttpResult, RegExp])[] = [
    (base) => [
      response(200, {
        ref: "refs/heads/main-old",
        object: { type: "commit", sha: base },
      }),
      /unexpected answer for the tip of main/,
    ],
    (base) => [
      response(200, {
        ref: "refs/heads/main",
        object: { type: "tag", sha: base },
      }),
      /unexpected answer for the tip of main/,
    ],
    () => [
      response(200, {
        ref: "refs/heads/main",
        object: { type: "commit", sha: "main" },
      }),
      /unexpected answer for the tip of main/,
    ],
    (base) => [
      response(200, [
        { ref: "refs/heads/main", object: { type: "commit", sha: base } },
      ]),
      /isn't a JSON object/,
    ],
    () => [response(404, {}), /GitHub answered 404/],
  ];
  for (const answer of answers) {
    let reason = /never/;
    const { read } = setup(t, CODE_ONLY, (shas) => {
      const [reply, why] = answer(shas.base);
      reason = why;
      return {
        override: (url: string) => (url === tipUrl ? reply : undefined),
      };
    });
    await assertCantRead(read, reason);
  }
});

void test("a pull request described in an unexpected shape fails closed", async (t) => {
  const { read } = setup(
    t,
    CODE_ONLY,
    answering(
      () => `${API}/pulls/7`,
      response(200, { head: { sha: "main" }, base: { ref: "main" } }),
    ),
  );
  await assertCantRead(read, /unexpected description of the pull request/);
});

void test("the head moving, the base tip moving or the base branch changing while the judge reads fails closed", async (t) => {
  const later = "5".repeat(40);
  const scripts: ((shas: {
    base: string;
    head: string;
  }) => Partial<GithubScript>)[] = [
    (shas) => ({ heads: [shas.head, later] }),
    (shas) => ({ tips: [shas.base, later] }),
    () => ({ baseRefs: ["main", "release"] }),
  ];
  for (const script of scripts) {
    await assertCantRead(
      setup(t, CODE_ONLY, script).read,
      new RegExp(MOVED_WHILE_READ.slice(0, 40)),
    );
  }
});

void test("the base moving while the lockfile is read fails closed, after reading only the first tip's tree", async (t) => {
  const later = "6".repeat(40);
  const { read, http, baseSha } = setup(
    t,
    { ...BASE, "pnpm-lock.yaml": "lockfileVersion: '9.0'\n# changed\n" },
    (shas) => ({ tips: [shas.base, later] }),
  );
  await assertCantRead(read, /changed while the judge read it/);
  const trees = http.calls.filter((call) => call.url.includes("/git/trees/"));
  assert.equal(trees[0]?.url, treeUrl(baseSha));
  assert.ok(trees.every((call) => !call.url.includes(later)));
});
