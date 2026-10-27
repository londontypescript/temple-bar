// The gate's options: exactly three forms, and every other set of
// arguments refused with exit 1 before anything runs.

import assert from "node:assert/strict";
import test from "node:test";

import { CommandRegistry } from "../registry.ts";
import { route } from "../router.ts";
import { parseGateArgs } from "./options.ts";
import { testGateCommand } from "./testing/fake-tools.ts";
import { ACTIONS_ENV } from "./testing/parts-fixture.ts";
import { workspace } from "./testing/workspace-fixture.ts";

void test("gate options: the three accepted forms, in any order", () => {
  assert.deepEqual(parseGateArgs([]), { kind: "whole" });
  assert.deepEqual(
    parseGateArgs(["--report", "r.json", "--leg", "l", "--part", "root"]),
    { kind: "part", part: "root", leg: "l", report: "r.json" },
  );
  assert.deepEqual(parseGateArgs(["--leg", "l", "--verify-parts", "out"]), {
    kind: "verify",
    folder: "out",
    leg: "l",
  });
});

void test("gate options: every other form is refused with its reason", () => {
  const refused: [readonly string[], string][] = [
    [["--parts", "root"], "unknown option: --parts"],
    [["--part=root"], "unknown option: --part=root"],
    [["extra"], "unexpected argument: extra"],
    [
      ["--part", "a", "--part", "b", "--leg", "l", "--report", "r"],
      "--part is given more than once",
    ],
    [["--part"], "--part needs a value"],
    [["--part", "--leg", "l", "--report", "r"], "--part needs a value"],
    [["--part", "", "--leg", "l", "--report", "r"], "--part needs a value"],
    [
      ["--part", "a", "--verify-parts", "d", "--leg", "l", "--report", "r"],
      "--part and --verify-parts can't be used together",
    ],
    [["--part", "a", "--report", "r"], "--part needs --leg"],
    [["--part", "a", "--leg", "l"], "--part needs --report"],
    [["--verify-parts", "d"], "--verify-parts needs --leg"],
    [
      ["--verify-parts", "d", "--leg", "l", "--report", "r"],
      "--report is only for --part",
    ],
    [["--leg", "l"], "--leg needs --part or --verify-parts"],
    [["--report", "r"], "--report needs --part"],
  ];
  for (const [args, reason] of refused) {
    assert.equal(parseGateArgs(args), reason, args.join(" "));
  }
});

void test("gate options: a refused form exits 1 with `gate: <reason>` and runs nothing", async () => {
  const { ctx, proc, stderr, stdout } = workspace({ env: ACTIONS_ENV });
  const git: string[] = [];
  const watched = {
    ...ctx,
    git: {
      run(args: readonly string[], cwd: string) {
        git.push(args.join(" "));
        return ctx.git.run(args, cwd);
      },
    },
  };
  const registry = new CommandRegistry();
  registry.register(testGateCommand);

  assert.equal(await route(["gate", "--leg", "windows"], watched, registry), 1);

  assert.equal(
    stderr.lines.join(""),
    "gate: --leg needs --part or --verify-parts\n",
  );
  assert.deepEqual(stdout.lines, []);
  assert.deepEqual(proc.calls, []);
  assert.deepEqual(git, []);
});
