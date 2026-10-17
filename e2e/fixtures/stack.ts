// A pnpm workspace shaped like the stacks temple-bar's users build: a React
// web app on Vite, a React Three Fiber scene, an Ink terminal app, an
// Electron desktop app, and a shared TypeScript package that only the apps
// import. Every package runs real checks (tsc, ESLint, Prettier, Vitest)
// with one small real test, and installs real frameworks at exact
// versions. Their own dependencies resolve fresh at each install, so the
// tests that install it also check today's npm still fits.
//
// Returned as files to write (path from the root, then text), so its
// sources exist only in a test's temporary folder: this repo's own
// TypeScript, ESLint, Prettier and knip never see them.

import { json, jsonConfig, stackPackages } from "./stack-packages.ts";

/** The packages besides the root, in the order the gate lists them. */
export const STACK_PACKAGES: readonly string[] = [
  "apps/desktop",
  "apps/scene",
  "apps/terminal",
  "apps/web",
  "packages/shared",
];

/** What the project's own knip config declares: the entries knip's
 * plugins don't find by themselves. */
export interface KnipDeclarations {
  /** The root's `vitest.root.config.ts`, a name knip's Vitest plugin
   * doesn't look for. */
  readonly rootVitestConfig: boolean;
  /** The desktop app's preload script, built by an esbuild script knip
   * takes no entries from. */
  readonly preloadEntry: boolean;
}

/** knip.json declaring what `declare` asks for. */
export function stackKnipConfig(declare: KnipDeclarations): string {
  const config: Record<string, unknown> = {};
  if (declare.rootVitestConfig) {
    config.vitest = { config: ["vitest.config.ts", "vitest.root.config.ts"] };
  }
  if (declare.preloadEntry) {
    config.workspaces = { "apps/desktop": { entry: ["src/preload.ts"] } };
  }
  return jsonConfig(config);
}

function root(): Record<string, string> {
  return {
    ".gitignore": "node_modules/\ndist/\n",
    "package.json": json({
      name: "stack",
      private: true,
      type: "module",
      engines: { node: ">=24" },
      scripts: {
        typecheck: "tsc --noEmit -p tsconfig.json",
        lint: "eslint .",
        "format:check": "prettier --check .",
        test: "vitest run --config vitest.root.config.ts",
      },
      devDependencies: {
        "@eslint/js": "10.0.1",
        "@types/node": "24.19.0",
        esbuild: "0.28.2",
        eslint: "10.11.0",
        "eslint-config-prettier": "10.1.8",
        globals: "17.12.0",
        prettier: "3.9.9",
        tsx: "4.23.15",
        typescript: "catalog:",
        "typescript-eslint": "8.71.0",
        vitest: "catalog:",
      },
    }),
    // No onlyBuiltDependencies: pnpm runs no dependency's install script.
    // Electron's binary comes only from its own install-electron command,
    // which nothing here runs, so it is never downloaded; esbuild runs from
    // its platform package without one.
    "pnpm-workspace.yaml": `packages:
  - apps/*
  - packages/*
strictPeerDependencies: true
catalog:
  react: 19.3.0
  react-dom: 19.3.0
  "@types/react": 19.3.0
  "@types/react-dom": 19.3.0
  "@react-three/fiber": 9.8.0
  three: 0.186.0
  "@types/three": 0.186.0
  ink: 7.1.1
  vite: 8.3.0
  "@vitejs/plugin-react": 6.1.1
  typescript: 6.0.3
  vitest: 5.0.1
`,
    "tsconfig.base.json": jsonConfig({
      compilerOptions: {
        target: "ES2023",
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "react-jsx",
        strict: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        verbatimModuleSyntax: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        types: ["node"],
        lib: ["ES2023", "DOM"],
        noEmit: true,
      },
    }),
    "tsconfig.json": jsonConfig({
      extends: "./tsconfig.base.json",
      include: ["*.config.ts", "scripts/**/*.ts"],
    }),
    "eslint.config.js": `import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["**/dist/"] },
  js.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  tseslint.configs.recommended,
  prettier,
);
`,
    // Threads, not Vitest's default forks: the forks pool leaves a copy of
    // each module it transformed in the temp folder and never removes it,
    // and the tests that install this stack check the temp folder is left
    // empty, to catch temple-bar's own leaks.
    "vitest.config.ts": `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.{ts,tsx}"], pool: "threads" },
});
`,
    "vitest.root.config.ts": `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["scripts/**/*.test.ts"], pool: "threads" },
});
`,
    "scripts/workspace.test.ts": `import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("the workspace installs with strict peer dependencies", () => {
  const settings = readFileSync("pnpm-workspace.yaml", "utf8");
  expect(settings).toMatch(/^strictPeerDependencies: true$/m);
});
`,
    "knip.json": stackKnipConfig({
      rootVitestConfig: true,
      preloadEntry: true,
    }),
  };
}

/** The whole workspace. The root's package.json has no temple-bar in it:
 * setup adds that. */
export function stackWorkspace(): Record<string, string> {
  return {
    ...root(),
    ...stackPackages(),
  };
}
