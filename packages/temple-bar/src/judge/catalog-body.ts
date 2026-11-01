// The body of the catalog: each line read as empty, a comment or one
// entry, then the two sides walked in step to find which entries changed
// value and which were added. Anything else (an entry removed or moved, a
// comment edited, temple-bar's own entry touched) is a finding naming its
// rule. See "The entry" and "Comparing the two sides" in
// docs/adr/0015-every-package-checked-and-guarded.md.

import { fail, type Checked, type Side } from "./catalog-lines.ts";
import { TEMPLE_BAR_PACKAGE } from "./manifests.ts";

export interface Entry {
  readonly kind: "entry";
  readonly line: number;
  readonly text: string;
  /** The key as written, quotes and all. */
  readonly written: string;
  /** The key's unquoted text: what keys compare as. */
  readonly key: string;
}

export type BodyLine =
  | Entry
  /** An empty line or a comment line. */
  | { readonly kind: "other"; readonly line: number; readonly text: string };

export interface CatalogEdit {
  readonly how: "changed" | "added";
  readonly entry: Entry;
}

// Two spaces, a key, `: `, a value and nothing more. The key's alternatives
// are wide on purpose: a quoted or odd key still splits off here, so the
// finding names the key's form rather than the line's shape.
const ENTRY = /^ {2}('(?:[^']|'')*'|"[^"]*"|[^ :'"][^ :]*): ([^ '"]+)$/;
const COMMENT = /^ *#/;

/** A package name YAML reads as a string whatever version it runs. */
const PLAIN_KEY = /^[a-z][a-z0-9._-]*$/;
/** Words YAML 1.1 reads as booleans or null when written bare. */
const NOT_STRINGS = new Set([
  "true",
  "false",
  "null",
  "yes",
  "no",
  "on",
  "off",
  "y",
  "n",
]);
/** YAML can only write a scoped name quoted; single quotes process no
 * escapes, and with no `''` inside they hold the text exactly. */
const SCOPED_KEY = /^'(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)'$/;
/** npm's longest package name. */
const MAX_NAME = 214;

const N = "(?:0|[1-9][0-9]*)";
const PRERELEASE = `(?:${N}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
/** A version, optionally led by `^` or `~`: always the same package on the
 * registry. No protocol, tag, range, build metadata or leading zero. */
const VERSION = new RegExp(
  `^[~^]?${N}\\.${N}\\.${N}(?:-${PRERELEASE}(?:\\.${PRERELEASE})*)?$`,
);

/** The key's unquoted text, or undefined when it is outside the grammar.
 * Keys are never folded: YAML and pnpm compare them exactly. */
function unquoted(written: string): string | undefined {
  const key = PLAIN_KEY.test(written)
    ? NOT_STRINGS.has(written)
      ? undefined
      : written
    : SCOPED_KEY.exec(written)?.[1];
  return key !== undefined && key.length <= MAX_NAME ? key : undefined;
}

/** Each body line read, or the first that is outside the grammar. */
export function readBody(
  body: readonly string[],
  start: number,
  side: Side,
): Checked<BodyLine[]> {
  const lines: BodyLine[] = [];
  for (const [index, text] of body.entries()) {
    const line = start + index;
    const at = `line ${String(line)} ${side}`;
    if (text === "" || COMMENT.test(text)) {
      lines.push({ kind: "other", line, text });
      continue;
    }
    const match = ENTRY.exec(text);
    if (match === null) {
      return fail(`entry shape: ${at}`);
    }
    const [, written = "", value = ""] = match;
    const key = unquoted(written);
    if (key === undefined) {
      return fail(`key form: the key on ${at}`);
    }
    if (!VERSION.test(value)) {
      return fail(`value grammar: the value on ${at}`);
    }
    lines.push({ kind: "entry", line, text, written, key });
  }
  return { ok: true, value: lines };
}

const entries = (lines: readonly BodyLine[]): Entry[] =>
  lines.filter((line): line is Entry => line.kind === "entry");

/** The same key twice in one body. */
export function duplicateProblem(
  lines: readonly BodyLine[],
  side: Side,
): string | undefined {
  const first = new Map<string, number>();
  for (const entry of entries(lines)) {
    const seen = first.get(entry.key);
    if (seen !== undefined) {
      return `duplicate key: ${entry.written} on lines ${String(seen)} and ${String(entry.line)} ${side}`;
    }
    first.set(entry.key, entry.line);
  }
  return undefined;
}

/** temple-bar's own entry: any key naming the package, as the manifest
 * checks read it, so `'@londontypescript/temple-bar-extra'` counts too. */
const isTempleBars = (entry: Entry): boolean =>
  entry.key.includes(TEMPLE_BAR_PACKAGE);

/** Why the walk stopped at a base line. */
function unmatched(was: BodyLine, now: BodyLine | undefined): string {
  const at = `line ${String(was.line)} on the base branch`;
  if (was.kind === "entry" && isTempleBars(was)) {
    return `temple-bar's own entry: ${was.written} on ${at} is removed or moved`;
  }
  return now === undefined
    ? `base line unmatched: ${at} is left over, so it is removed`
    : `base line unmatched: ${at} has no match at line ${String(now.line)} here`;
}

/**
 * Walks both bodies in order. At each step the pair is the same line (both
 * advance), two entries with one key and different values (a changed
 * value; both advance), or a head entry whose key is nowhere in the base
 * body (an addition; the head advances alone), preferred in that order.
 * Anything else stops the walk; base lines left over are removals.
 */
export function walk(
  base: readonly BodyLine[],
  head: readonly BodyLine[],
): Checked<CatalogEdit[]> {
  const baseKeys = new Set(entries(base).map((entry) => entry.key));
  const edits: CatalogEdit[] = [];
  let i = 0;
  let j = 0;
  while (i < base.length || j < head.length) {
    const was = base[i];
    const now = head[j];
    if (was !== undefined && was.text === now?.text) {
      i++;
      j++;
    } else if (
      was?.kind === "entry" &&
      now?.kind === "entry" &&
      was.key === now.key
    ) {
      edits.push({ how: "changed", entry: now });
      i++;
      j++;
    } else if (now?.kind === "entry" && !baseKeys.has(now.key)) {
      edits.push({ how: "added", entry: now });
      j++;
    } else if (was !== undefined) {
      return fail(unmatched(was, now));
    } else {
      return fail(
        `head line unmatched: line ${String(now?.line)} here is neither a line on the base branch nor an added entry`,
      );
    }
  }
  return { ok: true, value: edits };
}

/** A change to temple-bar's own entry, adding it included: the version CI
 * installs to judge the repository is never the pull request's to move. */
export function templeBarProblem(
  edits: readonly CatalogEdit[],
): string | undefined {
  const own = edits.find(({ entry }) => isTempleBars(entry));
  return own === undefined
    ? undefined
    : `temple-bar's own entry: ${own.entry.written} ${own.how} on line ${String(own.entry.line)} here`;
}
