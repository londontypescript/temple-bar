// Checking a targeted run's test file (`--only <file>`) before anything is
// contacted: it must pass the path rule the runner shares, and be a file the
// recorded commit tracks. The tree is already required clean, so that commit
// is what is on disk.

import { testTarget } from "./remote/only-target.ts";
import type { LocalDeps } from "./seams.ts";

/** Why `file` can't be run, for the terminal; undefined when it can. */
export function pathProblem(file: string): string | undefined {
  return testTarget(file) === undefined
    ? `${JSON.stringify(file)} is not a test file the suite runs. Give its repo-relative path with forward slashes, using only letters, digits, dots, underscores, hyphens and slashes, ending .test.ts, under scripts/, e2e/ or packages/<name>/src/`
    : undefined;
}

/** Why `file` isn't a regular file tracked at `sha`, or undefined. */
export async function trackedProblem(
  deps: LocalDeps,
  sha: string,
  file: string,
): Promise<string | undefined> {
  // --full-tree reads the path from the top of the repo, wherever this runs.
  const listing = await deps.git.run(
    ["ls-tree", "-z", "--full-tree", sha, "--", file],
    deps.cwd,
  );
  const entries = listing.stdout.split("\0").filter((entry) => entry !== "");
  const [entry] = entries;
  // Each entry is "<mode> <type> <object>\t<path>".
  const match =
    entry === undefined ? null : /^(\d+) (\w+) \S+\t(.*)$/s.exec(entry);
  const tracked =
    listing.code === 0 &&
    entries.length === 1 &&
    match !== null &&
    match[2] === "blob" &&
    // 120000 is a symbolic link, which is not the file it names.
    match[1] !== "120000" &&
    match[3] === file;
  return tracked
    ? undefined
    : `${file} is not a file tracked in the commit being run (${sha.slice(0, 7)}): commit it first, or check the path`;
}
