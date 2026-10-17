// The release tier: the packed launcher and gate on the five-package stack,
// with its real frameworks installed. Each promise here also has a test on
// the minimal workspace that every pull request runs; these confirm it holds
// on a real stack. See e2e/release/stack-project.ts for the setup.

import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { stripVTControlCharacters } from "node:util";

import { extraApp, PACKAGE_SCRIPTS } from "../fixtures/stack-packages.ts";
import { STACK_PACKAGES, stackKnipConfig } from "../fixtures/stack.ts";
import { describe, type RunResult } from "../support/run.ts";
import { startStack, type StackProject } from "./stack-project.ts";

let stack: StackProject | undefined;

before(async () => {
  stack = await startStack("stack-gate");
});

after(async () => {
  await stack?.close();
});

function project(): StackProject {
  assert.ok(stack, "the stack was not set up");
  return stack;
}

function gate(): Promise<RunResult> {
  return project().run("pnpm", ["gate"]);
}

const TIMEOUT = { timeout: 1_200_000 };
const SCRIPTS = Object.keys(PACKAGE_SCRIPTS);

/** A line of the gate's report, wherever the report went. */
function assertReports(result: RunResult, line: RegExp): void {
  assert.match(`${result.stdout}${result.stderr}`, line, describe(result));
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

void test(
  "stack: the packed launcher sets up at the root, and no package gets temple-bar or Electron's binary",
  TIMEOUT,
  () => {
    const { cwd, setup, launcher } = project();
    assert.match(setup.stdout, /Wrote temple-bar's rules into AGENTS.md/);
    const manifest = (relative: string) =>
      JSON.parse(readFileSync(path.join(cwd, relative), "utf8")) as {
        devDependencies?: Record<string, string>;
      };
    assert.equal(
      manifest("package.json").devDependencies?.[
        "@londontypescript/temple-bar"
      ],
      launcher.version,
    );
    for (const folder of STACK_PACKAGES) {
      const pins = manifest(`${folder}/package.json`).devDependencies ?? {};
      assert.ok(!("@londontypescript/temple-bar" in pins), folder);
    }
    // Electron's package is installed, but its binary never downloaded.
    const electron = realpathSync.native(
      path.join(cwd, "apps", "desktop", "node_modules", "electron"),
    );
    assert.ok(existsSync(path.join(electron, "electron.d.ts")), electron);
    assert.ok(!existsSync(path.join(electron, "dist")), electron);
    assert.ok(!existsSync(path.join(electron, "path.txt")), electron);
  },
);

void test(
  "stack gate: the correct workspace passes, listing the root and five packages and running each one's real scripts",
  TIMEOUT,
  async () => {
    const result = await gate();
    assert.equal(result.code, 0, describe(result));
    assertReports(
      result,
      /^ {2}passed {3}workspace packages \(the root and 5 package\(s\)\)$/m,
    );
    for (const folder of STACK_PACKAGES) {
      for (const script of SCRIPTS) {
        assertReports(
          result,
          new RegExp(
            `^ {2}passed {3}${escaped(script)} \\(${escaped(folder)}\\)$`,
            "m",
          ),
        );
      }
    }
    // knip saw the installed graph: the shared package's exports, used only
    // by its sibling apps, are used.
    assertReports(result, /^ {2}passed {3}unused code \(knip\)$/m);
    // The real tools ran, once at the root and once in each package. Vitest
    // colours its summary on Windows even into a pipe, so the colour codes
    // are taken out before counting.
    const plain = stripVTControlCharacters(result.stdout);
    const runs = (pattern: RegExp) => plain.match(pattern)?.length ?? 0;
    assert.equal(
      runs(/^> tsc --noEmit -p tsconfig\.json$/gm),
      6,
      describe(result),
    );
    assert.equal(runs(/^ +Tests +1 passed \(1\)$/gm), 6, describe(result));
  },
);

void test(
  "stack gate: a sixth app with real code and no scripts fails, naming its package.json",
  TIMEOUT,
  async () => {
    const result = await project().withFiles(extraApp({}), gate);
    assert.equal(result.code, 2, describe(result));
    assertReports(
      result,
      /^gate: apps\/extra\/package\.json is missing script\(s\): typecheck, lint, format:check, test$/m,
    );
    assertReports(result, /workspace packages \(the root and 6 package\(s\)\)/);
  },
);

void test(
  "stack gate: a sixth app without typecheck fails, naming the package, and its other scripts still run",
  TIMEOUT,
  async () => {
    const { typecheck, ...rest } = PACKAGE_SCRIPTS;
    assert.ok(typecheck);
    const result = await project().withFiles(extraApp(rest), gate);
    assert.equal(result.code, 2, describe(result));
    assertReports(
      result,
      /^ {2}missing {2}typecheck \(apps\/extra\) \(not in apps\/extra\/package\.json\)$/m,
    );
    assertReports(result, /^ {2}passed {3}test \(apps\/extra\)$/m);
  },
);

void test(
  "stack gate: a real type error in one app fails its typecheck, naming that package, though its test still passes",
  TIMEOUT,
  async () => {
    // A string where a number is declared: wrong only to the type checker.
    const app = "apps/web/src/App.tsx";
    const broken = `import { stackValue } from "@stack/shared";

export function App() {
  const title: number = stackValue().label;
  return <h1>{title}</h1>;
}
`;
    const result = await project().withFiles({ [app]: broken }, gate);
    assert.equal(result.code, 1, describe(result));
    assertReports(
      result,
      /^ {2}failed {3}typecheck \(apps\/web\) \(exit \d+\)$/m,
    );
    assertReports(result, /^ {2}passed {3}test \(apps\/web\)$/m);
    assertReports(result, /^ {2}passed {3}typecheck \(apps\/scene\)$/m);
    assert.match(result.stdout, /src\/App\.tsx\(\d+,\d+\): error TS2322/);
  },
);

void test(
  "stack gate: an unused export beside a used one in the shared package's internal module fails, naming the package and the file",
  TIMEOUT,
  async () => {
    const value = "packages/shared/src/value.ts";
    const text = readFileSync(path.join(project().cwd, value), "utf8");
    const result = await project().withFiles(
      { [value]: `${text}\nexport const unusedLabel = "unused";\n` },
      gate,
    );
    assert.equal(result.code, 1, describe(result));
    assertReports(
      result,
      /^ {2}failed {3}unused code \(knip\) \(unused files or exports in packages\/shared\)$/m,
    );
    assert.match(
      result.stderr,
      / {2}packages\/shared:\n {4}packages\/shared\/src\/value\.ts\n/,
    );
    assert.match(
      result.stdout,
      /unusedLabel +packages\/shared\/src\/value\.ts/,
    );
  },
);

void test(
  "stack gate: the custom root Vitest config fails unless the project's knip config names it",
  TIMEOUT,
  async () => {
    const knip = stackKnipConfig({
      rootVitestConfig: false,
      preloadEntry: true,
    });
    const result = await project().withFiles({ "knip.json": knip }, gate);
    assert.equal(result.code, 1, describe(result));
    assertReports(
      result,
      /^ {2}failed {3}unused code \(knip\) \(unused files or exports in the root\)$/m,
    );
    assert.match(
      result.stderr,
      / {2}the root:\n(?: {4}.*\n)* {4}vitest\.root\.config\.ts\n/,
    );
  },
);

void test(
  "stack gate: the Electron preload entry fails unless the project's knip config names it",
  TIMEOUT,
  async () => {
    const knip = stackKnipConfig({
      rootVitestConfig: true,
      preloadEntry: false,
    });
    const result = await project().withFiles({ "knip.json": knip }, gate);
    assert.equal(result.code, 1, describe(result));
    assertReports(
      result,
      /^ {2}failed {3}unused code \(knip\) \(unused files or exports in apps\/desktop\)$/m,
    );
    assert.match(
      result.stderr,
      / {2}apps\/desktop:\n {4}apps\/desktop\/src\/preload\.ts\n/,
    );
  },
);
