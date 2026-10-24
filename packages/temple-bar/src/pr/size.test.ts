import assert from "node:assert/strict";
import test from "node:test";

import {
  createFakeContext,
  createFakeFs,
  createFakeGh,
  createFakeGit,
  createFakeWriter,
} from "../testing/fakes.ts";
import type { PullRequestText } from "./closing-issues.ts";
import { checkPullRequestSize, warnAboutPullRequestSize } from "./size.ts";

// Small limits of the test's own, so no default number is repeated here.
const LIMITS = {
  maxPullRequestLines: 10,
  maxPullRequestTestLines: 20,
  maxPullRequestFiles: 3,
};

const SMALL = "4\t1\tsrc/a.ts\0" + "6\t0\tsrc/a.test.ts\0";
const OVER_SOURCE = "11\t1\tsrc/a.ts\0";

function setup(numstat: string, env: NodeJS.ProcessEnv = {}) {
  const stdout = createFakeWriter();
  const gh = createFakeGh();
  const ctx = createFakeContext({
    stdout,
    gh,
    git: createFakeGit((args) => ({
      code: 0,
      stdout: args[0] === "diff" ? numstat : "",
      stderr: "",
    })),
    // An event payload that says something else, to show a snapshot passed
    // in is what gets judged.
    fs: createFakeFs({
      "/repo/temple-bar.config.json": JSON.stringify(LIMITS),
      "/event.json": JSON.stringify({
        pull_request: { title: "feat: x", body: "Closes #8\nCloses #9" },
      }),
    }),
    env: { GITHUB_EVENT_PATH: "/event.json", ...env },
  });
  return { ctx, gh, out: () => stdout.lines.join("") };
}

function text(body: string): PullRequestText {
  return { title: "feat: x", body, repository: "acme/widgets" };
}

const OPTIONS = { base: "origin/main", head: "HEAD" };

void test("the all-clear gives source and test lines apart", async () => {
  const { ctx, out } = setup(SMALL);
  await warnAboutPullRequestSize(ctx, {
    ...OPTIONS,
    pullRequestText: text("Closes #1"),
  });
  assert.equal(
    out(),
    "pr-size: ok: 5 source lines and 6 test lines changed across 2 files; closes 1 issue\n",
  );
});

void test("a snapshot passed in is judged, and nothing is read from gh or the event", async () => {
  const { ctx, gh } = setup(SMALL);
  const report = await checkPullRequestSize(ctx, {
    ...OPTIONS,
    pullRequestText: text("Closes #1"),
  });
  assert.deepEqual(report.closedIssues, ["#1"]);
  assert.equal(gh.calls.length, 0);
});

void test("two closed issues with a valid One concern line are not a problem", async () => {
  const { ctx, out } = setup(SMALL);
  const report = await warnAboutPullRequestSize(ctx, {
    ...OPTIONS,
    pullRequestText: text("Closes #1\nCloses #2\n\nOne concern: same cause."),
  });
  assert.deepEqual(
    report.problems,
    [],
    "a valid One concern line drops the closes-several-issues problem",
  );
  assert.equal(report.oneConcernLine, true);
  assert.match(
    out(),
    /^pr-size: ok: .*closes 2 issues; its description has a `One concern:` line\n$/,
  );
});

void test("a One concern line that is only a template comment doesn't drop the problem", async () => {
  const { ctx } = setup(SMALL);
  const report = await checkPullRequestSize(ctx, {
    ...OPTIONS,
    pullRequestText: text("Closes #1\nCloses #2\n\nOne concern: <!-- -->"),
  });
  assert.equal(report.oneConcernLine, false);
  assert.deepEqual(report.problems, ["it closes 2 issues: #1, #2"]);
});

void test("CI's event payload is read the same way, so its valid line drops the problem too", async () => {
  const { ctx } = setup(SMALL);
  await ctx.fs.writeText(
    "/event.json",
    JSON.stringify({
      pull_request: {
        title: "fix: y",
        body: "Closes #1\nCloses #2\n\n- **One concern:** same cause.",
      },
    }),
  );
  const report = await checkPullRequestSize(ctx, OPTIONS);
  assert.deepEqual(report.problems, []);
});

void test("before a push, with no description read, the reminder stays", async () => {
  const { ctx, out, gh } = setup(OVER_SOURCE);
  const report = await warnAboutPullRequestSize(ctx, {
    ...OPTIONS,
    skipPullRequestText: true,
  });
  assert.equal(report.oneConcernLine, undefined);
  assert.equal(report.closedIssues, undefined);
  assert.equal(gh.calls.length, 0);
  assert.match(
    out(),
    /^pr-size: warning: this pull request may be too big or mix concerns:\n {2}- 12 lines of source changed, limit 10\n/,
  );
  assert.match(out(), /starting `One concern:` that says why it is one change/);
  assert.match(out(), /`temple-bar merge` requires that line/);
});

void test("each limit is its own problem: source lines, test lines, files", async () => {
  const { ctx } = setup(
    "11\t0\tsrc/a.ts\0" +
      "21\t0\tsrc/a.test.ts\0" +
      "1\t0\tb.ts\0" +
      "1\t0\tc.ts\0",
  );
  const report = await checkPullRequestSize(ctx, {
    ...OPTIONS,
    pullRequestText: text("Closes #1"),
  });
  assert.deepEqual(report.overages, [
    "13 lines of source changed, limit 10",
    "21 lines of tests changed, limit 20",
    "4 files touched, limit 3",
  ]);
  assert.deepEqual(report.problems, report.overages);
});

void test("test lines over the source limit but under their own aren't a problem", async () => {
  const { ctx } = setup("15\t0\tsrc/a.test.ts\0");
  const report = await checkPullRequestSize(ctx, {
    ...OPTIONS,
    pullRequestText: text(""),
  });
  assert.deepEqual(report.problems, []);
});

void test("oversized with a valid line is one information line, never a warning or an annotation", async () => {
  const { ctx, out } = setup(OVER_SOURCE, { GITHUB_ACTIONS: "true" });
  const report = await warnAboutPullRequestSize(ctx, {
    ...OPTIONS,
    pullRequestText: text("Closes #1\n\nOne concern: one rename everywhere."),
  });
  assert.deepEqual(report.problems, []);
  assert.equal(
    out(),
    "pr-size: over the size limits (12 lines of source changed, limit 10); its `One concern:` line says why it is one change\n",
  );
});
