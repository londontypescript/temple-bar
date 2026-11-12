import assert from "node:assert/strict";
import { test } from "node:test";
import { check } from "./check.ts";
import { validateGate } from "./gate-validation.ts";
import { tempProject, minimalFiles, world } from "./testing.ts";

const missing = ["typecheck", "format:check", "test"];
const report = `gate: the repo has files of its own, but package.json is missing script(s): typecheck, format:check, test
gate: checks:
  passed   workspace packages (the root alone: no pnpm-workspace.yaml)
  missing  typecheck (not in package.json)
  passed   lint
  missing  format:check (not in package.json)
  missing  test (not in package.json)
  passed   core setup (5 hooks unchanged)
  passed   gate and title workflows (2 exact copies)
  passed   file-length cap (all files within cap)
  passed   AGENTS.md size (159 lines)
  passed   markdown lint (7 markdown file(s))
  passed   local links (7 markdown file(s))
  passed   unused code (knip) (only comment-only unused files)
  skipped  branch ruleset (origin is not on GitHub)
  skipped  judge ruleset (origin is not on GitHub)
  skipped  code scanning rule (origin is not on GitHub)
  skipped  gate and title checks rule (origin is not on GitHub)
gate: failed: typecheck, format:check, test
`;
function judge(output = report, code = 2, timedOut = false): string[] {
  const project = tempProject(minimalFiles);
  try {
    return validateGate(
      project.snapshot,
      { code, timedOut, output, stdout: "" },
      missing,
    );
  } finally {
    project.close();
  }
}

void test("strict scaffold compatibility accepts only expected missing scripts and the complete report", () => {
  assert.deepEqual(judge(), []);
  assert.deepEqual(judge(report.replaceAll("\n", "\r\n")), []);
  assert.ok(judge(report, 1).some((line) => line.includes("unexpected exit")));
  assert.ok(judge(report, 2, true).some((line) => line.includes("deadline")));
});

for (const name of [
  "workspace packages",
  "lint",
  "core setup",
  "gate and title workflows",
  "file-length cap",
  "AGENTS.md size",
  "markdown lint",
  "local links",
  "unused code (knip)",
]) {
  for (const status of ["failed", "no-op", "missing", "skipped"]) {
    void test(`strict scaffold checker rejects ${status} ${name} despite expected missing scripts`, () => {
      const changed = report.replace(`passed   ${name}`, `${status}  ${name}`);
      assert.ok(
        judge(changed).some((line) =>
          line.includes("unexpected check outcome"),
        ),
        name,
      );
    });
  }
}

void test("incomplete, duplicate, unknown and contradictory reports fail closed", () => {
  for (const changed of [
    "",
    "gate: repo missing script(s): typecheck, format:check, test\n",
    report + report,
    report.replace("  passed   lint\n", ""),
    report.replace("  passed   lint", "  passed   lint\n  passed   lint"),
    report.replace("  passed   lint", "  passed   unexpected"),
    report.replace("  passed   lint", "  unknown  lint"),
    report.replace(
      "gate: failed: typecheck, format:check, test",
      "gate: passed",
    ),
    report.replace("missing  typecheck", "passed   typecheck"),
    report.replace("origin is not on GitHub", "unreachable API"),
    report + "gate: unexpected runtime error\n",
    report.replace(
      "missing script(s): typecheck, format:check, test",
      "missing script(s): test, typecheck, format:check",
    ),
  ])
    assert.notDeepEqual(judge(changed), [], changed);
});

void test("script expectations are fixed fixture data, never learned from the live scaffold", () => {
  const project = tempProject({
    "package.json": '{"scripts":{"lint":"lint-tool","test":"test-tool"}}',
  });
  try {
    assert.ok(
      validateGate(
        project.snapshot,
        { code: 2, output: report, stdout: "", timedOut: false },
        missing,
      ).some((line) => line.includes("scaffold script expectation changed")),
    );
  } finally {
    project.close();
  }
});

void test("a scaffold with all scripts needs real gate success", () => {
  const project = tempProject({
    "package.json":
      '{"scripts":{"typecheck":"tsc","lint":"eslint --max-warnings 0","format:check":"prettier","test":"node --test"}}',
  });
  const complete = report
    .split("\n")
    .slice(1)
    .join("\n")
    .replaceAll(
      /missing {2}(typecheck|format:check|test) \(not in package.json\)/g,
      "passed   $1",
    )
    .replace("gate: failed: typecheck, format:check, test", "gate: passed");
  try {
    assert.deepEqual(
      validateGate(
        project.snapshot,
        { code: 0, output: complete, stdout: "", timedOut: false },
        [],
      ),
      [],
    );
    assert.notDeepEqual(
      validateGate(
        project.snapshot,
        { code: 1, output: complete, stdout: "", timedOut: false },
        [],
      ),
      [],
    );
  } finally {
    project.close();
  }
});

