// Shared by the tests of the judge's GitHub reader: a base commit and a
// head commit in a real git repository, and a fake GitHub answering from
// it, whose answers a test can replace one URL at a time.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

import type { HttpResult } from "../../seams/http.ts";
import { createFakeContext } from "../../testing/fakes.ts";
import { commitFiles, type RepoFile } from "../../testing/git-commits.ts";
import { initTestRepo } from "../../testing/git-repo.ts";
import {
  API,
  githubFromGit,
  type GithubScript,
} from "../../testing/github-from-git.ts";
import { readFixedChanges } from "../github-changes.ts";
import type { PullRequestRef } from "../github.ts";

export const PR: PullRequestRef = {
  api: "https://api.github.com",
  owner: "acme",
  repo: "widgets",
  number: 7,
  token: "t0ken",
};

export type Files = Readonly<Record<string, RepoFile>>;

export const MANIFEST = JSON.stringify({
  name: "a",
  scripts: { test: "node --test" },
});
export const CHANGED_MANIFEST = JSON.stringify({
  name: "a",
  scripts: { test: "y" },
});

export const BASE: Files = {
  "package.json": JSON.stringify({ name: "root", scripts: { test: "x" } }),
  "packages/a/package.json": MANIFEST,
  "packages/a/src/index.ts": "export const a = 1;\n",
  ".npmrc": "engine-strict=true\n",
  ".github/workflows/ci.yml": "name: CI\n",
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
};

export const CODE_ONLY: Files = {
  ...BASE,
  "packages/a/src/index.ts": "export const a = 2;\n",
};

export const NESTED_CHANGE: Files = {
  ...BASE,
  "packages/a/package.json": CHANGED_MANIFEST,
};

export function newRepo(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-judge-trees-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  initTestRepo(dir);
  return dir;
}

/** A base commit, a head commit on top of it, and a fake GitHub for them.
 * `script` changes how GitHub answers; a function gets both commits. */
export function setup(
  t: TestContext,
  head: Files,
  script:
    | Partial<GithubScript>
    | ((shas: {
        base: string;
        head: string;
        dir: string;
      }) => Partial<GithubScript>) = {},
  base: Files = BASE,
) {
  const dir = newRepo(t);
  const baseSha = commitFiles(dir, base);
  const headSha = commitFiles(dir, head, baseSha);
  const extra =
    typeof script === "function"
      ? script({ base: baseSha, head: headSha, dir })
      : script;
  const http = githubFromGit({
    dir,
    heads: [headSha],
    tips: [baseSha],
    ...extra,
  });
  const ctx = createFakeContext({ http });
  return { dir, baseSha, headSha, http, read: () => readFixedChanges(ctx, PR) };
}

export const response = (status: number, body: unknown): HttpResult => ({
  kind: "response",
  status,
  body: typeof body === "string" ? body : JSON.stringify(body),
});

export const treeUrl = (sha: string): string =>
  `${API}/git/trees/${sha}?recursive=1`;
export const blobUrl = (id: string): string => `${API}/git/blobs/${id}`;
export const tipUrl = `${API}/git/ref/heads/main`;

/** Replaces GitHub's answer for exactly one URL. */
export function answering(
  url: (shas: { base: string; head: string; dir: string }) => string,
  answer: HttpResult,
) {
  return (shas: { base: string; head: string; dir: string }) => ({
    override: (requested: string) =>
      requested === url(shas) ? answer : undefined,
  });
}

export async function assertCantRead(
  read: () => ReturnType<typeof readFixedChanges>,
  reason: RegExp,
): Promise<void> {
  const result = await read();
  if (result.ok) {
    assert.fail("it must not pass what it couldn't read");
  }
  assert.match(result.reason, reason);
}
