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

/** What the head holds besides the root pnpm-workspace.yaml that decides
 * whether a change to its catalog can reach temple-bar's own install (see
 * catalog-facts.ts). Each list is sorted, so the order a reader lists its
 * tree in never matters. */
export interface CatalogContext {
  /** The head's root package.json, its text read. */
  readonly rootManifest: FileState;
  /** Root entries that fold to pnpm-workspace.yaml or package.json
   * without being exactly that name. */
  readonly foldedTwins: readonly string[];
  /** Entries at any depth whose folded name starts with `.pnpmfile.`. */
  readonly pnpmfiles: readonly string[];
  /** Entries at any depth whose folded name is `.npmrc`. */
  readonly npmrcs: readonly string[];
}

/** A guarded path that differs between the base and the head. */
export interface PathChange {
  readonly path: string;
  readonly base: FileState;
  readonly head: FileState;
  /** Set by both readers on the root pnpm-workspace.yaml's change. Missing
   * means unknown, and unknown never lets a catalog change pass. */
  readonly catalogContext?: CatalogContext;
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
