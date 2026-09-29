import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// P9.1a: Node's type stripping refuses to run TypeScript found under a
// node_modules directory, so a published package must ship built
// JavaScript rather than relying on Node to strip types at runtime. This
// is what forces packages/*/dist to exist. CI proves this on Node 24 and
// 26; this test proves it wherever it runs.
// Prints with process.stdout.write, not console.log: console.log colours a
// number whenever colour is forced, which some terminals do, and the check
// below compares plain text.
const ERASABLE_SOURCE =
  "const answer: number = 1;\nprocess.stdout.write(`${String(answer)}\\n`);\n";

void test("Node refuses type stripping under node_modules but allows it elsewhere", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-p9-1a-"));
  try {
    const insideNodeModules = path.join(dir, "node_modules", "pkg", "index.ts");
    mkdirSync(path.dirname(insideNodeModules), { recursive: true });
    writeFileSync(insideNodeModules, ERASABLE_SOURCE);

    assert.throws(
      () =>
        execFileSync(process.execPath, [insideNodeModules], { stdio: "pipe" }),
      (error: unknown) => {
        const stderr = (error as { stderr: Buffer }).stderr.toString();
        assert.match(stderr, /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/);
        return true;
      },
    );

    const outsideNodeModules = path.join(dir, "index.ts");
    writeFileSync(outsideNodeModules, ERASABLE_SOURCE);
    const output = execFileSync(process.execPath, [outsideNodeModules], {
      encoding: "utf8",
      // Forced on purpose: the result must not depend on the terminal.
      env: { ...process.env, FORCE_COLOR: "1" },
    });
    assert.equal(output, "1\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
