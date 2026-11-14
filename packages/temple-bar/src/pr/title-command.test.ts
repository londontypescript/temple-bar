import assert from "node:assert/strict";
import test from "node:test";

import type { HttpResult } from "../seams/http.ts";
import type { GitResult } from "../seams/git.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
  createFakeHttp,
  createFakeWriter,
} from "../testing/fakes.ts";
import { prTitleCommand } from "./title-command.ts";

const EVENT = "/event.json";
const HEAD = "a".repeat(40);
const ADA = "Ada <ada@example.com>";
const SOL = "ChatGPT Sol 6.1";
const PR_URL = "https://api.github.com/repos/acme/widgets/pulls/5";
const CREDITED = `- one change\n\nCo-Authored-By: ${ADA}\nReviewed-by: ${SOL}\n`;

const ok = (stdout: string): GitResult => ({ code: 0, stdout, stderr: "" });

function pullRequest(fields: Record<string, unknown> = {}): HttpResult {
  return {
    kind: "response",
    status: 200,
    body: JSON.stringify({
      number: 5,
      title: "feat: a change",
      body: CREDITED,
      head: { sha: HEAD },
      base: { ref: "main" },
      ...fields,
    }),
  };
}

/** A pull_request run in GitHub Actions: the event names #5 (with a stale
 * title the check must not use), GitHub answers `reply`, and the checkout
 * is whole, at `head`, with commits crediting `commits`. */
function world(
  options: {
    reply?: HttpResult;
    head?: string;
    shallow?: GitResult;
    log?: GitResult;
    commits?: string;
    env?: Record<string, string | undefined>;
    event?: unknown;
  } = {},
) {
  const stderr = createFakeWriter();
  const http = createFakeHttp(() => options.reply ?? pullRequest());
  const git = createFakeGit((args) => {
    if (args.includes("--is-shallow-repository")) {
      return options.shallow ?? ok("false\n");
    }
    if (args[0] === "rev-parse") {
      return ok(`${options.head ?? HEAD}\n`);
    }
    return (
      options.log ??
      ok(options.commits ?? `Co-authored-by: ${ADA}\n\nReviewed-by: ${SOL}\n`)
    );
  });
  const ctx = createFakeContext({
    stderr,
    http,
    git,
    env: {
      GITHUB_EVENT_PATH: EVENT,
      GITHUB_REPOSITORY: "acme/widgets",
      GITHUB_ACTIONS: "true",
      GH_TOKEN: "token",
      ...options.env,
    },
    fs: createFakeFs({
      [EVENT]: JSON.stringify(
        options.event ?? {
          pull_request: { number: 5, title: "stale title", body: "" },
        },
      ),
    }),
  });
  return {
    stderr,
    http,
    git,
    text: () => stderr.lines.join(""),
    run: () => prTitleCommand.run([], ctx),
  };
}

void test("pr-title: a conventional title given as an argument exits 0, and reads nothing else", async () => {
  const t = world();
  assert.equal(
    await prTitleCommand.run(
      ["feat(gate): add a check"],
      createFakeContext({ stderr: t.stderr, http: t.http, git: t.git }),
    ),
    0,
  );
  assert.equal(t.stderr.lines.length, 0);
  assert.equal(t.http.calls.length, 0);
  assert.equal(t.git.calls.length, 0);
});

void test("pr-title: an unprefixed title exits 1 with the same refusal as the hook", async () => {
  const stderr = createFakeWriter();
  const ctx = createFakeContext({ stderr });

  const code = await prTitleCommand.run(["Add a check"], ctx);
  const text = stderr.lines.join("");
  assert.match(text, /the pull request title needs a conventional prefix/);
  assert.match(text, /feat, fix, docs, chore/);
  assert.equal(code, 1);
});

void test("pr-title: in CI it reads the pull request live with the token, and passes when the description credits everyone", async () => {
  const t = world();
  assert.equal(await t.run(), 0, t.text());
  assert.deepEqual(t.http.calls, [{ url: PR_URL, token: "token" }]);
  const log = t.git.calls.find((call) => call.args[0] === "log");
  assert.equal(log?.args.at(-1), `origin/main..${HEAD}`);
});

