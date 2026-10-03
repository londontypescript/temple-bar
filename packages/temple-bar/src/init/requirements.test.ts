import assert from "node:assert/strict";
import test from "node:test";

import {
  checkGhInstalled,
  checkGhSignedIn,
  checkGitRepo,
  checkOrigin,
  parseGithubOrigin,
  RERUN_INIT,
  rerunInit,
  wrongHostMessage,
} from "./requirements.ts";
import {
  createFakeContext,
  createFakeGh,
  createFakeGit,
} from "../testing/fakes.ts";

void test("parseGithubOrigin accepts https, ssh-shorthand and full ssh URLs", () => {
  assert.deepEqual(parseGithubOrigin("https://github.com/acme/widgets"), {
    owner: "acme",
    repo: "widgets",
  });
  assert.deepEqual(parseGithubOrigin("https://github.com/acme/widgets.git"), {
    owner: "acme",
    repo: "widgets",
  });
  assert.deepEqual(parseGithubOrigin("git@github.com:acme/widgets.git"), {
    owner: "acme",
    repo: "widgets",
  });
  assert.deepEqual(parseGithubOrigin("ssh://git@github.com/acme/widgets.git"), {
    owner: "acme",
    repo: "widgets",
  });
});

void test("parseGithubOrigin rejects non-GitHub hosts", () => {
  assert.equal(parseGithubOrigin("https://gitlab.com/acme/widgets"), undefined);
  assert.equal(
    parseGithubOrigin("git@example.com:acme/widgets.git"),
    undefined,
  );
});

void test("checkGitRepo returns the repo root on success", async () => {
  const git = createFakeGit(() => ({
    code: 0,
    stdout: "/repo\n",
    stderr: "",
  }));
  const ctx = createFakeContext({ git });
  const result = await checkGitRepo(ctx, "/repo/sub");
  assert.deepEqual(result, { ok: true, value: "/repo" });
});

void test("checkGitRepo fails with the exact `git init` fix", async () => {
  const git = createFakeGit(() => ({ code: 128, stdout: "", stderr: "fatal" }));
  const ctx = createFakeContext({ git });
  const result = await checkGitRepo(ctx, "/repo");
  assert.equal(result.ok, false);
  assert.match(result.message, /git init/);
});

void test("checkGhInstalled fails when gh is not on PATH", async () => {
  const gh = createFakeGh(() => ({
    code: null,
    stdout: "",
    stderr: "",
    notFound: true,
  }));
  const ctx = createFakeContext({ gh });
  const result = await checkGhInstalled(ctx, "/repo");
  assert.equal(result.ok, false);
  assert.match(result.message, /cli\.github\.com/);
  assert.match(result.message, /must not install/);
});

void test("checkGhSignedIn fails with the `gh auth login` fix", async () => {
  const gh = createFakeGh(() => ({
    code: 1,
    stdout: "",
    stderr: "not logged in",
    notFound: false,
  }));
  const ctx = createFakeContext({ gh });
  const result = await checkGhSignedIn(ctx, "/repo");
  assert.equal(result.ok, false);
  assert.match(result.message, /gh auth login/);
});

void test("checkOrigin reports missing when there is no origin remote", async () => {
  const git = createFakeGit(() => ({
    code: 1,
    stdout: "",
    stderr: "no such remote",
  }));
  const ctx = createFakeContext({ git });
  const result = await checkOrigin(ctx, "/repo");
  assert.deepEqual(result, { state: "missing" });
});

void test("checkOrigin reports wrong-host for a non-GitHub origin", async () => {
  const git = createFakeGit(() => ({
    code: 0,
    stdout: "https://gitlab.com/acme/widgets\n",
    stderr: "",
  }));
  const ctx = createFakeContext({ git });
  const result = await checkOrigin(ctx, "/repo");
  assert.equal(result.state, "wrong-host");
  assert.match(
    wrongHostMessage("https://gitlab.com/acme/widgets"),
    /doesn't point at GitHub/,
  );
});

void test("checkOrigin reports ok with the parsed owner/repo", async () => {
  const git = createFakeGit(() => ({
    code: 0,
    stdout: "git@github.com:acme/widgets.git\n",
    stderr: "",
  }));
  const ctx = createFakeContext({ git });
  const result = await checkOrigin(ctx, "/repo");
  assert.deepEqual(result, {
    state: "ok",
    origin: { owner: "acme", repo: "widgets" },
  });
});

void test("every rerun hint is a pnpm command, never npx", async () => {
  assert.equal(RERUN_INIT, "`pnpm exec temple-bar init`");
  const git = createFakeGit(() => ({ code: 128, stdout: "", stderr: "" }));
  const notRepo = await checkGitRepo(createFakeContext({ git }), "/app");
  assert.ok(!notRepo.ok);
  assert.match(notRepo.message, /`pnpm exec temple-bar init` again/);
  assert.doesNotMatch(notRepo.message, /npx/);
  assert.doesNotMatch(wrongHostMessage("https://example.com/x"), /npx/);
});

void test("rerunInit keeps every flag inside the one code quote", () => {
  assert.equal(rerunInit(), RERUN_INIT);
  assert.equal(
    rerunInit("--create-ruleset"),
    "`pnpm exec temple-bar init --create-ruleset`",
  );
  assert.equal(
    rerunInit("--create-repo", "--create-ruleset"),
    "`pnpm exec temple-bar init --create-repo --create-ruleset`",
  );
});
