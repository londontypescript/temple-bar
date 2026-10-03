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

function noCommitGit(commitCode: number, calls: string[]) {
  return createFakeGit((args) => {
    calls.push(`git ${args.join(" ")}`);
    if (args[0] === "rev-parse" && args[1] === "HEAD") {
      return { code: 128, stdout: "", stderr: "unknown revision" };
    }
    if (args[0] === "commit") {
      return commitCode === 0
        ? { code: 0, stdout: "", stderr: "" }
        : { code: 1, stdout: "", stderr: "error: gpg failed to sign\nmore" };
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
}

void test("offerRepoCreation: yes with no commits writes the files, commits, then creates and pushes", async () => {
  const calls: string[] = [];
  const gh = createFakeGh((args) => {
    calls.push(`gh ${args.join(" ")}`);
    return { code: 0, stdout: "", stderr: "", notFound: false };
  });
  const ctx = createFakeContext({
    prompt: createFakePrompt({ interactive: true, answer: "yes" }),
    git: noCommitGit(0, calls),
    gh,
  });
  const outcome = await offerRepoCreation(ctx, "/repo/widgets", () => {
    calls.push("prepare");
    return Promise.resolve();
  });
  assert.equal(outcome.kind, "created");
  const order = calls.filter(
    (c) => !c.startsWith("git rev-parse") && !c.startsWith("git remote"),
  );
  assert.deepEqual(order.slice(0, 3), [
    "prepare",
    "git add -A",
    "git commit -m Initial commit",
  ]);
  assert.match(order[3] ?? "", /^gh repo create widgets .* --push$/);
});

void test("offerRepoCreation: a first commit that can't be made still creates the repo, without pushing, and names the one command left", async () => {
  const calls: string[] = [];
  const gh = createFakeGh((args) => {
    calls.push(`gh ${args.join(" ")}`);
    return { code: 0, stdout: "", stderr: "", notFound: false };
  });
  const ctx = createFakeContext({
    prompt: createFakePrompt({ interactive: true, answer: "yes" }),
    git: noCommitGit(1, calls),
    gh,
  });
  const outcome = await offerRepoCreation(ctx, "/repo/widgets");
  assert.equal(outcome.kind, "commit-needed");
  assert.ok(!calls.some((c) => c.endsWith("--push")), "nothing to push yet");
  assert.match(outcome.message, /gpg failed to sign/);
  assert.ok(
    outcome.message.includes(
      'git commit -m "Initial commit" && git push -u origin HEAD',
    ),
  );
});

void test("offerRepoCreation: with commits already there it commits nothing", async () => {
  const calls: string[] = [];
  const git = createFakeGit((args) => {
    calls.push(args[0] ?? "");
    return args[0] === "remote"
      ? { code: 0, stdout: "git@github.com:acme/widgets.git\n", stderr: "" }
      : { code: 0, stdout: "abc\n", stderr: "" };
  });
  const ctx = createFakeContext({
    prompt: createFakePrompt({ interactive: true, answer: "yes" }),
    git,
    gh: createFakeGh(() => ({
      code: 0,
      stdout: "",
      stderr: "",
      notFound: false,
    })),
  });
  await offerRepoCreation(ctx, "/repo/widgets", () => {
    throw new Error("must not prepare");
  });
  assert.ok(!calls.includes("add") && !calls.includes("commit"));
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

void test("offerRepoCreation: no terminal names the flag an agent passes after asking the user", async () => {
  const ctx = createFakeContext({
    prompt: createFakePrompt({ interactive: false, answer: "no-terminal" }),
    gh: createFakeGh(),
  });
  const outcome = await offerRepoCreation(ctx, "/repo");
  assert.equal(outcome.kind, "declined");
  // The flag sits inside the quote, so copying the command copies the flag.
  assert.match(outcome.message, /`pnpm exec temple-bar init --create-repo`/);
});

void test("offerRepoCreation: approved (--create-repo) creates with no prompt, even with no terminal", async () => {
  let asked = false;
  const gh = createFakeGh();
  const ctx = createFakeContext({
    git: createFakeGit((args) =>
      args[0] === "remote"
        ? { code: 0, stdout: "git@github.com:acme/widgets.git\n", stderr: "" }
        : { code: 0, stdout: "abc\n", stderr: "" },
    ),
    prompt: {
      isInteractive: () => false,
      confirm: () => {
        asked = true;
        return Promise.resolve("no-terminal");
      },
    },
    gh,
  });
  const outcome = await offerRepoCreation(ctx, "/repo", undefined, true);
  assert.equal(outcome.kind, "created");
  assert.equal(asked, false);
  assert.equal(gh.calls[0]?.args[0], "repo");
});
