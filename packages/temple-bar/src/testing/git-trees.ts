// A fake git's answers to the reads `ready` and `merge` make of a guarded
// file (merge/guarded-states.ts): `git ls-tree` for its entry at a commit
// and `git cat-file blob` for its text, from each commit's files. For tests
// only; excluded from the built package (tsconfig.build.json).

import { createHash } from "node:crypto";

import type { GitResult } from "../seams/git.ts";

/** Each file's text at a commit, by path; undefined for an unknown commit. */
export type FilesAt = (
  commit: string,
) => Readonly<Record<string, string>> | undefined;

/** Answers `args` when it is one of those two reads, else undefined so the
 * caller's own fake answers. */
export type TreeReads = (args: readonly string[]) => GitResult | undefined;

export function fakeTreeReads(filesAt: FilesAt): TreeReads {
  const blobs = new Map<string, string>();
  const ok = (stdout: string): GitResult => ({ code: 0, stdout, stderr: "" });
  return (args) => {
    if (args.includes("ls-tree")) {
      // ... ls-tree -z --full-tree <commit> -- <path>
      const commit = args.at(-3) ?? "";
      const file = args.at(-1) ?? "";
      const files = filesAt(commit);
      if (files === undefined) {
        return { code: 128, stdout: "", stderr: "fatal: not a tree object" };
      }
      const text = Object.hasOwn(files, file) ? files[file] : undefined;
      if (text === undefined) {
        return ok("");
      }
      const id = createHash("sha1")
        .update(`blob ${String(Buffer.byteLength(text))}\0`)
        .update(text)
        .digest("hex");
      blobs.set(id, text);
      return ok(`100644 blob ${id}\t${file}\0`);
    }
    if (args[0] === "cat-file" && args[1] === "blob") {
      const text = blobs.get(args[2] ?? "");
      return text === undefined
        ? { code: 128, stdout: "", stderr: "fatal: bad file" }
        : ok(text);
    }
    return undefined;
  };
}
