import assert from "node:assert/strict";
import test from "node:test";

import {
  GATE_CHECK,
  GATE_WORKFLOW_PATH,
  PR_TITLE_CHECK,
  PR_TITLE_WORKFLOW_PATH,
} from "../init/workflows.ts";
import {
  GITHUB_ACTIONS_APP_ID,
  JUDGE_WORKFLOW_PATH,
} from "../judge/workflow.ts";
import type { HttpResult } from "../seams/http.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
  createFakeHttp,
  createFakeWriter,
} from "../testing/fakes.ts";
import { REQUIRED_CHECKS_CHECK } from "./required-checks-rule.ts";
import { runRulesetChecks } from "./ruleset.ts";
import type { EffectiveRule } from "./ruleset-compare.ts";
import { goodRules, rule } from "./testing/rules-fixture.ts";

const URL = "https://api.github.com/repos/acme/widgets";
const GATE = { context: GATE_CHECK, integration_id: GITHUB_ACTIONS_APP_ID };
const TITLE = {
  context: PR_TITLE_CHECK,
  integration_id: GITHUB_ACTIONS_APP_ID,
};
const NAMES = [
  "branch ruleset",
  "judge ruleset",
  "code scanning rule",
  REQUIRED_CHECKS_CHECK,
];
const json = (status: number, body: unknown = {}): HttpResult => ({
  kind: "response",
  status,
  body: JSON.stringify(body),
});

function checks(
  entries: readonly object[],
  strict: unknown = true,
): EffectiveRule {
  return rule("required_status_checks", {
    strict_required_status_checks_policy: strict,
    required_status_checks: entries,
  });
}

function base(): EffectiveRule[] {
  return goodRules().filter((entry) => {
    const listed: unknown = entry.parameters?.required_status_checks;
    return (
      !Array.isArray(listed) ||
      !listed.some(
        (check: { context?: unknown }) =>
          check.context === GATE_CHECK || check.context === PR_TITLE_CHECK,
      )
    );
  });
}

function setup(
  options: {
    rules?: EffectiveRule[];
    contents?: Readonly<Record<string, HttpResult>>;
    here?: readonly string[];
    repo?: HttpResult;
    rulesReply?: HttpResult;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  const http = createFakeHttp((url) => {
    if (url === URL)
      return (
        options.repo ??
        json(200, { private: false, default_branch: "release/next" })
      );
    if (url.includes("/contents/")) {
      const path = url.split("/contents/")[1]?.split("?")[0] ?? "";
      return options.contents?.[path] ?? json(200);
    }
    return options.rulesReply ?? json(200, options.rules ?? goodRules());
  });
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    git: createFakeGit(() => ({
      code: 0,
      stdout: "git@github.com:acme/widgets.git\n",
      stderr: "",
    })),
    fs: createFakeFs(
      Object.fromEntries(
        (options.here ?? []).map((path) => [`/repo/${path}`, "workflow"]),
      ),
    ),
    http,
    stderr,
    env: options.env ?? {},
  });
  return {
    http,
    stderr,
    run: () => runRulesetChecks(ctx),
    outcome: async () => {
      const all = await runRulesetChecks(ctx);
      assert.deepEqual(
        all.map((entry) => entry.name),
        NAMES,
      );
      const found = all.find((entry) => entry.name === REQUIRED_CHECKS_CHECK);
      assert.ok(found);
      return found;
    },
  };
}

void test("gate and title checks: both required in one strict Actions rule pass without workflow reads", async () => {
  const t = setup();
  assert.deepEqual(await t.outcome(), {
    name: REQUIRED_CHECKS_CHECK,
    status: "passed",
    detail: "the default branch requires the gate and title checks",
  });
  assert.equal(
    t.http.calls.filter((call) => call.url.includes("/contents/")).length,
    0,
  );
  assert.deepEqual(t.stderr.lines, []);
});

