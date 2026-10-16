// One entry of a git tree, as both readers see it: GitHub's trees API for
// the judge and `git ls-tree` for `ready` and `merge`. Checked the same way
// on both, so a shape one reader refuses the other refuses too.

export interface TreeEntry {
  readonly mode: string;
  readonly type: string;
  readonly id: string;
}

/** Each mode git writes, and the only object type it goes with. */
const TYPE_OF_MODE: ReadonlyMap<string, string> = new Map([
  ["100644", "blob"],
  ["100755", "blob"],
  ["120000", "blob"],
  ["160000", "commit"],
  ["040000", "tree"],
]);

/** A SHA-1 object id, as GitHub and git name every object. */
const OBJECT_ID = /^[0-9a-f]{40}$/;

/** The entry, or undefined when its mode is unknown, its type doesn't go
 * with its mode, or its id isn't an object id. */
export function checkEntry(
  mode: unknown,
  type: unknown,
  id: unknown,
): TreeEntry | undefined {
  if (
    typeof mode !== "string" ||
    typeof type !== "string" ||
    typeof id !== "string" ||
    TYPE_OF_MODE.get(mode) !== type ||
    !OBJECT_ID.test(id)
  ) {
    return undefined;
  }
  return { mode, type, id };
}

/** A path as git stores it in a tree: no NUL, and no empty, "." or ".."
 * part, so no leading or trailing "/". Anything else can't be a real
 * entry, and could dodge a rule by its spelling: `node_modules/../a`
 * would be left out as if it sat under node_modules. */
export function isTreePath(path: string): boolean {
  return (
    !path.includes("\0") &&
    path
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

/** A regular file, executable or not. Everything else, a symlink, a
 * submodule or a folder, is never read as a file's text: a package.json
 * made a symlink can show the same text as before and later follow a file
 * the judge doesn't guard. */
export function isRegularFile(entry: TreeEntry): boolean {
  return entry.mode === "100644" || entry.mode === "100755";
}
