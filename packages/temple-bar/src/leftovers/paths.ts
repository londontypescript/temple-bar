// Paths as git and the disk give them, used whole. A path can hold spaces,
// newlines and any byte but NUL, so git's output is read NUL-delimited with
// only the terminator removed, and never trimmed: trimming would turn
// "notes " into "notes", a different file.

/** git's NUL-terminated entries, each whole. Undefined when the output
 * doesn't end with a NUL, which means it was cut short. */
export function splitNul(stdout: string): string[] | undefined {
  if (stdout === "") {
    return [];
  }
  return stdout.endsWith("\0") ? stdout.slice(0, -1).split("\0") : undefined;
}

/** One value git printed on its own line, with only that newline removed. */
export function withoutNewline(stdout: string): string | undefined {
  return stdout.endsWith("\n") && stdout.length > 1
    ? stdout.slice(0, -1)
    : undefined;
}

/** Bytes that aren't UTF-8 reach Node as U+FFFD, and can't be turned back
 * into the name on disk, so a path holding one can't be checked or named. */
export function undecodable(text: string): boolean {
  return text.includes("�");
}

/** How two paths are compared: one separator, no trailing one, and case
 * folded where the file system folds it by default (Windows and macOS). */
function pathKey(
  entry: string,
  platform: NodeJS.Platform = process.platform,
): string {
  let key = entry.replaceAll("\\", "/");
  while (key.endsWith("/") && key !== "/" && !/^[A-Za-z]:\/$/.test(key)) {
    key = key.slice(0, -1);
  }
  return platform === "win32" || platform === "darwin"
    ? key.toLowerCase()
    : key;
}

/** True when `inner` is `outer` or anywhere inside it. */
export function isInside(inner: string, outer: string): boolean {
  const child = pathKey(inner);
  const parent = pathKey(outer);
  return (
    child === parent ||
    child.startsWith(parent.endsWith("/") ? parent : `${parent}/`)
  );
}

/** Every folder on the way to a "/"-separated relative path, from the top:
 * "a/b/c" gives "a" and "a/b". */
export function foldersOnTheWay(relative: string): string[] {
  const parts = relative.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** At most a few paths, for a reason line a person can read. */
export function firstFew(paths: readonly string[], count = 3): string {
  const shown = paths.slice(0, count).map((entry) => JSON.stringify(entry));
  const more = paths.length - shown.length;
  return more > 0
    ? `${shown.join(", ")} and ${String(more)} more`
    : shown.join(", ");
}

export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}
