import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CONFIG } from "../config/project-config.ts";
import type { GhResult } from "../seams/gh.ts";
import {
  createFakeContext,
  createFakeGh,
  createFakeGit,
  createFakeWriter,
} from "../testing/fakes.ts";
import type { PullRequest } from "./github.ts";
import { checkAndMerge, type Landing } from "./land.ts";

const SHA = "a".repeat(40);
const ONE_CONCERN = "\n\nOne concern: one rename across every file.\n";

function ok(stdout = ""): GhResult {
  return { code: 0, stdout, stderr: "", notFound: false };
}

/** A numstat entry changing `lines` lines (all added) in `file`. */
function entry(file: string, lines: number): string {
  return `${String(lines)}\t0\t${file}\0`;
}

// Just over each default limit, read from the defaults so no number is
// repeated here.
const OVER_SOURCE = entry("src/a.ts", DEFAULT_CONFIG.maxPullRequestLines + 1);
const OVER_TESTS = entry(
  "src/a.test.ts",
  DEFAULT_CONFIG.maxPullRequestTestLines + 1,
);
const OVER_FILES = Array.from(
  { length: DEFAULT_CONFIG.maxPullRequestFiles + 1 },
  (_, i) => entry(`src/f${String(i)}.ts`, 1),
).join("");

/** A scripted git and GitHub on which the checks pass and the merge goes
 * through, so whatever stops `checkAndMerge` is the size step. `numstat`
 * undefined makes `git diff` fail. */
function setup(numstat: string | undefined, body: string) {
  const stdout = createFakeWriter();
  const git = createFakeGit((args) => {
    if (args[0] === "diff") {
      return numstat === undefined
        ? { code: 128, stdout: "", stderr: "fatal: bad revision 'origin/main'" }
        : { code: 0, stdout: numstat, stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  const gh = createFakeGh((args) => {
    const joined = args.join(" ");
    if (joined.includes("/check-runs")) {
      return ok(
        JSON.stringify({
          name: "gate",
          status: "completed",
          conclusion: "success",
        }),
      );
    }
    return ok();
  });
  const pullRequest: PullRequest = {
    number: 7,
    title: "feat(x): add x",
    body: `Closes #1.${body}`,
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "feat/x",
    headRefOid: SHA,
    isCrossRepository: false,
  };
  const landing: Landing = {
    repository: { nameWithOwner: "o/r", defaultBranch: "main" },
    prNumber: 7,
    sha: SHA,
    upstream: "origin/main",
    message: { subject: "feat(x): add x (#7)", body: "" },
    pullRequest,
  };
  const ctx = createFakeContext({ git, gh, stdout });
  const deps = { sleep: () => Promise.resolve() };
  return {
    land: () => checkAndMerge(ctx, deps, landing, "/repo"),
    gh,
    out: () => stdout.lines.join(""),
  };
}

for (const [name, numstat, limit] of [
  ["source lines", OVER_SOURCE, /lines of source changed, limit/],
  ["test lines", OVER_TESTS, /lines of tests changed, limit/],
  ["files", OVER_FILES, /files touched, limit/],
] as const) {
  void test(`too many ${name} without a One concern line refuses before any check is read`, async () => {
    const { land, gh } = setup(numstat, "");
    await assert.rejects(land(), (error: Error) => {
      assert.match(
        error.message,
        /^pull request #7 is over the size limits \(.*\) but its description has no `One concern:` line\. Add a line to the description starting `One concern:`/,
      );
      assert.match(error.message, limit);
      return true;
    });
    assert.deepEqual(
      gh.calls.map((call) => call.args.join(" ")),
      [],
      "nothing asked of GitHub: no ruleset, no checks, no merge",
    );
  });
}

void test("an oversized pull request with a One concern line goes on to the checks, saying so in one line", async () => {
  const { land, gh, out } = setup(OVER_SOURCE, ONE_CONCERN);
  await land();
  assert.match(
    out(),
    /^pr-size: over the size limits \(.* lines of source changed, limit .*\); its `One concern:` line says why it is one change\n/,
  );
  const asked = gh.calls.map((call) => call.args.join(" "));
  assert.ok(asked.some((call) => call.includes("/rules/branches/")));
  assert.ok(asked.some((call) => call.includes("/check-runs")));
  assert.ok(asked.some((call) => call.startsWith("pr merge")));
});

void test("a size that can't be measured refuses, before any check is read", async () => {
  const { land, gh } = setup(undefined, "");
  await assert.rejects(
    land(),
    /^MergeRefusal: could not measure pull request #7's size: git diff origin\/main\.\.\.a+ failed: fatal: bad revision 'origin\/main'\. Merge needs the size/,
  );
  assert.equal(gh.calls.length, 0);
});

void test("test lines over the source limit but under their own don't need the line", async () => {
  const { land, out } = setup(
    entry("src/a.test.ts", DEFAULT_CONFIG.maxPullRequestLines + 1),
    "",
  );
  await land();
  assert.match(out(), /^pr-size: ok: 0 source lines and .* test lines changed/);
});

void test("closing two issues without the line refuses on the snapshot that merges", async () => {
  const { land, gh } = setup(entry("src/a.ts", 1), "\nCloses #2.");
  await assert.rejects(
    land(),
    /closes 2 issues \(#1, #2\) but its description has no `One concern:` line/,
  );
  assert.equal(gh.calls.length, 0);
});
