// Which repositories `init` works on (ADR 0021): public ones owned by an
// organisation. Every refusal here happens before setup writes anything,
// .gitignore included, and before any change on GitHub.

import assert from "node:assert/strict";
import test from "node:test";

import {
  ACME_WIDGETS,
  defaultGhScript,
  defaultGitScript,
  isOwnerCheck,
  makeFixture,
  runInitFor,
  setUpFiles,
  worldFixture,
  type Fixture,
} from "./testing/command-fixture.ts";
import { newWorld, type World } from "./testing/creation-world.ts";
import { createFakeFs, createFakeGh, createFakeGit } from "../testing/fakes.ts";
import type { FakeFs } from "../testing/fakes.ts";
import type { GhResult } from "../seams/gh.ts";

/** Nothing written, nothing committed, nothing created or protected. */
function assertUntouched(fixture: Fixture, fs: FakeFs, calls: string[]): void {
  assert.deepEqual(fs.writes, []);
  for (const call of calls) {
    assert.doesNotMatch(
      call,
      /^git (add|commit|push)|-c push|^gh repo|POST|PUT|PATCH/,
    );
  }
  assert.equal(fixture.hookCalls.calls, 0);
}

function gitCalls(fixture: Fixture): string[] {
  const git = fixture.ctx.git as ReturnType<typeof createFakeGit>;
  const gh = fixture.ctx.gh as ReturnType<typeof createFakeGh>;
  return [
    ...git.calls.map((c) => `git ${c.args.join(" ")}`),
    ...gh.calls.map((c) => `gh ${c.args.join(" ")}`),
  ];
}

