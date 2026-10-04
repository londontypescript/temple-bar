// The unused-code check with the real knip on a real repo, through the
// whole gate: an unused export fails it, and once the export is used the
// gate passes.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { initTestRepo } from "../testing/git-repo.ts";
import { createGateCommand } from "./command.ts";
import { installCore } from "./testing/core-fixture.ts";
import { realContext } from "./testing/real-repo.ts";
import { createRealGateTools } from "./tools.ts";

const gate = createGateCommand(createRealGateTools());

async function runGate(dir: string) {
  const { ctx, stdout, stderr } = realContext(dir);
  const code = await gate.run([], ctx);
  return { code, out: stdout.lines.join(""), err: stderr.lines.join("") };
}

void test("unused e2e: an unused export fails the gate, and using it passes", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-gate-knip-"));
  const write = (name: string, text: string): void => {
    writeFileSync(path.join(dir, name), text);
    execFileSync("git", ["add", "-A"], { cwd: dir });
  };
  try {
    initTestRepo(dir);
    const passes = 'node -e ""';
    write(
      "package.json",
      JSON.stringify({
        name: "sample",
        type: "module",
        main: "index.js",
        scripts: {
          typecheck: passes,
          lint: passes,
          "format:check": passes,
          test: passes,
        },
      }),
    );
    write("lib.js", "export const used = 1;\nexport const forgotten = 2;\n");
    write("index.js", 'import { used } from "./lib.js";\nconsole.log(used);\n');
    await installCore(dir);

    const failing = await runGate(dir);
    assert.equal(failing.code, 1, failing.err);
    // knip lists what it found on stdout.
    assert.match(failing.out, /forgotten +lib\.js/);
    assert.match(
      failing.err,
      /^ {2}failed {3}unused code \(knip\) \(unused files or exports\)$/m,
    );

    write(
      "index.js",
      'import { used, forgotten } from "./lib.js";\nconsole.log(used, forgotten);\n',
    );
    const passing = await runGate(dir);
    assert.equal(passing.code, 0, passing.err);
    assert.match(passing.out, /^ {2}passed {3}unused code \(knip\)$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
