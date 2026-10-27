// `gate --verify-parts`: accepts a leg's reports only when there is exactly
// one well-formed report for every part it works out itself. Its checks of
// each report's contents are in verify-parts-contents.test.ts.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  ACTIONS_ENV,
  REPORTS,
  runGate,
  withHead,
} from "./testing/parts-fixture.ts";
import {
  edit,
  everyPartReported,
  PARTS,
  readJson,
  writeJson,
} from "./testing/verify-fixture.ts";
import { workspace } from "./testing/workspace-fixture.ts";

/** The problem lines the verifier listed. */
function problems(stderr: { lines: string[] }): string[] {
  return stderr.lines
    .join("")
    .split("\n")
    .filter((line) => line.startsWith("  "))
    .map((line) => line.trim());
}

void test("verify-parts: one passing report per part passes, one line per part", async () => {
  const leg = await everyPartReported();

  const { code, stdout, stderr } = await leg.verify();

  assert.equal(code, 0, stderr.lines.join(""));
  const text = stdout.lines.join("");
  for (const part of PARTS) {
    assert.match(
      text,
      new RegExp(`^gate: part ${part}: \\d+ outcome\\(s\\), all accepted`, "m"),
    );
  }
  assert.match(
    text,
    /^gate: verified: 4 part\(s\) add up to the whole gate on leg windows$/m,
  );
});

void test("verify-parts: a part with no report is missing", async () => {
  const leg = await everyPartReported();
  leg.files.entries.delete(path.join(REPORTS, "packages-a.json"));

  const { code, stderr } = await leg.verify();

  assert.equal(code, 1);
  assert.deepEqual(problems(stderr), [
    "missing: no report for part packages/a",
  ]);
});

void test("verify-parts: two reports for one part are duplicated", async () => {
  const leg = await everyPartReported();
  writeJson(leg.files, "root-again.json", readJson(leg.files, "root.json"));

  const { code, stderr } = await leg.verify();

  assert.equal(code, 1);
  assert.deepEqual(problems(stderr), [
    "duplicated: part root has 2 reports: root-again.json, root.json",
  ]);
});

void test("verify-parts: a report for a part this gate doesn't have is unexpected", async () => {
  const leg = await everyPartReported();
  writeJson(leg.files, "c.json", {
    ...readJson(leg.files, "packages-b.json"),
    part: "packages/c",
  });

  const { code, stderr } = await leg.verify();

  assert.equal(code, 1);
  assert.deepEqual(problems(stderr), [
    "unexpected: c.json reports part packages/c, which isn't one of this gate's parts (repo, root, packages/a, packages/b)",
  ]);
});

void test("verify-parts: anything but a well-formed report file is malformed, named with its reason", async () => {
  const cases: [
    string,
    (leg: Awaited<ReturnType<typeof everyPartReported>>) => void,
    string,
  ][] = [
    [
      "not JSON",
      (leg) => leg.files.entries.set(path.join(REPORTS, "x.json"), "{"),
      "malformed: x.json: not JSON",
    ],
    [
      "a missing key",
      (leg) => {
        edit(leg.files, "root.json", (report) => {
          delete report.commit;
        });
      },
      "malformed: root.json: missing commit",
    ],
    [
      "an extra key",
      (leg) => {
        edit(leg.files, "root.json", (report) => {
          report.extra = true;
        });
      },
      "malformed: root.json: unexpected extra",
    ],
    [
      "a wrong type",
      (leg) => {
        edit(leg.files, "root.json", (report) => {
          report.attempt = 1;
        });
      },
      "malformed: root.json: attempt isn't a string",
    ],
    [
      "an unknown version",
      (leg) => {
        edit(leg.files, "root.json", (report) => {
          report.version = 2;
        });
      },
      "malformed: root.json: version 2 isn't one this gate reads (1)",
    ],
    [
      "an unknown format",
      (leg) => {
        edit(leg.files, "root.json", (report) => {
          report.format = "other";
        });
      },
      'malformed: root.json: format "other" isn\'t temple-bar-gate-part',
    ],
    [
      "an outcome with an unknown status",
      (leg) => {
        edit(leg.files, "root.json", (report) => {
          report.outcomes = [{ name: "lint", status: "fine" }];
        });
      },
      'malformed: root.json: outcomes[0].status "fine" isn\'t a check status',
    ],
    [
      "a folder",
      (leg) => leg.files.others.set(path.join(REPORTS, "more"), "directory"),
      "malformed: more is a directory, not a regular file",
    ],
    [
      "a link",
      (leg) => leg.files.others.set(path.join(REPORTS, "l.json"), "symlink"),
      "malformed: l.json is a symlink, not a regular file",
    ],
    [
      "a file that isn't .json",
      (leg) => leg.files.entries.set(path.join(REPORTS, "notes.txt"), "{}"),
      "malformed: notes.txt isn't a .json file",
    ],
  ];
  for (const [what, spoil, expected] of cases) {
    const leg = await everyPartReported();
    spoil(leg);

    const { code, stderr } = await leg.verify();

    assert.equal(code, 1, what);
    assert.ok(
      problems(stderr).includes(expected),
      `${what}: ${problems(stderr).join(" | ")}`,
    );
  }
});

