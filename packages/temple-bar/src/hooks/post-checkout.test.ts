// Unit tests for post-checkout.ts through the fakes: when it acts at all,
// what it runs, and what a failed install says.

import assert from "node:assert/strict";
import test from "node:test";

import type { GitResult } from "../seams/git.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
  createFakeProc,
  createFakeWriter,
} from "../testing/fakes.ts";
import { postCheckout } from "./post-checkout.ts";

const ZEROS = "0".repeat(40);
const SOME_COMMIT = "e67c04d39aae2f9c0bbdd8342c8a9e3ed5110f38";

function ok(stdout: string): GitResult {
  return { code: 0, stdout, stderr: "" };
}

/** git as seen from inside a linked worktree at /worktree of the repo whose
 * primary checkout is /primary; `linked: false` makes it the primary itself,
 * as in a fresh clone. */
function repoScript(
  options: { linked?: boolean; bare?: boolean } = {},
): (args: readonly string[]) => GitResult {
  const linked = options.linked ?? true;
  return (args) => {
    const joined = args.join(" ");
    if (joined === "rev-parse --git-dir") {
      return ok(linked ? "/primary/.git/worktrees/worktree\n" : ".git\n");
    }
    if (joined === "rev-parse --git-common-dir") {
      return ok(linked ? "/primary/.git\n" : ".git\n");
    }
    if (joined === "rev-parse --show-toplevel") {
      return ok(linked ? "/worktree\n" : "/primary\n");
    }
    if (joined === "worktree list --porcelain") {
      const primary = options.bare
        ? "worktree /primary\nbare\n"
        : "worktree /primary\nHEAD abc\nbranch refs/heads/main\n";
      return ok(
        `${primary}\nworktree /worktree\nHEAD abc\nbranch refs/heads/b\n`,
      );
    }
    if (args[0] === "ls-files") {
      return ok("");
    }
    return { code: 1, stdout: "", stderr: `unexpected: git ${joined}` };
  };
}

function repoGit(options: { linked?: boolean; bare?: boolean } = {}) {
  return createFakeGit(repoScript(options));
}

void test("post-checkout: a checkout with a previous HEAD does nothing, without even asking git", async () => {
  const git = createFakeGit();
  const proc = createFakeProc();
  const stdout = createFakeWriter();
  const ctx = createFakeContext({ git, proc, stdout, cwd: "/worktree" });

  const code = await postCheckout(SOME_COMMIT, ctx);

  assert.equal(code, 0);
  assert.equal(git.calls.length, 0);
  assert.equal(proc.calls.length, 0);
  assert.deepEqual(stdout.lines, []);
});

void test("post-checkout: the first checkout of a fresh clone (not a linked worktree) does nothing", async () => {
  const proc = createFakeProc();
  const stdout = createFakeWriter();
  const fs = createFakeFs({ "/primary/pnpm-lock.yaml": "" });
  const ctx = createFakeContext({
    git: repoGit({ linked: false }),
    proc,
    fs,
    stdout,
    cwd: "/primary",
  });

  const code = await postCheckout(ZEROS, ctx);

  assert.equal(code, 0);
  assert.equal(proc.calls.length, 0);
  assert.deepEqual(stdout.lines, []);
});

void test("post-checkout: a new worktree gets pnpm install --frozen-lockfile, run in the worktree", async () => {
  const proc = createFakeProc();
  const fs = createFakeFs({ "/worktree/pnpm-lock.yaml": "" });
  const ctx = createFakeContext({
    git: repoGit(),
    proc,
    fs,
    cwd: "/worktree",
    env: { PATH: "/bin" },
  });

  const code = await postCheckout(ZEROS, ctx);

  assert.equal(code, 0);
  assert.deepEqual(
    proc.calls.map((call) => [call.command, call.args, call.cwd, call.env]),
    [["pnpm", ["install", "--frozen-lockfile"], "/worktree", { PATH: "/bin" }]],
  );
});

void test("post-checkout: with no pnpm-lock.yaml nothing is installed, and it says so", async () => {
  const proc = createFakeProc();
  const stdout = createFakeWriter();
  const ctx = createFakeContext({
    git: repoGit(),
    proc,
    stdout,
    cwd: "/worktree",
  });

  const code = await postCheckout(ZEROS, ctx);

  assert.equal(code, 0);
  assert.equal(proc.calls.length, 0);
  assert.match(stdout.lines.join(""), /no pnpm-lock\.yaml here/);
});

void test("post-checkout: a failed install exits 1 and says the worktree exists and what to run", async () => {
  const proc = createFakeProc(() => 1);
  const stderr = createFakeWriter();
  const fs = createFakeFs({ "/worktree/pnpm-lock.yaml": "" });
  const ctx = createFakeContext({
    git: repoGit(),
    proc,
    fs,
    stderr,
    cwd: "/worktree",
  });

  const code = await postCheckout(ZEROS, ctx);

  assert.equal(code, 1);
  const message = stderr.lines.join("");
  assert.match(message, /pnpm install --frozen-lockfile failed \(exit 1\)/);
  assert.match(message, /The worktree itself was made/);
  assert.match(message, /cd "\/worktree" && pnpm install --frozen-lockfile/);
});

void test("post-checkout: env files are copied before the install, so a failed install still leaves them", async () => {
  const order: string[] = [];
  const fs = createFakeFs({
    "/primary/.env": "A=1\n",
    "/worktree/pnpm-lock.yaml": "",
  });
  const inRepo = repoScript();
  const git = createFakeGit((args) => {
    if (args[0] === "ls-files" && args.includes("--ignored")) {
      order.push("env");
      return ok(".env\0");
    }
    return inRepo(args);
  });
  const proc = createFakeProc(() => {
    order.push("install");
    return 1;
  });
  const ctx = createFakeContext({ git, proc, fs, cwd: "/worktree" });

  const code = await postCheckout(ZEROS, ctx);

  assert.equal(code, 1);
  assert.deepEqual(order, ["env", "install"]);
  assert.equal(fs.files.get("/worktree/.env"), "A=1\n");
});

void test("post-checkout: a bare primary means no env files to copy, and the install still runs", async () => {
  const proc = createFakeProc();
  const stdout = createFakeWriter();
  const fs = createFakeFs({ "/worktree/pnpm-lock.yaml": "" });
  const ctx = createFakeContext({
    git: repoGit({ bare: true }),
    proc,
    fs,
    stdout,
    cwd: "/worktree",
  });

  const code = await postCheckout(ZEROS, ctx);

  assert.equal(code, 0);
  assert.match(
    stdout.lines.join(""),
    /no primary checkout to copy env files from/,
  );
  assert.equal(proc.calls.length, 1);
});
