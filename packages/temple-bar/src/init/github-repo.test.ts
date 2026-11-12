import assert from "node:assert/strict";
import test from "node:test";

import {
  licenseNote,
  offerRepoCreation,
  repoCreateCommand,
  type RepoCreateRequest,
} from "./github-repo.ts";
import { readHeadState, readPushIdentities } from "./push-identities.ts";
import { newWorld, worldSeams, type World } from "./testing/creation-world.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakePrompt,
} from "../testing/fakes.ts";
import type { Context } from "../context.ts";
import type { ConfirmResult } from "../seams/prompt.ts";

const ROOT = "/repo/widgets";

function contextFor(
  world: World,
  answer: ConfirmResult = "no-terminal",
  onQuestion: (question: string) => void = () => undefined,
): Context {
  return createFakeContext({
    ...worldSeams(world),
    prompt: {
      isInteractive: () => answer !== "no-terminal",
      confirm: (question) => {
        onQuestion(question);
        return Promise.resolve(answer);
      },
    },
  });
}

/** The code setup shows for the world as it stands. */
async function codeFor(world: World): Promise<string> {
  const ctx = contextFor(newWorld({ ...world, calls: [] }));
  const read = await readPushIdentities(
    ctx,
    ROOT,
    await readHeadState(ctx, ROOT),
  );
  assert.ok(read.ok);
  return read.value.code;
}

function request(
  overrides: Partial<RepoCreateRequest> = {},
): RepoCreateRequest {
  return {
    owner: "acme",
    approved: false,
    identitiesCode: undefined,
    ...overrides,
  };
}

const created = (world: World) =>
  world.calls.filter((call) => call.startsWith("gh repo create"));
const pushes = (world: World) =>
  world.calls.filter((call) => call.includes(" push "));

void test("with no owner named, setup stops, asks for an organisation and shows the identities, creating nothing", async () => {
  const world = newWorld();
  const outcome = await offerRepoCreation(
    contextFor(world),
    ROOT,
    request({ owner: undefined }),
  );
  assert.equal(outcome.kind, "declined");
  assert.ok(!("origin" in outcome));
  const code = await codeFor(world);
  assert.match(outcome.message, /never a\s+personal account/);
  assert.ok(
    outcome.message.includes(
      `\`pnpm exec temple-bar init --create-repo --owner <organisation> --identities ${code}\``,
    ),
  );
  assert.ok(
    outcome.message.includes(repoCreateCommand("<organisation>", "widgets")),
  );
  assert.ok(
    outcome.message.includes(
      "Ada Lovelace <ada@example.com>: author, committer",
    ),
  );
  assert.deepEqual(created(world), []);
});

void test("no terminal: the stop names <org>/<name> and the full rerun, and creates nothing", async () => {
  const world = newWorld();
  const outcome = await offerRepoCreation(contextFor(world), ROOT, request());
  assert.equal(outcome.kind, "declined");
  const code = await codeFor(world);
  assert.ok(outcome.message.includes("acme/widgets"));
  assert.ok(
    outcome.message.includes(
      `\`pnpm exec temple-bar init --create-repo --owner acme --identities ${code}\``,
    ),
  );
  assert.ok(outcome.message.includes(repoCreateCommand("acme", "widgets")));
  assert.deepEqual(created(world), []);
});

void test("the question names the owner and every identity; a no prints the command by hand", async () => {
  const world = newWorld({
    history: [
      {
        author: "Ada Lovelace",
        authorEmail: "ada@example.com",
        committer: "Build Bot",
        committerEmail: "bot@example.com",
        message: "Start\n\nCo-Authored-By: Grace Hopper <grace@example.com>\n",
      },
    ],
    ident: "Ada L <ada@home.example>",
  });
  let asked = "";
  const outcome = await offerRepoCreation(
    contextFor(world, "no", (question) => (asked = question)),
    ROOT,
    request(),
  );
  assert.match(
    asked,
    /Create the public repository acme\/widgets, owned by the organisation acme/,
  );
  for (const line of [
    "Ada Lovelace <ada@example.com>: author",
    "Build Bot <bot@example.com>: committer",
    "Grace Hopper <grace@example.com>: co-author",
    "Ada L <ada@home.example>: your git author identity, your git committer identity",
  ]) {
    assert.ok(asked.includes(line), line);
  }
  assert.equal(outcome.kind, "declined");
  assert.ok(outcome.message.includes(repoCreateCommand("acme", "widgets")));
  assert.deepEqual(created(world), []);
});

