// Minimal pnpm workspaces for the setup tests: a root plus two tiny packages.
// Each returns the files to write, keyed by path relative to the root.

const manifest = (name: string): string =>
  `${JSON.stringify({ name, version: "1.0.0", private: true }, null, 2)}\n`;

const ROOT_FILES: Readonly<Record<string, string>> = {
  ".gitignore": "node_modules/\n",
  "package.json": manifest("workspace-root"),
};

/** Both packages under one pattern. */
export function onePatternWorkspace(): Record<string, string> {
  return {
    ...ROOT_FILES,
    "pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n',
    "packages/a/package.json": manifest("pkg-a"),
    "packages/b/package.json": manifest("pkg-b"),
  };
}

/** The packages split across two patterns: the shape on which pnpm refused
 * a plain `pnpm add` at the root. */
export function twoPatternWorkspace(): Record<string, string> {
  return {
    ...ROOT_FILES,
    "pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n  - "tools/*"\n',
    "packages/a/package.json": manifest("pkg-a"),
    "tools/b/package.json": manifest("pkg-b"),
  };
}

/** A project with no workspace file. */
export function standaloneProject(): Record<string, string> {
  return { ...ROOT_FILES };
}