void test("a wrong call exits 2 before any git, gh or file access, saying what is wrong", async () => {
  const cases: [string[], RegExp][] = [
    [["--bogus"], /unknown option: --bogus/],
    [["stray"], /unexpected argument: stray/],
    [["--owner"], /--owner needs a value/],
    // A forgotten value, never an owner named "--create-repo".
    [["--owner", "--create-repo"], /--owner needs a value/],
    [["--owner="], /--owner needs a value/],
    [["--owner", "-acme"], /--owner needs a value/],
    [["--owner", "acme", "--owner=acme"], /--owner is given more than once/],
    [["--owner", "acme/widgets"], /isn't a GitHub organisation's name/],
    [["--owner", "two words"], /isn't a GitHub organisation's name/],
    [["--identities", "ABCDEF123456"], /isn't the 12-character code/],
    [["--identities=12345"], /isn't the 12-character code/],
    [["--create-repo"], /--create-repo needs --owner/],
    [
      ["--create-repo", "--identities", "0123456789ab"],
      /--create-repo needs --owner/,
    ],
  ];
  for (const [args, expected] of cases) {
    const fs = createFakeFs();
    const git = createFakeGit(defaultGitScript);
    const gh = createFakeGh(defaultGhScript);
    const fixture = makeFixture({ fs, git, gh });
    assert.equal(await runInitFor(fixture, args), 2, args.join(" "));
    assert.equal(git.calls.length + gh.calls.length, 0, args.join(" "));
    assert.deepEqual(fs.writes, []);
    const said = fixture.stderr.lines.join("");
    assert.match(said, /^init: /);
    assert.match(said, expected, args.join(" "));
  }
});

void test("both forms of each value are accepted", async () => {
  const world = newWorld();
  const fixture = worldFixture(world);
  await runInitFor(fixture, ["--owner=acme", "--identities=0123456789ab"]);
  assert.ok(world.calls.includes("gh api users/acme --hostname github.com"));
});

void test("GH_HOST naming another host is refused before anything is read or written; github.com in any case is fine", async () => {
  const fs = createFakeFs();
  const world = newWorld({ origin: "git@github.com:acme/widgets.git" });
  const fixture = worldFixture(world, "no-terminal", {
    fs,
    env: { GH_HOST: "ghe.example.com" },
  });
  assert.equal(await runInitFor(fixture), 1);
  assert.match(
    fixture.stderr.lines.join(""),
    /GH_HOST is set to "ghe\.example\.com"/,
  );
  assert.ok(!world.calls.some((c) => c.startsWith("gh api")));
  assertUntouched(fixture, fs, world.calls);

  const fine = worldFixture(
    newWorld({ origin: "git@github.com:acme/widgets.git" }),
    "no-terminal",
    {
      fs: setUpFiles(),
      env: { GH_HOST: "GitHub.com" },
    },
  );
  assert.equal(await runInitFor(fine), 0, fine.stderr.lines.join(""));
});

void test("an origin git can't read is refused, never taken as missing", async () => {
  const fs = createFakeFs();
  const git = createFakeGit((args) =>
    args[0] === "remote"
      ? { code: 128, stdout: "", stderr: "fatal: bad config line 3" }
      : defaultGitScript(args),
  );
  const fixture = makeFixture({ fs, git }, "yes");
  assert.equal(await runInitFor(fixture, ["--owner", "acme"]), 1);
  assert.match(
    fixture.stderr.lines.join(""),
    /Couldn't read the "origin" remote \(git: fatal: bad config line 3\)/,
  );
  assertUntouched(fixture, fs, gitCalls(fixture));
});

void test("--owner disagreeing with origin's owner is refused", async () => {
  const fs = createFakeFs();
  const world = newWorld({ origin: "git@github.com:acme/widgets.git" });
  const fixture = worldFixture(world, "yes", { fs });
  assert.equal(await runInitFor(fixture, ["--owner", "other"]), 1);
  assert.match(
    fixture.stderr.lines.join(""),
    /--owner other was given, but "origin" points at acme\/widgets/,
  );
  assertUntouched(fixture, fs, world.calls);
  // Case doesn't matter to GitHub, so it doesn't here.
  const same = worldFixture(
    newWorld({ origin: "git@github.com:acme/widgets.git" }),
    "yes",
    { fs: setUpFiles() },
  );
  assert.equal(
    await runInitFor(same, ["--owner", "ACME"]),
    0,
    same.stderr.lines.join(""),
  );
});

void test("a personal account is refused by name, as a new owner and as origin's owner", async () => {
  const newOwner = newWorld();
  const fs = createFakeFs();
  const fixture = worldFixture(newOwner, "yes", { fs });
  assert.equal(await runInitFor(fixture, ["--owner", "ada"]), 1);
  const said = fixture.stderr.lines.join("");
  assert.match(said, /"ada" is a personal GitHub account, not an organisation/);
  assert.match(said, /To prototype, work without temple-bar/);
  assert.match(said, /ask an organisation admin for a repository/);
  assertUntouched(fixture, fs, newOwner.calls);

  const existing = newWorld({
    origin: "git@github.com:ada/widgets.git",
    remote: { type: "User", visibility: "public", private: false },
  });
  const fsTwo = createFakeFs();
  const second = worldFixture(existing, "yes", { fs: fsTwo });
  assert.equal(await runInitFor(second), 1);
  assert.match(
    second.stderr.lines.join(""),
    /owned by "ada" is a personal GitHub account/,
  );
  assertUntouched(second, fsTwo, existing.calls);
});

void test("a repository that isn't public is refused, saying setup never changes visibility", async () => {
  for (const remote of [
    { type: "Organization", visibility: "private", private: true },
    { type: "Organization", visibility: "internal", private: true },
    { type: "Organization", visibility: "public", private: true },
  ]) {
    const world = newWorld({
      origin: "git@github.com:acme/widgets.git",
      remote,
    });
    const fs = createFakeFs();
    const fixture = worldFixture(world, "yes", { fs });
    assert.equal(await runInitFor(fixture), 1, JSON.stringify(remote));
    assert.match(
      fixture.stderr.lines.join(""),
      /never\s+changes a repository's visibility/,
    );
    assertUntouched(fixture, fs, world.calls);
  }
});

/** origin is acme/widgets, and GitHub answers its owner check with `reply`. */
function ownerReply(reply: GhResult): { fixture: Fixture; fs: FakeFs } {
  const fs = createFakeFs();
  const gh = createFakeGh((args) =>
    isOwnerCheck(args, "repos/acme/widgets") ? reply : defaultGhScript(args),
  );
  return { fixture: makeFixture({ fs, gh }, "yes"), fs };
}

const reply = (stdout: string, code = 0, stderr = ""): GhResult => ({
  code,
  stdout,
  stderr,
  notFound: false,
});

void test("an answer GitHub doesn't settle is refused, never assumed fine", async () => {
  const shapes: [GhResult, RegExp][] = [
    [
      reply(JSON.stringify({ visibility: "public", private: false })),
      /owner's type was missing/,
    ],
    [
      reply(
        JSON.stringify({
          owner: { login: "acme", type: "Bot" },
          visibility: "public",
          private: false,
        }),
      ),
      /owner's type was missing or unexpected/,
    ],
    [
      reply(
        JSON.stringify({
          owner: { login: "acme", type: "Organization" },
          private: false,
        }),
      ),
      /visibility was missing/,
    ],
    [reply("<html>"), /unexpected reply/],
    [reply("", 1, "gh: Server Error (HTTP 502)"), /Couldn't confirm.*HTTP 502/],
    [
      reply("", 1, "gh: Not Found (HTTP 404)"),
      /GitHub doesn't show you acme\/widgets/,
    ],
  ];
  for (const [answer, expected] of shapes) {
    const { fixture, fs } = ownerReply(answer);
    assert.equal(await runInitFor(fixture), 1, answer.stdout);
    assert.match(fixture.stderr.lines.join(""), expected);
    assertUntouched(fixture, fs, gitCalls(fixture));
  }
  // The same fake, answering an organisation's public repository, passes.
  const gh = createFakeGh((args) =>
    isOwnerCheck(args, "repos/acme/widgets")
      ? reply(ACME_WIDGETS)
      : defaultGhScript(args),
  );
  const passing = makeFixture({ fs: setUpFiles(), gh });
  assert.equal(await runInitFor(passing), 0, passing.stderr.lines.join(""));
});

void test("a new owner GitHub doesn't know, or can't say, is refused", async () => {
  const unknown = newWorld();
  const fixture = worldFixture(unknown, "yes", { fs: createFakeFs() });
  assert.equal(await runInitFor(fixture, ["--owner", "nobody"]), 1);
  assert.match(
    fixture.stderr.lines.join(""),
    /GitHub has no account named "nobody"/,
  );
  assert.ok(!unknown.calls.some((c) => c.startsWith("gh repo")));
});

function emptyOnGitHub(): World {
  return newWorld({
    origin: "git@github.com:acme/widgets.git",
    remoteHasBranches: false,
  });
}

async function shownCode(world: World): Promise<string> {
  const fixture = worldFixture(world, "no-terminal", { fs: createFakeFs() });
  await runInitFor(fixture, ["--create-repo", "--owner", "acme"]);
  const code = /--identities ([0-9a-f]{12})/.exec(
    fixture.stderr.lines.join(""),
  )?.[1];
  assert.ok(code, fixture.stderr.lines.join(""));
  return code;
}

void test("--create-repo finishes an empty repository's first push, on the agreed code only", async () => {
  const code = await shownCode(emptyOnGitHub());
  for (const given of [[], ["--identities", "0123456789ab"]]) {
    const world = emptyOnGitHub();
    const fixture = worldFixture(world, "no-terminal", { fs: setUpFiles() });
    assert.equal(
      await runInitFor(fixture, ["--create-repo", "--owner", "acme", ...given]),
      1,
    );
    assert.ok(!world.calls.some((c) => c.includes(" push ")));
    assert.match(
      fixture.stderr.lines.join(""),
      /Ada Lovelace <ada@example\.com>/,
    );
  }
  const world = emptyOnGitHub();
  const fixture = worldFixture(world, "no-terminal", { fs: setUpFiles() });
  const exit = await runInitFor(fixture, [
    "--create-repo",
    "--owner",
    "acme",
    "--identities",
    code,
  ]);
  assert.equal(exit, 0, fixture.stderr.lines.join(""));
  assert.ok(
    world.calls.includes(
      "git -c push.followTags=false push origin c0ffee:refs/heads/main",
    ),
  );
  assert.match(
    fixture.stdout.lines.join(""),
    /Pushed this branch to acme\/widgets/,
  );
});

void test("without --create-repo nothing about an existing repository's branches is asked; with branches there, the flag pushes nothing", async () => {
  const quiet = emptyOnGitHub();
  const fixture = worldFixture(quiet, "no-terminal", { fs: setUpFiles() });
  assert.equal(await runInitFor(fixture), 0, fixture.stderr.lines.join(""));
  assert.ok(!quiet.calls.some((c) => c.includes("/branches?per_page")));

  const pushedBefore = newWorld({ origin: "git@github.com:acme/widgets.git" });
  const flagged = worldFixture(pushedBefore, "no-terminal", {
    fs: setUpFiles(),
  });
  assert.equal(
    await runInitFor(flagged, [
      "--create-repo",
      "--owner",
      "acme",
      "--identities",
      "0123456789ab",
    ]),
    0,
  );
  assert.ok(!pushedBefore.calls.some((c) => c.includes(" push ")));
});

void test("the LICENSE note goes to stdout when no licence file exists, and never changes the exit code", async () => {
  const world = newWorld({ origin: "git@github.com:acme/widgets.git" });
  const fixture = worldFixture(world, "no-terminal", { fs: setUpFiles() });
  assert.equal(await runInitFor(fixture), 0);
  assert.match(fixture.stdout.lines.join(""), /no LICENSE file/);

  const licensed = worldFixture(
    newWorld({ origin: "git@github.com:acme/widgets.git" }),
    "no-terminal",
    {
      fs: setUpFiles({ "/repo/LICENSE": "MIT" }),
    },
  );
  assert.equal(await runInitFor(licensed), 0);
  assert.doesNotMatch(licensed.stdout.lines.join(""), /LICENSE/);
});