void test("--create-repo without the code, or with another one, stops before creating", async () => {
  for (const identitiesCode of [undefined, "0123456789ab"]) {
    const world = newWorld();
    const outcome = await offerRepoCreation(
      contextFor(world),
      ROOT,
      request({ approved: true, identitiesCode }),
    );
    assert.equal(outcome.kind, "declined");
    assert.ok(outcome.message.includes(await codeFor(world)));
    assert.deepEqual(created(world), []);
  }
});

void test("--create-repo with the matching code creates <org>/<name> without --push, then pushes exactly the commit read", async () => {
  const world = newWorld();
  const code = await codeFor(world);
  const outcome = await offerRepoCreation(
    contextFor(world),
    ROOT,
    request({ approved: true, identitiesCode: code }),
  );
  assert.deepEqual(outcome, {
    kind: "created",
    origin: { owner: "acme", repo: "widgets" },
  });
  assert.deepEqual(created(world), [
    "gh repo create acme/widgets --public --source . --remote origin",
  ]);
  assert.deepEqual(pushes(world), [
    "git -c push.followTags=false push origin c0ffee:refs/heads/main",
  ]);
});

void test("in a worktree, the main checkout's folder names the repository", async () => {
  const world = newWorld();
  await offerRepoCreation(
    contextFor(world, "yes"),
    `${ROOT}/.claude/worktrees/setup`,
    request(),
  );
  assert.equal(created(world)[0]?.split(" ")[3], "acme/widgets");
});

void test("an unborn branch: setup's files, its first commit, then creation and the push of that commit", async () => {
  const world = newWorld({ commit: undefined, history: [] });
  const code = await codeFor(world);
  const order: string[] = [];
  const outcome = await offerRepoCreation(
    contextFor(world),
    ROOT,
    request({ approved: true, identitiesCode: code }),
    () => {
      world.calls.push("prepare");
      order.push("prepare");
      return Promise.resolve();
    },
  );
  assert.equal(outcome.kind, "created");
  const steps = world.calls.filter((call) =>
    /^(prepare|git add|git commit|gh repo create|git -c)/.test(call),
  );
  assert.deepEqual(steps, [
    "prepare",
    "git add -A",
    "git commit -m Initial commit",
    "gh repo create acme/widgets --public --source . --remote origin",
    "git -c push.followTags=false push origin 5e7c0de:refs/heads/main",
  ]);
});

void test("a hook's co-author in setup's first commit stops the push", async () => {
  const world = newWorld({
    commit: undefined,
    history: [],
    hookAddsLine: "Co-authored-by: Someone <someone@example.com>\n",
  });
  const code = await codeFor(world);
  const outcome = await offerRepoCreation(
    contextFor(world),
    ROOT,
    request({ approved: true, identitiesCode: code }),
  );
  assert.equal(outcome.kind, "failed");
  assert.ok(
    outcome.message.includes("Someone <someone@example.com>: co-author"),
  );
  assert.deepEqual(pushes(world), []);
});

void test("a commit by someone new while the question waits stops the push", async () => {
  const world = newWorld();
  const outcome = await offerRepoCreation(
    contextFor(world, "yes", () => {
      world.commit = "bada55";
      world.history = [
        { author: "Mallory", authorEmail: "m@example.com", message: "x\n" },
        ...world.history,
      ];
    }),
    ROOT,
    request(),
  );
  assert.equal(outcome.kind, "failed");
  assert.match(outcome.message, /Nothing was pushed to acme\/widgets/);
  assert.ok(outcome.message.includes("Mallory <m@example.com>: author"));
  assert.deepEqual(pushes(world), []);
});

void test("a first commit setup can't make still creates the repository, pushes nothing and names the rerun", async () => {
  const world = newWorld({
    commit: undefined,
    history: [],
    commitAnswer: {
      code: 1,
      stdout: "",
      stderr: "error: gpg failed to sign\nmore",
    },
  });
  const code = await codeFor(world);
  const outcome = await offerRepoCreation(
    contextFor(world, "yes"),
    ROOT,
    request(),
  );
  assert.equal(outcome.kind, "failed");
  assert.equal(created(world).length, 1);
  assert.deepEqual(pushes(world), []);
  assert.match(outcome.message, /gpg failed to sign/);
  assert.ok(
    outcome.message.includes(
      `\`pnpm exec temple-bar init --create-repo --owner acme --identities ${code}\``,
    ),
  );
});

