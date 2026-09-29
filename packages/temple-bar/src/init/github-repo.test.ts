import assert from "node:assert/strict";
import test from "node:test";

import { offerRepoCreation, repoCreateCommand } from "./github-repo.ts";
import {
  createFakeContext,
  createFakeGh,
  createFakeGit,
  createFakePrompt,
} from "../testing/fakes.ts";

void test("offerRepoCreation: no-terminal prints the steps and doesn't touch gh", async () => {
  const gh = createFakeGh();
  const ctx = createFakeContext({
    prompt: createFakePrompt({ interactive: false, answer: "no-terminal" }),
    gh,
  });
  const outcome = await offerRepoCreation(ctx, "/repo");
  assert.equal(outcome.kind, "declined");
  assert.ok(outcome.message.includes(repoCreateCommand("repo")));
  assert.equal(gh.calls.length, 0);
});

void test("offerRepoCreation: an explicit no prints the command and doesn't touch gh", async () => {
  const gh = createFakeGh();
  const ctx = createFakeContext({
    prompt: createFakePrompt({ interactive: true, answer: "no" }),
    gh,
  });
  const outcome = await offerRepoCreation(ctx, "/repo");
  assert.equal(outcome.kind, "declined");
  assert.equal(gh.calls.length, 0);
});

void test("offerRepoCreation: yes but no commits yet stops safely without pushing", async () => {
  const git = createFakeGit((args) =>
    args[0] === "rev-parse" && args[1] === "HEAD"
      ? { code: 128, stdout: "", stderr: "unknown revision" }
      : { code: 0, stdout: "", stderr: "" },
  );
  const gh = createFakeGh();
  const ctx = createFakeContext({
    prompt: createFakePrompt({ interactive: true, answer: "yes" }),
    git,
    gh,
  });
  const outcome = await offerRepoCreation(ctx, "/repo");
  assert.equal(outcome.kind, "no-commits");
  assert.ok(outcome.message.includes("no commits yet"));
  assert.equal(gh.calls.length, 0, "must never push with no commits");
});

void test("offerRepoCreation: yes with commits creates and pushes, returning the parsed origin", async () => {
  const git = createFakeGit((args) => {
    if (args[0] === "rev-parse" && args[1] === "HEAD") {
      return { code: 0, stdout: "abc123\n", stderr: "" };
    }
    if (args[0] === "remote") {
      return {
        code: 0,
        stdout: "git@github.com:acme/widgets.git\n",
        stderr: "",
      };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  const gh = createFakeGh(() => ({
    code: 0,
    stdout: "",
    stderr: "",
    notFound: false,
  }));
  const ctx = createFakeContext({
    prompt: createFakePrompt({ interactive: true, answer: "yes" }),
    git,
    gh,
    cwd: "/repo/widgets",
  });
  const outcome = await offerRepoCreation(ctx, "/repo/widgets");
  assert.deepEqual(outcome, {
    kind: "created",
    origin: { owner: "acme", repo: "widgets" },
  });
  assert.deepEqual(gh.calls[0]?.args.slice(0, 2), ["repo", "create"]);
});

void test("offerRepoCreation: yes with commits but a failing `gh repo create` reports failure", async () => {
  const git = createFakeGit((args) =>
    args[0] === "rev-parse" && args[1] === "HEAD"
      ? { code: 0, stdout: "abc123\n", stderr: "" }
      : { code: 0, stdout: "", stderr: "" },
  );
  const gh = createFakeGh(() => ({
    code: 1,
    stdout: "",
    stderr: "HTTP 422: name already exists",
    notFound: false,
  }));
  const ctx = createFakeContext({
    prompt: createFakePrompt({ interactive: true, answer: "yes" }),
    git,
    gh,
  });
  const outcome = await offerRepoCreation(ctx, "/repo");
  assert.equal(outcome.kind, "failed");
});
