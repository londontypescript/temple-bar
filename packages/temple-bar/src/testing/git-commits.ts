// Commits made straight from a map of files, for tests of the readers that
// compare two commits. Built with git's plumbing and never through the
// working tree, so a path no filesystem allows (a tab, a newline, a quote
// on Windows) and a symlink or a submodule work the same on every platform.
// Excluded from the built package (tsconfig.build.json).

import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

/** A file as a test gives it. Text alone is a regular file. */
export type RepoFile =
  | string
  | { readonly text: string; readonly executable: true }
  /** A symbolic link; git stores its target as the blob's text. */
  | { readonly symlink: string }
  /** A submodule, pinned at this commit. It has no blob. */
  | { readonly submodule: string };

function git(
  dir: string,
  args: readonly string[],
  input?: string,
  env: NodeJS.ProcessEnv = {},
): string {
  return execFileSync("git", args, {
    cwd: dir,
    input,
    encoding: "utf8",
    env: { ...process.env, ...env },
  }).trim();
}

/** Stores `text` as a blob and gives its id. */
export function writeBlob(dir: string, text: string): string {
  return git(dir, ["hash-object", "-w", "--stdin"], text);
}

function modeAndId(dir: string, file: RepoFile): [string, string] {
  if (typeof file === "string") {
    return ["100644", writeBlob(dir, file)];
  }
  if ("text" in file) {
    return ["100755", writeBlob(dir, file.text)];
  }
  if ("symlink" in file) {
    return ["120000", writeBlob(dir, file.symlink)];
  }
  return ["160000", file.submodule];
}

/** A commit whose tree holds exactly `files`, on top of `parent` if given.
 * `dir` must be a repo set up by initTestRepo. */
export function commitFiles(
  dir: string,
  files: Readonly<Record<string, RepoFile>>,
  parent?: string,
): string {
  const index = path.resolve(
    dir,
    git(dir, ["rev-parse", "--git-dir"]),
    "test-index",
  );
  const env = { GIT_INDEX_FILE: index };
  rmSync(index, { force: true });
  const entries = Object.entries(files).map(([file, content]) => {
    const [mode, id] = modeAndId(dir, content);
    return `${mode} ${id}\t${file}\0`;
  });
  // Git for Windows refuses paths no Windows filesystem allows (a quote, a
  // tab) unless core.protectNTFS is off, and --index-info skips them with
  // only a warning. Nothing here is ever checked out, so it is safe to
  // turn off for this throwaway index.
  git(
    dir,
    ["-c", "core.protectNTFS=false", "update-index", "-z", "--index-info"],
    entries.join(""),
    env,
  );
  const tree = git(dir, ["write-tree"], undefined, env);
  rmSync(index, { force: true });
  // Never a commit missing a path the test asked for: a skipped one would
  // make the test judge a different change from the one it names.
  const listed = execFileSync(
    "git",
    ["ls-tree", "-r", "-z", "--name-only", "--full-tree", tree],
    { cwd: dir, encoding: "utf8" },
  )
    .split("\0")
    .filter((file) => file !== "");
  const missing = Object.keys(files).filter((file) => !listed.includes(file));
  if (missing.length > 0) {
    throw new Error(`commitFiles: git left out ${JSON.stringify(missing)}`);
  }
  const parents = parent === undefined ? [] : ["-p", parent];
  return git(dir, ["commit-tree", tree, ...parents, "-m", "test"]);
}

/** Deletes a loose object, as a damaged or partial clone would lack it. */
export function deleteObject(dir: string, id: string): void {
  const objects = git(dir, ["rev-parse", "--git-path", "objects"]);
  rmSync(path.resolve(dir, objects, id.slice(0, 2), id.slice(2)));
}