void test("verify-parts: an entry that can't be examined is named, and the other problems still reported", async () => {
  const leg = await everyPartReported();
  const broken = path.resolve(REPORTS, "locked.json");
  leg.files.entries.set(broken, "{}");
  const kind = leg.files.kind;
  leg.files.kind = (target) =>
    path.resolve(target) === broken
      ? Promise.reject(new Error("EACCES"))
      : kind(target);
  leg.files.entries.delete(path.join(REPORTS, "repo.json"));

  const { code, stderr } = await leg.verify();

  assert.equal(code, 1);
  assert.deepEqual(problems(stderr), [
    "malformed: locked.json can't be examined: EACCES",
    "missing: no report for part repo",
  ]);
});

void test("verify-parts: every problem is reported, not just the first", async () => {
  const leg = await everyPartReported();
  leg.files.entries.delete(path.join(REPORTS, "repo.json"));
  edit(leg.files, "root.json", (report) => {
    report.leg = "linux";
  });

  const { code, stderr } = await leg.verify();

  assert.equal(code, 1);
  assert.deepEqual(problems(stderr), [
    "missing: no report for part repo",
    'mismatched: root.json (part root): leg is "linux", but this run\'s is "windows"',
  ]);
});

void test("verify-parts: refuses outside GitHub Actions, and fails when its own inventory fails", async () => {
  const leg = await everyPartReported();
  const outside = workspace();
  assert.equal(
    await runGate(withHead(outside.ctx), leg.files, [
      "--verify-parts",
      REPORTS,
      "--leg",
      "windows",
    ]),
    1,
  );
  assert.match(
    outside.stderr.lines.join(""),
    /^gate: --verify-parts runs only in GitHub Actions; missing: GITHUB_ACTIONS=true, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT$/m,
  );

  const broken = workspace({
    env: ACTIONS_ENV,
    listing: { stdout: "not json" },
  });
  assert.equal(
    await runGate(withHead(broken.ctx), leg.files, [
      "--verify-parts",
      REPORTS,
      "--leg",
      "windows",
    ]),
    1,
  );
  assert.match(
    broken.stderr.lines.join(""),
    /^gate: can't work out the parts: the workspace inventory failed \(pnpm's package list isn't JSON; no package's scripts were run\)$/m,
  );
});

void test("verify-parts: a folder that can't be read fails, naming it", async () => {
  const leg = await everyPartReported();
  const { ctx, stderr } = workspace({ env: ACTIONS_ENV });

  assert.equal(
    await runGate(withHead(ctx), leg.files, [
      "--verify-parts",
      path.resolve("/nowhere"),
      "--leg",
      "windows",
    ]),
    1,
  );
  assert.match(
    stderr.lines.join(""),
    /^gate: could not read the reports' folder .*nowhere: /m,
  );
});