void test("gate and title checks: contexts can be required by different active rules, including the judge's rule", async () => {
  const t = setup({
    rules: [
      ...base(),
      checks([GATE]),
      checks([
        { context: "temple-bar judge", integration_id: GITHUB_ACTIONS_APP_ID },
        TITLE,
      ]),
    ],
  });
  assert.equal((await t.outcome()).status, "passed");
});

void test("gate and title checks: missing or wrong integration and non-strict policies are weakened, with no workflow read", async () => {
  for (const weakened of [
    checks([{ context: GATE_CHECK }, TITLE]),
    checks([{ ...GATE, integration_id: 99 }, TITLE]),
    checks([GATE, TITLE], false),
    rule("required_status_checks", { required_status_checks: [GATE, TITLE] }),
  ]) {
    const t = setup({ rules: [...base(), weakened] });
    const outcome = await t.outcome();
    assert.equal(
      outcome.status,
      "failed",
      "a check must require GitHub Actions and strict branches",
    );
    assert.match(outcome.detail ?? "", /"temple-bar gate": weakened/);
    assert.match(
      t.stderr.lines.join(""),
      /"temple-bar gate".*weakened.*GitHub Actions.*branches up to date/,
    );
    assert.match(t.stderr.lines.join(""), /Settings > Rules > Rulesets/);
    assert.equal(
      t.http.calls.filter((call) => call.url.includes("/contents/")).length,
      0,
    );
  }
});

void test("gate and title checks: a qualifying rule remains sufficient beside a weaker copy", async () => {
  const t = setup({
    rules: [...goodRules(), checks([{ context: GATE_CHECK }], false)],
  });
  assert.equal((await t.outcome()).status, "passed");
});

void test("gate and title checks: missing on the default branch fails and explains a failed or never reported check can merge", async () => {
  for (const [context, other, path, wording] of [
    [GATE_CHECK, TITLE, GATE_WORKFLOW_PATH, "gate"],
    [PR_TITLE_CHECK, GATE, PR_TITLE_WORKFLOW_PATH, "title check"],
  ] as const) {
    const t = setup({ rules: [...base(), checks([other])] });
    const outcome = await t.outcome();
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.detail, `"${context}": missing`);
    const text = t.stderr.lines.join("");
    assert.ok(text.includes(`${wording} failed or never reported can merge`));
    assert.match(
      text,
      /`pnpm exec temple-bar init --create-ruleset` once the user agrees/,
    );
    assert.match(text, /requires the status check/);
    assert.deepEqual(
      t.http.calls
        .filter((call) => call.url.includes("/contents/"))
        .map((call) => call.url),
      [`${URL}/contents/${path}?ref=release%2Fnext`],
    );
  }
});

void test("gate and title checks: a workflow only in the checkout is skipped even when the other check is required", async () => {
  const t = setup({
    rules: [...base(), checks([TITLE])],
    contents: { [GATE_WORKFLOW_PATH]: json(404) },
    here: [GATE_WORKFLOW_PATH],
  });
  const outcome = await t.outcome();
  assert.equal(outcome.status, "skipped");
  assert.match(
    outcome.detail ?? "",
    /"temple-bar gate".*on its way.*once it has, run setup again/,
  );
  assert.doesNotMatch(outcome.detail ?? "", /"temple-bar pr-title"/);
  assert.deepEqual(t.stderr.lines, []);
});

void test("gate and title checks: a workflow nowhere fails and says to write it, land it, then require its check", async () => {
  const t = setup({
    rules: [...base(), checks([TITLE])],
    contents: { [GATE_WORKFLOW_PATH]: json(404) },
  });
  assert.equal((await t.outcome()).status, "failed");
  assert.match(
    t.stderr.lines.join(""),
    /temple-bar-gate\.yml.*neither on the default branch nor here/,
  );
  assert.match(
    t.stderr.lines.join(""),
    /run `pnpm exec temple-bar init` to write it, land it.*then run setup again/,
  );
});

