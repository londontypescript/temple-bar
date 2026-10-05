// Bypass merges are reported, never prevented: these tests hold the report
// to every bypass GitHub lists, with the rules each went past, and to saying
// plainly when GitHub couldn't be read rather than reporting none. The
// answers are shaped like GitHub's real ones for temple-bar's 0.0.7 pin bump.

import assert from "node:assert/strict";
import test from "node:test";

import { bypassReport, readBypasses } from "./bypasses.ts";
import type { GhResult } from "../seams/gh.ts";
import { createFakeContext, createFakeGh } from "../testing/fakes.ts";

const ok = (stdout: string): GhResult => ({
  code: 0,
  stdout,
  stderr: "",
  notFound: false,
});

const SUITE = {
  id: 4350599839,
  after_sha: "4bd23a923cfde9e247195c391aa44e9709f5f8af",
  actor_name: "maintainer",
  pushed_at: "2026-10-04T03:35:02+01:00",
};

const DETAIL = {
  ...SUITE,
  result: "bypass",
  rule_evaluations: [
    {
      rule_source: { type: "ruleset", name: "main: pull requests only" },
      result: "pass",
      rule_type: "pull_request",
    },
    {
      rule_source: { type: "ruleset", name: "main: the judge" },
      result: "fail",
      rule_type: "required_status_checks",
    },
  ],
};

function context(script: (args: readonly string[]) => GhResult) {
  const gh = createFakeGh(script);
  return { gh, ctx: createFakeContext({ gh }) };
}

void test("bypasses: each bypass on the branch is listed with the rules it went past", async () => {
  const { gh, ctx } = context((args) =>
    args.includes("--paginate")
      ? ok(`${JSON.stringify(SUITE)}\n`)
      : ok(JSON.stringify(DETAIL)),
  );
  const history = await readBypasses(ctx, "acme/widgets", "main", "/repo");
  assert.deepEqual(history, {
    ok: true,
    bypasses: [
      {
        commit: SUITE.after_sha,
        actor: "maintainer",
        at: SUITE.pushed_at,
        rules: ["main: the judge (required_status_checks)"],
      },
    ],
  });
  // Only bypasses, only the default branch, as far back as GitHub keeps.
  const list = gh.calls[0]?.args.join(" ") ?? "";
  assert.match(list, /rule_suite_result=bypass/);
  assert.match(list, /ref=refs%2Fheads%2Fmain/);
  assert.match(list, /time_period=month/);
  assert.equal(
    gh.calls[1]?.args.join(" "),
    "api repos/acme/widgets/rulesets/rule-suites/4350599839",
  );
  assert.deepEqual(bypassReport("main", history), [
    "bypass merges on main in the past month: 1. The maintainer merges changes to the checks this way; check each one was theirs:",
    "  4bd23a9 by maintainer at 2026-10-04T03:35:02+01:00, past main: the judge (required_status_checks)",
  ]);
});

void test("bypasses: none is said so", async () => {
  const { ctx } = context(() => ok(""));
  const history = await readBypasses(ctx, "acme/widgets", "main", "/repo");
  assert.deepEqual(bypassReport("main", history), [
    "bypass merges on main in the past month: none",
  ]);
});

void test("bypasses: an answer GitHub won't give is reported as unread, never as none", async () => {
  const { ctx } = context(() => ({
    code: 1,
    stdout: "",
    stderr: "gh: Resource not accessible by personal access token (HTTP 403)",
    notFound: false,
  }));
  const report = bypassReport(
    "main",
    await readBypasses(ctx, "acme/widgets", "main", "/repo"),
  ).join("\n");
  assert.match(report, /couldn't be read \(gh: Resource not accessible/);
  assert.match(report, /administration settings/);
  assert.doesNotMatch(report, /none/);

  const garbled = context(() => ok('{"id":"x"}\n'));
  assert.deepEqual(
    await readBypasses(garbled.ctx, "acme/widgets", "main", "/repo"),
    { ok: false, reason: "GitHub listed rule suites unexpectedly" },
  );
});
