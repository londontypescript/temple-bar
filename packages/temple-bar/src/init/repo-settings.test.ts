import assert from "node:assert/strict";
import test from "node:test";

import type { GhResult } from "../seams/gh.ts";
import { createFakeContext, createFakeGh } from "../testing/fakes.ts";
import {
  MANUAL_SQUASH_DEFAULTS_STEPS,
  readSquashDefaults,
  setSquashDefaults,
} from "./repo-settings.ts";

const origin = { owner: "acme", repo: "widgets" };

const ok = (body: unknown): GhResult => ({
  code: 0,
  stdout: typeof body === "string" ? body : JSON.stringify(body),
  stderr: "",
  notFound: false,
});

const failed = (stderr: string): GhResult => ({
  code: 1,
  stdout: "",
  stderr,
  notFound: false,
});

const repo = (title: unknown, message: unknown) => ({
  private: false,
  default_branch: "main",
  squash_merge_commit_title: title,
  squash_merge_commit_message: message,
});

void test("readSquashDefaults: PR_TITLE and PR_BODY read as set", async () => {
  const gh = createFakeGh(() => ok(repo("PR_TITLE", "PR_BODY")));
  const read = await readSquashDefaults(
    createFakeContext({ gh }),
    "/repo",
    origin,
  );
  assert.deepEqual(read, { kind: "set" });
  assert.deepEqual(gh.calls[0]?.args, ["api", "repos/acme/widgets"]);
});

void test("readSquashDefaults: GitHub's own defaults, or either half wrong, read as differs with what GitHub has", async () => {
  for (const [title, message] of [
    ["COMMIT_OR_PR_TITLE", "COMMIT_MESSAGES"],
    ["PR_TITLE", "COMMIT_MESSAGES"],
    ["PR_TITLE", "BLANK"],
    ["COMMIT_OR_PR_TITLE", "PR_BODY"],
  ]) {
    const gh = createFakeGh(() => ok(repo(title, message)));
    assert.deepEqual(
      await readSquashDefaults(createFakeContext({ gh }), "/repo", origin),
      { kind: "differs", title, message },
    );
  }
});

void test("readSquashDefaults: a failed read, a reply that isn't JSON, or missing fields are unreadable, never a guess", async () => {
  const cases: [GhResult, RegExp][] = [
    [failed("gh: Forbidden (HTTP 403)"), /HTTP 403/],
    [ok("not json"), /unexpected reply/],
    [ok([]), /no squash merge settings in the reply/],
    [ok({ private: false }), /no squash merge settings in the reply/],
    [ok(repo("PR_TITLE", null)), /no squash merge settings in the reply/],
    [ok(repo(7, "PR_BODY")), /no squash merge settings in the reply/],
  ];
  for (const [answer, reason] of cases) {
    const read = await readSquashDefaults(
      createFakeContext({ gh: createFakeGh(() => answer) }),
      "/repo",
      origin,
    );
    const message = read.kind === "unreadable" ? read.message : "";
    assert.equal(read.kind, "unreadable", answer.stdout);
    assert.match(message, reason);
    assert.match(
      message,
      /couldn't read the repository's squash merge settings/,
    );
  }
});

void test("setSquashDefaults: sends both fields in one PATCH, then reads them back", async () => {
  let patched = false;
  const gh = createFakeGh((args) => {
    if (args.includes("PATCH")) {
      patched = true;
      return ok({});
    }
    return ok(
      patched ? repo("PR_TITLE", "PR_BODY") : repo("X", "COMMIT_MESSAGES"),
    );
  });
  const step = await setSquashDefaults(
    createFakeContext({ gh }),
    "/repo",
    origin,
  );
  assert.equal(step.ok, true);
  assert.match(
    step.message,
    /squash merges now default to the pull request's title and description/i,
  );
  const patch = gh.calls.find((call) => call.args.includes("PATCH"));
  assert.deepEqual(patch?.args, [
    "api",
    "--method",
    "PATCH",
    "repos/acme/widgets",
    "--input",
    "-",
  ]);
  // The assertion above has narrowed `patch` to a call.
  assert.deepEqual(JSON.parse(patch.input ?? ""), {
    squash_merge_commit_title: "PR_TITLE",
    squash_merge_commit_message: "PR_BODY",
  });
  // The read-back comes after the write.
  assert.deepEqual(gh.calls.at(-1)?.args, ["api", "repos/acme/widgets"]);
});

void test("setSquashDefaults: a failed PATCH fails with GitHub's error", async () => {
  const gh = createFakeGh((args) =>
    args.includes("PATCH")
      ? failed("gh: Validation Failed (HTTP 422)")
      : ok(repo("PR_TITLE", "PR_BODY")),
  );
  const step = await setSquashDefaults(
    createFakeContext({ gh }),
    "/repo",
    origin,
  );
  assert.equal(step.ok, false);
  assert.match(step.message, /setting the squash merge defaults failed/);
  assert.match(step.message, /HTTP 422/);
  assert.equal(
    gh.calls.filter((call) => !call.args.includes("PATCH")).length,
    0,
  );
});

void test("setSquashDefaults: an accepted PATCH whose read-back still differs, or can't be read, isn't finished", async () => {
  const cases: [GhResult, RegExp][] = [
    [ok(repo("COMMIT_OR_PR_TITLE", "COMMIT_MESSAGES")), /COMMIT_OR_PR_TITLE/],
    [failed("gh: Service Unavailable (HTTP 503)"), /HTTP 503/],
  ];
  for (const [after, detail] of cases) {
    const gh = createFakeGh((args) =>
      args.includes("PATCH") ? ok({}) : after,
    );
    const step = await setSquashDefaults(
      createFakeContext({ gh }),
      "/repo",
      origin,
    );
    assert.equal(step.ok, false, after.stdout || after.stderr);
    assert.match(step.message, /reading them back/);
    assert.match(step.message, detail);
  }
});

void test("the manual steps name the setting as the site words it", () => {
  assert.match(
    MANUAL_SQUASH_DEFAULTS_STEPS,
    /Settings > General > Pull Requests/,
  );
  assert.match(
    MANUAL_SQUASH_DEFAULTS_STEPS,
    /"Default to pull request title and description"/,
  );
});