void test("gate and title checks: lookup failures fail, never skip or pass", async () => {
  for (const reply of [
    json(500),
    { kind: "network-error", message: "fetch failed" } as const,
  ]) {
    const t = setup({
      rules: [...base(), checks([TITLE])],
      contents: { [GATE_WORKFLOW_PATH]: reply },
    });
    const outcome = await t.outcome();
    assert.equal(
      outcome.status,
      "failed",
      "an unreadable workflow must fail the gate check",
    );
    assert.match(
      outcome.detail ?? "",
      /"temple-bar gate": missing; could not read GitHub/,
    );
    assert.match(
      t.stderr.lines.join(""),
      /rule is missing, and GitHub couldn't say whether/,
    );
  }
});

void test("gate and title checks: a failed context outweighs the other on its way, and every failure is named", async () => {
  const t = setup({
    rules: base(),
    contents: { [PR_TITLE_WORKFLOW_PATH]: json(404) },
    here: [PR_TITLE_WORKFLOW_PATH],
  });
  const outcome = await t.outcome();
  assert.equal(outcome.status, "failed");
  assert.match(outcome.detail ?? "", /"temple-bar gate": missing/);
  const both = setup({ rules: base() });
  const failure = await both.outcome();
  for (const name of [GATE_CHECK, PR_TITLE_CHECK]) {
    assert.ok(failure.detail?.includes(name));
    assert.ok(both.stderr.lines.join("").includes(name));
  }
});

void test("gate workflow lookups: each path is read at most once, including the judge shared by CodeQL", async () => {
  const t = setup({
    rules: goodRules().filter(
      (entry) =>
        !["required_status_checks", "code_scanning"].includes(entry.type),
    ),
  });
  await t.run();
  const calls = t.http.calls.filter((call) => call.url.includes("/contents/"));
  assert.deepEqual(
    calls.map((call) => call.url),
    [JUDGE_WORKFLOW_PATH, GATE_WORKFLOW_PATH, PR_TITLE_WORKFLOW_PATH].map(
      (path) => `${URL}/contents/${path}?ref=release%2Fnext`,
    ),
  );
});

void test("all four ruleset outcomes share private, unreadable and needs-token treatment", async () => {
  const offline = { kind: "network-error", message: "offline" } as const;
  for (const [options, status] of [
    [{ repo: json(200, { private: true, default_branch: "main" }) }, "skipped"],
    [{ repo: json(404) }, "skipped"],
    [{ repo: offline }, "skipped"],
    [{ rulesReply: offline }, "skipped"],
    [
      { repo: offline, env: { GITHUB_ACTIONS: "true", GH_TOKEN: "token" } },
      "failed",
    ],
    [
      {
        rulesReply: offline,
        env: { GITHUB_ACTIONS: "true", GH_TOKEN: "token" },
      },
      "failed",
    ],
    [{ env: { GITHUB_ACTIONS: "true" } }, "failed"],
  ] as const) {
    const all = await setup(options).run();
    assert.deepEqual(
      all.map((entry) => entry.name),
      NAMES,
      "every private, unreadable and token path must return all four checks",
    );
    assert.deepEqual(
      all.map((entry) => entry.status),
      Array<string>(4).fill(status),
    );
  }
});

void test("gate and title checks: both workflows on their way skip and name both contexts", async () => {
  const t = setup({
    rules: base(),
    contents: {
      [GATE_WORKFLOW_PATH]: json(404),
      [PR_TITLE_WORKFLOW_PATH]: json(404),
    },
    here: [GATE_WORKFLOW_PATH, PR_TITLE_WORKFLOW_PATH],
  });
  const outcome = await t.outcome();
  assert.equal(outcome.status, "skipped");
  assert.match(
    outcome.detail ?? "",
    /"temple-bar gate".*"temple-bar pr-title"/,
  );
  assert.deepEqual(t.stderr.lines, []);
});
