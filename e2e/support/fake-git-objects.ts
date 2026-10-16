// The git objects behind the fake GitHub API: each ref's files turned into
// blobs and trees with git's own ids, so identical content has the same id
// on both sides of a pull request, as on GitHub, and a judge that compares
// ids sees exactly what it would see there. The ids are the ones `git
// write-tree` gives for the same files; the tests check that against git.

import { createHash } from "node:crypto";

/** A file as a test gives it. Text alone is a regular file. */
export type FakeFile =
  | string
  | { readonly text: string; readonly executable: true }
  /** A symbolic link; git stores its target as the blob's text. */
  | { readonly symlink: string }
  /** A submodule, pinned at this commit. It has no blob. */
  | { readonly submodule: string };

/** A tree entry as GitHub's trees API lists it. */
export interface TreeEntry {
  readonly path: string;
  readonly mode: "100644" | "100755" | "120000" | "160000" | "040000";
  readonly type: "blob" | "tree" | "commit";
  readonly sha: string;
  /** The blob's size in bytes, which GitHub gives for blobs only. */
  readonly size?: number;
}

export interface GitObjects {
  /** Each blob's text, by id. */
  readonly blobs: ReadonlyMap<string, string>;
  /** Each tree's own entries, by id, in git's order. */
  readonly trees: ReadonlyMap<string, readonly TreeEntry[]>;
  /** Each ref's root tree id. */
  readonly roots: ReadonlyMap<string, string>;
}

function hash(kind: string, body: Buffer): string {
  return createHash("sha1")
    .update(`${kind} ${String(body.length)}\0`)
    .update(body)
    .digest("hex");
}

/** Git sorts a tree's entries by name as bytes, with a folder's name read
 * as if it ended in "/", so "a.json" comes before the folder "a". */
function sortKey(entry: TreeEntry): Buffer {
  return Buffer.from(entry.type === "tree" ? `${entry.path}/` : entry.path);
}

function leaf(file: FakeFile, store: Map<string, string>) {
  if (typeof file !== "string" && "submodule" in file) {
    return { mode: "160000", type: "commit", sha: file.submodule } as const;
  }
  const text =
    typeof file === "string"
      ? file
      : "symlink" in file
        ? file.symlink
        : file.text;
  const sha = hash("blob", Buffer.from(text, "utf8"));
  store.set(sha, text);
  const mode =
    typeof file === "string"
      ? "100644"
      : "symlink" in file
        ? "120000"
        : "100755";
  return { mode, type: "blob", sha, size: Buffer.byteLength(text) } as const;
}

interface Folder {
  readonly files: Map<string, FakeFile>;
  readonly folders: Map<string, Folder>;
}

function folderFor(files: ReadonlyMap<string, FakeFile>, ref: string): Folder {
  const root: Folder = { files: new Map(), folders: new Map() };
  for (const [filePath, file] of files) {
    const parts = filePath.split("/");
    const name = parts.pop() ?? "";
    let at = root;
    for (const part of parts) {
      const next = at.folders.get(part) ?? {
        files: new Map(),
        folders: new Map(),
      };
      at.folders.set(part, next);
      at = next;
    }
    at.files.set(name, file);
  }
  // A path that is both a file and a folder can't exist in git, so it is a
  // mistake in the test, not something to answer.
  const check = (folder: Folder, at: string): void => {
    for (const [name, sub] of folder.folders) {
      if (folder.files.has(name)) {
        throw new Error(`${ref}: "${at}${name}" is both a file and a folder`);
      }
      check(sub, `${at}${name}/`);
    }
  };
  check(root, "");
  return root;
}

function writeTree(
  folder: Folder,
  blobs: Map<string, string>,
  trees: Map<string, readonly TreeEntry[]>,
): string {
  const entries: TreeEntry[] = [];
  for (const [name, file] of folder.files) {
    entries.push({ path: name, ...leaf(file, blobs) });
  }
  for (const [name, sub] of folder.folders) {
    const sha = writeTree(sub, blobs, trees);
    entries.push({ path: name, mode: "040000", type: "tree", sha });
  }
  entries.sort((a, b) => Buffer.compare(sortKey(a), sortKey(b)));
  // In the object itself a folder's mode has no leading zero.
  const body = Buffer.concat(
    entries.flatMap((entry) => [
      Buffer.from(`${entry.mode.replace(/^0/, "")} ${entry.path}\0`),
      Buffer.from(entry.sha, "hex"),
    ]),
  );
  const sha = hash("tree", body);
  trees.set(sha, entries);
  return sha;
}

/** Every ref's files as git objects. A path missing from a ref is absent
 * there. */
export function writeGitObjects(
  refs: ReadonlyMap<string, ReadonlyMap<string, FakeFile>>,
): GitObjects {
  const blobs = new Map<string, string>();
  const trees = new Map<string, readonly TreeEntry[]>();
  const roots = new Map<string, string>();
  for (const [ref, files] of refs) {
    roots.set(ref, writeTree(folderFor(files, ref), blobs, trees));
  }
  return { blobs, trees, roots };
}

/** A tree's entries by their path below it: its own, or with `recursive`
 * everything under it, depth first as GitHub lists them. */
export function listTree(
  trees: GitObjects["trees"],
  id: string,
  recursive: boolean,
  prefix = "",
): TreeEntry[] {
  return (trees.get(id) ?? []).flatMap((entry) => {
    const named = { ...entry, path: `${prefix}${entry.path}` };
    return recursive && entry.type === "tree"
      ? [named, ...listTree(trees, entry.sha, true, `${named.path}/`)]
      : [named];
  });
}

/** The entry at a path from a tree, or undefined if nothing is there. */
export function entryAt(
  trees: GitObjects["trees"],
  root: string,
  at: string,
): TreeEntry | undefined {
  let entry: TreeEntry | undefined;
  let tree: string | undefined = root;
  for (const part of at.split("/")) {
    entry = trees.get(tree ?? "")?.find((item) => item.path === part);
    tree = entry?.type === "tree" ? entry.sha : undefined;
  }
  return entry;
}

/** The regular file a symlink at `at` points to, or undefined when its
 * target is outside the repository, missing, or not a regular file. The
 * target is walked a segment at a time, as the operating system does, so
 * "missing/../x" fails at "missing" instead of being tidied into "x". A
 * symlink along the way isn't followed. */
export function followSymlink(
  trees: GitObjects["trees"],
  root: string,
  at: string,
  target: string,
): TreeEntry | undefined {
  if (target.startsWith("/")) {
    return undefined;
  }
  const parts = at.split("/").slice(0, -1);
  // The folder each part leads to, the root first.
  const folders = [root];
  for (const part of parts) {
    const entry = entryAt(trees, folders.at(-1) ?? "", part);
    folders.push(entry?.sha ?? "");
  }
  const segments = target.split("/");
  const name = segments.pop() ?? "";
  // A target ending in "/", "." or ".." names a folder, never a file.
  if (name === "" || name === "." || name === "..") {
    return undefined;
  }
  for (const segment of segments) {
    if (segment === "..") {
      if (folders.length === 1) {
        return undefined;
      }
      folders.pop();
    } else if (segment !== "" && segment !== ".") {
      const entry = entryAt(trees, folders.at(-1) ?? "", segment);
      if (entry?.type !== "tree") {
        return undefined;
      }
      folders.push(entry.sha);
    }
  }
  const file = entryAt(trees, folders.at(-1) ?? "", name);
  return file?.mode === "100644" || file?.mode === "100755" ? file : undefined;
}