void test("pr-title: the title checked is the live one, never the event's", async () => {
  const stale = world({ reply: pullRequest({ title: "a thing" }) });
  assert.equal(await stale.run(), 1);
  assert.match(stale.text(), /the pull request title needs/);

  const fixed = world({
    event: { pull_request: { number: 5, title: "a thing" } },
  });
  assert.equal(await fixed.run(), 0, fixed.text());
});

void test("pr-title: a description missing a trailer the commits carry fails, printing exactly the lines to add", async () => {
  const t = world({
    reply: pullRequest({ body: `- one\n\nCo-Authored-By: ${ADA}` }),
    commits: `Co-authored-by: ${ADA}\nReviewed-by: ${SOL}\nCo-authored-by: Bob <bob@example.com>\n`,
  });
  assert.equal(await t.run(), 1);
  assert.match(t.text(), /must end with a trailer block/);
  assert.ok(
    t
      .text()
      .endsWith(
        "\nCo-Authored-By: Bob <bob@example.com>\nReviewed-by: ChatGPT Sol 6.1\n",
      ),
    t.text(),
  );
});

void test("pr-title: trailers that aren't the description's last paragraph don't count", async () => {
  for (const body of [
    `Co-Authored-By: ${ADA}\nReviewed-by: ${SOL}\n\nThanks!`,
    `- one\n\`\`\`\nCo-Authored-By: ${ADA}\nReviewed-by: ${SOL}\n\`\`\``,
    `- one\n\nCo-Authored-By: ${ADA}\nReviewed-by: ${SOL}\n<!-- end -->`,
  ]) {
    const t = world({ reply: pullRequest({ body }) });
    assert.equal(await t.run(), 1, body);
    assert.match(t.text(), /Co-Authored-By: Ada/);
  }
});

void test("pr-title: case and spacing don't matter, as in merge, and CRLF is fine", async () => {
  const t = world({
    reply: pullRequest({
      body: `- one\r\n\r\nco-authored-by:  ada   <ADA@example.com>\r\nREVIEWED-BY: chatgpt sol 6.1\r\n`,
    }),
  });
  assert.equal(await t.run(), 0, t.text());
});

void test("pr-title: commits with no trailers need none, even with no description at all", async () => {
  const t = world({ reply: pullRequest({ body: null }), commits: "\n\n" });
  assert.equal(await t.run(), 0, t.text());
});

void test("pr-title: a head that moved since the checkout fails and says to rerun, without reading commits", async () => {
  const t = world({ head: "b".repeat(40) });
  assert.equal(await t.run(), 1);
  assert.match(t.text(), /head is now a{40}, but this run checked out b{40}/);
  assert.match(t.text(), /Rerun the check for the newest push/);
  assert.equal(
    t.git.calls.some((call) => call.args[0] === "log"),
    false,
  );
});

void test("pr-title: a shallow checkout, or one git can't describe, fails", async () => {
  for (const [shallow, message] of [
    [ok("true\n"), /the checkout is shallow/],
    [{ code: 128, stdout: "", stderr: "fatal" }, /could not tell whether/],
  ] as const) {
    const t = world({ shallow });
    assert.equal(await t.run(), 1);
    assert.match(t.text(), message);
    assert.match(t.text(), /fetch-depth: 0/);
  }
});

