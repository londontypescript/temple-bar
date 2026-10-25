// Which test file a targeted run (`pnpm windows-run --only <file>`) may run,
// and the command that runs it the way `pnpm test` would. Both sides use it:
// the local side to refuse a path before contacting anything, and the
// runner's entry point to refuse anything else that reaches it. It lives in
// the runner's folder because that folder is what is sent to the machine.

/** Only these characters, so the path can sit on the SSH command line that
 * the machine's `cmd` reads without any of cmd's quoting coming into play. */
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;
const PACKAGE_DIR = "packages";

/** The folders each workspace's `test` script covers, in the order its
 * globs name them: the root's covers scripts/ and e2e/, and every package's
 * covers its own src/. A test checks this against the scripts themselves. */
export const ROOT_TEST_FOLDERS = ["scripts", "e2e"] as const;
export const PACKAGE_TEST_FOLDERS = ["src"] as const;
export const TEST_FILE_SUFFIX = ".test.ts";

export interface TestTarget {
  /** The workspace's folder, repo-relative: "" for the root, or
   * `packages/<name>`. */
  readonly workspace: string;
  /** The file relative to that folder, as its `test` script would name it. */
  readonly file: string;
}

/**
 * Where `repoPath` (repo-relative, forward slashes) runs, or undefined when
 * it is not a test file one of the repo's `test` scripts covers. Every
 * segment must be a plain name: none empty, none starting with a dot (which
 * rules out `.` and `..`, and the dot folders a glob doesn't enter).
 */
export function testTarget(repoPath: string): TestTarget | undefined {
  if (!SAFE_PATH.test(repoPath) || !repoPath.endsWith(TEST_FILE_SUFFIX)) {
    return undefined;
  }
  const segments = repoPath.split("/");
  if (segments.some((segment) => segment === "" || segment.startsWith("."))) {
    return undefined;
  }
  const [first, second, third] = segments;
  if (
    segments.length >= 2 &&
    ROOT_TEST_FOLDERS.some((folder) => folder === first)
  ) {
    return { workspace: "", file: repoPath };
  }
  if (
    first === PACKAGE_DIR &&
    second !== undefined &&
    segments.length >= 4 &&
    PACKAGE_TEST_FOLDERS.some((folder) => folder === third)
  ) {
    return {
      workspace: `${PACKAGE_DIR}/${second}`,
      file: segments.slice(2).join("/"),
    };
  }
  return undefined;
}

/**
 * The arguments for `node` that the workspace's `test` script passes before
 * its globs: the repo's test runner and the two setup files every test file
 * loads, reached from the workspace's folder. `pnpm test` itself can't run
 * one file: pnpm adds extra arguments after the script's globs, so the whole
 * suite would still run.
 */
export function runnerArgs(workspace: string): string[] {
  const up = workspace === "" ? "" : "../".repeat(workspace.split("/").length);
  // An `--import` value is a module specifier, so at the root it needs the
  // `./` that a bare relative path lacks, exactly as the root script has it.
  const imported = up === "" ? "./" : up;
  return [
    `${up}scripts/run-tests.ts`,
    "--import",
    `${imported}scripts/isolate-git-config.ts`,
    "--import",
    `${imported}scripts/isolate-temp-folder.ts`,
    "--test",
  ];
}

/** The whole command for one file: `node`, needing no shell, so nothing here
 * meets `cmd`'s quoting at all. */
export function testCommand(target: TestTarget): {
  readonly command: "node";
  readonly args: readonly string[];
} {
  return {
    command: "node",
    args: [...runnerArgs(target.workspace), target.file],
  };
}
