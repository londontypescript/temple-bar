// The judge, `ready` and `merge` reach one verdict on a change to the root
// pnpm-workspace.yaml's catalog. Every example in ADR 0015's tables runs
// here through both readers from real commits (the cases are in
// ../judge/testing/catalog-cases*.ts), with the facts about the head each
// reader gathers from its own listing of the tree: pnpmfiles and .npmrc
// files at any depth, folded root names, the root manifest's state and
// text, config dependencies, and text that isn't valid UTF-8.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { assertAgree, judgeBoth } from "../judge/testing/agreement.ts";
import {
  BODY_REFUSED,
  BUMPED,
  PASSING,
  ws,
} from "../judge/testing/catalog-cases.ts";
import {
  ALONGSIDE,
  AROUND_REFUSED,
  FILE_SHAPES_REFUSED,
  HEAD_FACTS_REFUSED,
} from "../judge/testing/catalog-cases-around.ts";
import { BASE, refused, swap } from "../judge/testing/catalog-fixture.ts";
import { newRepo } from "../judge/testing/trees.ts";
import { createFakeContext, createFakeGit } from "../testing/fakes.ts";
import { commitFiles } from "../testing/git-commits.ts";
import { readGuardedChanges } from "./guarded-states.ts";
import { MergeRefusal } from "./refusal.ts";

void test("both readers pass the changes ADR 0015 admits", async (t) => {
  await assertAgree(t, PASSING);
});

void test("both readers refuse the body changes ADR 0015 refuses", async (t) => {
  await assertAgree(t, BODY_REFUSED);
});

void test("both readers refuse the changes around the catalog ADR 0015 refuses", async (t) => {
  await assertAgree(t, AROUND_REFUSED);
});

void test("both readers refuse the file shapes ADR 0015 refuses", async (t) => {
  await assertAgree(t, FILE_SHAPES_REFUSED);
});

void test("both readers gather the head's facts, and any that lets the catalog reach temple-bar's install refuses", async (t) => {
  await assertAgree(t, HEAD_FACTS_REFUSED);
});

void test("a catalog-only change beside any other change to the checks leaves that change's finding", async (t) => {
  await assertAgree(t, ALONGSIDE);
});

void test("ready and merge read each tree as stored, whatever a local replacement ref says", async (t) => {
  const dir = newRepo(t);
  const base = commitFiles(dir, ws(BASE));
  const head = commitFiles(dir, ws(swap(BASE, "  react: 19.2.0\n", "")), base);
  // A commit that looks like a plain bump, put in the head's place for
  // every git command that honours replacement refs.
  const decoy = commitFiles(dir, ws(BUMPED), base);
  execFileSync("git", ["replace", head, decoy], { cwd: dir });
  // GitHub knows nothing of this clone's refs: only the local reader could
  // be shown the decoy.
  const { byGit } = await judgeBoth(dir, base, head);
  assert.deepEqual(
    byGit,
    refused(
      "base line unmatched: line 13 on the base branch has no match at line 13 here",
    ),
  );
});

void test("ready and merge find a guarded change a replacement ref hides from the diff", async (t) => {
  const dir = newRepo(t);
  const ci = (text: string) => ({ ".github/workflows/ci.yml": text });
  const base = commitFiles(dir, ws(BASE, ci("a")));
  const head = commitFiles(dir, ws(BASE, ci("b")), base);
  const decoy = commitFiles(dir, ws(BUMPED, ci("a")), base);
  execFileSync("git", ["replace", head, decoy], { cwd: dir });
  const { byGit } = await judgeBoth(dir, base, head);
  assert.deepEqual(byGit, [".github/workflows/ci.yml (modified)"]);
});

void test("ready and merge refuse a tree listing that names one path twice", async () => {
  const id = "8".repeat(40);
  const entry = `100644 blob ${id}\tpnpm-workspace.yaml\0`;
  const git = createFakeGit((args) => ({
    code: 0,
    stdout: args.includes("-r") ? `${entry}${entry}` : "",
    stderr: "",
  }));
  await assert.rejects(
    readGuardedChanges(
      createFakeContext({ git }),
      "b",
      "h",
      ["pnpm-workspace.yaml"],
      "/repo",
    ),
    (error: unknown) =>
      error instanceof MergeRefusal &&
      error.message ===
        "could not list the files at b: git ls-tree lists pnpm-workspace.yaml twice",
  );
});