void test("pr-title: commits git can't read (no base branch fetched) fail", async () => {
  const t = world({
    log: { code: 128, stdout: "", stderr: "fatal: bad revision 'origin/main'" },
  });
  assert.equal(await t.run(), 1);
  assert.match(t.text(), /could not read the branch's commits/);
  assert.match(t.text(), /bad revision/);
  assert.match(t.text(), /fetch-depth: 0/);
});

void test("pr-title: any failure to read the pull request fails, and nothing else is read", async () => {
  const replies: HttpResult[] = [
    { kind: "network-error", message: "getaddrinfo ENOTFOUND" },
    { kind: "response", status: 404, body: "{}" },
    { kind: "response", status: 403, body: "{}" },
    { kind: "response", status: 429, body: "{}" },
    { kind: "response", status: 502, body: "" },
    { kind: "response", status: 200, body: "not json" },
    { kind: "response", status: 200, body: "[]" },
    pullRequest({ title: undefined }),
    pullRequest({ body: 7 }),
    pullRequest({ head: { sha: "abc" } }),
    pullRequest({ head: null }),
    pullRequest({ base: { ref: "" } }),
  ];
  for (const reply of replies) {
    const t = world({ reply });
    assert.equal(await t.run(), 1, JSON.stringify(reply));
    assert.match(t.text(), /could not read pull request #5 from GitHub/);
    assert.equal(t.git.calls.length, 0);
  }
});

void test("pr-title: an answer that isn't 200 fails on its status, even with a whole pull request in it", async () => {
  for (const status of [201, 304, 403, 404]) {
    const reply = { ...pullRequest(), status };
    const t = world({ reply });
    assert.equal(await t.run(), 1, String(status));
    assert.ok(t.text().includes(`GitHub answered ${String(status)}`), t.text());
    assert.equal(t.git.calls.length, 0);
  }
});

void test("pr-title: in Actions with no token it fails, naming the setup rerun; elsewhere it reads without one", async () => {
  const actions = world({ env: { GH_TOKEN: undefined, GITHUB_TOKEN: "" } });
  assert.equal(await actions.run(), 1);
  assert.match(actions.text(), /pnpm exec temple-bar init/);
  assert.equal(actions.http.calls.length, 0);

  const local = world({ env: { GH_TOKEN: undefined, GITHUB_ACTIONS: "" } });
  assert.equal(await local.run(), 0, local.text());
  assert.equal(local.http.calls[0]?.token, undefined);
});

void test("pr-title: GITHUB_API_URL and the event's repository are used when GitHub gives them", async () => {
  const t = world({
    env: {
      GITHUB_API_URL: "https://ghe.example.com/api/v3",
      GITHUB_REPOSITORY: undefined,
    },
    event: {
      pull_request: { number: 5 },
      repository: { full_name: "acme/widgets" },
    },
  });
  assert.equal(await t.run(), 0, t.text());
  assert.equal(
    t.http.calls[0]?.url,
    "https://ghe.example.com/api/v3/repos/acme/widgets/pulls/5",
  );
});

void test("pr-title: no pull request to check exits 2 and says what to do", async () => {
  const noEnv = createFakeWriter();
  assert.equal(
    await prTitleCommand.run([], createFakeContext({ stderr: noEnv })),
    2,
  );
  assert.match(noEnv.lines.join(""), /no pull request title to check/);

  for (const content of [
    "not json",
    JSON.stringify({ ref: "refs/heads/x" }),
    JSON.stringify({ pull_request: { title: "fix: x" } }),
    JSON.stringify({ pull_request: { number: "5" } }),
    JSON.stringify({ pull_request: { number: 0 } }),
    JSON.stringify({ pull_request: { number: 1.5 } }),
  ]) {
    const http = createFakeHttp();
    const ctx = createFakeContext({
      env: { GITHUB_EVENT_PATH: EVENT, GITHUB_REPOSITORY: "acme/widgets" },
      fs: createFakeFs({ [EVENT]: content }),
      http,
    });
    assert.equal(await prTitleCommand.run([], ctx), 2, content);
    assert.equal(http.calls.length, 0);
  }

  const noRepository = createFakeContext({
    env: { GITHUB_EVENT_PATH: EVENT },
    fs: createFakeFs({
      [EVENT]: JSON.stringify({ pull_request: { number: 5 } }),
    }),
  });
  assert.equal(await prTitleCommand.run([], noRepository), 2);

  const missingFile = createFakeContext({ env: { GITHUB_EVENT_PATH: EVENT } });
  assert.equal(await prTitleCommand.run([], missingFile), 2);
});
