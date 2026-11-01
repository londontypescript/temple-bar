// Shared by the tests of the catalog grammar: a synthetic root
// pnpm-workspace.yaml in the shape ADR 0015's examples describe (the
// package list, a comment, a default catalog of fourteen entries, seven of
// them scoped, then a setting), built from public package names only, and
// helpers that change one line of it at a time.

import type { CatalogContext, FileState, PathChange } from "../file-state.ts";

export const WORKSPACE = "pnpm-workspace.yaml";

/** Line 5 is the marker; the body is lines 6 to 20 (the entries, then an
 * empty line); the suffix starts at line 21. */
export const BASE = [
  "packages:",
  '  - "packages/*"',
  "",
  "# Versions every package shares.",
  "catalog:",
  "  '@eslint/js': 9.39.1",
  "  '@tanstack/react-query': 5.90.10",
  "  '@types/react': 19.2.6",
  "  '@vitejs/plugin-react': 5.1.1",
  "  '@vitest/coverage-v8': 4.0.13",
  "  eslint: 9.39.1",
  "  prettier: 3.6.2",
  "  react: 19.2.0",
  "  '@testing-library/react': 16.3.0",
  "  react-dom: 19.2.0",
  "  typescript: 5.9.3",
  "  '@types/react-dom': 19.2.3",
  "  vite: 8.3.3",
  "  vitest: 4.0.13",
  "",
  "onlyBuiltDependencies:",
  "  - esbuild",
  "",
].join("\n");

/** The character with this code, so a test names an invisible or
 * look-alike character by its number. */
export const char = (code: number): string => String.fromCharCode(code);

/** `text` with `from` replaced by `to`. `from` must be there exactly once,
 * so a test can never judge a change it didn't make. */
export function swap(text: string, from: string, to: string): string {
  const parts = text.split(from);
  if (parts.length !== 2) {
    throw new Error(
      `swap: ${JSON.stringify(from)} is there ${String(parts.length - 1)} times`,
    );
  }
  return parts.join(to);
}

/** `text` with each pair swapped in turn. */
export const swapAll = (
  text: string,
  pairs: readonly (readonly [string, string])[],
): string => pairs.reduce((now, [from, to]) => swap(now, from, to), text);

export const regular = (text: string, mode = "100644"): FileState => ({
  kind: "regular",
  mode,
  text,
});

/** A root manifest with nothing that reads the catalog. */
export const ROOT_MANIFEST = JSON.stringify({
  name: "widgets",
  private: true,
  scripts: { test: "node --test" },
  devDependencies: { "@londontypescript/temple-bar": "0.2.2" },
});

/** A head with nothing that maps the catalog onto temple-bar's install. */
export const INERT: CatalogContext = {
  rootManifest: regular(ROOT_MANIFEST),
  foldedTwins: [],
  pnpmfiles: [],
  npmrcs: [],
};

/** The root workspace file's change from `before` to `after`, with the
 * head's facts as `context` gives them. */
export const workspace = (
  before: string,
  after: string,
  context: CatalogContext = INERT,
): PathChange => ({
  path: WORKSPACE,
  base: regular(before),
  head: regular(after),
  catalogContext: context,
});

/** The same change as a reader that gathered no facts would hand it. */
export const withoutFacts = (before: string, after: string): PathChange => ({
  path: WORKSPACE,
  base: regular(before),
  head: regular(after),
});

/** The one finding a refused catalog change gives. */
export const refused = (reason: string): string[] => [
  `${WORKSPACE} (not a catalog-only change: ${reason})`,
];
