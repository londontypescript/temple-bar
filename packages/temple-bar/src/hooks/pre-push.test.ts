// Unit tests for the pre-push hook with fake git and gh. The real-git
// version is pre-push.integration.test.ts.

import assert from "node:assert/strict";
import test from "node:test";

import type { GitResult } from "../seams/git.ts";
import {
  createFakeContext,
  createFakeGh,
  createFakeGit,
  createFakeWriter,
} from "../testing/fakes.ts";
import { parsePushedRefs, prePushCheck } from "./pre-push.ts";

const ZERO = "0".repeat(40);
const OLD = "a".repeat(40);
const NEW = "b".repeat(40);

function line(remoteRef: string, localSha: string, remoteSha: string): string {
  const localRef = remoteRef;
  return `${localRef} ${localSha} ${remoteRef} ${remoteSha}\n`;
}

interface Scenario {
  /** Exit code of `merge-base --is-ancestor`. */
  ancestor?: number;
  /** Whether GitHub's commit exists in this clone. */
  remoteShaPresent?: boolean;
  numstat?: string;
  diffFails?: boolean;
  originHead?: string;
}

function setup(scenario: Scenario = {}) {
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const gh = createFakeGh();
  const ok = (out = ""): GitResult => ({ code: 0, stdout: out, stderr: "" });
  const git = createFakeGit((args) => {
    switch (args[0]) {
      case "symbolic-ref":
        return scenario.originHead === undefined
          ? { code: 1, stdout: "", stderr: "" }
          : ok(`refs/remotes/origin/${scenario.originHead}\n`);
      case "cat-file":
        return scenario.remoteShaPresent === false
          ? { code: 128, stdout: "", stderr: "not a valid object" }
          : ok();
      case "merge-base":
        return { code: scenario.ancestor ?? 0, stdout: "", stderr: "" };
      case "diff":
        return scenario.diffFails === true
          ? { code: 128, stdout: "", stderr: "bad revision origin/main" }
          : ok(scenario.numstat ?? "5\t1\ta.ts\0");
      default:
        return ok();
    }
  });
  const ctx = createFakeContext({ git, gh, stdout, stderr });
  return { ctx, git, gh, stdout, stderr };
}

const HUGE = "1000\t178\ta.ts\0";

void test("parsePushedRefs: reads git's four-field lines and skips junk", () => {
  const refs = parsePushedRefs(
    `refs/heads/x ${NEW} refs/heads/x ${OLD}\n\nnot a line\n`,
  );
  assert.deepEqual(refs, [
    { localSha: NEW, remoteRef: "refs/heads/x", remoteSha: OLD },
  ]);
});

void test("pre-push: a push that only adds commits is allowed, silently", async () => {
  const { ctx, stderr, stdout } = setup({ ancestor: 0 });
  assert.equal(await prePushCheck(line("refs/heads/work", NEW, OLD), ctx), 0);
  assert.equal(stderr.lines.length, 0);
  assert.equal(stdout.lines.length, 0);
});

void test("pre-push: a push that replaces GitHub's commits is refused with the merge-main advice", async () => {
  const { ctx, stderr } = setup({ ancestor: 1 });
  assert.equal(await prePushCheck(line("refs/heads/work", NEW, OLD), ctx), 1);
  const out = stderr.lines.join("");
  assert.match(out, /refusing to push work: .* \(a force push\)/);
  assert.match(out, /merging main into it; never rewrite a pushed branch/);
});

void test("pre-push: when GitHub's commit isn't in this clone, refuses and says to fetch", async () => {
  const { ctx, stderr, git } = setup({ remoteShaPresent: false });
  assert.equal(await prePushCheck(line("refs/heads/work", NEW, OLD), ctx), 1);
  const out = stderr.lines.join("");
  assert.match(out, /isn't in this clone/);
  assert.match(out, /git fetch/);
  assert.match(out, /never rewrite a pushed branch/);
  assert.ok(
    !git.calls.some((call) => call.args[0] === "merge-base"),
    "no guess is made from a commit git can't see",
  );
});

void test("pre-push: an ancestry check that errors is refused, not guessed", async () => {
  const { ctx } = setup({ ancestor: 128 });
  assert.equal(await prePushCheck(line("refs/heads/work", NEW, OLD), ctx), 1);
});

void test("pre-push: a new branch is allowed without comparing anything", async () => {
  const { ctx, git } = setup();
  assert.equal(await prePushCheck(line("refs/heads/work", NEW, ZERO), ctx), 0);
  assert.ok(!git.calls.some((call) => call.args[0] === "merge-base"));
});

void test("pre-push: deleting a branch is allowed and not measured", async () => {
  const { ctx, git, stderr } = setup({ ancestor: 1, numstat: HUGE });
  assert.equal(await prePushCheck(line("refs/heads/work", ZERO, OLD), ctx), 0);
  assert.equal(stderr.lines.length, 0);
  assert.equal(git.calls.length, 0);
});

void test("pre-push: tags are left alone", async () => {
  const { ctx, git } = setup({ ancestor: 1 });
  assert.equal(await prePushCheck(line("refs/tags/v1", NEW, OLD), ctx), 0);
  assert.equal(git.calls.length, 0);
});

void test("pre-push: one refused branch refuses the whole push, and the others are still judged", async () => {
  const { ctx, stderr } = setup({ ancestor: 1 });
  const input =
    line("refs/heads/one", NEW, OLD) + line("refs/heads/two", NEW, OLD);
  assert.equal(await prePushCheck(input, ctx), 1);
  const out = stderr.lines.join("");
  assert.match(out, /refusing to push one:/);
  assert.match(out, /refusing to push two:/);
});

void test("pre-push: an oversized branch prints the size warning to stderr and is still allowed", async () => {
  const { ctx, stderr, stdout } = setup({ numstat: HUGE });
  assert.equal(await prePushCheck(line("refs/heads/work", NEW, ZERO), ctx), 0);
  assert.match(
    stderr.lines.join(""),
    /warning: this pull request may be too big/,
  );
  assert.match(stderr.lines.join(""), /1,178 lines/);
  assert.equal(stdout.lines.length, 0);
});

void test("pre-push: the size is measured against origin's default branch, with no gh call", async () => {
  const { ctx, git, gh } = setup({ numstat: HUGE, originHead: "master" });
  await prePushCheck(line("refs/heads/work", NEW, ZERO), ctx);
  const diff = git.calls.find((call) => call.args[0] === "diff");
  assert.ok(diff?.args.includes(`origin/master...${NEW}`));
  assert.equal(gh.calls.length, 0, "no pull request exists yet to read");
});

void test("pre-push: a push to the default branch is not measured or second-guessed here", async () => {
  const { ctx, git, stderr } = setup({ numstat: HUGE });
  assert.equal(await prePushCheck(line("refs/heads/main", NEW, OLD), ctx), 0);
  assert.equal(stderr.lines.length, 0);
  assert.ok(!git.calls.some((call) => call.args[0] === "diff"));
});

void test("pre-push: when measuring fails, the reason is printed and the push is allowed", async () => {
  const { ctx, stderr } = setup({ diffFails: true });
  assert.equal(await prePushCheck(line("refs/heads/work", NEW, ZERO), ctx), 0);
  const out = stderr.lines.join("");
  assert.match(out, /could not check the size of work, pushing anyway/);
  assert.match(out, /bad revision origin\/main/);
});

void test("pre-push: a push with no branches does nothing", async () => {
  const { ctx, git } = setup();
  assert.equal(await prePushCheck("", ctx), 0);
  assert.equal(git.calls.length, 0);
});
