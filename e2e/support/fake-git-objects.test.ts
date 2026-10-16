// A judge that compares object ids is only tested properly if the fake's ids
// are git's, so these tests check them against git itself, then check the
// fake serves modes, symlinks and submodules the way GitHub does.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { serveFakeGithubApi } from "./fake-github-api.ts";
import {
  listTree,
  writeGitObjects,
  type FakeFile,
} from "./fake-git-objects.ts";

const HEAD = "c".repeat(40);
const PINNED = "d".repeat(40);

// Names chosen for git's ordering: a folder sorts as if its name ended in
// "/", so "a.json" and "a-b" come before the folder "a", and "a0" after it.
const FILES: Record<string, FakeFile> = {
  "package.json": '{ "name": "widgets" }\n',
  "a.json": "1",
  "a-b": "2",
  "a/b c.json": "3",
  "a/deep/x.json": "1",
  a0: "",
  "bin/run": { text: "#!/bin/sh\n", executable: true },
  "linked.json": { symlink: "a/b c.json" },
  "vendor/lib": { submodule: PINNED },
};

/** What git writes for the same files, listed by `git ls-tree`. */
function gitListing(files: Record<string, FakeFile>): {
  root: string;
  lines: string[];
} {
  const dir = mkdtempSync(path.join(tmpdir(), "fake-git-objects-"));
  const git = (args: string[], input?: string) =>
    execFileSync("git", args, { cwd: dir, input, encoding: "utf8" }).trim();
  try {
    git(["init", "-q"]);
    for (const [filePath, file] of Object.entries(files)) {
      const [mode, sha] =
        typeof file === "string"
          ? ["100644", git(["hash-object", "-w", "--stdin"], file)]
          : "submodule" in file
            ? ["160000", file.submodule]
            : "symlink" in file
              ? ["120000", git(["hash-object", "-w", "--stdin"], file.symlink)]
              : ["100755", git(["hash-object", "-w", "--stdin"], file.text)];
      git([
        "update-index",
        "--add",
        "--cacheinfo",
        `${mode},${sha},${filePath}`,
      ]);
    }
    const root = git(["write-tree"]);
    const lines = git(["ls-tree", "-r", "-t", "-l", root]).split("\n");
    return { root, lines };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void test("the fake's object ids, modes and order are git's own", () => {
  const objects = writeGitObjects(
    new Map([[HEAD, new Map(Object.entries(FILES))]]),
  );
  const root = objects.roots.get(HEAD) ?? "";
  const git = gitListing(FILES);
  assert.equal(root, git.root);
  assert.deepEqual(
    listTree(objects.trees, root, true).map(
      (entry) =>
        `${entry.mode} ${entry.type} ${entry.sha} ${String(entry.size ?? "-").padStart(7)}\t${entry.path}`,
    ),
    git.lines,
  );
});

void test("a path that is both a file and a folder is a mistake in the test", () => {
  assert.throws(
    () =>
      writeGitObjects(
        new Map([
          [
            HEAD,
            new Map([
              ["a", "1"],
              ["a/b", "2"],
            ]),
          ],
        ]),
      ),
    /"a" is both a file and a folder/,
  );
});

void test("the fake gives the same content the same id at every ref, and serves each mode", async () => {
  const api = await serveFakeGithubApi("acme", "widgets", [], {
    trees: {
      main: { "package.json": "same", "b.json": "old" },
      [HEAD]: {
        ...FILES,
        "package.json": "same",
        "b.json": "new",
        "c.json": "same",
      },
    },
  });
  const get = async (route: string) => {
    const res = await fetch(`${api.url}/repos/acme/widgets/${route}`);
    return {
      status: res.status,
      body: (await res.json()) as Record<string, unknown>,
    };
  };
  type Listed = {
    tree: { path: string; mode: string; type: string; sha: string }[];
  };
  try {
    const base = (await get("git/trees/main?recursive=1")).body as Listed;
    const head = (await get(`git/trees/${HEAD}?recursive=1`)).body as Listed;
    const at = (listed: Listed, p: string) =>
      listed.tree.find((entry) => entry.path === p);
    assert.equal(at(base, "package.json")?.sha, at(head, "package.json")?.sha);
    assert.equal(at(head, "c.json")?.sha, at(head, "package.json")?.sha);
    assert.notEqual(at(base, "b.json")?.sha, at(head, "b.json")?.sha);
    assert.match(at(head, "b.json")?.sha ?? "", /^[0-9a-f]{40}$/);
    // The answer names the root tree, not the commit it was asked for.
    assert.match(
      String((await get(`git/trees/${HEAD}`)).body.sha),
      /^[0-9a-f]{40}$/,
    );
    assert.notEqual((await get(`git/trees/${HEAD}`)).body.sha, HEAD);

    const link = at(head, "linked.json");
    assert.deepEqual([link?.mode, link?.type], ["120000", "blob"]);
    const target = (await get(`git/blobs/${link?.sha ?? ""}`)).body;
    assert.equal(
      Buffer.from(String(target.content), "base64").toString(),
      "a/b c.json",
    );
    assert.deepEqual(
      [at(head, "bin/run")?.mode, at(head, "a")?.mode],
      ["100755", "040000"],
    );

    // A submodule is a commit, with no blob to fetch.
    const sub = at(head, "vendor/lib");
    assert.deepEqual(
      [sub?.mode, sub?.type, sub?.sha],
      ["160000", "commit", PINNED],
    );
    assert.equal((await get(`git/blobs/${PINNED}`)).status, 404);

    assert.deepEqual((await get(`contents/linked.json?ref=${HEAD}`)).body, {
      type: "symlink",
      path: "linked.json",
      sha: link?.sha,
      target: "a/b c.json",
    });
    assert.deepEqual((await get(`contents/vendor/lib?ref=${HEAD}`)).body, {
      type: "submodule",
      path: "vendor/lib",
      sha: PINNED,
    });
    // In a folder's list GitHub calls a submodule a file.
    const vendor = (await get(`contents/vendor?ref=${HEAD}`))
      .body as unknown as {
      type: string;
    }[];
    assert.deepEqual(
      vendor.map((entry) => entry.type),
      ["file"],
    );
  } finally {
    await api.close();
  }
});
