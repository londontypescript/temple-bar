// temple-bar's own entries in pnpm-lock.yaml. `pnpm install
// --frozen-lockfile` checks that the lockfile matches package.json's
// version ranges, but trusts the lockfile for where each package comes
// from: a lockfile whose temple-bar entry names another tarball and its
// integrity installs that tarball while package.json, and pnpm's own output,
// still show the pinned version. So a pull request could swap the checks
// that judge it through the lockfile alone. Guarding the whole lockfile
// would send every dependency update to the maintainer, so only the parts
// that name temple-bar are compared.
//
// This reads the lockfile as text, never runs anything from it, and needs
// no YAML library. It understands the YAML pnpm writes: block mappings, one
// key per line, quoted or plain keys, and flow mappings that open and close
// on one line. YAML that could hide temple-bar's name from a text search
// (escapes, anchors and aliases, tags, explicit keys, flow mappings across
// lines) is something pnpm never writes, so finding any is treated as a
// change the judge can't read, and the judge fails closed.

export const LOCKFILE = "pnpm-lock.yaml";

/** Each part of the lockfile that names temple-bar, by where it sits
 * (its keys from the top, joined with " > "), holding its own text and
 * everything nested under it. */
type Entries = Map<string, string>;

type Read =
  | { readonly ok: true; readonly entries: Entries }
  | { readonly ok: false; readonly line: number };

const indentOf = (line: string): number =>
  line.length - line.trimStart().length;

/** The line's key, unquoted, or the whole line when it isn't `key: ...`. */
function keyOf(content: string): string {
  const quote = content[0];
  if (quote === "'" || quote === '"') {
    const end = content.indexOf(quote, 1);
    return end > 0 ? content.slice(1, end).replaceAll("''", "'") : content;
  }
  const colon = content.search(/:(\s|$)/);
  return colon > 0 ? content.slice(0, colon) : content;
}

/** Whether `{`/`[` and `}`/`]` balance on the line, outside quotes. */
function flowBalanced(content: string): boolean {
  let depth = 0;
  let quote: string | undefined;
  for (const char of content) {
    if (quote !== undefined) {
      quote = char === quote ? undefined : quote;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "{" || char === "[") {
      depth++;
    } else if (char === "}" || char === "]") {
      depth--;
    }
  }
  return depth === 0;
}

/** YAML that pnpm never writes and that could hide a package's name. */
function unexpected(line: string, content: string): boolean {
  return (
    line.slice(0, indentOf(line)).includes("\t") ||
    /^(\?|&|\*|!|<<|%)/.test(content) ||
    /:\s+[&*!]/.test(content) ||
    /"[^"]*\\/.test(content) ||
    !flowBalanced(content)
  );
}

function readEntries(text: string, name: string): Read {
  const lines = text.split(/\r?\n/);
  const entries: Entries = new Map();
  const parents: { indent: number; key: string }[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const content = line.trim();
    if (content === "" || content.startsWith("#") || content === "---") {
      continue;
    }
    if (unexpected(line, content)) {
      return { ok: false, line: index + 1 };
    }
    const indent = indentOf(line);
    while ((parents.at(-1)?.indent ?? -1) >= indent) {
      parents.pop();
    }
    const key = keyOf(content);
    if (!content.includes(name)) {
      parents.push({ indent, key });
      continue;
    }
    // The entry is this line and every deeper line under it.
    const block = [content];
    while (index + 1 < lines.length) {
      const next = lines[index + 1] ?? "";
      if (next.trim() !== "" && indentOf(next) <= indent) {
        break;
      }
      index++;
      if (unexpected(next, next.trim())) {
        return { ok: false, line: index + 1 };
      }
      block.push(next.trim());
    }
    let where = [...parents.map((parent) => parent.key), key].join(" > ");
    // YAML that names a key twice is unusual enough to be seen: the second
    // copy is kept as an entry of its own.
    while (entries.has(where)) {
      where += " (again)";
    }
    entries.set(where, block.filter((part) => part !== "").join("\n"));
  }
  return { ok: true, entries };
}

function unreadable(line: number, side: string): string {
  return `${LOCKFILE}: line ${String(line)} ${side} uses YAML pnpm doesn't write, so the judge can't tell whether it changes temple-bar's entries`;
}

/**
 * What a change to pnpm-lock.yaml does to the entries naming the package
 * `name` (temple-bar): one line, or none when they are the same on both
 * sides. Undefined text means there is no lockfile on that side.
 */
export function lockfileFindings(
  name: string,
  before: string | undefined,
  after: string | undefined,
): string[] {
  const was = readEntries(before ?? "", name);
  const now = readEntries(after ?? "", name);
  // Unreadable means unknown, and the judge fails closed on the unknown.
  if (!was.ok) {
    return [unreadable(was.line, "on the base branch")];
  }
  if (!now.ok) {
    return [unreadable(now.line, "here")];
  }
  const changed: string[] = [];
  for (const where of new Set([...was.entries.keys(), ...now.entries.keys()])) {
    const before = was.entries.get(where);
    const after = now.entries.get(where);
    if (before !== after) {
      const how =
        before === undefined
          ? "added"
          : after === undefined
            ? "removed"
            : "changed";
      changed.push(`${where} (${how})`);
    }
  }
  return changed.length === 0
    ? []
    : [`${LOCKFILE}: temple-bar's entries: ${changed.join("; ")}`];
}
