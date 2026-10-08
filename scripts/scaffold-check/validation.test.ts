import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { expectation } from "./expectation.ts";
import {
  gitState,
  validateCommit,
  validateGate,
  validateRefusal,
} from "./validation.ts";
import { check } from "./check.ts";
import { fixture, minimalFiles, ok, tempProject, world } from "./testing.ts";

for (const manager of ["npm@99.1.0", "yarn@4.3.0"]) {
  void test(`real orchestration judges the launcher's ${manager} refusal using the snapshot value`, async () => {
    const data = fixture("angular", {
      ...minimalFiles,
      "package.json": JSON.stringify({ packageManager: manager }),
    });
    const fake = world([data]);
    try {
      const result = await check({
        update: false,
        runner: fake.runner,
        resources: fake.resources,
        fixtures: fake.fixtures,
        tempRoot: fake.root,
      });
      assert.equal(result.code, 0, result.report);
      assert.match(
        result.report,
        new RegExp(manager.replaceAll(".", "\\.")),
        "refusal names the live value",
      );
      assert.equal(
        fake.calls.some((call) => call.args[1] === "gate"),
        false,
        "refused scaffold is not set up further",
      );
    } finally {
      fake.close();
    }
  });
}

void test("real orchestration keeps no expectation separate from setup failure and spots unexpected gh output", async () => {
  const fake = world([
    fixture("vite", {
      ...minimalFiles,
      "package.json":
        '{"devEngines":{"packageManager":{"name":"npm","version":"11.0.0"}}}',
    }),
  ]);
  try {
    const result = await check({
      update: false,
      runner: fake.runner,
      resources: fake.resources,
      fixtures: fake.fixtures,
      tempRoot: fake.root,
    });
    assert.equal(result.code, 1);
    assert.deepEqual(
      result.results[0]?.statuses,
      ["no expectation"],
      result.report,
    );
    assert.match(result.report, /no expectation: devEngines.packageManager/);
    const passing = world();
    try {
      passing.override = (call) =>
        call.args.includes("create-temple-bar")
          ? {
              code: 0,
              output: "fake gh: unexpected call: []\n",
              timedOut: false,
            }
          : undefined;
      const unexpected = await check({
        update: false,
        runner: passing.runner,
        resources: passing.resources,
        fixtures: passing.fixtures,
        tempRoot: passing.root,
      });
      assert.equal(unexpected.code, 1);
      assert.match(
        unexpected.report,
        /finding: launcher: fake gh: unexpected call in output/,
        "unexpected fake gh call gets its own finding",
      );
      assert.deepEqual(unexpected.results[0]?.statuses, ["setup failed"]);
    } finally {
      passing.close();
    }
  } finally {
    fake.close();
  }
});

for (const foreign of [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]) {
  void test(`refusal expectations import and name ${foreign}`, () => {
    const project = tempProject({
      "package.json": '{"packageManager":"npm@99.0.0"}',
      [foreign]: "lock\n",
    });
    try {
      const expected = expectation(project.snapshot);
      assert.ok(
        expected.refusal?.includes(
          `this folder has a ${foreign}, which another package manager wrote`,
        ),
        "lockfile takes priority over packageManager, matching launcher",
      );
      assert.ok(expected.refusal);
      const before = gitState(project.dir);
      const launch = {
        code: 1,
        output: `${expected.refusal}\n`,
        timedOut: false,
      };
      assert.deepEqual(
        validateRefusal(project.dir, before, ok(), launch, expected.refusal),
        [],
        "unchanged own-message refusal accepted",
      );
      assert.ok(
        validateRefusal(project.dir, before, ok(), ok(), expected.refusal).some(
          (finding) => finding.includes("expected a non-zero refusal"),
        ),
        "launcher not refusing gets its own finding",
      );
    } finally {
      project.close();
    }
  });
}

for (const kind of [
  "message",
  "status",
  "config",
  "hooks",
  "deadline",
] as const) {
  void test(`refusal validator catches ${kind} with its own finding`, () => {
    const project = tempProject({
      "package.json": '{"packageManager":"npm@99.0.0"}',
    });
    try {
      const message = expectation(project.snapshot).refusal;
      assert.ok(message);
      const before = gitState(project.dir);
      const launch = {
        code: 1,
        output:
          kind === "message"
            ? "pnpm: This project is configured to use npm\n"
            : `${message}\n`,
        timedOut: kind === "deadline",
      };
      if (kind === "config")
        writeFileSync(path.join(project.dir, ".git/config"), "changed\n");
      if (kind === "hooks")
        writeFileSync(path.join(project.dir, ".git/hooks/extra"), "hook\n");
      const status =
        kind === "status" ? ok(" M package.json\n!! node_modules/\n") : ok();
      const own = {
        message: "missing its own refusal message",
        status: "git status --porcelain --ignored was not empty",
        config: ".git/config changed byte for byte",
        hooks: "the set of files in .git/hooks changed",
        deadline: "expected a non-zero refusal without a deadline",
      }[kind];
      assert.ok(
        validateRefusal(project.dir, before, status, launch, message).some(
          (finding) => finding.includes(own),
        ),
        `${kind}: own refusal finding`,
      );
    } finally {
      project.close();
    }
  });
}

void test("gate judges exact missing scripts in gate order, exit and deadline while framework results remain informational", () => {
  const project = tempProject(minimalFiles);
  try {
    const report =
      "gate: repo missing script(s): typecheck, format:check, test\nframework lint failed\n";
    assert.deepEqual(
      validateGate(project.snapshot, {
        code: 2,
        output: report,
        timedOut: false,
      }),
      [],
      "correct missing script report accepted",
    );
    for (const changed of [
      report.replace(
        "typecheck, format:check, test",
        "test, typecheck, format:check",
      ),
      report.replace(", test", ""),
      `${report}${report}`,
    ])
      assert.ok(
        validateGate(project.snapshot, {
          code: 2,
          output: changed,
          timedOut: false,
        }).some((finding) =>
          finding.startsWith("gate: expected missing script(s):"),
        ),
        "wrong list, order or duplicate line gets own finding",
      );
    assert.ok(
      validateGate(project.snapshot, {
        code: 1,
        output: report,
        timedOut: false,
      }).some((finding) => finding.startsWith("gate: unexpected exit")),
      "missing scripts require gate exit 2",
    );
    assert.ok(
      validateGate(project.snapshot, {
        code: 2,
        output: report,
        timedOut: true,
      }).some((finding) => finding.includes("deadline")),
      "deadlined gate is not accepted",
    );
  } finally {
    project.close();
  }
  const all = tempProject({
    "package.json":
      '{"scripts":{"typecheck":"tsc","lint":"eslint","format:check":"prettier","test":"node --test"}}',
  });
  try {
    for (const code of [0, 1])
      assert.deepEqual(
        validateGate(all.snapshot, {
          code,
          output: "framework report\n",
          timedOut: false,
        }),
        [],
        "with no missing scripts framework success or failure accepted",
      );
  } finally {
    all.close();
  }
});

void test("commit validator requires the hook's own refusal, not just a failing git", () => {
  assert.deepEqual(
    validateCommit({
      code: 1,
      output: "refusing to commit directly to main\n",
      timedOut: false,
    }),
    [],
  );
  for (const result of [
    ok(),
    { code: 1, output: "git failed\n", timedOut: false },
    {
      code: 1,
      output: "refusing to commit directly to main\n",
      timedOut: true,
    },
  ])
    assert.deepEqual(
      validateCommit(result),
      ["hooks: direct commit to main did not refuse with the hook's message"],
      "bad commit result gets own hook finding",
    );
});
