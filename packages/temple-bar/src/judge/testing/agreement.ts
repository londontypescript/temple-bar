// Shared by the tests that judge one change through both readers: the git
// reader `ready` and `merge` use, and the judge's GitHub reader against a
// fake GitHub answering from the same repository. Both must name exactly
// the same findings.

import assert from "node:assert/strict";
import type { TestContext } from "node:test";

import { checkChanges } from "../../merge/approval.ts";
import { readChanges } from "../../merge/manifests.ts";
import { createGitSeam } from "../../seams/git.ts";
import { createFakeContext } from "../../testing/fakes.ts";
import { commitFiles } from "../../testing/git-commits.ts";
import { githubFromGit } from "../../testing/github-from-git.ts";
import { findCheckChanges } from "../changes.ts";
import { readFixedChanges } from "../github-changes.ts";
import { newRepo, PR, type Files } from "./trees.ts";

/** Both readers' findings for the change from `base` to `head`, and what
 * the judge's read gave when it didn't succeed. */
export async function judgeBoth(dir: string, baseSha: string, headSha: string) {
  const local = createFakeContext({ git: createGitSeam(), cwd: dir });
  const byGit = checkChanges(await readChanges(local, baseSha, headSha, dir));
  const http = githubFromGit({ dir, heads: [headSha], tips: [baseSha] });
  const read = await readFixedChanges(createFakeContext({ http }), PR);
  return {
    byGit,
    byGitHub: read.ok ? findCheckChanges(read.value.changes) : read.reason,
  };
}

/** One case: what it is, the base's files, the head's, and the findings. */
export type AgreementCase = readonly [
  what: string,
  base: Files,
  head: Files,
  expected: readonly string[],
];

/** Each case committed in one repository and judged by both readers, which
 * must each give exactly the expected findings. `src/x.ts` changes in
 * every case, so no head is the same commit as its base. */
export async function assertAgree(
  t: TestContext,
  cases: readonly AgreementCase[],
): Promise<void> {
  const dir = newRepo(t);
  for (const [what, base, head, expected] of cases) {
    const baseSha = commitFiles(dir, { "src/x.ts": "1", ...base });
    const headSha = commitFiles(dir, { "src/x.ts": "2", ...head }, baseSha);
    const { byGit, byGitHub } = await judgeBoth(dir, baseSha, headSha);
    assert.deepEqual(byGit, expected, `${what}: ready and merge`);
    assert.deepEqual(byGitHub, expected, `${what}: the judge`);
  }
}
