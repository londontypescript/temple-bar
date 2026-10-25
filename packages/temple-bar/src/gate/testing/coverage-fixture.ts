// A project shaped like primrose-hill's when it split one tsconfig and one
// test run into web and Node halves, for the coverage check's end-to-end
// tests. Reviews, not checks, found its two gaps: files under src/ outside
// the named folders were in no tsconfig and no test run, and `.spec`,
// `.mts` and web-side tests were type-checked but never run. Returned as
// files to write (path relative to the root, then text); each option sets
// one half to its broken or fixed state. Not shipped: the build tsconfig
// excludes every `testing/` folder.

export interface CoverageFixtureOptions {
  /** "broken": tsconfig.node.json includes only src/core, src/cli and
   * src/server, as primrose-hill's first commit did; "fixed": all of src
   * but src/web. */
  readonly nodeConfig: "broken" | "fixed";
  /** "broken": the test run takes only `*.test.ts` under the three Node
   * folders; "fixed": every `.test` and `.spec` file under src;
   * "unmatched": a pattern that matches no file. */
  readonly testScript: "broken" | "fixed" | "unmatched";
  /** The typecheck script: `tsc -b` unless a test needs another form. */
  readonly typecheck?: string;
}

/** A test Node's runner runs and passes. */
const PASSING_TEST =
  'import test from "node:test";\n\ntest("runs", () => {});\n';

const TEST_SCRIPTS: Readonly<
  Record<CoverageFixtureOptions["testScript"], string>
> = {
  broken: 'node --test "src/{core,cli,server}/**/*.test.ts"',
  // Braces only: the gate reads no `(`, `|` or `)` in a script.
  fixed: 'node --test "src/**/*.{test,spec}.{ts,mts,cts}"',
  unmatched: 'node --test "tests/**/*.test.ts"',
};

/** A referenced project: `tsc -b` needs it composite, so it emits, but
 * only declarations, into dist/, which setup's .gitignore leaves out. It
 * checks nothing (`noCheck`): no types for Node or JSX are installed, and
 * the check is about which files are included, not whether they pass. */
function project(
  outDir: string,
  include: readonly string[],
  exclude: readonly string[] = [],
  jsx = false,
): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        composite: true,
        noCheck: true,
        emitDeclarationOnly: true,
        outDir,
        allowImportingTsExtensions: true,
        types: [],
        ...(jsx ? { jsx: "preserve" } : {}),
      },
      include,
      ...(exclude.length > 0 ? { exclude } : {}),
    },
    null,
    2,
  )}\n`;
}

/** The project's files, keyed by "/"-separated path from the root. The
 * package.json has no temple-bar scripts: setup adds those. */
export function coverageProject(
  options: CoverageFixtureOptions,
): Record<string, string> {
  const passing = 'node -e "process.exit(0)"';
  return {
    "package.json": `${JSON.stringify(
      {
        name: "coverage-fixture",
        private: true,
        type: "module",
        scripts: {
          typecheck: options.typecheck ?? "tsc -b",
          lint: passing,
          "format:check": passing,
          test: TEST_SCRIPTS[options.testScript],
        },
      },
      null,
      2,
    )}\n`,
    "tsconfig.json": `${JSON.stringify(
      {
        files: [],
        references: [
          { path: "./tsconfig.web.json" },
          { path: "./tsconfig.node.json" },
        ],
      },
      null,
      2,
    )}\n`,
    "tsconfig.web.json": project("dist/web", ["src/web"], [], true),
    "tsconfig.node.json":
      options.nodeConfig === "broken"
        ? project("dist/node", ["src/core", "src/cli", "src/server"])
        : project("dist/node", ["src"], ["src/web"]),
    "src/core/index.ts": "export const core = 1;\n",
    // An ordinary test the broken pattern does match.
    "src/core/index.test.ts": PASSING_TEST,
    "src/core/index.spec.ts": PASSING_TEST,
    "src/core/m.test.mts": PASSING_TEST,
    "src/cli/index.ts": "export const cli = 1;\n",
    "src/server/index.ts": "export const server = 1;\n",
    "src/shared/util.ts":
      "export function twice(n: number): number {\n  return n * 2;\n}\n",
    "src/root.test.ts": PASSING_TEST,
    // A declaration, which is never required.
    "src/types.d.ts": "declare const VERSION: string;\n",
    "src/web/App.tsx": "export function App() {\n  return <p>web</p>;\n}\n",
    // Every test file is .ts, .mts or .cts: Node's runner can't run .tsx.
    "src/web/App.test.ts": PASSING_TEST,
    "src/web/Node.test.ts": PASSING_TEST,
    "src/web/main.tsx":
      'import { App } from "./App.tsx";\n\nconsole.log(App);\n',
    "src/web/test/setup.ts": "export const setup = true;\n",
  };
}
