// A guarded path's state on each side of a change, as the readers hand it
// to the comparison: GitHub's trees and blobs for the judge, git for
// `ready` and `merge`. The comparison never reads anything itself.

/** One side of a changed path. */
export type FileState =
  | { readonly kind: "absent" }
  /** A regular file. `text` is there for the paths whose text the
   * comparison reads (see readsText in guarded-paths.ts). */
  | { readonly kind: "regular"; readonly mode: string; readonly text?: string }
  /** A symlink, a submodule or a folder: never read as a file. */
  | { readonly kind: "special"; readonly mode: string }
  /** Present or not, nobody knows: it never counts as absent. */
  | { readonly kind: "unreadable"; readonly reason: string };

/** A guarded path that differs between the base and the head. */
export interface PathChange {
  readonly path: string;
  readonly base: FileState;
  readonly head: FileState;
}

type Readable = Exclude<FileState, { kind: "unreadable" }>;

/** A line for each side that couldn't be read: unknown is treated as a
 * change, so the checks fail closed. */
export function unreadableFindings(
  file: string,
  base: FileState,
  head: FileState,
): string[] {
  const sides = [
    [base, "on the base branch"],
    [head, "here"],
  ] as const;
  return sides.flatMap(([state, where]) =>
    state.kind === "unreadable"
      ? [`${file} (could not read it ${where}: ${state.reason})`]
      : [],
  );
}

/** A line when the head is not a regular file, or the file's mode
 * changed: either can point the path at text the judge doesn't guard. */
export function modeFindings(
  file: string,
  base: Readable,
  head: Readable,
): string[] {
  if (head.kind === "special") {
    return [`${file} (not a regular file)`];
  }
  if (base.kind !== "absent" && head.kind !== "absent") {
    return base.mode === head.mode
      ? []
      : [`${file} (mode changed from ${base.mode} to ${head.mode})`];
  }
  return [];
}

/** A regular file's text, which its reader must have read. */
export function textOf(
  file: string,
  state: Extract<FileState, { kind: "regular" }>,
): string {
  if (state.text === undefined) {
    throw new Error(`findCheckChanges: ${file} changed but wasn't read`);
  }
  return state.text;
}