void test("gh failing after adding origin leaves only the push; gh failing before says setup pushed nothing and infers nothing", async () => {
  const failing = {
    code: 1,
    stdout: "",
    stderr: "HTTP 422: name already exists",
    notFound: false,
  };
  const added = newWorld({ createAnswer: failing });
  const afterOrigin = await offerRepoCreation(
    contextFor(added, "yes"),
    ROOT,
    request(),
  );
  assert.equal(afterOrigin.kind, "failed");
  assert.match(
    afterOrigin.message,
    /gh created acme\/widgets and set it as "origin", then failed/,
  );

  const none = newWorld({ createAnswer: failing, createAddsOrigin: false });
  const before = await offerRepoCreation(
    contextFor(none, "yes"),
    ROOT,
    request(),
  );
  assert.equal(before.kind, "failed");
  assert.match(before.message, /failed, and setup pushed nothing/);
  assert.match(before.message, /name already exists/);
  assert.doesNotMatch(before.message, /^Created/);
  for (const world of [added, none]) {
    assert.deepEqual(pushes(world), []);
    assert.ok(!world.calls.some((call) => call.startsWith("gh api")));
  }
});

void test("a failed push is reported as not completed, with the fixes and the rerun", async () => {
  const world = newWorld({
    pushAnswer: {
      code: 128,
      stdout: "",
      stderr: "fatal: Authentication failed",
    },
  });
  const outcome = await offerRepoCreation(
    contextFor(world, "yes"),
    ROOT,
    request(),
  );
  assert.equal(outcome.kind, "failed");
  assert.match(
    outcome.message,
    /didn't complete \(it may or may not have reached/,
  );
  assert.match(outcome.message, /Authentication failed/);
  assert.match(outcome.message, /gh auth setup-git/);
  assert.match(outcome.message, /--create-repo --owner acme --identities/);
});

void test("a push URL elsewhere stops the push", async () => {
  const world = newWorld({
    pushUrls: ["git@github.com:acme/widgets.git", "git@example.com:x/y.git"],
  });
  const outcome = await offerRepoCreation(
    contextFor(world, "yes"),
    ROOT,
    request(),
  );
  assert.equal(outcome.kind, "failed");
  assert.match(outcome.message, /git@example\.com:x\/y\.git/);
  assert.deepEqual(pushes(world), []);
});

void test("a detached HEAD stops before asking or creating", async () => {
  const world = newWorld({ detached: true });
  let asked = false;
  const outcome = await offerRepoCreation(
    contextFor(world, "yes", () => (asked = true)),
    ROOT,
    request(),
  );
  assert.equal(outcome.kind, "declined");
  assert.match(outcome.message, /HEAD is detached/);
  assert.equal(asked, false);
  assert.deepEqual(created(world), []);
});

void test("the LICENSE note appears with no licence file, never with one, and never when the root can't be listed", async () => {
  const without = createFakeContext({
    fs: createFakeFs({ "/repo/README.md": "x" }),
  });
  assert.match((await licenseNote(without, "/repo")) ?? "", /no LICENSE file/);
  for (const name of [
    "LICENSE",
    "licence.md",
    "COPYING",
    "UNLICENSE",
    "LICENSE-MIT",
  ]) {
    const ctx = createFakeContext({
      fs: createFakeFs({ [`/repo/${name}`]: "x" }),
    });
    assert.equal(await licenseNote(ctx, "/repo"), undefined, name);
  }
  const fs = createFakeFs();
  fs.globErrors.set("*", new Error("EACCES"));
  assert.equal(
    await licenseNote(createFakeContext({ fs }), "/repo"),
    undefined,
  );
});

void test("an interactive yes asks, then creates", async () => {
  const world = newWorld();
  const outcome = await offerRepoCreation(
    createFakeContext({
      ...worldSeams(world),
      prompt: createFakePrompt({ interactive: true, answer: "yes" }),
    }),
    ROOT,
    request(),
  );
  assert.equal(outcome.kind, "created");
});
