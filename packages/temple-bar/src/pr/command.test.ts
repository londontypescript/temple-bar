import assert from "node:assert/strict";
import test from "node:test";

import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
  createFakeWriter,
} from "../testing/fakes.ts";
import { prSizeCommandEntry } from "./command.ts";

function setup(options: {
  numstat: string;
  config?: object;
  title?: string;
  body?: string;
  env?: NodeJS.ProcessEnv;
}) {
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const git = createFakeGit((args) =>
    args[0] === "diff"
      ? { code: 0, stdout: options.numstat, stderr: "" }
      : { code: 0, stdout: "", stderr: "" },
  );
  const files: Record<string, string> = {
    "/event.json": JSON.stringify({
      pull_request: {
        title: options.title ?? "feat: x",
        body: options.body ?? "",
      },
    }),
  };
  if (options.config !== undefined) {
    files["/repo/temple-bar.config.json"] = JSON.stringify(options.config);
  }
  const ctx = createFakeContext({
    git,
    stdout,
    stderr,
    fs: createFakeFs(files),
    env: { GITHUB_EVENT_PATH: "/event.json", ...options.env },
  });
  return { ctx, stdout, stderr, git };
}

const SMALL = "5\t1\ta.ts\0";
const HUGE = "1000\t178\ta.ts\0";

void test("pr-size warns, names size and issues, suggests one pull request per issue, and still exits 0", async () => {
  const { ctx, stdout } = setup({
    numstat: HUGE,
    body: "Closes #101\nCloses #104\nCloses #125",
  });
  const code = await prSizeCommandEntry.run(["--base", "origin/main"], ctx);
  const out = stdout.lines.join("");
  assert.equal(code, 0);
  assert.match(out, /warning/);
  assert.match(out, /1,178 lines/);
  assert.match(out, /closes 3 issues: #101, #104, #125/);
  assert.match(out, /one pull request per issue/);
  assert.doesNotMatch(out, /::warning/, "no annotation outside GitHub Actions");
});

void test("pr-size says all is well for a small one-issue pull request", async () => {
  const { ctx, stdout } = setup({ numstat: SMALL, body: "Closes #141" });
  assert.equal(await prSizeCommandEntry.run(["--base", "origin/main"], ctx), 0);
  assert.match(
    stdout.lines.join(""),
    /^pr-size: ok: 6 lines changed across 1 file; closes 1 issue/,
  );
});

void test("pr-size honours the limits in the project's config", async () => {
  const { ctx, stdout } = setup({
    numstat: "3\t0\ta.ts\0" + "1\t0\tb.ts\0",
    config: { maxPullRequestFiles: 1 },
  });
  await prSizeCommandEntry.run(["--base", "main"], ctx);
  assert.match(stdout.lines.join(""), /touches 2 files \(limit 1\)/);
});

void test("in GitHub Actions the warning is also an annotation, on one line", async () => {
  const { ctx, stdout } = setup({
    numstat: HUGE,
    env: { GITHUB_ACTIONS: "true", GITHUB_BASE_REF: "main" },
  });
  assert.equal(await prSizeCommandEntry.run([], ctx), 0);
  const annotation = stdout.lines
    .join("")
    .split("\n")
    .filter((line) => line.startsWith("::warning title=Pull request size::"));
  assert.equal(annotation.length, 1);
  assert.match(annotation[0] ?? "", /1,178 lines/);
});

void test("GITHUB_BASE_REF names the base as its remote branch", async () => {
  const { ctx, git } = setup({
    numstat: SMALL,
    env: { GITHUB_BASE_REF: "main" },
  });
  await prSizeCommandEntry.run([], ctx);
  assert.equal(git.calls[0]?.args.includes("origin/main...HEAD"), true);
});

void test("pr-size exits 2 with a message when called wrongly", async () => {
  for (const args of [[], ["--nope"], ["--base"], ["--base", "--head"]]) {
    const { ctx, stderr } = setup({ numstat: SMALL });
    assert.equal(await prSizeCommandEntry.run(args, ctx), 2, args.join(" "));
    assert.match(stderr.lines.join(""), /pr-size:/);
  }
});

void test("a measuring failure is reported but never fails the command", async () => {
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    stderr,
    git: createFakeGit(() => ({
      code: 128,
      stdout: "",
      stderr: "fatal: bad revision",
    })),
  });
  assert.equal(await prSizeCommandEntry.run(["--base", "origin/zzz"], ctx), 0);
  assert.match(stderr.lines.join(""), /could not measure.*bad revision/);
});