const LINT_MESSAGE = `gate: package.json has a "lint" script that lets warnings pass
  "eslint ." runs eslint without --max-warnings 0: add --max-warnings 0 to it
`;
/** The report for a scaffold whose `lint` is `eslint .`, as the gate
 * refuses it, beside the three missing scripts. */
const refused = report
  .replace("gate: checks:", `${LINT_MESSAGE}gate: checks:`)
  .replace("  passed   lint", "  failed   lint (lets warnings pass)")
  .replace(
    "gate: failed: typecheck, format:check, test",
    "gate: failed: typecheck, lint, format:check, test",
  );

function judgeLint(
  output: string,
  code: number,
  scripts: string,
  expected: readonly string[] = missing,
): string[] {
  const project = tempProject({ "package.json": scripts });
  try {
    return validateGate(
      project.snapshot,
      { code, timedOut: false, output, stdout: "" },
      expected,
    );
  } finally {
    project.close();
  }
}

const ESLINT_ONLY = '{"scripts":{"lint":"eslint ."}}';

void test("a scaffold lint script without its tool's flag expects the gate's lint finding, not a pass", () => {
  assert.deepEqual(judgeLint(refused, 2, ESLINT_ONLY), []);
  for (const [changed, finding] of [
    [report, "expected the lint finding"],
    [refused.replace(LINT_MESSAGE, ""), "expected the lint message"],
    [
      refused.replace("(lets warnings pass)", "(lets warnings pass; exit 1)"),
      "expected the lint finding",
    ],
    [
      refused.replace(
        "gate: failed: typecheck, lint, format:check, test",
        "gate: failed: typecheck, format:check, test",
      ),
      "unexpected verdict",
    ],
  ] as const) {
    assert.ok(
      judgeLint(changed, 2, ESLINT_ONLY).some((line) => line.includes(finding)),
      finding,
    );
  }
  // With the flag, the same scaffold needs the lint check to pass.
  assert.ok(
    judgeLint(
      refused,
      2,
      '{"scripts":{"lint":"eslint . --max-warnings 0"}}',
    ).some((line) => line.includes("unexpected check outcome: failed   lint")),
  );
});

void test("a scaffold with every script but an unflagged lint expects exit 1 and lint alone failed", () => {
  const scripts =
    '{"scripts":{"typecheck":"tsc","lint":"oxlint","format:check":"prettier","test":"node --test"}}';
  const complete = refused
    .replace(LINT_MESSAGE, "")
    .replace(
      "gate: checks:",
      `gate: package.json has a "lint" script that lets warnings pass\n  "oxlint" runs oxlint without --deny-warnings: add --deny-warnings to it\ngate: checks:`,
    )
    .split("\n")
    .slice(1)
    .join("\n")
    .replaceAll(
      /missing {2}(typecheck|format:check|test) \(not in package.json\)/g,
      "passed   $1",
    )
    .replace(
      "gate: failed: typecheck, lint, format:check, test",
      "gate: failed: lint",
    );
  assert.deepEqual(judgeLint(complete, 1, scripts, []), []);
  assert.ok(
    judgeLint(complete, 0, scripts, []).some((line) =>
      line.includes("unexpected exit 0"),
    ),
  );
});

void test("unexpected analyzer failure becomes setup failed in the real checker orchestration", async () => {
  const fake = world();
  fake.override = (call) =>
    call.args[0] === "run" && call.args[1] === "gate"
      ? {
          code: 2,
          output: report.replace(
            "passed   unused code (knip)",
            "failed   unused code (knip)",
          ),
          stdout: "",
          timedOut: false,
        }
      : undefined;
  try {
    const result = await check({
      update: false,
      runner: fake.runner,
      resources: fake.resources,
      fixtures: fake.fixtures,
      tempRoot: fake.root,
    });
    assert.equal(result.code, 1);
    assert.deepEqual(result.results[0]?.statuses, ["setup failed"]);
    assert.match(
      result.report,
      /finding: gate: unexpected check outcome: failed +unused code/,
    );
  } finally {
    fake.close();
  }
});
