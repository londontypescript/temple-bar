// Minimal pnpm workspaces for the setup and gate tests: a root plus two tiny
// packages. Each returns the files to write, keyed by path relative to the
// root.

const manifest = (
  name: string,
  scripts?: Readonly<Record<string, string>>,
): string =>
  `${JSON.stringify({ name, version: "1.0.0", private: true, ...(scripts === undefined ? {} : { scripts }) }, null, 2)}\n`;

/** A command that runs and passes, and is no placeholder the gate refuses. */
export const PASSING_COMMAND = 'node -e "process.exit(0)"';

/** The four scripts the gate requires, each running PASSING_COMMAND. */
export const PASSING_SCRIPTS: Readonly<Record<string, string>> = {
  typecheck: PASSING_COMMAND,
  lint: PASSING_COMMAND,
  "format:check": PASSING_COMMAND,
  test: PASSING_COMMAND,
};

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

/** A package's manifest, with `scripts` when given. */
export function packageManifest(
  name: string,
  scripts?: Readonly<Record<string, string>>,
): string {
  return manifest(name, scripts);
}

/** Both packages under one pattern, the root and each package with the four
 * scripts the gate requires, all passing. */
export function checkedWorkspace(): Record<string, string> {
  return {
    ".gitignore": "node_modules/\n",
    "package.json": manifest("workspace-root", PASSING_SCRIPTS),
    "pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n',
    "packages/a/package.json": manifest("pkg-a", PASSING_SCRIPTS),
    "packages/b/package.json": manifest("pkg-b", PASSING_SCRIPTS),
  };
}
