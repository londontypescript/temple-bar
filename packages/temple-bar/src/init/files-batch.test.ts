// writeSetupFiles reads git's index once, for the whole batch of setup's
// writes. That read stays true only while nothing in the batch prompts (a
// person could stage files while setup waits) or runs a git command that
// writes the index (ADR 0018). These tests run the whole batch over each kind
// of repo setup meets and check every git call and prompt it made, from the
// recorded calls rather than from an error, which later error handling could
// swallow.

import assert from "node:assert/strict";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";

import { AGENTS_MD_0_1_0 } from "./testing/agents-md-0-1-0.ts";
import { PNPM_USER_AGENT, setUpFiles } from "./testing/command-fixture.ts";
import { writeSetupFiles, type SetupFilesOutcome } from "./files.ts";
import { SETUP_PATHS } from "./write-target.ts";
import { JUDGE_WORKFLOW_PATH } from "../judge/workflow.ts";
import type { GitResult } from "../seams/git.ts";
import type { PromptSeam } from "../seams/prompt.ts";
import { outputFromRelease } from "../testing/published-output.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
  createFakeProc,
  type FakeFs,
} from "../testing/fakes.ts";

const INDEX_READ = ["ls-files", "-s", "-z", "--"];

/** Setup's paths and every folder on the way to them: what its index read
 * names. */
const SETUP_INDEX_PATHS = new Set(
  SETUP_PATHS.flatMap((file) => {
    const parts = file.split("/");
    return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
  }),
);

/** Every git call setup's batch may make. Each one only reads. Package
 * naming reaches the last three when package.json is missing or unnamed. */
const READ_ONLY_GIT: readonly ((args: readonly string[]) => boolean)[] = [
  (args) =>
    isDeepStrictEqual(args.slice(0, 4), INDEX_READ) &&
    args.length > INDEX_READ.length &&
    args.slice(INDEX_READ.length).every((file) => SETUP_INDEX_PATHS.has(file)),
  (args) => isDeepStrictEqual(args, ["remote", "get-url", "origin"]),
  (args) => isDeepStrictEqual(args, ["rev-parse", "--git-common-dir"]),
  (args) =>
    args.length === 4 &&
    args[0] === "--git-dir" &&
    isDeepStrictEqual(args.slice(2), ["rev-parse", "--is-bare-repository"]),
];

const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "" });

/** Git answering as a repo whose index tracks `tracked`, each as an ordinary
 * file, with `origin` set or not. */
function gitScript(options: {
  readonly origin: boolean;
  readonly tracked: readonly string[];
}) {
  return (args: readonly string[]): GitResult => {
    if (args[0] === "ls-files")
      return ok(
        options.tracked
          .map((file) => `100644 ${"a".repeat(40)} 0\t${file}\0`)
          .join(""),
      );
    if (isDeepStrictEqual(args, ["remote", "get-url", "origin"]))
      return options.origin
        ? ok("git@github.com:acme/widgets.git\n")
        : { code: 2, stdout: "", stderr: "error: No such remote 'origin'" };
    if (args[0] === "rev-parse" && args[1] === "--git-common-dir")
      return ok(".git\n");
    if (args.includes("--is-bare-repository")) return ok("false\n");
    return ok();
  };
}

interface BatchFixture {
  readonly name: string;
  readonly fs: () => FakeFs;
  readonly git: (args: readonly string[]) => GitResult;
  /** That the run took the path the fixture is named for. */
  readonly check: (outcome: SetupFilesOutcome, fs: FakeFs) => void;
}

const packageName = (fs: FakeFs): unknown =>
  (JSON.parse(fs.files.get("/repo/package.json") ?? "{}") as { name?: unknown })
    .name;

