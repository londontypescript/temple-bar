// The property the split gate rests on: in a workspace, every part run on
// its own, in its own fresh copy, reports between them exactly the
// outcomes the whole gate reports, with the same status and detail, and no
// outcome belongs to two parts.

import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIONS_ENV,
  createFakePartFiles,
  partArgs,
  readReport,
  reportFile,
  runGate,
  withHead,
} from "./testing/parts-fixture.ts";
import {
  ALL_SCRIPTS,
  pnpmListing,
  workspace,
  type WorkspaceOptions,
} from "./testing/workspace-fixture.ts";

const PACKAGES = ["apps/web", "packages/a", "packages/b"];

/** A workspace where outcomes differ: a package missing a script, one
 * failing a script, and the rest passing. */
const OPTIONS: WorkspaceOptions = {
  packages: {
    "apps/web": ALL_SCRIPTS,
    "packages/a": { typecheck: "tsc", lint: "eslint .", test: "node --test" },
    "packages/b": ALL_SCRIPTS,
  },
  listing: { stdout: pnpmListing(["", ...PACKAGES]) },
  exitCode: (folder, script) =>
    folder === "packages/b" && script === "test" ? 1 : 0,
};

function fresh() {
  const made = workspace({ env: ACTIONS_ENV, ...OPTIONS });
  return { ...made, ctx: withHead(made.ctx) };
}

/** "<status> <name> (<detail>)", as the gate's report line says it. */
function line(status: string, name: string, detail?: string): string {
  return `${status} ${name}${detail === undefined ? "" : ` (${detail})`}`;
}

/** The outcome lines of the gate's closing report, in order. */
function reportLines(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.indexOf("gate: checks:");
  const end = lines.findIndex(
    (each, index) => index > start && each.startsWith("gate: "),
  );
  return lines
    .slice(start + 1, end)
    .map((each) => each.trim().replace(/^(\S+)\s+/, "$1 "));
}

void test("the parts add up to the whole gate: the same outcomes, statuses and details, none in two parts", async () => {
  const whole = fresh();
  assert.equal(await runGate(whole.ctx, createFakePartFiles(), []), 2);
  const wholeLines = reportLines(
    whole.stdout.lines.join("") + whole.stderr.lines.join(""),
  );

  const files = createFakePartFiles();
  const owner = new Map<string, string>();
  const partLines: string[] = [];
  for (const part of ["repo", "root", ...PACKAGES]) {
    await runGate(fresh().ctx, files, partArgs(part, reportFile(part)));
    for (const outcome of readReport(files, reportFile(part)).outcomes) {
      const earlier = owner.get(outcome.name);
      assert.equal(
        earlier,
        undefined,
        `${outcome.name} is in both ${String(earlier)} and ${part}`,
      );
      owner.set(outcome.name, part);
      partLines.push(line(outcome.status, outcome.name, outcome.detail));
    }
  }

  assert.ok(wholeLines.length > 20, wholeLines.join("\n"));
  assert.deepEqual(
    [...partLines].sort(),
    [...wholeLines].sort(),
    "the whole gate's outcomes differ from the union of the parts'",
  );
});
