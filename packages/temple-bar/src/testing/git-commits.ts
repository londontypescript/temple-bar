// Commits made straight from a map of files, for tests of the readers that
// compare two commits. Built with git's plumbing and never through the
// working tree, so a path no filesystem allows (a tab, a newline, a quote
// on Windows) and a symlink or a submodule work the same on every platform.
// Excluded from the built package (tsconfig.build.json).
//
// Starting a git process costs tens of milliseconds on Windows, against a
// couple on Linux, and the judge's tests make hundreds of commits, so a
// commit here starts as few git processes as it can.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

/** A file's mode, and either the text its blob holds or the commit a
 * submodule is pinned at. */
type Entry = { mode: string; text: string } | { mode: "160000"; id: string };

function entryOf(file: RepoFile): Entry {
  if (typeof file === "string") {
    return { mode: "100644", text: file };
  }
  if ("text" in file) {
    return { mode: "100755", text: file.text };
  }
  if ("symlink" in file) {
    return { mode: "120000", text: file.symlink };
  }
  return { mode: "160000", id: file.submodule };
}

/** Stores every text as a blob with one git process and gives their ids, in
 * order. Git reads each from a numbered file in `folder`, never from the
 * file's repository path, which may hold a name no filesystem allows. */
function writeBlobs(
  dir: string,
  folder: string,
  texts: readonly string[],
): string[] {
  if (texts.length === 0) {
    return [];
  }
  const paths = texts.map((text, i) => {
    const file = path.join(folder, `${String(i)}.blob`);
    writeFileSync(file, text);
    return file;
  });
  // --no-filters stores the bytes as written, as writeBlob's --stdin does,
  // whatever line-ending settings the repo has.
  const ids = git(
    dir,
    ["hash-object", "-w", "--no-filters", "--stdin-paths"],
    paths.map((file) => `${file}\n`).join(""),
  ).split("\n");
  if (ids.length !== texts.length) {
    throw new Error(
      `commitFiles: git stored ${String(ids.length)} blobs for ${String(texts.length)} files`,
    );
  }
  return ids;
}

/** The tree holding exactly `files`, built in a throwaway index. */
function writeTree(
  dir: string,
  files: Readonly<Record<string, RepoFile>>,
): string {
  const listed = Object.entries(files).map(
    ([file, content]) => [file, entryOf(content)] as const,
  );
  // The blob files and the index live in a folder of their own, deleted
  // before this returns: the test's temp folder check runs when the test
  // file ends and must find nothing left by a commit.
  const folder = mkdtempSync(path.join(tmpdir(), "tb-commit-"));
  try {
    const ids = writeBlobs(
      dir,
      folder,
      listed.flatMap(([, entry]) => ("text" in entry ? [entry.text] : [])),
    );
    let blob = 0;
    const lines = listed.map(([file, entry]) => {
      const id = "text" in entry ? ids[blob++] : entry.id;
      return `${entry.mode} ${String(id)}\t${file}\0`;
    });
    const env = { GIT_INDEX_FILE: path.join(folder, "index") };
    // Git for Windows refuses paths no Windows filesystem allows (a quote, a
    // tab) unless core.protectNTFS is off, and --index-info skips them with
    // only a warning. Nothing here is ever checked out, so it is safe to
    // turn off for this throwaway index.
    git(
      dir,
      ["-c", "core.protectNTFS=false", "update-index", "-z", "--index-info"],
      lines.join(""),
      env,
    );
    return git(dir, ["write-tree"], undefined, env);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** A path git takes into an index on every platform: letters, digits, dots,
 * dashes and underscores between single slashes, with no "." or ".."
 * segment and no ".git". Any other path may be one git skips. */
function isPlainPath(file: string): boolean {
  return file
    .split("/")
    .every(
      (segment) =>
        /^[\w.-]+$/.test(segment) &&
        segment !== "." &&
        segment !== ".." &&
        segment.toLowerCase() !== ".git",
    );
}

/** Never a commit missing a path the test asked for: a skipped one would
 * make the test judge a different change from the one it names. */
function assertAllListed(
  dir: string,
  tree: string,
  files: Readonly<Record<string, RepoFile>>,
): void {
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
}

/** A commit whose tree holds exactly `files`, on top of `parent` if given.
 * `dir` must be a repo set up by initTestRepo. */
export function commitFiles(
  dir: string,
  files: Readonly<Record<string, RepoFile>>,
  parent?: string,
): string {
  const tree = writeTree(dir, files);
  if (!Object.keys(files).every(isPlainPath)) {
    assertAllListed(dir, tree, files);
  }
  const parents = parent === undefined ? [] : ["-p", parent];
  return git(dir, ["commit-tree", tree, ...parents, "-m", "test"]);
}

/** Deletes a loose object, as a damaged or partial clone would lack it. */
export function deleteObject(dir: string, id: string): void {
  const objects = git(dir, ["rev-parse", "--git-path", "objects"]);
  rmSync(path.resolve(dir, objects, id.slice(0, 2), id.slice(2)));
}