const FIXTURES: readonly BatchFixture[] = [
  {
    name: "a fresh repo with no package.json",
    fs: () => createFakeFs(),
    git: gitScript({ origin: true, tracked: [] }),
    check: (outcome, fs) => {
      assert.equal(outcome.packageOutcome.wrote, true);
      assert.equal(packageName(fs), "widgets", "named from origin");
    },
  },
  {
    name: "a repo with no origin",
    fs: () => createFakeFs(),
    git: gitScript({ origin: false, tracked: [] }),
    check: (outcome, fs) => {
      assert.equal(outcome.packageOutcome.wrote, true);
      assert.equal(packageName(fs), "repo", "named from the main checkout");
    },
  },
  {
    name: "a rerun on a repo already set up",
    fs: () => setUpFiles(),
    git: gitScript({ origin: true, tracked: SETUP_PATHS }),
    check: (_, fs) => {
      assert.deepEqual(fs.writes, [], "nothing left to write");
    },
  },
  {
    name: "an upgrade from an earlier setup's output",
    fs: () =>
      setUpFiles({
        "/repo/AGENTS.md": AGENTS_MD_0_1_0,
        [`/repo/${JUDGE_WORKFLOW_PATH}`]: outputFromRelease(
          JUDGE_WORKFLOW_PATH,
          "0.0.8",
        ),
      }),
    git: gitScript({ origin: true, tracked: SETUP_PATHS }),
    check: (outcome) => {
      assert.equal(outcome.wroteAgents, true, "AGENTS.md block upgraded");
      assert.ok(
        outcome.workflows.some(
          (workflow) =>
            workflow.workflow.path === JUDGE_WORKFLOW_PATH && workflow.upgraded,
        ),
        "earlier judge workflow upgraded",
      );
    },
  },
];

/** An interactive terminal whose every use is recorded, and whose question
 * fails, so the test sees a prompt even if something catches the failure. */
function recordingPrompt() {
  const calls: string[] = [];
  const seam: PromptSeam = {
    isInteractive: () => {
      calls.push("isInteractive()");
      return true;
    },
    confirm: (question) => {
      calls.push(`confirm(${question})`);
      return Promise.reject(new Error(`setup's batch asked: ${question}`));
    },
  };
  return { calls, seam };
}

for (const fixture of FIXTURES) {
  void test(`setup batch: ${fixture.name} reads git's index once, never prompts, and runs only read-only git`, async () => {
    const fs = fixture.fs();
    const git = createFakeGit(fixture.git);
    const prompt = recordingPrompt();
    // proc can run any command, git included, so nothing may go through it.
    const proc = createFakeProc();
    const ctx = createFakeContext({
      fs,
      git,
      prompt: prompt.seam,
      proc,
      env: { npm_config_user_agent: PNPM_USER_AGENT },
    });
    let outcome: SetupFilesOutcome | undefined;
    let failure: unknown;
    try {
      outcome = await writeSetupFiles(ctx, "/repo");
    } catch (error) {
      failure = error;
    }
    assert.deepEqual(
      prompt.calls,
      [],
      "setup's batch used the prompt; a batch must hold no prompt, since its one index read would be stale after one (ADR 0018)",
    );
    assert.deepEqual(
      proc.calls.map((call) => [call.command, ...call.args]),
      [],
      "setup's batch ran a process outside the git seam",
    );
    const calls = git.calls.map((call) => call.args);
    assert.deepEqual(
      calls.filter((args) => !READ_ONLY_GIT.some((allowed) => allowed(args))),
      [],
      "setup's batch ran git commands that aren't known read-only shapes; one that writes the index would leave the batch's one read stale (ADR 0018)",
    );
    assert.equal(
      calls.filter((args) => args[0] === "ls-files").length,
      1,
      "setup's batch reads git's index exactly once",
    );
    // Only now, so a failure caused by a prompt or a git call is reported by
    // the assertions above, not by the error it led to.
    assert.ifError(failure);
    assert.ok(outcome);
    assert.deepEqual([...outcome.refusedPaths.keys()], []);
    fixture.check(outcome, fs);
  });
}
